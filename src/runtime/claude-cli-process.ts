// src/runtime/claude-cli-process.ts
//
// Child-process plumbing shared by the two headless Claude CLI roles the
// runtime owns: the implementer executor and the independent reviewer. Both
// spawn a detached `claude --print` child, feed one stream-json user message
// on stdin, translate the NDJSON stdout into durable run events, and hand the
// whole process group to the service on cancellation. Keeping one lifecycle
// here is what lets the reviewer be a second role instead of a second engine.

import {
	AgentProcessActivityTimeoutError,
	type AgentProcessResult,
	runAgentProcess,
} from './agent-process.ts';
import {
	ProviderCallError,
	providerErrorFromMessage,
} from './agent-session.ts';
import {
	type ClaudeModelUsage,
	type ClaudeResultUsage,
	classifyHeadlessStreamLine,
} from './claude-stream.ts';
import type { ModelSlot } from './model-settings.ts';
import { buildClaudeAuthEnv } from './provider-env.ts';

export const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const MAX_ACTIVITY_TEXT = 2_000;

export interface ClaudeCliRunInput {
	argv: string[];
	cwd: string;
	env: Record<string, string | undefined>;
	prompt: string;
	signal: AbortSignal;
	/**
	 * `eventClass` declares GSHIP-627's activity/decision split at the emit
	 * call site; omitted means the store defaults it to `decision`.
	 */
	emit: (kind: string, payload?: Record<string, unknown>, eventClass?: 'activity' | 'decision') => void;
	/** Event namespace, so a reviewer child is distinguishable from the implementer. */
	eventPrefix: string;
	/**
	 * The pair GSHIP-617 already resolved for this spawn, so the usage event
	 * below (GSHIP-623) can carry it without a second lookup. Pass the empty
	 * slot, not an absent field, when neither is configured.
	 */
	slot: ModelSlot;
	terminationGraceMs?: number;
	activityTimeoutMs?: number;
	onSpawn?: (pid: number) => void;
}

export interface ClaudeCliResult {
	summary: string;
	structuredOutput?: unknown;
}

/**
 * `token`, when present, is the dedicated subscription credential GSHIP-704
 * resolved for this spawn -- never read from `source` here, so a value that
 * only happens to sit in the service's own environment cannot leak in
 * through this function's normal allowlist path. See `buildClaudeAuthEnv`
 * for the precedence this boundary enforces against `CLAUDE_CONFIG_DIR`.
 */
export function buildClaudeEnv(
	source: Record<string, string | undefined>,
	token?: string,
): Record<string, string | undefined> {
	return {
		...buildClaudeAuthEnv(source, token),
		// Gateship owns the provider process identity for the whole run. A child
		// may not replace the CLI behind the recorded workflow revision.
		DISABLE_UPDATES: '1',
	};
}

/** Persist only operator-visible prose and tool names from an assistant event. */
export function projectAssistantActivity(raw: Record<string, unknown>): Record<string, unknown> {
	const message = raw['message'];
	if (message === null || typeof message !== 'object' || Array.isArray(message)) return {};
	const content = (message as Record<string, unknown>)['content'];
	if (!Array.isArray(content)) return {};

	const text: string[] = [];
	const tools: string[] = [];
	for (const block of content) {
		if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
		const record = block as Record<string, unknown>;
		if (record['type'] === 'text' && typeof record['text'] === 'string') {
			text.push(record['text']);
		}
		if (record['type'] === 'tool_use' && typeof record['name'] === 'string') {
			tools.push(record['name']);
		}
	}
	const joined = text.join('\n').trim().slice(0, MAX_ACTIVITY_TEXT);
	return {
		...(joined.length === 0 ? {} : { text: joined }),
		...(tools.length === 0 ? {} : { tools }),
	};
}

/** Persist only a bounded tool result, never its name, arguments or environment. */
export function projectToolObservation(
	raw: Record<string, unknown>,
	toolNames: ReadonlyMap<string, string> = new Map(),
): Array<{ tool?: string; action: string; toolUseId?: string; result: string; isError?: boolean }> {
	const message = raw['message'];
	if (message === null || typeof message !== 'object' || Array.isArray(message)) return [];
	const content = (message as Record<string, unknown>)['content'];
	if (!Array.isArray(content)) return [];
	return content.flatMap((block) => projectToolResultBlock(block, toolNames));
}

function projectToolResultBlock(
	block: unknown,
	toolNames: ReadonlyMap<string, string>,
): Array<{ tool?: string; action: string; toolUseId?: string; result: string; isError?: boolean }> {
	if (block === null || typeof block !== 'object' || Array.isArray(block)) return [];
	const record = block as Record<string, unknown>;
	if (record['type'] !== 'tool_result') return [];
	const result = projectToolResultText(record['content']);
	if (result.length === 0) return [];
	const toolUseId = typeof record['tool_use_id'] === 'string' ? record['tool_use_id'] : undefined;
	const tool = toolUseId === undefined ? undefined : toolNames.get(toolUseId);
	const isError = typeof record['is_error'] === 'boolean' ? record['is_error'] : undefined;
	return [{ action: 'result', ...(tool === undefined ? {} : { tool }),
		...(toolUseId === undefined ? {} : { toolUseId }), result,
		...(isError === undefined ? {} : { isError }) }];
}

function projectToolResultText(value: unknown): string {
	const text = typeof value === 'string' ? value
		: Array.isArray(value) ? value.flatMap((item) => {
			if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
			const text = (item as Record<string, unknown>)['text'];
			return typeof text === 'string' ? [text] : [];
		}).join('\n')
		: '';
	return text.trim().slice(0, MAX_ACTIVITY_TEXT);
}

function compact(record: object): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record).filter(([, value]) => value !== undefined),
	);
}

interface ClaudeRateLimitInfo {
	status: 'allowed' | 'allowed_warning' | 'rejected';
	rateLimitType?: string;
	retryAt?: string;
	usedPercent?: number;
}

function retryAtFromUnixSeconds(value: unknown): string | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const date = new Date(value * 1_000);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * `rate_limit_info.utilization` is a 0-1 fraction of the reported window
 * (measured on a real Gateship Claude invocation, 2026-08-21: `{"status":
 * "allowed_warning","resetsAt":..,"rateLimitType":"seven_day","utilization":
 * 0.78,...}`). Normalized into a clamped 0-100 percentage here so a
 * malformed or out-of-range value -- never observed, but not contractual --
 * cannot render as a false reading instead of simply being dropped.
 */
function usedPercentFromUtilization(value: unknown): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.min(100, Math.max(0, value * 100));
}

function readClaudeRateLimit(raw: Record<string, unknown>): ClaudeRateLimitInfo | null {
	const value = raw['rate_limit_info'];
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const info = value as Record<string, unknown>;
	const status = info['status'];
	if (status !== 'allowed' && status !== 'allowed_warning' && status !== 'rejected') return null;
	const rateLimitType = typeof info['rateLimitType'] === 'string'
		? info['rateLimitType']
		: undefined;
	const retryAt = retryAtFromUnixSeconds(info['resetsAt']);
	const usedPercent = usedPercentFromUtilization(info['utilization']);
	return {
		status,
		...(rateLimitType === undefined ? {} : { rateLimitType }),
		...(retryAt === undefined ? {} : { retryAt }),
		...(usedPercent === undefined ? {} : { usedPercent }),
	};
}

function claudeUsageLimitError(info: ClaudeRateLimitInfo): ProviderCallError {
	const window = info.rateLimitType?.replaceAll('_', ' ') ?? 'subscription';
	const reset = info.retryAt === undefined ? '' : ` until ${info.retryAt}`;
	return new ProviderCallError(
		'claude',
		'usage-limit',
		`Claude ${window} usage limit reached${reset}.`,
		info.retryAt === undefined ? {} : { retryAt: info.retryAt },
	);
}

interface ClaudeStreamState {
	resultSeen: boolean;
	resultIsError: boolean;
	summary: string;
	structuredOutput: unknown;
	rateLimitFailure?: ProviderCallError;
	toolNames: Map<string, string>;
}

function rateLimitEventPayload(info: ClaudeRateLimitInfo | null): Record<string, unknown> {
	if (info === null) return {};
	return {
		status: info.status,
		...(info.rateLimitType === undefined ? {} : { limit: info.rateLimitType }),
		...(info.retryAt === undefined ? {} : { retryAt: info.retryAt }),
		...(info.usedPercent === undefined ? {} : { usedPercent: info.usedPercent }),
	};
}

function consumeClaudeLine(
	line: string,
	input: ClaudeCliRunInput,
	state: ClaudeStreamState,
): void {
	const event = classifyHeadlessStreamLine(line);
	// Only system and assistant are activity (GSHIP-627). The provider's
	// result and availability signals remain durable decisions.
	switch (event.kind) {
		case 'system':
			consumeClaudeSystem(event.subtype, input);
			return;
		case 'assistant':
			consumeClaudeAssistant(event.raw, input, state);
			return;
		case 'user': {
			consumeClaudeUser(event.raw, input, state.toolNames);
			return;
		}
		case 'rate_limit_event': {
			consumeClaudeRateLimit(event.raw, input, state);
			return;
		}
		case 'result':
			consumeClaudeResult(event, input, state);
			return;
		default:
			return;
	}
}

function consumeClaudeSystem(subtype: string | undefined, input: ClaudeCliRunInput): void {
	input.emit(`${input.eventPrefix}.system`, { subtype: subtype ?? 'unknown' }, 'activity');
}

function consumeClaudeAssistant(raw: Record<string, unknown>, input: ClaudeCliRunInput, state: ClaudeStreamState): void {
	const message = raw['message'];
	const content = message !== null && typeof message === 'object' && !Array.isArray(message)
		? (message as Record<string, unknown>)['content'] : undefined;
	if (Array.isArray(content)) recordClaudeToolUses(content, state.toolNames);
	input.emit(`${input.eventPrefix}.activity`, projectAssistantActivity(raw), 'activity');
}

function recordClaudeToolUses(content: unknown[], toolNames: Map<string, string>): void {
	for (const block of content) {
		if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
		const record = block as Record<string, unknown>;
		if (record['type'] === 'tool_use' && typeof record['id'] === 'string' && typeof record['name'] === 'string') {
			toolNames.set(record['id'], record['name']);
		}
	}
}

function consumeClaudeUser(raw: Record<string, unknown>, input: ClaudeCliRunInput, toolNames: ReadonlyMap<string, string>): void {
	for (const observation of projectToolObservation(raw, toolNames)) input.emit(input.eventPrefix + '.tool-observation', observation);
}

function consumeClaudeRateLimit(raw: Record<string, unknown>, input: ClaudeCliRunInput, state: ClaudeStreamState): void {
	const info = readClaudeRateLimit(raw);
	input.emit(`${input.eventPrefix}.rate-limit`, rateLimitEventPayload(info));
	if (info?.status === 'rejected') state.rateLimitFailure = claudeUsageLimitError(info);
}

function consumeClaudeResult(
	event: ReturnType<typeof classifyHeadlessStreamLine>,
	input: ClaudeCliRunInput,
	state: ClaudeStreamState,
): void {
	if (event.kind !== 'result') return;
	state.resultSeen = true;
	state.resultIsError = event.raw.is_error === true;
	if (typeof event.raw.result === 'string') state.summary = event.raw.result;
	state.structuredOutput = event.raw['structured_output'];
	input.emit(`${input.eventPrefix}.result`);
	emitUsage(input.emit, input.eventPrefix, input.slot, {
		totalCostUsd: event.totalCostUsd, usage: event.usage, modelUsage: event.modelUsage,
	});
}

/**
 * One durable event per provider invocation carrying what the CLI reported
 * for it (GSHIP-623): the resolved model/effort pair beside the cost and
 * token counts, so a run's total is derivable by summing this event's kind
 * alone. Omitted entirely when the CLI reported nothing measurable -- never
 * emitted with a fabricated zero, which would read as "this call was free".
 */
function emitUsage(
	emit: (kind: string, payload?: Record<string, unknown>) => void,
	eventPrefix: string,
	slot: ModelSlot,
	result: {
		totalCostUsd: number | undefined;
		usage: ClaudeResultUsage | undefined;
		modelUsage: ClaudeModelUsage[] | undefined;
	},
): void {
	if (result.totalCostUsd === undefined && result.usage === undefined && result.modelUsage === undefined) {
		return;
	}
	emit(`${eventPrefix}.usage`, {
		...(slot.model === undefined ? {} : { model: slot.model }),
		...(slot.effort === undefined ? {} : { effort: slot.effort }),
		...(result.totalCostUsd === undefined ? {} : { totalCostUsd: result.totalCostUsd }),
		...(result.usage === undefined ? {} : { usage: compact(result.usage) }),
		...(result.modelUsage === undefined
			? {}
			: { modelUsage: result.modelUsage.map((entry) => compact(entry)) }),
	});
}

/**
 * Run one headless Claude CLI turn and return its final result text. Throws on
 * a non-zero exit, a missing result event, an error result, or cancellation --
 * and never resolves before the child process group has actually settled.
 */
export async function runClaudeCli(input: ClaudeCliRunInput): Promise<ClaudeCliResult> {
	const message = JSON.stringify({
		type: 'user',
		message: { role: 'user', content: input.prompt },
	});
	const state: ClaudeStreamState = {
		resultSeen: false,
		resultIsError: false,
		summary: '',
		structuredOutput: undefined,
		toolNames: new Map(),
	};
	let processResult: AgentProcessResult;
	try {
		processResult = await runAgentProcess({
			argv: input.argv,
			cwd: input.cwd,
			env: input.env,
			stdin: `${message}\n`,
			signal: input.signal,
			terminationGraceMs: input.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
			...(input.activityTimeoutMs === undefined
				? {}
				: { activityTimeoutMs: input.activityTimeoutMs }),
			...(input.onSpawn === undefined ? {} : { onSpawn: input.onSpawn }),
			onLine: (line) => consumeClaudeLine(line, input, state),
		});
	} catch (error) {
		if (error instanceof AgentProcessActivityTimeoutError) {
			throw new ProviderCallError(
				'claude',
				'transport-unavailable',
				`Claude CLI produced no protocol activity for ${error.timeoutMs}ms.`,
				{ cause: error },
			);
		}
		throw error;
	}
	if (state.rateLimitFailure !== undefined) throw state.rateLimitFailure;
	if (processResult.exitCode !== 0) {
		throw providerErrorFromMessage(
			'claude',
			`Claude CLI exited with ${processResult.exitCode}: ${processResult.stderr.trim().slice(-1_000)}`,
			'unknown',
		);
	}
	if (!state.resultSeen) {
		throw new ProviderCallError('claude', 'protocol-invalid', 'Claude CLI exited without a result event.');
	}
	if (state.resultIsError) {
		throw providerErrorFromMessage(
			'claude',
			state.summary || 'Claude CLI returned an error result.',
			'unknown',
		);
	}
	return {
		summary: state.summary,
		...(state.structuredOutput === undefined ? {} : { structuredOutput: state.structuredOutput }),
	};
}

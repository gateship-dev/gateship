import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import {
	AgentProcessActivityTimeoutError,
	type AgentProcessResult,
	runAgentProcess,
} from './agent-process.ts';
import {
	type AgentSession,
	type AgentSessionInput,
	type AgentSessionResult,
	ProviderCallError,
	providerErrorFromMessage,
} from './agent-session.ts';
import { buildAllowlistedEnv } from './child-env.ts';
import {
	buildWorkPrompt,
	EXECUTION_RESULT_SCHEMA,
	parseExecutionResult,
} from './claude-cli-executor.ts';
import {
	codexModelArgv,
	emitModelSelection,
	MODEL_PROBE_PROMPT,
	MODEL_PROBE_TIMEOUT_MS,
	type ModelProbeResult,
	type ModelSlot,
	type ModelSlotResolver,
	resolveModelSlot,
} from './model-settings.ts';
import type {
	RuntimeExecutionInput,
	RuntimeExecutionResult,
	RuntimeExecutor,
} from './run-runtime.ts';

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const MAX_ACTIVITY_TEXT = 2_000;

export interface CodexCliExecutorOptions {
	session?: AgentSession;
	command?: string[];
	model?: string;
	effort?: string;
	/** Asked at every spawn, so the operator's choice needs no restart. */
	resolveModel?: ModelSlotResolver;
	sourceEnv?: Record<string, string | undefined>;
	terminationGraceMs?: number;
	/** Internal/test seam; production uses the shared ten-minute constant. */
	activityTimeoutMs?: number;
	loadIssue?: (cwd: string, issueId: string) => string;
	approvedContract?: string;
	onSpawn?: (pid: number) => void;
	onExit?: (exitCode: number) => void;
}

interface CodexInvocation {
	command: string[];
	sessionId: string;
	resume: boolean;
	model?: string;
	effort?: string;
	outputSchemaPath?: string;
	readOnly?: boolean;
}

interface CodexReviewInvocation {
	command: string[];
	model?: string;
	effort?: string;
	outputSchemaPath?: string;
}

export function buildCodexCliArgv(input: CodexInvocation): string[] {
	const argv = [...input.command, 'exec'];
	if (input.resume) argv.push('resume');
	argv.push('--json');
	if (input.readOnly) {
		argv.push(
			'--ignore-user-config',
			// Without this, a read-only turn started outside a directory Codex
			// already trusts fails before it ever reaches the model check, with
			// "Not inside a trusted directory" -- which would then read as a
			// refused model even for a valid one.
			'--skip-git-repo-check',
			'-c',
			'sandbox_mode="read-only"',
			'-c',
			'approval_policy="never"',
		);
	} else {
		// Bypasses approvals and sandbox, but still never inherits user config.
		argv.push('--dangerously-bypass-approvals-and-sandbox', '--ignore-user-config');
	}
	argv.push(...codexModelArgv(input));
	if (input.outputSchemaPath !== undefined) {
		argv.push('--output-schema', input.outputSchemaPath);
	}
	if (input.resume) argv.push(input.sessionId);
	argv.push('-');
	return argv;
}

export function buildCodexReviewArgv(input: CodexReviewInvocation): string[] {
	return buildCodexCliArgv({
		...input,
		sessionId: '',
		resume: false,
		readOnly: true,
	});
}

export function buildCodexEnv(
	source: Record<string, string | undefined>,
): Record<string, string | undefined> {
	return buildAllowlistedEnv(source, ['CODEX_HOME']);
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function errorText(value: unknown): string | undefined {
	if (typeof value === 'string') return value;
	const record = recordOf(value);
	return typeof record?.['message'] === 'string' ? record['message'] : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return typeof value === 'number' ? value : undefined;
}

function compact(record: object): Record<string, unknown> {
	return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

/**
 * Codex's `turn.completed.usage` (GSHIP-888), confirmed against the pinned
 * CLI's own primary source -- the TypeScript SDK's event types (`Usage` in
 * `sdk/typescript/src/events.ts`, openai/codex tag `rust-v0.153.4`, matching
 * the `codex-cli 0.153.4` binary available while implementing this):
 * `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`,
 * `output_tokens` and `reasoning_output_tokens`, each documented as "during a
 * turn" -- per-turn, never a running total across a resumed thread, unlike
 * Claude's `modelUsage`/`total_cost_usd`. So nothing here computes a delta;
 * each `turn.completed` already reports only its own turn.
 *
 * Mapped onto the same input/output/cache/reasoning vocabulary GSHIP-623
 * already established for Claude (`cached_input_tokens` as a cache read,
 * `cache_write_input_tokens` as a cache creation, `reasoning_output_tokens`
 * as thinking) so an existing consumer reading that vocabulary is not blind
 * to Codex. Limitation on record: the SDK's own doc comments do not state
 * whether `cached_input_tokens` is included inside `input_tokens` or
 * additional to it -- unlike Anthropic's `cache_read_input_tokens`, which is
 * documented as additional -- so each field is reported exactly as received
 * and never combined into a derived total here.
 */
function parseCodexTurnUsage(event: Record<string, unknown>): Record<string, unknown> {
	const usage = recordOf(event['usage']) ?? {};
	return compact({
		inputTokens: numberField(usage, 'input_tokens'),
		outputTokens: numberField(usage, 'output_tokens'),
		cacheCreationInputTokens: numberField(usage, 'cache_write_input_tokens'),
		cacheReadInputTokens: numberField(usage, 'cached_input_tokens'),
		thinkingTokens: numberField(usage, 'reasoning_output_tokens'),
	});
}

/**
 * One durable event per Codex turn carrying what `turn.completed` reported
 * (GSHIP-888), mirroring the Claude `.usage` event GSHIP-623 established:
 * the resolved model/effort pair, tagged with `provider` and the one-call
 * `invocationId`. Omitted entirely when nothing measurable was reported --
 * never emitted with a fabricated zero, which would read as "this call was
 * free". Fires as soon as the line is parsed, so a later `protocol-invalid`
 * failure on the same call (a missing agent message) does not erase usage
 * already reported for it.
 */
function emitCodexUsage(
	emit: (kind: string, payload?: Record<string, unknown>) => void,
	eventPrefix: string,
	slot: ModelSlot,
	invocationId: string,
	event: Record<string, unknown>,
): void {
	const usage = parseCodexTurnUsage(event);
	if (Object.keys(usage).length === 0) return;
	emit(`${eventPrefix}.usage`, {
		provider: 'codex',
		invocationId,
		...(slot.model === undefined ? {} : { model: slot.model }),
		...(slot.effort === undefined ? {} : { effort: slot.effort }),
		usage,
	});
}

interface CodexStreamState {
	terminal: boolean;
	/** A clean protocol-reported turn failure, classified from its own detail. */
	turnFailed: ProviderCallError | undefined;
	/** A generic transport-style error event, classified conservatively. */
	transportFailed: ProviderCallError | undefined;
	summary: string;
	structuredOutput: unknown;
}

function buildTurnArgv(
	input: AgentSessionInput,
	options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'>,
	slot: ModelSlot,
	schemaPath: string | undefined,
	review: boolean,
): string[] {
	const shared = {
		command: options.command ?? ['codex'],
		...slot,
		...(schemaPath === undefined ? {} : { outputSchemaPath: schemaPath }),
	};
	if (review) return buildCodexReviewArgv(shared);
	return buildCodexCliArgv({
		...shared,
		sessionId: input.sessionId,
		resume: input.resume,
		readOnly: input.access === 'read-only',
	});
}

function parseEventLine(line: string): Record<string, unknown> | null {
	try {
		return recordOf(JSON.parse(line) as unknown);
	} catch {
		return null;
	}
}

export function projectCodexToolObservation(itemValue: unknown): { tool: string; action: string; result?: string; exitCode?: number } | undefined {
	const item = recordOf(itemValue);
	const itemType = item?.['type'];
	if (itemType !== 'command_execution' && itemType !== 'web_search_call') return undefined;
	const output = typeof item?.['aggregated_output'] === 'string' ? item['aggregated_output']
		: typeof item?.['output'] === 'string' ? item['output']
		: typeof item?.['result'] === 'string' ? item['result'] : undefined;
	const exitCode = typeof item?.['exit_code'] === 'number' ? item['exit_code'] : undefined;
	if ((output === undefined || output.trim().length === 0) && exitCode === undefined) return undefined;
	return {
		tool: itemType as string,
		action: 'completed',
		...(output === undefined ? {} : { result: output.trim().slice(0, MAX_ACTIVITY_TEXT) }),
		...(exitCode === undefined ? {} : { exitCode }),
	};
}

function consumeCompletedItem(
	itemValue: unknown,
	input: AgentSessionInput,
	state: CodexStreamState,
): void {
	const item = recordOf(itemValue);
	const itemType = item?.['type'];
	const observation = projectCodexToolObservation(itemValue);
	if (observation !== undefined) input.emit(input.eventPrefix + '.tool-observation', observation);
	// This is Codex's own raw provider/review output stream (GSHIP-627), the
	// equivalent of claude-cli-process.ts's `.activity` -- always declared
	// activity, never a decision the run made.
	if (itemType !== 'agent_message') {
		if (typeof itemType === 'string' && itemType !== 'reasoning') {
			input.emit(`${input.eventPrefix}.activity`, { tools: [itemType] }, 'activity');
		}
		return;
	}
	const message = item?.['text'];
	if (typeof message !== 'string') return;
	state.summary = message;
	try {
		state.structuredOutput = JSON.parse(message) as unknown;
	} catch {
		state.structuredOutput = undefined;
	}
	const text = message.trim().slice(0, MAX_ACTIVITY_TEXT);
	if (text.length > 0) input.emit(`${input.eventPrefix}.activity`, { text }, 'activity');
}

function consumeCodexEvent(
	line: string,
	input: AgentSessionInput,
	state: CodexStreamState,
	slot: ModelSlot,
	invocationId: string,
): void {
	const event = parseEventLine(line);
	if (event === null) return;
	const type = event['type'];
	if (type === 'thread.started') {
		const sessionId = event['thread_id'];
		if (typeof sessionId === 'string' && sessionId.length > 0) input.onSessionId?.(sessionId);
		return;
	}
	if (type === 'turn.failed') {
		state.turnFailed = providerErrorFromMessage(
			'codex',
			errorText(event['error']) ?? 'Codex turn failed.',
			'unknown',
		);
		return;
	}
	if (type === 'error') {
		state.transportFailed = providerErrorFromMessage(
			'codex',
			errorText(event['message']) ?? errorText(event['error']) ?? 'Codex error.',
			'transport-unavailable',
		);
		return;
	}
	if (type === 'turn.completed') {
		state.terminal = true;
		emitCodexUsage(input.emit, input.eventPrefix, slot, invocationId, event);
		return;
	}
	if (type === 'item.completed') consumeCompletedItem(event['item'], input, state);
}

function codexLifecycleCallbacks(
	input: AgentSessionInput,
	options: Pick<CodexCliExecutorOptions, 'onSpawn' | 'onExit'>,
): Pick<Parameters<typeof runAgentProcess>[0], 'onSpawn' | 'onExit'> {
	return {
		...(options.onSpawn === undefined && input.onSpawn === undefined ? {} : {
			onSpawn: (pid: number) => { options.onSpawn?.(pid); input.onSpawn?.(pid); },
		}),
		...(options.onExit === undefined && input.onExit === undefined ? {} : {
			onExit: (exitCode: number) => { options.onExit?.(exitCode); input.onExit?.(exitCode); },
		}),
	};
}

async function runCodexTurn(
	input: AgentSessionInput,
	options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'>,
	schemaPath: string | undefined,
	review = false,
): Promise<AgentSessionResult> {
	const state: CodexStreamState = {
		terminal: false,
		turnFailed: undefined,
		transportFailed: undefined,
		summary: '',
		structuredOutput: undefined,
	};
	const slot = resolveModelSlot(options);
	emitModelSelection(input.emit, input.eventPrefix, slot, 'codex');
	// Minted fresh for this one call (GSHIP-888): stable within it, distinct
	// from any other call sharing the same `sessionId` on resume or retry.
	const invocationId = randomUUID();
	let result: AgentProcessResult;
	try {
		result = await runAgentProcess({
			argv: buildTurnArgv(input, options, slot, schemaPath, review),
			cwd: input.cwd,
			env: buildCodexEnv(options.sourceEnv ?? process.env),
			stdin: input.prompt,
			signal: input.signal,
			terminationGraceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
			...(options.activityTimeoutMs === undefined
				? {}
				: { activityTimeoutMs: options.activityTimeoutMs }),
			onLine: (line) => consumeCodexEvent(line, input, state, slot, invocationId),
			...codexLifecycleCallbacks(input, options),
		});
	} catch (error) {
		if (error instanceof AgentProcessActivityTimeoutError) {
			throw new ProviderCallError(
				'codex',
				'transport-unavailable',
				`Codex CLI produced no protocol activity for ${error.timeoutMs}ms.`,
				{ cause: error },
			);
		}
		throw error;
	}
	// Only a clean turn.failed is a protocol-reported refusal; a generic error
	// event reads the same whether the model was rejected or the process just
	// died mid-stream, so it is never mistaken for a clean CLI refusal.
	if (state.turnFailed !== undefined) throw state.turnFailed;
	if (state.transportFailed !== undefined) throw state.transportFailed;
	if (result.exitCode !== 0) {
		throw providerErrorFromMessage(
			'codex',
			`Codex CLI exited with ${result.exitCode}: ${result.stderr.trim().slice(-1_000)}`,
			'unknown',
		);
	}
	if (!state.terminal) {
		throw new ProviderCallError('codex', 'protocol-invalid', 'Codex CLI exited without a turn.completed event.');
	}
	if (state.summary.length === 0) {
		throw new ProviderCallError('codex', 'protocol-invalid', 'Codex CLI completed without an agent message.');
	}
	return {
		summary: state.summary,
		...(state.structuredOutput === undefined ? {} : { structuredOutput: state.structuredOutput }),
	};
}

async function withOutputSchema(
	schema: Record<string, unknown> | undefined,
	run: (schemaPath: string | undefined) => Promise<AgentSessionResult>,
): Promise<AgentSessionResult> {
	if (schema === undefined) return run(undefined);
	const directory = mkdtempSync(join(tmpdir(), 'gship-codex-schema-'));
	const schemaPath = join(directory, 'output.schema.json');
	try {
		writeFileSync(schemaPath, JSON.stringify(schema), { mode: 0o600 });
		return await run(schemaPath);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export class CodexAgentSession implements AgentSession {
	readonly provider = 'codex' as const;
	readonly #options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'>;

	constructor(options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'> = {}) {
		this.#options = options;
	}

	async run(input: AgentSessionInput): Promise<AgentSessionResult> {
		return withOutputSchema(
			input.outputSchema,
			(schemaPath) => runCodexTurn(input, this.#options, schemaPath),
		);
	}
}

/** Fresh structured Codex review, with user config disabled and read-only access. */
export class CodexReviewSession implements AgentSession {
	readonly provider = 'codex' as const;
	readonly #options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'>;

	constructor(options: Omit<CodexCliExecutorOptions, 'loadIssue' | 'session'> = {}) {
		this.#options = options;
	}

	async run(input: AgentSessionInput): Promise<AgentSessionResult> {
		return withOutputSchema(
			input.outputSchema,
			(schemaPath) => runCodexTurn(input, this.#options, schemaPath, true),
		);
	}
}

export interface CodexModelProbeOptions {
	command?: string[];
	sourceEnv?: Record<string, string | undefined>;
	timeoutMs?: number;
}

/**
 * Spawns Codex read-only with the chosen model and effort and a trivial
 * prompt, so an invalid choice is caught at save time instead of at the next
 * real run. Reuses the same read-only argv the orchestrator's own inspection
 * turns use, with the model and effort added when the slot carries them.
 */
export async function probeCodexModel(
	slot: ModelSlot,
	cwd: string,
	options: CodexModelProbeOptions = {},
): Promise<ModelProbeResult> {
	const session = new CodexAgentSession({
		command: options.command,
		model: slot.model,
		effort: slot.effort,
		sourceEnv: options.sourceEnv,
	});
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(),
		options.timeoutMs ?? MODEL_PROBE_TIMEOUT_MS,
	);
	try {
		await session.run({
			sessionId: randomUUID(),
			resume: false,
			cwd,
			prompt: MODEL_PROBE_PROMPT,
			access: 'read-only',
			signal: controller.signal,
			emit: () => {},
			eventPrefix: 'model-probe',
		});
		return { outcome: 'accepted' };
	} catch (error) {
		if (error instanceof ProviderCallError && error.kind === 'model-refused') {
			return { outcome: 'refused', message: error.message };
		}
		return {
			outcome: 'inconclusive',
			message: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

export class CodexCliExecutor implements RuntimeExecutor {
	readonly #session: AgentSession;
	readonly #approvedContract: string | undefined;

	constructor(options: CodexCliExecutorOptions = {}) {
		this.#approvedContract = options.approvedContract;
		this.#session = options.session ?? new CodexAgentSession(options);
	}

	async execute(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
		const issue = (input.approvedContract ?? this.#approvedContract)?.trim();
		if (issue === undefined || issue.length === 0) throw new Error('approved issue contract is unavailable for this run');
		const prompt = buildWorkPrompt(
			input.issueId,
			issue,
			input.resume,
			input.reviewFeedback,
			input.operatorGuidance,
			input.operatorDecisions ?? [],
			input.fullVerifyFeedback,
			input.ciFeedback,
			input.executorHandoff,
			input.verificationFeedback,
			input.conflictFeedback,
			input.internalGuidance,
		input.reconciliationGuidance,
		input.research,
		input.operatorGuidanceSource,
		input.operatorGuidanceAuthorizationEvidence,
		);
		const result = await this.#session.run({
			sessionId: input.sessionId,
			resume: input.resume,
			cwd: input.cwd,
			prompt,
			outputSchema: EXECUTION_RESULT_SCHEMA,
			signal: input.signal,
			emit: input.emit,
			eventPrefix: 'provider',
			...(input.setSessionId === undefined ? {} : { onSessionId: input.setSessionId }),
			...(input.onExecutorSpawn === undefined ? {} : { onSpawn: input.onExecutorSpawn }),
			...(input.onExecutorExit === undefined ? {} : { onExit: input.onExecutorExit }),
		});
		const parsed = parseExecutionResult(result.structuredOutput);
		return parsed.outcome === 'waiting-user' ? { ...parsed, approvedContract: issue } : parsed;
	}
}

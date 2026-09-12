import { randomUUID } from 'node:crypto';

import type { AgentProviderId, AgentSession } from './agent-session.ts';
import { OPERATOR_LANGUAGE_CONTRACT } from './operator-language.ts';
import type {
	RuntimeCycleQuestionInput,
	RuntimeCycleQuestionResolver,
	RuntimeCycleQuestionResult,
	RuntimeCycleResponseUsage,
} from './run-runtime.ts';
import { normalizeCycleDiagnostic, type CycleObservationReference } from './cycle-diagnostic.ts';

export const CYCLE_QUESTION_RESULT_SCHEMA = {
	type: 'object',
	properties: {
		outcome: { type: 'string', enum: ['continue', 'operator'] },
		guidance: { type: ['string', 'null'] },
		reason: { type: ['string', 'null'] },
		diagnostic: { type: ['object', 'null'] },
	},
	required: ['outcome', 'guidance', 'reason', 'diagnostic'],
	additionalProperties: false,
} as const;

function recordOf(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function numberOf(record: Record<string, unknown> | null | undefined, key: string): number | undefined {
	const value = record?.[key];
	return typeof value === 'number' ? value : undefined;
}

function firstText(...values: unknown[]): string | undefined {
	return values.find((value): value is string => typeof value === 'string');
}

function reportedNumbers(record: Record<string, unknown> | null): Partial<RuntimeCycleResponseUsage> {
	const fields = [
		'inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'thinkingTokens',
	] as const;
	return Object.fromEntries(fields.flatMap((field) => {
		const value = numberOf(record, field);
		return value === undefined ? [] : [[field, value]];
	}));
}

function usageOf(
	payload: Record<string, unknown> | undefined,
	modelPayload: Record<string, unknown> | undefined,
): RuntimeCycleResponseUsage {
	const invocation = recordOf(payload?.['usage']);
	const modelUsage = Array.isArray(payload?.['modelUsage'])
		? payload['modelUsage'].filter((entry): entry is Record<string, unknown> => recordOf(entry) !== null)
		: undefined;
	const reportedModel = modelUsage?.find((entry) => typeof entry['model'] === 'string')?.['model'];
	const model = firstText(payload?.['model'], modelPayload?.['model'], reportedModel)
		?? 'provider-default';
	const effort = firstText(payload?.['effort'], modelPayload?.['effort']) ?? 'provider-default';
	const totalCostUsd = numberOf(payload, 'totalCostUsd');
	const usage: RuntimeCycleResponseUsage = {
		model,
		effort,
		...(totalCostUsd === undefined ? {} : { totalCostUsd }),
		...reportedNumbers(invocation),
		...(modelUsage === undefined ? {} : { modelUsage }),
	};
	return usage;
}

export function buildCycleQuestionPrompt(input: RuntimeCycleQuestionInput): string {
	const contractSection = input.approvedContract === undefined ? [] : [
		'',
		'Approved issue contract:',
		input.approvedContract,
	];
	return [
		`Answer one bounded Gateship cycle question for run ${input.runId}, issue ${input.issueId}.`,
		'You are the orchestrator, in a fresh mechanically read-only session. Do not edit files, approve, start, ship, or request tools that mutate state.',
		'Only the approved issue specification and recorded operator decisions are binding; other issue fields are context only.',
		'Return continue only with non-empty, concrete guidance that lets the existing executor proceed within authority already granted by the approved contract, make a precise in-scope correction, or provide an evidence-backed no-change rebuttal.',
		'Return operator only when a concrete unresolved product or authority ambiguity requires a human decision, with that ambiguity in reason.',
		'Do not expose hidden reasoning or credentials.',
		'',
		...OPERATOR_LANGUAGE_CONTRACT,
		...contractSection,
		'',
		'Current cycle question:',
		`Finding origin: ${input.origin}.`,
		input.finding,
		'',
		'Prior durable cycle responses:',
		JSON.stringify(input.priorResponses),
		'',
		'Classify the outcome in diagnostic. A correction must state hypothesis, concrete action and expected observation. Cite only observation IDs listed below. A new sentence, timestamp, diff or claimed advance is not an observation. Invalid or absent evidence means insufficient-evidence. Repetition alone, or two cycles without progress, does not determine the outcome. When the same executor question returns after concrete internal guidance and without a new recorded progress observation, preserve the legacy stall behavior and return operator with that stall as the public reason. Otherwise, treat repetition as a possible loop for re-evaluation by the existing orchestrator: choose a distinct justified action, request recorded evidence, or identify a concrete impossibility within the contract. Return operator only for that legacy stall or a concrete missing decision, authority or human data.',
		'',
		'Recorded tool observations:',
		JSON.stringify(input.observations ?? []),
	].join('\n');
}

function parseResult(value: unknown, usage: RuntimeCycleResponseUsage, observations: readonly CycleObservationReference[]): RuntimeCycleQuestionResult {
	const record = recordOf(value);
	if (record?.['outcome'] === 'continue') {
		return { outcome: 'continue', guidance: String(record['guidance'] ?? ''), usage, diagnostic: normalizeCycleDiagnostic(record['diagnostic'], observations) };
	}
	if (record?.['outcome'] === 'operator') {
		return { outcome: 'operator', reason: String(record['reason'] ?? ''), usage, diagnostic: normalizeCycleDiagnostic(record['diagnostic'], observations) };
	}
	return { outcome: 'operator', reason: '', usage, diagnostic: normalizeCycleDiagnostic(null, observations) };
}

/** Routes each run to its own provider, always as a fresh read-only call. */
export class AgentCycleQuestionResolver implements RuntimeCycleQuestionResolver {
	readonly #sessions: Readonly<Record<AgentProviderId, AgentSession>>;

	constructor(sessions: Readonly<Record<AgentProviderId, AgentSession>>) {
		this.#sessions = sessions;
	}

	async resolve(input: RuntimeCycleQuestionInput): Promise<RuntimeCycleQuestionResult> {
		let usagePayload: Record<string, unknown> | undefined;
		let modelPayload: Record<string, unknown> | undefined;
		const result = await this.#sessions[input.providerId].run({
			sessionId: randomUUID(),
			resume: false,
			cwd: input.workspace,
			prompt: buildCycleQuestionPrompt(input),
			access: 'read-only',
			outputSchema: CYCLE_QUESTION_RESULT_SCHEMA,
			signal: input.signal,
			eventPrefix: 'cycle-question',
			emit: (kind, payload, eventClass) => {
				if (kind === 'cycle-question.usage') usagePayload = payload;
				if (kind === 'cycle-question.model') modelPayload = payload;
				input.emit(kind, payload, eventClass);
			},
		});
		return parseResult(result.structuredOutput, usageOf(usagePayload, modelPayload), input.observations ?? []);
	}
}

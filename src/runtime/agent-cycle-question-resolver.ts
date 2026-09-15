import { randomUUID } from 'node:crypto';

import { ProviderCallError, type AgentProviderId, type AgentSession, type ProviderErrorKind } from './agent-session.ts';
import { OPERATOR_LANGUAGE_CONTRACT } from './operator-language.ts';
import type {
	RuntimeCycleQuestionInput,
	RuntimeCycleQuestionResolver,
	RuntimeCycleQuestionResult,
	RuntimeCycleResponseUsage,
} from './run-runtime.ts';
import { normalizeCycleDiagnostic, type CycleObservationReference } from './cycle-diagnostic.ts';

const CYCLE_DIAGNOSTIC_SCHEMA = {
	type: ['object', 'null'],
	properties: {
			kind: { type: 'string', enum: ['correction', 'human-decision', 'insufficient-evidence', 'technical-failure'] },
			hypothesis: { type: ['string', 'null'] },
			action: { type: ['string', 'null'] },
			expectedObservation: { type: ['string', 'null'] },
			question: { type: ['string', 'null'] },
			failure: { type: ['string', 'null'] },
			missing: { type: ['string', 'null'] },
			evidence: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string' }, runId: { type: 'string' }, attempt: { type: 'integer', minimum: 1 },
						verifiedVersion: { type: 'string' }, result: { type: 'string' },
						tool: { type: ['string', 'null'] }, action: { type: ['string', 'null'] }, toolUseId: { type: ['string', 'null'] },
						exitCode: { type: ['integer', 'null'] }, isError: { type: ['boolean', 'null'] },
					},
					required: ['id', 'runId', 'attempt', 'verifiedVersion', 'result', 'tool', 'action', 'toolUseId', 'exitCode', 'isError'],
					additionalProperties: false,
				},
			},
	},
	required: ['kind', 'hypothesis', 'action', 'expectedObservation', 'question', 'failure', 'missing', 'evidence'],
	additionalProperties: false,
} as const;

export const CYCLE_QUESTION_RESULT_SCHEMA = {
	type: 'object',
	properties: {
		outcome: { type: 'string', enum: ['continue', 'operator'] },
		guidance: { type: ['string', 'null'] },
		reason: { type: ['string', 'null'] },
		diagnostic: CYCLE_DIAGNOSTIC_SCHEMA,
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

/** GSHIP-888: whichever provider the raw `.usage`/`.model` events themselves reported, never guessed from `input.providerId` -- a mismatch would misreport, not just misroute. */
function providerOf(
	payload: Record<string, unknown> | undefined,
	modelPayload: Record<string, unknown> | undefined,
): AgentProviderId | undefined {
	const value = payload?.['provider'] ?? modelPayload?.['provider'];
	return value === 'codex' || value === 'claude' ? value : undefined;
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
	const provider = providerOf(payload, modelPayload);
	const invocationId = firstText(payload?.['invocationId']);
	const usage: RuntimeCycleResponseUsage = {
		model,
		effort,
		...(provider === undefined ? {} : { provider }),
		...(invocationId === undefined ? {} : { invocationId }),
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
		'For command observations, verifiedVersion identifies tracked and non-ignored worktree content only, not workflowRevision, dependencies or external services. unknown means no reliable version was recorded, including legacy events; it does not mean unchanged code or lack of progress. A different content hash does not itself prove improvement. Compare the recorded results and current finding; do not treat earlier narrative conclusions about a fixed workflow revision as code evidence. A review or full-verify finding is not a repeated executor question. Use null only for absent optional evidence fields; copy existing evidence values exactly.',
		JSON.stringify(input.observations ?? []),
	].join('\n');
}

/**
 * The durable record of one cycle-question fallback (GSHIP-892): where it
 * came from, where it went, why it was tried and what the attempt produced.
 * One event per attempt, written once the attempt has settled, so the log
 * never claims a fallback that has no outcome.
 */
export const CYCLE_QUESTION_FALLBACK_EVENT = 'run.cycle-question-fallback';

/**
 * Only a subscription limit reached before any verdict buys the alternative
 * provider, exactly as it does for the review fallback (GSHIP-709/721) this
 * mirrors. Every other failure keeps the question on its own provider.
 */
const CYCLE_QUESTION_FALLBACK_REASONS: readonly ProviderErrorKind[] = ['usage-limit', 'rate-limited'];

/** The single alternative each origin may try, in either direction. */
const CYCLE_QUESTION_FALLBACK: Readonly<Record<AgentProviderId, AgentProviderId>> = {
	claude: 'codex',
	codex: 'claude',
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

/**
 * Routes each run to its own provider, always as a fresh read-only call, and
 * -- only when that provider's own subscription limit is reached -- answers
 * with exactly one attempt on the alternative (GSHIP-892), the same policy
 * `AgentReviewerRouter` (GSHIP-709/721) applies to reviews. Both sessions are
 * already held here (`#sessions`), so the alternative attempt calls its own
 * `AgentSession` directly, never back through `resolve`: a refusal from it
 * restores the origin's own error instead of asking the origin again.
 */
export class AgentCycleQuestionResolver implements RuntimeCycleQuestionResolver {
	readonly #sessions: Readonly<Record<AgentProviderId, AgentSession>>;

	constructor(sessions: Readonly<Record<AgentProviderId, AgentSession>>) {
		this.#sessions = sessions;
	}

	async resolve(input: RuntimeCycleQuestionInput): Promise<RuntimeCycleQuestionResult> {
		const providerId = input.providerId;
		try {
			return await this.#ask(providerId, input);
		} catch (error) {
			const fallback = this.#fallbackProvider(providerId, error, input);
			if (fallback === null) throw error;
			return await this.#askWithFallback(input, providerId, fallback, error as ProviderCallError);
		}
	}

	async #ask(providerId: AgentProviderId, input: RuntimeCycleQuestionInput): Promise<RuntimeCycleQuestionResult> {
		let usagePayload: Record<string, unknown> | undefined;
		let modelPayload: Record<string, unknown> | undefined;
		const result = await this.#sessions[providerId].run({
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

	/**
	 * The alternative this failure admits, or `null` to let the original error
	 * stand. The limit must be the origin's own: a failure carrying another
	 * provider's name is not evidence that this one is held, and an aborted
	 * run is left to its own interruption instead of spawning one more child.
	 */
	#fallbackProvider(
		providerId: AgentProviderId,
		error: unknown,
		input: RuntimeCycleQuestionInput,
	): AgentProviderId | null {
		if (!(error instanceof ProviderCallError)) return null;
		if (error.provider !== providerId) return null;
		if (!CYCLE_QUESTION_FALLBACK_REASONS.includes(error.kind)) return null;
		if (input.signal.aborted) return null;
		return CYCLE_QUESTION_FALLBACK[providerId];
	}

	/**
	 * The one alternative attempt, in a fresh session of its own. Whatever it
	 * fails with -- its own limit included -- settles as this fallback's
	 * outcome and restores the origin's error, so the two directions can never
	 * hand the question back and forth.
	 */
	async #askWithFallback(
		input: RuntimeCycleQuestionInput,
		origin: AgentProviderId,
		fallback: AgentProviderId,
		held: ProviderCallError,
	): Promise<RuntimeCycleQuestionResult> {
		try {
			const result = await this.#ask(fallback, input);
			this.#emitFallback(input, origin, fallback, held, { outcome: result.outcome });
			return result;
		} catch (error) {
			this.#emitFallback(input, origin, fallback, held, {
				outcome: 'refused',
				error: errorMessage(error),
				...(error instanceof ProviderCallError ? { errorKind: error.kind } : {}),
			});
			throw held;
		}
	}

	#emitFallback(
		input: RuntimeCycleQuestionInput,
		origin: AgentProviderId,
		fallback: AgentProviderId,
		held: ProviderCallError,
		result: Record<string, unknown>,
	): void {
		input.emit(CYCLE_QUESTION_FALLBACK_EVENT, {
			from: origin,
			to: fallback,
			reason: held.kind,
			message: held.message,
			...(held.retryAt === undefined ? {} : { retryAt: held.retryAt }),
			...result,
		});
	}
}

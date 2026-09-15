// test/runtime/agent-cycle-question-resolver.test.ts
//
// The review cycle's question resolver is the fourth operator-facing agent
// text a run produces (GSHIP-703): its guidance and its reason both reach the
// operator, so it carries the same shared language contract as the executor,
// the reviewer and the conversational orchestrator.

import { describe, expect, test } from 'bun:test';

import {
	PROVIDER_ERROR_KINDS,
	ProviderCallError,
	type AgentProviderId,
	type AgentSession,
	type AgentSessionInput,
} from '../../src/runtime/agent-session.ts';
import {
	AgentCycleQuestionResolver,
	buildCycleQuestionPrompt,
	CYCLE_QUESTION_FALLBACK_EVENT,
	CYCLE_QUESTION_RESULT_SCHEMA,
} from '../../src/runtime/agent-cycle-question-resolver.ts';
import { OPERATOR_LANGUAGE_CONTRACT } from '../../src/runtime/operator-language.ts';
import type { RuntimeCycleQuestionInput } from '../../src/runtime/run-runtime.ts';

function questionInput(
	overrides: Partial<RuntimeCycleQuestionInput> = {},
): RuntimeCycleQuestionInput {
	return {
		runId: 'run-703',
		issueId: 'CAM-703',
		workspace: '/workspace',
		finding: '1. src/a.ts: o contrato quebrou',
		origin: 'review',
		priorResponses: [],
		providerId: 'claude',
		signal: new AbortController().signal,
		emit: () => {},
		...overrides,
	};
}

function capturingSession(
	provider: AgentProviderId,
	capture: (input: AgentSessionInput) => void,
): AgentSession {
	return {
		provider,
		run: async (input) => {
			capture(input);
			return {
				summary: '',
				structuredOutput: { outcome: 'continue', guidance: 'Corrija o seam.', reason: null },
			};
		},
	};
}

describe('agent cycle question resolver', () => {
	test('accepts provider-schema nulls through the production adapter for both providers', async () => {
		const observation = { id: 'run-observation-102121', runId: 'run-703', attempt: 4, verifiedVersion: 'worktree-sha256:current', result: 'exit 0', exitCode: 0 };
		const session = (provider: AgentProviderId): AgentSession => ({ provider, run: async () => ({
			summary: '', structuredOutput: { outcome: 'continue', guidance: 'Corrija o defeito atual.', reason: null,
				diagnostic: { kind: 'correction', hypothesis: 'Defeito delimitado.', action: 'Corrigir observação.', expectedObservation: 'Teste passa.', question: null, failure: null, missing: null,
					evidence: [{ ...observation, tool: null, action: null, toolUseId: null, isError: null }] } },
		}) });
		const resolver = new AgentCycleQuestionResolver({ claude: session('claude'), codex: session('codex') });
		for (const providerId of ['claude', 'codex'] as const) {
			const result = await resolver.resolve(questionInput({ providerId, observations: [observation] }));
			expect(result.diagnostic).toMatchObject({ kind: 'correction', evidence: [observation] });
		}
	});

	test('publishes a closed nullable diagnostic and evidence schema', () => {
		const diagnostic = CYCLE_QUESTION_RESULT_SCHEMA.properties.diagnostic;
		expect(diagnostic).toMatchObject({ type: ['object', 'null'], additionalProperties: false });
		const objectSchema = diagnostic.properties;
		expect(objectSchema?.evidence).toMatchObject({ type: 'array' });
		expect(objectSchema?.evidence.items).toMatchObject({ additionalProperties: false });
		expect(objectSchema?.evidence.items.required).toEqual([
			'id', 'runId', 'attempt', 'verifiedVersion', 'result', 'tool', 'action', 'toolUseId', 'exitCode', 'isError',
		]);
		expect(diagnostic.required).toEqual([
			'kind', 'hypothesis', 'action', 'expectedObservation', 'question', 'failure', 'missing', 'evidence',
		]);
	});

	test('carries the shared operator language contract, with and without prior responses', () => {
		const contract = OPERATOR_LANGUAGE_CONTRACT.join('\n');
		expect(buildCycleQuestionPrompt(questionInput())).toContain(contract);
		const prompt = buildCycleQuestionPrompt(questionInput({
			priorResponses: [{
				questionId: 'q-1',
				outcome: 'continue',
				finding: 'src/a.ts: o contrato quebrou',
				origin: 'review',
				text: 'Mantenha o seam menor.',
				createdAt: '2026-08-22T19:31:05.522Z',
			}],
		}));
		expect(prompt).toContain(contract);
		expect(prompt).toContain('"finding":"src/a.ts: o contrato quebrou"');
		expect(prompt).toContain('"origin":"review"');
	});

	// GSHIP-708: this turn holds no Issue record, so the contract's fallback
	// clause is the only thing naming a language source for it. Ruling out the
	// instructions' own English without it would leave the resolver with none.
	test('names a language source for a turn that carries no issue record', () => {
		const prompt = buildCycleQuestionPrompt(questionInput());
		expect(prompt).not.toContain('Issue record:');
		expect(prompt).toContain('When a turn carries no Issue record');
		expect(prompt).toContain('the review finding under discussion or the prior answers');
	});

	test('keeps the contract ahead of the finding and the prior responses', () => {
		const prompt = buildCycleQuestionPrompt(questionInput());
		expect(prompt.indexOf(OPERATOR_LANGUAGE_CONTRACT[0]))
			.toBeLessThan(prompt.indexOf('Current cycle question:'));
		expect(prompt.indexOf('Current cycle question:'))
			.toBeLessThan(prompt.indexOf('Prior durable cycle responses:'));
	});

	test('distinguishes a legacy stall from repetition alone', () => {
		const prompt = buildCycleQuestionPrompt(questionInput({
			priorResponses: [{
				questionId: 'q-repeat',
				outcome: 'continue',
				finding: 'Escape repetido sem efeito',
				origin: 'executor',
				text: 'Tente Escape novamente.',
				createdAt: '2026-09-12T00:00:00.000Z',
			}],
			finding: 'Escape repetido sem efeito',
		}));
		expect(prompt).toContain('Repetition alone, or two cycles without progress, does not determine the outcome.');
		expect(prompt).toContain('preserve the legacy stall behavior and return operator');
		expect(prompt).toContain('choose a distinct justified action, request recorded evidence, or identify a concrete impossibility');
		expect(prompt).toContain('Return operator only for that legacy stall or a concrete missing decision, authority or human data.');
	});

	test('gives an executor question the approved contract and identifies its origin', () => {
		const approvedContract = '{"id":"GSHIP-768","spec":{"scope":"decompor integralmente"}}';
		const prompt = buildCycleQuestionPrompt(questionInput({
			origin: 'executor',
			approvedContract,
			finding: 'A decomposição já exigida amplia escopo?',
		}));
		expect(prompt).toContain('Approved issue contract:');
		expect(prompt).toContain(approvedContract);
		expect(prompt).toContain('Finding origin: executor.');
		expect(prompt).toContain('A decomposição já exigida amplia escopo?');
	});

	test('sends each provider the same prompt, as a fresh read-only turn', async () => {
		const turns: Record<string, AgentSessionInput> = {};
		const resolver = new AgentCycleQuestionResolver({
			claude: capturingSession('claude', (input) => { turns['claude'] = input; }),
			codex: capturingSession('codex', (input) => { turns['codex'] = input; }),
		});

		for (const providerId of ['claude', 'codex'] as const) {
			const result = await resolver.resolve(questionInput({ providerId }));
			expect(result.outcome).toBe('continue');
		}

		expect(turns['claude']?.prompt).toBe(buildCycleQuestionPrompt(questionInput()));
		expect(turns['codex']?.prompt).toBe(turns['claude']?.prompt);
		for (const turn of Object.values(turns)) {
			expect(turn.access).toBe('read-only');
			expect(turn.resume).toBe(false);
		}
	});

	// GSHIP-888: the resolver is an existing consumer of the adapters' `.usage`
	// event; it must propagate the provider tag and the invocation link the
	// adapters now attach, not just the token counts it already read.
	test('propagates the provider tag, invocation id and token counts from the underlying usage event', async () => {
		const session: AgentSession = {
			provider: 'codex',
			run: async (input) => {
				input.emit('cycle-question.model', { model: 'gpt-5-codex', effort: 'high', provider: 'codex' });
				input.emit('cycle-question.usage', {
					provider: 'codex',
					invocationId: 'invocation-888',
					model: 'gpt-5-codex',
					effort: 'high',
					usage: { inputTokens: 40, outputTokens: 10, cacheCreationInputTokens: 2, cacheReadInputTokens: 3, thinkingTokens: 5 },
				});
				return { summary: '', structuredOutput: { outcome: 'continue', guidance: 'Prossiga.', reason: null } };
			},
		};
		const resolver = new AgentCycleQuestionResolver({ claude: session, codex: session });
		const result = await resolver.resolve(questionInput({ providerId: 'codex' }));
		expect(result.usage).toMatchObject({
			provider: 'codex',
			invocationId: 'invocation-888',
			model: 'gpt-5-codex',
			effort: 'high',
			inputTokens: 40,
			outputTokens: 10,
			cacheCreationInputTokens: 2,
			cacheReadInputTokens: 3,
			thinkingTokens: 5,
		});
	});
});

// GSHIP-892: a usage-limit or rate-limited failure on the run's own provider
// buys exactly one attempt on the alternative, the same policy the review
// fallback (GSHIP-709/721) already applies, so a cycle question never leaves
// the run stuck in waiting-provider once the executor and reviewer are
// already routed to the alternative.
interface EmittedEvent {
	kind: string;
	payload?: Record<string, unknown>;
}

function session(
	provider: AgentProviderId,
	outcome: { outcome: 'continue'; guidance: string } | { outcome: 'operator'; reason: string } | Error,
): AgentSession {
	return {
		provider,
		run: async () => {
			if (outcome instanceof Error) throw outcome;
			return {
				summary: '',
				structuredOutput: outcome.outcome === 'continue'
					? { outcome: 'continue', guidance: outcome.guidance, reason: null }
					: { outcome: 'operator', guidance: null, reason: outcome.reason },
			};
		},
	};
}

interface Direction {
	from: AgentProviderId;
	to: AgentProviderId;
	held: ProviderCallError;
}

const CLAUDE_LIMIT = new ProviderCallError('claude', 'usage-limit', 'Claude usage limit reached.', {
	retryAt: '2026-09-15T12:00:00.000Z',
});

const CODEX_LIMIT = new ProviderCallError('codex', 'rate-limited', 'Codex is rate limited.', {
	retryAt: '2026-09-15T13:00:00.000Z',
});

const DIRECTIONS: readonly Direction[] = [
	{ from: 'claude', to: 'codex', held: CLAUDE_LIMIT },
	{ from: 'codex', to: 'claude', held: CODEX_LIMIT },
];

const INADMISSIBLE_KINDS = PROVIDER_ERROR_KINDS
	.filter((kind) => kind !== 'usage-limit' && kind !== 'rate-limited');

for (const direction of DIRECTIONS) {
	describe(`cycle question fallback from a ${direction.from} limit to ${direction.to}`, () => {
		test(`tries ${direction.to} once and records origin, target, reason and outcome`, async () => {
			const events: EmittedEvent[] = [];
			const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
				? { claude: session('claude', direction.held), codex: session('codex', { outcome: 'continue', guidance: 'Prossiga com o merge.' }) }
				: { claude: session('claude', { outcome: 'continue', guidance: 'Prossiga com o merge.' }), codex: session('codex', direction.held) });

			const result = await resolver.resolve(questionInput({
				providerId: direction.from,
				emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}));

			expect(result).toMatchObject({ outcome: 'continue', guidance: 'Prossiga com o merge.' });
			expect(events).toEqual([{
				kind: CYCLE_QUESTION_FALLBACK_EVENT,
				payload: {
					from: direction.from,
					to: direction.to,
					reason: direction.held.kind,
					message: direction.held.message,
					retryAt: direction.held.retryAt,
					outcome: 'continue',
				},
			}]);
		});

		test(`records a refused attempt and keeps the original ${direction.from} hold`, async () => {
			const events: EmittedEvent[] = [];
			const refusal = new ProviderCallError(direction.to, 'auth-required', 'Not authenticated.');
			const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
				? { claude: session('claude', direction.held), codex: session('codex', refusal) }
				: { claude: session('claude', refusal), codex: session('codex', direction.held) });

			await expect(resolver.resolve(questionInput({
				providerId: direction.from,
				emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}))).rejects.toThrow(direction.held);

			expect(events).toEqual([{
				kind: CYCLE_QUESTION_FALLBACK_EVENT,
				payload: {
					from: direction.from,
					to: direction.to,
					reason: direction.held.kind,
					message: direction.held.message,
					retryAt: direction.held.retryAt,
					outcome: 'refused',
					error: 'Not authenticated.',
					errorKind: 'auth-required',
				},
			}]);
		});

		test(`stops at ${direction.to} when the alternative is held too`, async () => {
			const events: EmittedEvent[] = [];
			const alternativeLimit = new ProviderCallError(direction.to, 'usage-limit', 'Alternative usage limit reached.');
			const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
				? { claude: session('claude', direction.held), codex: session('codex', alternativeLimit) }
				: { claude: session('claude', alternativeLimit), codex: session('codex', direction.held) });

			await expect(resolver.resolve(questionInput({
				providerId: direction.from,
				emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}))).rejects.toThrow(direction.held);

			expect(events).toHaveLength(1);
			expect(events[0]?.payload).toMatchObject({
				from: direction.from,
				to: direction.to,
				outcome: 'refused',
				errorKind: 'usage-limit',
			});
		});

		test('leaves an aborted question to its own interruption instead of spawning the alternative', async () => {
			const events: EmittedEvent[] = [];
			const controller = new AbortController();
			const aborting: AgentSession = {
				provider: direction.from,
				run: async () => { controller.abort(); throw direction.held; },
			};
			const alternative = session(direction.to, { outcome: 'continue', guidance: 'Nunca chamado.' });
			const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
				? { claude: aborting, codex: alternative }
				: { claude: alternative, codex: aborting });

			await expect(resolver.resolve(questionInput({
				providerId: direction.from,
				signal: controller.signal,
				emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}))).rejects.toThrow(direction.held);
			expect(events).toEqual([]);
		});

		test('never answers a failure that is not a subscription limit', async () => {
			for (const kind of INADMISSIBLE_KINDS) {
				const events: EmittedEvent[] = [];
				const failure = new ProviderCallError(direction.from, kind, `${kind} on ${direction.from}.`);
				const alternative = session(direction.to, { outcome: 'continue', guidance: 'Nunca chamado.' });
				const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
					? { claude: session('claude', failure), codex: alternative }
					: { claude: alternative, codex: session('codex', failure) });

				await expect(resolver.resolve(questionInput({
					providerId: direction.from,
					emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
				}))).rejects.toThrow(failure);
				expect(events).toEqual([]);
			}
		});

		test('never answers a limit reported for another provider', async () => {
			const events: EmittedEvent[] = [];
			const foreign = new ProviderCallError(direction.to, 'usage-limit', 'Limit on the other side.');
			const alternative = session(direction.to, { outcome: 'continue', guidance: 'Nunca chamado.' });
			const resolver = new AgentCycleQuestionResolver(direction.from === 'claude'
				? { claude: session('claude', foreign), codex: alternative }
				: { claude: alternative, codex: session('codex', foreign) });

			await expect(resolver.resolve(questionInput({
				providerId: direction.from,
				emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}))).rejects.toThrow(foreign);
			expect(events).toEqual([]);
		});
	});
}

// GSHIP-892 acceptance criterion 4: run 8b868e4d (GSHIP-884, 2026-09-14).
// providerId codex, executor already in handoff to claude and reviewer
// already in fallback to claude; the origin-review cycle question resolves
// on claude instead of leaving the run stuck on codex's own held limit.
test('resolves a review-origin cycle question on the alternative when the run\'s own provider is held (run 8b868e4d)', async () => {
	const events: EmittedEvent[] = [];
	const resolver = new AgentCycleQuestionResolver({
		claude: session('claude', { outcome: 'continue', guidance: 'Reduza o handler ao contrato aprovado.' }),
		codex: session('codex', CODEX_LIMIT),
	});

	const result = await resolver.resolve(questionInput({
		runId: 'run-8b868e4d',
		issueId: 'GSHIP-884',
		providerId: 'codex',
		origin: 'review',
		finding: '1. src/runtime/github-shipper.ts: reconciliar o merge conflict recovery',
		emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
	}));

	expect(result).toMatchObject({ outcome: 'continue', guidance: 'Reduza o handler ao contrato aprovado.' });
	expect(events).toEqual([{
		kind: CYCLE_QUESTION_FALLBACK_EVENT,
		payload: {
			from: 'codex',
			to: 'claude',
			reason: 'rate-limited',
			message: CODEX_LIMIT.message,
			retryAt: CODEX_LIMIT.retryAt,
			outcome: 'continue',
		},
	}]);
});

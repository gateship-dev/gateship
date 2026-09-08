import { describe, expect, test } from 'bun:test';

import { fingerprintSpec, profileSpec } from '../../src/issues/spec.ts';
import { evaluateRun } from '../../src/runtime/run-evaluation.ts';
import type { RunEvent, RunRecord } from '../../src/runtime/run-store.ts';

const RUN: RunRecord = {
	id: 'run-eval',
	issueId: 'GSHIP-700',
	sessionId: 'session-eval',
	providerId: 'claude',
	workspacePath: '/workspaces/run-eval',
	state: 'done',
	fixRounds: 1,
	createdAt: '2026-08-20T10:00:00.000Z',
	updatedAt: '2026-08-20T10:12:00.000Z',
	summary: null,
	error: null,
};

function event(
	kind: string,
	fromState: RunEvent['fromState'],
	toState: RunEvent['toState'],
	payload: Record<string, unknown> = {},
): RunEvent {
	return {
		seq: 1,
		runId: RUN.id,
		kind,
		fromState,
		toState,
		payload,
		createdAt: RUN.createdAt,
		eventClass: 'decision',
	};
}

describe('replayable run evaluation', () => {
	test('profiles legacy, v2 and missing specs without copying their text', () => {
		const legacy = { scope: 'texto legacy', verify: ['bun test'], evidence: [{ command: 'pwd', output: '/repo' }] };
		const v2 = { version: 2 as const, objective: 'objetivo', acceptance: ['a', 'b'], boundaries: ['limite'], verify: ['bun test', 'bun run build'], evidence: [] };
		expect(profileSpec(legacy)).toEqual({
			version: 'legacy', fingerprint: fingerprintSpec(legacy), counts: { acceptance: 0, boundaries: 0, verify: 1, evidence: 1 },
		});
		expect(profileSpec(v2)).toEqual({
			version: 'v2', fingerprint: fingerprintSpec(v2), counts: { acceptance: 2, boundaries: 1, verify: 2, evidence: 0 },
		});
		expect(profileSpec(undefined)).toEqual({
			version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null },
		});
	});

	test('derives revision, attention, holds and provider configuration from the durable log', () => {
		const evaluation = evaluateRun(RUN, [
			event('run.created', null, 'queued', { workflowRevision: ' revision-b ' }),
			event('provider.model', 'working', 'working', { model: 'sonnet', effort: 'xhigh' }),
			event('provider.model', 'working', 'working', { model: 'sonnet', effort: 'xhigh' }),
			event('provider.model', 'working', 'working', { model: 'opus', effort: 'high' }),
			event('run.waiting-user', 'working', 'waiting-user'),
			event('run.operator-guidance', 'waiting-user', 'waiting-user'),
			event('run.operator-guidance', 'waiting-user', 'waiting-user'),
			event('run.provider-waiting', 'review', 'waiting-provider'),
			event('review.model', 'review', 'review', { model: 'opus', effort: 'medium' }),
		]);

		expect(evaluation).toEqual({
			specProfile: { version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null } },
			corrections: { verification: 0, review: 0, fullVerify: 0, ci: 0, total: 0 },
			cycleQuestions: { executor: 0, review: 0, fullVerify: 0, total: 0 },
			reconciliations: { unchanged: 0, adapted: 0, 'contract-change-required': 0, total: 0 },
			workflowRevision: 'revision-b',
			provider: 'claude',
			outcome: 'shipped',
			wallTimeMs: 12 * 60_000,
			attentionRequests: 1,
			operatorInterventions: 2,
			providerHolds: 1,
			resolvedCycleQuestions: 0,
			roles: [
				{ role: 'executor', models: ['opus', 'sonnet'], efforts: ['high', 'xhigh'], providers: ['claude'] },
				{ role: 'reviewer', models: ['opus'], efforts: ['medium'], providers: ['claude'] },
			],
		});
	});

	test('replays spec facts, correction origins, question origins and reconciliations', () => {
		const evaluation = evaluateRun(RUN, [
			event('run.created', null, 'queued', {
				specProfile: { version: 'v2', fingerprint: 'f'.repeat(64), counts: { acceptance: 2, boundaries: 1, verify: 3, evidence: 1 } },
		}),
			event('run.verification-fix-requested', 'verify', 'working'),
			event('run.review-fix-requested', 'review', 'working'),
			event('run.full-verify-fix-requested', 'full-verify', 'working'),
			event('run.ci-fix-requested', 'ready-to-ship', 'working'),
			event('run.cycle-question', 'review', 'review', { origin: 'review' }),
			event('run.cycle-question', 'working', 'working', { origin: 'executor' }),
			event('run.chain-reconciliation', 'done', 'done', { outcome: 'unchanged' }),
			event('run.chain-reconciliation', 'done', 'done', { outcome: 'clarified' }),
			event('run.chain-reconciliation', 'done', 'done', { outcome: 'material' }),
		]);
		expect(evaluation.specProfile).toEqual({ version: 'v2', fingerprint: 'f'.repeat(64), counts: { acceptance: 2, boundaries: 1, verify: 3, evidence: 1 } });
		expect(evaluation.corrections).toEqual({ verification: 1, review: 1, fullVerify: 1, ci: 1, total: 4 });
		expect(evaluation.cycleQuestions).toEqual({ executor: 1, review: 1, fullVerify: 0, total: 2 });
		expect(evaluation.reconciliations).toEqual({ unchanged: 1, adapted: 1, 'contract-change-required': 1, total: 3 });
	});

	// GSHIP-709: a review answered by the fallback is attributed to the
	// provider that produced it without erasing the origin it started from.
	test('adds the review fallback provider to the reviewer role, keeping its origin', () => {
		const evaluation = evaluateRun(RUN, [
			event('review.model', 'review', 'review', { effort: 'medium' }),
			event('run.review-fallback', 'review', 'review', {
				from: 'claude',
				to: 'codex',
				phase: 'review',
				reason: 'usage-limit',
				outcome: 'findings',
			}),
		]);

		expect(evaluation.provider).toBe('claude');
		expect(evaluation.roles).toEqual([
			{ role: 'reviewer', models: [], efforts: ['medium'], providers: ['claude', 'codex'] },
		]);
	});

	// A refused attempt still spawned the alternative, which reported its own
	// model before failing: the provider stays listed beside that model, and
	// the fallback event's outcome is what says the attempt produced nothing.
	test('lists the refused fallback provider beside the model its own spawn reported', () => {
		const evaluation = evaluateRun(RUN, [
			event('review.model', 'review', 'review', { model: 'opus' }),
			event('review.model', 'review', 'review', { model: 'gpt-5-codex', effort: 'medium' }),
			event('run.review-fallback', 'review', 'review', {
				from: 'claude',
				to: 'codex',
				phase: 'review',
				reason: 'rate-limited',
				outcome: 'refused',
				error: 'codex is not authenticated',
			}),
		]);

		expect(evaluation.roles).toEqual([{
			role: 'reviewer',
			models: ['gpt-5-codex', 'opus'],
			efforts: ['medium'],
			providers: ['claude', 'codex'],
		}]);
	});

	// GSHIP-721: the same attribution in the other direction -- a Codex run
	// reviewed by the Claude fallback keeps the provider its record was opened
	// with and lists both under the reviewer role.
	test('attributes the fallback on a Codex run without rewriting its own provider', () => {
		const evaluation = evaluateRun({ ...RUN, providerId: 'codex' }, [
			event('provider.model', 'working', 'working', { model: 'gpt-5-codex' }),
			event('review.model', 'review', 'review', { model: 'opus', effort: 'medium' }),
			event('run.review-fallback', 'review', 'review', {
				from: 'codex',
				to: 'claude',
				phase: 'review',
				reason: 'rate-limited',
				retryAt: '2026-08-20T11:00:00.000Z',
				outcome: 'clean',
			}),
		]);

		expect(evaluation.provider).toBe('codex');
		expect(evaluation.roles).toEqual([
			{ role: 'executor', models: ['gpt-5-codex'], efforts: [], providers: ['codex'] },
			{ role: 'reviewer', models: ['opus'], efforts: ['medium'], providers: ['claude', 'codex'] },
		]);
	});

	// GSHIP-722: an executor handoff is attributed to the executor role, the
	// same way a review fallback is attributed to the reviewer role, keeping
	// the run's own origin provider unchanged.
	test('adds the executor handoff provider to the executor role, keeping its origin', () => {
		const evaluation = evaluateRun(RUN, [
			event('provider.model', 'working', 'working', { model: 'sonnet', effort: 'high' }),
			event('run.executor-handoff', 'working', 'working', {
				from: 'claude',
				to: 'codex',
				role: 'executor',
				reason: 'usage-limit',
				attempt: 1,
				sessionId: 'session-alt',
				outcome: 'completed',
			}),
			event('provider.model', 'working', 'working', { model: 'gpt-5-codex' }),
		]);

		expect(evaluation.provider).toBe('claude');
		expect(evaluation.roles).toEqual([
			{ role: 'executor', models: ['gpt-5-codex', 'sonnet'], efforts: ['high'], providers: ['claude', 'codex'] },
		]);
	});

	test('lists a refused executor handoff provider without erasing what its own spawn reported', () => {
		const evaluation = evaluateRun(RUN, [
			event('provider.model', 'working', 'working', { model: 'opus' }),
			event('run.executor-handoff', 'working', 'working', {
				from: 'claude',
				to: 'codex',
				role: 'executor',
				reason: 'rate-limited',
				attempt: 1,
				sessionId: 'session-alt',
				outcome: 'refused',
				error: 'codex is not authenticated',
			}),
		]);

		expect(evaluation.roles).toEqual([
			{ role: 'executor', models: ['opus'], efforts: [], providers: ['claude', 'codex'] },
		]);
	});

	test('keeps legacy revision and non-terminal wall time explicitly unknown', () => {
		expect(evaluateRun({ ...RUN, state: 'working' }, [event('run.created', null, 'queued')]))
			.toMatchObject({ workflowRevision: null, outcome: 'incomplete', wallTimeMs: null });
		expect(evaluateRun({ ...RUN, createdAt: 'invalid' }, []))
			.toMatchObject({ outcome: 'shipped', wallTimeMs: null });
	});
});

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

function timedEvent(kind: string, fromState: RunEvent['fromState'], toState: RunEvent['toState'], createdAt: string): RunEvent {
	return { ...event(kind, fromState, toState), createdAt };
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
			dispatches: { total: 4, executor: 3, reviewer: 1, orchestrator: 0 },
			guidance: { channels: { web: 0, 'agent-cli': 0, other: 0, unknown: 2 }, authorization: { observed: 0, absent: 0, unknown: 2 } },
			workflowRevision: 'revision-b',
			provider: 'claude',
			outcome: 'shipped',
			wallTimeMs: 12 * 60_000,
			phaseDurations: {
				queued: { durationMs: null, entries: 1 }, working: { durationMs: 0, entries: 0 }, verify: { durationMs: 0, entries: 0 }, review: { durationMs: 0, entries: 0 },
				'full-verify': { durationMs: 0, entries: 0 }, shipping: { durationMs: 0, entries: 0 }, 'waiting-provider': { durationMs: 720_000, entries: 1 }, 'waiting-user': { durationMs: null, entries: 1 },
			},
			unassignedDuration: { durationMs: 0, entries: 0 },
			durationReconciliation: { classifiedMs: null, unassignedMs: null, totalMs: 720_000, toleranceMs: 1000, reconciles: null },
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

	test('counts full verifier passes from command index one, not command count', () => {
		const evaluation = evaluateRun(RUN, [
			event('verify.started', 'verify', 'verify'),
			event('verify.command.started', 'verify', 'verify', { commandIndex: 1 }),
			event('verify.command.started', 'verify', 'verify', { commandIndex: 2 }),
			event('verify.started', 'verify', 'verify'),
			event('verify.skipped', 'verify', 'verify'),
			event('full-verify.command.started', 'full-verify', 'full-verify', { commandIndex: 1 }),
			event('full-verify.command.started', 'full-verify', 'full-verify', { commandIndex: 2 }),
			event('full-verify.command.started', 'full-verify', 'full-verify', { commandIndex: 1 }),
			event('full-verify.skipped', 'full-verify', 'ready-to-ship'),
		]);
		expect(evaluation.verificationCadence).toEqual({
			focused: { executed: 2, skipped: 1 },
			full: { executed: 2, skipped: 1 },
		});
	});

	test('uses the complete log for dispatches and preserves channel and authorization uncertainty', () => {
		const events = Array.from({ length: 51 }, (_, index) => event(
			index % 3 === 0 ? 'provider.model' : index % 3 === 1 ? 'review.model' : 'run.cycle-response',
			'working', 'working', index === 0 ? { source: 'web', authorizationEvidence: 'explicit' } : {},
		));
		events.push(
			event('run.operator-guidance', 'waiting-user', 'waiting-user', { source: 'web', authorizationEvidence: 'explicit' }),
			event('run.operator-guidance', 'waiting-user', 'waiting-user', { source: 'agent-cli', operatorAuthorized: false }),
			event('run.operator-guidance', 'waiting-user', 'waiting-user', { source: 'plugin-channel' }),
		);
		const evaluation = evaluateRun(RUN, events);
		expect(evaluation.dispatches).toEqual({ total: 51, executor: 17, reviewer: 17, orchestrator: 17 });
		expect(evaluation.guidance).toEqual({
			channels: { web: 1, 'agent-cli': 1, other: 1, unknown: 0 },
			authorization: { observed: 1, absent: 1, unknown: 1 },
		});
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

	test('reconstructs active work, both waits, corrections and shipping from transitions', () => {
		const run = { ...RUN, updatedAt: '2026-08-20T10:10:00.000Z' };
		const evaluation = evaluateRun(run, [
			timedEvent('run.created', null, 'queued', '2026-08-20T10:00:00.000Z'),
			timedEvent('run.started', 'queued', 'working', '2026-08-20T10:01:00.000Z'),
			timedEvent('provider.activity', 'working', 'working', 'invalid'),
			timedEvent('run.provider-waiting', 'working', 'waiting-provider', '2026-08-20T10:02:00.000Z'),
			timedEvent('run.provider-retry-started', 'waiting-provider', 'working', '2026-08-20T10:03:00.000Z'),
			timedEvent('run.verification-started', 'working', 'verify', '2026-08-20T10:04:00.000Z'),
			timedEvent('run.verification-fix-requested', 'verify', 'working', '2026-08-20T10:05:00.000Z'),
			timedEvent('run.waiting-user', 'working', 'waiting-user', '2026-08-20T10:06:00.000Z'),
			timedEvent('run.operator-guidance', 'waiting-user', 'waiting-user', '2026-08-20T10:07:00.000Z'),
			timedEvent('run.resume', 'waiting-user', 'working', '2026-08-20T10:08:00.000Z'),
			timedEvent('run.ready-to-ship', 'working', 'ready-to-ship', '2026-08-20T10:09:00.000Z'),
			timedEvent('run.ship-started', 'ready-to-ship', 'shipping', '2026-08-20T10:09:00.000Z'),
			timedEvent('run.shipped', 'shipping', 'done', '2026-08-20T10:10:00.000Z'),
		]);
		expect(evaluation.phaseDurations).toMatchObject({
			queued: { durationMs: 60_000, entries: 1 }, working: { durationMs: 240_000, entries: 4 }, verify: { durationMs: 60_000, entries: 1 },
			'waiting-provider': { durationMs: 60_000, entries: 1 }, 'waiting-user': { durationMs: 120_000, entries: 1 }, shipping: { durationMs: 60_000, entries: 1 },
		});
		expect(evaluation.durationReconciliation).toMatchObject({ classifiedMs: 600_000, unassignedMs: 0, totalMs: 600_000, reconciles: true });
	});

	test('does not invent time for incomplete or invalid historical clocks', () => {
		const incomplete = evaluateRun({ ...RUN, state: 'interrupted' }, [timedEvent('run.created', null, 'queued', 'invalid')]);
		expect(incomplete.phaseDurations.queued.durationMs).toBeNull();
		expect(incomplete.durationReconciliation.reconciles).toBeNull();
		const legacy = evaluateRun({ ...RUN, createdAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:02:00.000Z' }, []);
		expect(legacy.unassignedDuration.durationMs).toBe(120_000);
		expect(legacy.durationReconciliation.reconciles).toBe(true);
	});

	test('marks the interval unknown when a durable transition is missing', () => {
		const evaluation = evaluateRun(RUN, [
			timedEvent('run.created', null, 'queued', '2026-08-20T10:00:00.000Z'),
			timedEvent('run.review-started', 'working', 'review', '2026-08-20T10:02:00.000Z'),
		]);
		expect(evaluation.phaseDurations.queued.durationMs).toBeNull();
		expect(evaluation.phaseDurations.review.durationMs).toBe(600_000);
		expect(evaluation.durationReconciliation).toMatchObject({ classifiedMs: null, unassignedMs: null, reconciles: null });
	});

	test('marks an intermediate null origin as an incomplete transition', () => {
		const evaluation = evaluateRun(RUN, [
			timedEvent('run.created', null, 'queued', '2026-08-20T10:00:00.000Z'),
			timedEvent('run.started', 'queued', 'working', '2026-08-20T10:01:00.000Z'),
			timedEvent('run.review-started', null, 'review', '2026-08-20T10:02:00.000Z'),
		]);
		expect(evaluation.phaseDurations.working.durationMs).toBeNull();
		expect(evaluation.durationReconciliation.reconciles).toBeNull();
	});

	test('does not count a terminal transition after the run ended', () => {
		const evaluation = evaluateRun({ ...RUN, updatedAt: '2026-08-20T10:12:00.000Z' }, [
			timedEvent('run.created', null, 'queued', '2026-08-20T10:00:00.000Z'),
			timedEvent('run.started', 'queued', 'working', '2026-08-20T10:01:00.000Z'),
			timedEvent('run.review-started', 'working', 'review', '2026-08-20T10:13:00.000Z'),
		]);
		expect(evaluation.phaseDurations.working.durationMs).toBeNull();
		expect(evaluation.durationReconciliation.reconciles).toBeNull();
	});

	test('does not infer active work from an empty legacy history', () => {
		const evaluation = evaluateRun({ ...RUN, state: 'working' }, []);
		expect(evaluation.phaseDurations.working).toEqual({ durationMs: 0, entries: 0 });
		expect(evaluation.unassignedDuration.durationMs).toBe(720_000);
		expect(evaluation.durationReconciliation.reconciles).toBeNull();
	});

	test('keeps the prefix unassigned when the first durable event is late', () => {
		const evaluation = evaluateRun(RUN, [timedEvent('run.review-started', 'working', 'review', '2026-08-20T10:11:00.000Z')]);
		expect(evaluation.unassignedDuration.durationMs).toBeNull();
		expect(evaluation.phaseDurations.review.durationMs).toBe(60_000);
		expect(evaluation.durationReconciliation.reconciles).toBeNull();
	});
});

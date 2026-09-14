import { describe, expect, test } from 'bun:test';
import { fingerprintSpec, profileSpec } from '../../src/issues/spec.ts';
import type { IssueEntry } from '../../src/issues/types.ts';
import { RunRuntime, type RuntimeCycleQuestionOrigin, type RuntimeCycleQuestionResult } from '../../src/runtime/run-runtime.ts';
import { RunStore } from '../../src/runtime/run-store.ts';

const spec = { version: 2 as const, objective: 'Recover the same question.', acceptance: ['Resolve before work.'], verify: ['bun test'] };
const issue: IssueEntry = {
	id: 'GSHIP-886', title: 'Recovery', stage: 'specified', status: 'open', blockedBy: [],
	createdAt: '', updatedAt: '', spec, approval: { fingerprint: fingerprintSpec(spec), approvedAt: '' },
};
const contract = JSON.stringify(issue);
const usage = { model: 'test-model', effort: 'medium' };

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('Timed out waiting for recovery');
		await Bun.sleep(5);
	}
}

function recovery(origin: RuntimeCycleQuestionOrigin, state: 'failed' | 'interrupted' | 'crashed') {
	const store = new RunStore(':memory:');
	const runId = 'preserved-run';
	const at = '2026-09-13T00:00:00Z';
	store.createRun({ id: runId, issueId: issue.id, sessionId: 'preserved-session', workspacePath: '/preserved-worktree', createdAt: at, approvedContract: contract, specProfile: profileSpec(spec) });
	store.transition({ runId, toState: 'working', kind: 'run.started', createdAt: at });
	store.transition({ runId, toState: 'verify', kind: 'run.work-completed', createdAt: at });
	store.transition({ runId, toState: 'review', kind: 'run.review-started', createdAt: at });
	store.transition({ runId, toState: 'working', kind: 'run.review-fix-requested', createdAt: at });
	store.appendEvent({ runId, kind: 'run.cycle-question', payload: { questionId: 'preserved-question', finding: 'Preserved finding', origin, approvedContract: contract }, createdAt: at });
	// Legacy runs have a call event and terminal failure, without the newer failure marker.
	store.appendEvent({ runId, kind: 'cycle-question.model', payload: { model: 'test-model' }, createdAt: at });
	store.transition({ runId, toState: 'failed', kind: 'run.failed', error: 'invalid_json_schema', createdAt: at });
	if (state !== 'failed') {
		store.transition({ runId, toState: 'working', kind: 'run.cycle-question-retry-requested', createdAt: at });
		if (state === 'interrupted') store.transition({ runId, toState: 'interrupted', kind: 'run.interrupted', createdAt: at });
		else if (origin !== 'executor') {
			store.transition({ runId, toState: 'verify', kind: 'run.work-completed', createdAt: at });
			store.transition({ runId, toState: 'review', kind: 'run.review-started', createdAt: at });
			if (origin === 'full-verify') store.transition({ runId, toState: 'full-verify', kind: 'run.review-clean', createdAt: at });
		}
	}
	const calls: string[] = [];
	let resolve!: (result: RuntimeCycleQuestionResult) => void;
	let reject!: (error: Error) => void;
	const answer = new Promise<RuntimeCycleQuestionResult>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	const runtime = new RunRuntime({
		cwd: '/project', store, listBacklog: () => [issue],
		cycleQuestionResolver: { resolve: async (input) => {
			calls.push('resolve');
			expect(input).toMatchObject({ runId, origin, finding: 'Preserved finding', approvedContract: contract, workspace: '/preserved-worktree' });
			return await answer;
		} },
		executor: { execute: async (input) => {
			calls.push('execute');
			expect(input).toMatchObject({ runId, sessionId: 'preserved-session', cwd: '/preserved-worktree', resume: true });
			const guidance = origin === 'executor' ? input.internalGuidance?.guidance
				: origin === 'review' ? input.reviewFeedback : input.fullVerifyFeedback;
			expect(guidance).toContain('Repair the finding.');
			return { outcome: 'completed', summary: 'Repaired' };
		} },
		verifier: { verify: async () => { calls.push('verify'); return { ok: true }; } },
		reviewer: { review: async () => { calls.push('review'); return { verdict: 'clean' }; } },
		fullVerifier: { verify: async () => { calls.push('full-verify'); return { ok: true }; } },
	});
	const start = () => state === 'failed'
		? runtime.retryCycleQuestionRun(runId, 'Retry after schema repair') : runtime.resumeRun(runId);
	return { runtime, runId, calls, resolve, reject, start };
}

describe('pending cycle question recovery order', () => {
	for (const origin of ['executor', 'review', 'full-verify'] as const) {
		for (const state of ['failed', 'interrupted', 'crashed'] as const) {
			test(`${state} ${origin} resolves before work and preserves every verification gate`, async () => {
				const fixture = recovery(origin, state);
				try {
					fixture.start();
					await waitFor(() => fixture.calls.length > 0);
					expect(fixture.calls).toEqual(['resolve']);
					expect(fixture.runtime.getRun(fixture.runId)?.fixRounds).toBe(1);
					fixture.resolve({ outcome: 'continue', guidance: 'Repair the finding.', usage });
					await waitFor(() => fixture.runtime.getRun(fixture.runId)?.state === 'ready-to-ship');
					expect(fixture.calls).toEqual(['resolve', 'execute', 'verify', 'review', 'full-verify']);
					expect(fixture.runtime.getRun(fixture.runId)?.fixRounds).toBe(1);
					const responses = fixture.runtime.listRunDecisionEvents(fixture.runId).filter((event) => event.kind === 'run.cycle-response');
					expect(responses).toHaveLength(1);
					expect(responses[0]?.payload).toMatchObject({ questionId: 'preserved-question', origin, outcome: 'continue' });
				} finally {
					fixture.resolve({ outcome: 'operator', reason: 'Test cleanup', usage });
					await fixture.runtime.stop();
					fixture.runtime.close();
				}
			});
		}
	}

	test.each(['failure', 'operator', 'invalid'] as const)('%s cannot dispatch an executor after a review crash', async (outcome) => {
		const fixture = recovery('review', 'crashed');
		try {
			fixture.start();
			await waitFor(() => fixture.calls.length > 0);
			expect(fixture.calls).toEqual(['resolve']);
			if (outcome === 'failure') fixture.reject(new Error('Resolver still unavailable'));
			else if (outcome === 'operator') fixture.resolve({ outcome: 'operator', reason: 'Scope decision required.', usage });
			else fixture.resolve({ outcome: 'continue', guidance: '', usage });
			await waitFor(() => ['failed', 'waiting-user'].includes(fixture.runtime.getRun(fixture.runId)?.state ?? ''));
			expect(fixture.runtime.getRun(fixture.runId)?.state).toBe(outcome === 'failure' ? 'failed' : 'waiting-user');
			expect(fixture.calls).toEqual(['resolve']);
			expect(fixture.runtime.getRun(fixture.runId)?.fixRounds).toBe(1);
			expect(fixture.runtime.listRunDecisionEvents(fixture.runId).filter((event) => event.kind === 'run.cycle-response' && event.payload['outcome'] === 'continue')).toHaveLength(0);
		} finally {
			fixture.resolve({ outcome: 'operator', reason: 'Test cleanup', usage });
			await fixture.runtime.stop();
			fixture.runtime.close();
		}
	});
});

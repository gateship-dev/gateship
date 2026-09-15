// test/runtime/run-review.test.ts
//
// CAM-577 acceptance criterion 1: a verified run enters review, a clean
// verdict reaches ready-to-ship, findings buy exactly one automatic fix with
// a fresh verification and a fresh review, and persistent findings without a
// configured cycle resolver stop safely at waiting-user.

import { describe, expect, test } from 'bun:test';

import { fingerprintSpec } from '../../src/issues/spec.ts';
import type { IssueEntry } from '../../src/issues/types.ts';
import {
	RunRuntime as BaseRunRuntime,
	type RunRuntimeOptions,
	type RuntimeExecutionInput,
	type RuntimeReviewResult,
	type RuntimeShipper,
} from '../../src/runtime/run-runtime.ts';
import { RunStore } from '../../src/runtime/run-store.ts';

const REVIEW_SPEC = { version: 2 as const, objective: 'Test review', acceptance: ['Review behavior'], verify: ['bun test'] };
const REVIEW_FINGERPRINT = fingerprintSpec(REVIEW_SPEC);
const REVIEW_BACKLOG: IssueEntry[] = ['CAM-577', 'CAM-583', 'GSHIP-732'].map((id) => ({
	id, title: id, stage: 'specified', status: 'open', blockedBy: [], createdAt: '', updatedAt: '', spec: REVIEW_SPEC,
	approval: { fingerprint: REVIEW_FINGERPRINT, approvedAt: '' },
}));

class RunRuntime extends BaseRunRuntime {
	constructor(options: RunRuntimeOptions) {
		super({ ...options, listBacklog: options.listBacklog ?? (() => REVIEW_BACKLOG) });
	}
}

interface ExecutionCall {
	resume: boolean;
	reviewFeedback: string | undefined;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error('timed out waiting for runtime state');
		await Bun.sleep(5);
	}
}

function createRuntime(verdicts: RuntimeReviewResult[], shipper?: RuntimeShipper): {
	runtime: RunRuntime;
	executions: ExecutionCall[];
	verifications: number[];
	reviews: number[];
} {
	const executions: ExecutionCall[] = [];
	const verifications: number[] = [];
	const reviews: number[] = [];
	let verdictIndex = 0;
	const runtime = new RunRuntime({
		cwd: '/project',
		store: new RunStore(':memory:'),
		newId: () => 'run-review',
		newSessionId: () => 'session-review',
		executor: {
			execute: async (input: RuntimeExecutionInput) => {
				executions.push({ resume: input.resume, reviewFeedback: input.reviewFeedback });
				return { outcome: 'completed', summary: 'change written' };
			},
		},
		verifier: {
			verify: async () => {
				verifications.push(verifications.length + 1);
				return { ok: true };
			},
		},
		reviewer: {
			review: async () => {
				reviews.push(reviews.length + 1);
				const verdict = verdicts[verdictIndex] ?? verdicts.at(-1);
				verdictIndex += 1;
				if (verdict === undefined) throw new Error('no verdict configured');
				return verdict;
			},
		},
		...(shipper === undefined ? {} : { shipper }),
	});
	return { runtime, executions, verifications, reviews };
}

describe('independent review stage', () => {
	test('a clean verdict takes a verified run from review to ready-to-ship', async () => {
		const { runtime, executions, reviews } = createRuntime([{ verdict: 'clean' }]);
		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');

		expect(runtime.getRun(run.id)).toMatchObject({ state: 'ready-to-ship', fixRounds: 0 });
		expect(runtime.listEvents().map((event) => event.kind)).toEqual([
			'run.created',
			'run.started',
			'run.work-completed',
			'run.review-started',
			'run.review-clean',
		]);
		expect(executions).toHaveLength(1);
		expect(reviews).toHaveLength(1);
		await runtime.stop();
		runtime.close();
	});

	test('findings buy exactly one automatic fix, then a new verification and review', async () => {
		const { runtime, executions, verifications, reviews } = createRuntime([
			{ verdict: 'findings', detail: '1. src/a.ts: off-by-one in the cursor' },
			{ verdict: 'clean' },
		]);
		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');

		expect(runtime.getRun(run.id)).toMatchObject({ state: 'ready-to-ship', fixRounds: 1 });
		expect(runtime.listEvents().map((event) => event.kind)).toEqual([
			'run.created',
			'run.started',
			'run.work-completed',
			'run.review-started',
			'run.review-fix-requested',
			'run.recovery-dispatch-reserved',
			'run.recovery-dispatch-finished',
			'run.work-completed',
			'run.review-started',
			'run.review-clean',
		]);
		// The fix round is the only execution that carries the reviewer's findings,
		// and it continues the implementer session instead of starting a new one.
		expect(executions).toEqual([
			{ resume: false, reviewFeedback: undefined },
			{ resume: true, reviewFeedback: '1. src/a.ts: off-by-one in the cursor' },
		]);
		expect(verifications).toHaveLength(2);
		expect(reviews).toHaveLength(2);
		await runtime.stop();
		runtime.close();
	});

	test('persistent findings without a cycle resolver stop safely at waiting-user', async () => {
		const { runtime, executions, reviews } = createRuntime([
			{ verdict: 'findings', detail: 'first pass finding' },
			{ verdict: 'findings', detail: 'still broken in src/a.ts' },
		]);
		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'waiting-user');

		expect(runtime.getRun(run.id)).toMatchObject({
			state: 'waiting-user',
			fixRounds: 1,
			summary: 'still broken in src/a.ts',
		});
		const events = runtime.listEvents();
			expect(events.map((event) => event.kind)).toEqual([
			'run.created',
			'run.started',
			'run.work-completed',
			'run.review-started',
			'run.review-fix-requested',
			'run.recovery-dispatch-reserved',
			'run.recovery-dispatch-finished',
			'run.work-completed',
			'run.review-started',
			'run.cycle-question',
			'run.review-fix-limit',
		]);
		expect(events.at(-2)?.payload).toMatchObject({
			questionId: 'run-review',
			issueId: 'CAM-577',
			finding: 'still broken in src/a.ts',
			origin: 'review',
		});
		expect(events.at(-1)?.payload).toEqual({
			questionId: 'run-review',
			findings: 'still broken in src/a.ts',
			origin: 'review',
			reason: 'Cycle question resolver is unavailable.',
		});
		expect(executions).toHaveLength(2);
		expect(reviews).toHaveLength(2);
		await runtime.stop();
		runtime.close();
	});

	// CAM-583: the clean verdict is what releases the ship, so the two stages
	// are exercised together rather than across an operator command.
	test('a clean verdict ships the run without stopping at the button', async () => {
		const shipped: string[] = [];
		const { runtime } = createRuntime([{ verdict: 'clean' }], {
			ship: async (input) => {
				shipped.push(input.runId);
				return { outcome: 'merged', prNumber: 407 };
			},
		});
		const run = await runtime.startRun('CAM-583');
		await waitFor(() => runtime.getRun(run.id)?.state === 'done');

		expect(runtime.listEvents().map((event) => event.kind)).toEqual([
			'run.created',
			'run.started',
			'run.work-completed',
			'run.review-started',
			'run.review-clean',
			'run.ship-started',
			'run.shipped',
			'run.chain-paused',
		]);
		expect(shipped).toEqual([run.id]);
		await runtime.stop();
		runtime.close();
	});

	test('findings that survive the fix round hold the run instead of shipping it', async () => {
		let shipCalls = 0;
		const { runtime } = createRuntime(
			[{ verdict: 'findings', detail: 'first pass finding' }, { verdict: 'findings', detail: 'still broken' }],
			{
				ship: async () => {
					shipCalls += 1;
					return { outcome: 'merged', prNumber: 407 };
				},
			},
		);
		const run = await runtime.startRun('CAM-583');
		await waitFor(() => runtime.getRun(run.id)?.state === 'waiting-user');

		expect(shipCalls).toBe(0);
		expect(runtime.listEvents().map((event) => event.kind)).not.toContain('run.ship-started');
		await runtime.stop();
		runtime.close();
	});

	test('routes more findings than the former ceiling through internal cycle responses', async () => {
		let reviews = 0;
		let nextId = 0;
		const runtime = new RunRuntime({
			cwd: '/project',
			store: new RunStore(':memory:'),
			newId: () => `cycle-${++nextId}`,
			executor: { execute: async () => ({ outcome: 'completed', summary: 'ready' }) },
			verifier: { verify: async () => ({ ok: true }) },
			reviewer: { review: async () => {
				reviews += 1;
				return reviews < 5
					? { verdict: 'findings', detail: `technical finding ${reviews}` }
					: { verdict: 'clean' };
			} },
			cycleQuestionResolver: { resolve: async (input) => {
				expect(input.origin).toBe('review');
				return {
					outcome: 'continue', guidance: `Apply ${input.finding}.`,
					usage: { model: 'model', effort: 'high' },
				};
			} },
		});

		const run = await runtime.startRun('GSHIP-732');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');
		expect(runtime.getRun(run.id)?.fixRounds).toBe(4);
		expect(runtime.listRunDecisionEvents(run.id).filter((event) => event.kind === 'run.cycle-response'))
			.toHaveLength(3);
		expect(runtime.getRunEvaluation(run.id)).toMatchObject({
			attentionRequests: 0, operatorInterventions: 0, resolvedCycleQuestions: 3,
		});
		await runtime.stop();
		runtime.close();
	});

	// GSHIP-872: the evidence summary a review collects has to reach the
	// executor too, not only the reviewer that gathered it -- exercised here on
	// the one round that already carries the review's own findings back.
	test('evidence a review delivers rides along with its findings into the fix round the executor receives', async () => {
		const executions: ExecutionCall[] = [];
		let reviews = 0;
		const runtime = new RunRuntime({
			cwd: '/project',
			store: new RunStore(':memory:'),
			newId: () => 'run-evidence',
			executor: {
				execute: async (input: RuntimeExecutionInput) => {
					executions.push({ resume: input.resume, reviewFeedback: input.reviewFeedback });
					return { outcome: 'completed', summary: 'change written' };
				},
			},
			verifier: { verify: async () => ({ ok: true }) },
			reviewer: {
				review: async (input: RuntimeExecutionInput) => {
					reviews += 1;
					if (reviews === 1) {
						input.emit('review.evidence', { summary: 'Verification evidence for run run-evidence: fresh.' });
						return { verdict: 'findings', detail: '1. src/a.ts: off-by-one in the cursor' };
					}
					return { verdict: 'clean' };
				},
			},
		});

		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');

		expect(executions[1]?.reviewFeedback).toBe(
			'1. src/a.ts: off-by-one in the cursor\n\nVerification evidence for run run-evidence: fresh.',
		);
		expect(runtime.listEvents().map((event) => event.kind)).toContain('review.evidence');
		await runtime.stop();
		runtime.close();
	});

	// GSHIP-872: a verify command that did not exit clean must never hand the
	// reviewer a fingerprint or an artifact list evidence could present as
	// "this worktree was verified" -- checked here at the boundary the
	// provenance actually crosses (what the reviewer receives), not by
	// reaching into a private method.
	test('a verify command that exited non-zero never hands the reviewer its provenance', async () => {
		const captured: { provenance?: RuntimeExecutionInput['verificationProvenance']; called: boolean } = { called: false };
		const runtime = new RunRuntime({
			cwd: '/project',
			store: new RunStore(':memory:'),
			newId: () => 'run-dirty-exit',
			executor: { execute: async () => ({ outcome: 'completed', summary: 'change written' }) },
			verifier: {
				verify: async (input: RuntimeExecutionInput) => {
					input.emit('verify.command.completed', { commandIndex: 1, command: 'bun run verify', exitCode: 0, verifiedVersion: 'worktree-sha256:v1', attempt: input.attemptNumber });
					input.emit('verify.command.completed', { commandIndex: 2, command: 'bun run verify', exitCode: 1, verifiedVersion: 'worktree-sha256:v1', attempt: input.attemptNumber });
					return { ok: true };
				},
			},
			reviewer: {
				review: async (input: RuntimeExecutionInput) => {
					captured.provenance = input.verificationProvenance;
					captured.called = true;
					return { verdict: 'clean' };
				},
			},
		});

		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');

		expect(captured.called).toBe(true);
		expect(captured.provenance).toBeUndefined();
		await runtime.stop();
		runtime.close();
	});

	// GSHIP-872: `GitIssueVerifier` runs every command of the spec's verify
	// array in one pass, so the reviewer needs all of them, each with its own
	// exit code, and every artifact attributed to the specific command that
	// produced it -- not only the pass's last command.
	test('a clean verification pass hands the reviewer every command it ran and the command that produced each artifact', async () => {
		const captured: { provenance?: RuntimeExecutionInput['verificationProvenance'] } = {};
		const runtime = new RunRuntime({
			cwd: '/project',
			store: new RunStore(':memory:'),
			newId: () => 'run-clean-exit',
			executor: { execute: async () => ({ outcome: 'completed', summary: 'change written' }) },
			verifier: {
				verify: async (input: RuntimeExecutionInput) => {
					input.emit('verify.started');
					input.emit('verify.command.completed', {
						commandIndex: 1, command: 'bun run verify', exitCode: 0, verifiedVersion: 'worktree-sha256:v1',
						attempt: input.attemptNumber, artifacts: [{ path: 'test-results/ui-results.json', sizeBytes: 42, sha256: 'abc' }],
					});
					input.emit('verify.command.completed', {
						commandIndex: 2, command: 'bun run test:ui:smoke:fixed', exitCode: 0, verifiedVersion: 'worktree-sha256:v1',
						attempt: input.attemptNumber,
					});
					return { ok: true };
				},
			},
			reviewer: {
				review: async (input: RuntimeExecutionInput) => {
					captured.provenance = input.verificationProvenance;
					return { verdict: 'clean' };
				},
			},
		});

		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');

		expect(captured.provenance).toEqual({
			attempt: 1,
			verifiedVersion: 'worktree-sha256:v1',
			commands: [
				{ commandIndex: 1, command: 'bun run verify', exitCode: 0 },
				{ commandIndex: 2, command: 'bun run test:ui:smoke:fixed', exitCode: 0 },
			],
			artifacts: [{ path: 'test-results/ui-results.json', sizeBytes: 42, sha256: 'abc', commandIndex: 1, command: 'bun run verify' }],
		});
		await runtime.stop();
		runtime.close();
	});

	test('a run without a configured reviewer still verifies straight to ready-to-ship', async () => {
		const runtime = new RunRuntime({
			cwd: '/project',
			store: new RunStore(':memory:'),
			newId: () => 'run-no-reviewer',
			executor: { execute: async () => ({ outcome: 'completed' }) },
			verifier: { verify: async () => ({ ok: true }) },
		});
		const run = await runtime.startRun('CAM-577');
		await waitFor(() => runtime.getRun(run.id)?.state === 'ready-to-ship');
		expect(runtime.listEvents().map((event) => event.kind)).not.toContain('run.review-started');
		await runtime.stop();
		runtime.close();
	});
});

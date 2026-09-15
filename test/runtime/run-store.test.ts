import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { emptyModelSettings } from '../../src/runtime/model-settings.ts';
import { DISPATCH_METHODOLOGY_VERSION } from '../../src/runtime/run-evaluation.ts';
import { selectPullRequestDelivery } from '../../src/runtime/pull-request-delivery.ts';
import { PROPOSAL_LIMITS, ProposalTransitionError } from '../../src/runtime/run-proposal.ts';
import {
	PROJECT_BRIEF_LIMITS,
	readPersistedRunHistory,
	readPersistedRunStatuses,
	reevaluateHistoricalSample,
	RunStore,
} from '../../src/runtime/run-store.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

const EMPTY_BRIEF = { objective: '', decisions: [], constraints: [], openItems: [] };
const EMPTY_MODEL_SETTINGS = emptyModelSettings();

type AtomicRecoveryTransition = 'reserve' | 'start' | 'finish' | 'reconcile';

function assertAtomicRecoveryTransition(transition: AtomicRecoveryTransition): void {
	const dbPath = join(createTestTmpdir(`gship-recovery-atomic-${transition}-`), 'runtime.sqlite');
	const store = new RunStore(dbPath);
	store.createRun({ id: 'run-atomic', issueId: 'GSHIP-871', sessionId: 'session', workspacePath: '/workspace', createdAt: '2026-09-12T00:00:00Z' });
	const seed = {
		reserve: () => undefined,
		start: () => store.reserveRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:01Z'),
		finish: () => {
			store.reserveRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:01Z');
			store.markRecoveryDispatchStarted('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:02Z', 'darwin-v1:1:birth');
		},
		reconcile: () => {
			store.reserveRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:01Z');
			store.markRecoveryDispatchStarted('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:02Z', 'darwin-v1:1:birth');
		},
	}[transition];
	seed();
	const triggerDb = new Database(dbPath);
	triggerDb.exec(`CREATE TRIGGER fail_recovery_observation BEFORE INSERT ON run_events
		WHEN NEW.kind LIKE 'run.recovery-dispatch-%'
		BEGIN SELECT RAISE(ABORT, 'injected recovery observation failure'); END;`);
	const operation = {
		reserve: () => store.reserveRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:01Z'),
		start: () => store.markRecoveryDispatchStarted('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:02Z', 'darwin-v1:1:birth'),
		finish: () => store.finishRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:03Z'),
		reconcile: () => store.reconcileRecoveryDispatch('run-atomic', 'dispatch-atomic', '2026-09-12T00:00:03Z'),
	}[transition];
	expect(operation).toThrow();
	triggerDb.close();
	store.close();
	const reopened = new RunStore(dbPath);
	expect(reopened.listRunDecisionEvents('run-atomic').some((event) => event.kind.startsWith('run.recovery-dispatch-'))).toBe(transition !== 'reserve');
	expect(reopened.getUnfinishedRecoveryDispatch('run-atomic')?.status).toBe(transition === 'reserve' ? undefined : transition === 'start' ? 'reserved' : 'started');
	reopened.close();
}

function storeWithRun(id: string, issueId: string): RunStore {
	const store = new RunStore(':memory:');
	store.createRun({
		id,
		issueId,
		sessionId: `session-${id}`,
		workspacePath: `/workspaces/${id}`,
		createdAt: '2026-08-16T22:00:00.000Z',
	});
	return store;
}

describe('read-only persisted run status', () => {
	test('reads a bounded newest-first projection without changing the database', () => {
		const stateDir = createTestTmpdir('gship-run-store-readonly-');
		const dbPath = join(stateDir, 'runtime.sqlite');
		const store = new RunStore(dbPath);
		for (let index = 0; index < 3; index += 1) {
			store.createRun({
				id: `run-${index}`,
				issueId: `GSHIP-${index}`,
				sessionId: `session-${index}`,
				workspacePath: `/workspace/run-${index}`,
				createdAt: `2026-08-22T10:00:0${index}.000Z`,
			});
		}
		store.close();
		const before = statSync(dbPath);
		const walExistedBefore = existsSync(`${dbPath}-wal`);

		expect(readPersistedRunStatuses(dbPath, 2)).toEqual([
			{
				id: 'run-2', issueId: 'GSHIP-2', providerId: 'claude', state: 'queued',
				createdAt: '2026-08-22T10:00:02.000Z', updatedAt: '2026-08-22T10:00:02.000Z',
			},
			{
				id: 'run-1', issueId: 'GSHIP-1', providerId: 'claude', state: 'queued',
				createdAt: '2026-08-22T10:00:01.000Z', updatedAt: '2026-08-22T10:00:01.000Z',
			},
		]);
		const after = statSync(dbPath);
		expect({ size: after.size, mtimeMs: after.mtimeMs }).toEqual({
			size: before.size,
			mtimeMs: before.mtimeMs,
		});
		expect(existsSync(`${dbPath}-wal`)).toBe(walExistedBefore);
	});

	test('does not create a missing database', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-readonly-missing-'), 'runtime.sqlite');
		expect(() => readPersistedRunStatuses(dbPath)).toThrow();
		expect(existsSync(dbPath)).toBe(false);
	});

});

describe('durable recovery budget', () => {
	test('rolls back each recovery transition when its observation event fails', () => {
		for (const transition of ['reserve', 'start', 'finish', 'reconcile'] as const) assertAtomicRecoveryTransition(transition);
	});

	test('snapshots a versioned policy and reserves each corrective dispatch once', () => {
		const store = new RunStore(':memory:');
		store.createRun({ id: 'run-budget', issueId: 'GSHIP-871', sessionId: 'session-budget', workspacePath: '/workspaces/run-budget', createdAt: '2026-09-12T00:00:00Z', recoveryPolicy: { version: 1, maxRecoveryDispatches: 2 } });
		expect(store.getRun('run-budget')?.recoveryPolicy).toEqual({ version: 1, maxRecoveryDispatches: 2 });
		expect(store.reserveRecoveryDispatch('run-budget', 'dispatch-1', '2026-09-12T00:00:01Z')).toBe('reserved');
		expect(store.reserveRecoveryDispatch('run-budget', 'dispatch-1', '2026-09-12T00:00:02Z')).toBe('already-reserved');
		expect(store.reserveRecoveryDispatch('run-budget', 'dispatch-2', '2026-09-12T00:00:03Z')).toBe('reserved');
		expect(store.reserveRecoveryDispatch('run-budget', 'dispatch-3', '2026-09-12T00:00:04Z')).toBe('exhausted');
		store.markRecoveryDispatchStarted('run-budget', 'dispatch-1', '2026-09-12T00:00:05Z', 'claude:session-budget');
		store.finishRecoveryDispatch('run-budget', 'dispatch-2', '2026-09-12T00:00:05Z');
		expect(store.getUnfinishedRecoveryDispatch('run-budget')).toEqual({ dispatchId: 'dispatch-1', status: 'started', processIdentity: 'claude:session-budget' });
		store.finishRecoveryDispatch('run-budget', 'dispatch-1', '2026-09-12T00:00:06Z');
		store.finishRecoveryDispatch('run-budget', 'dispatch-1', '2026-09-12T00:00:07Z');
		store.close();
	});

	test('fails closed when the persisted recovery policy is corrupt', () => {
		const dbPath = join(createTestTmpdir('gship-recovery-policy-corrupt-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.createRun({ id: 'run-corrupt-policy', issueId: 'GSHIP-871', sessionId: 'session', workspacePath: '/workspace', createdAt: '2026-09-12T00:00:00Z', recoveryPolicy: { version: 1, maxRecoveryDispatches: 2 } });
		store.close();
		const db = new Database(dbPath);
		db.query("UPDATE runs SET recovery_policy_json = '{bad json' WHERE id = 'run-corrupt-policy'").run();
		db.close();
		const reopened = new RunStore(dbPath);
		expect(() => reopened.getRun('run-corrupt-policy')).toThrow();
		reopened.close();
	});
});

describe('run store workspace migration', () => {
	test('adds workspace_path to a CAM-574 database without losing existing runs', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-migrate-'), 'runtime.sqlite');
		const legacy = new Database(dbPath, { create: true });
		legacy.exec(`
			CREATE TABLE runs (
				id TEXT PRIMARY KEY,
				issue_id TEXT NOT NULL,
				session_id TEXT,
				state TEXT NOT NULL,
				fix_rounds INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				summary TEXT,
				error TEXT
			);
			INSERT INTO runs (
				id, issue_id, session_id, state, fix_rounds, created_at, updated_at
			) VALUES (
				'legacy-run', 'CAM-574', 'legacy-session', 'interrupted', 0,
				'2026-08-15T10:00:00Z', '2026-08-15T10:01:00Z'
			);
		`);
		legacy.close();

		const migrated = new RunStore(dbPath);
		expect(migrated.getRun('legacy-run')).toMatchObject({
			issueId: 'CAM-574',
			sessionId: 'legacy-session',
			providerId: 'claude',
			workspacePath: '',
			state: 'interrupted',
		});
		migrated.createRun({
			id: 'new-run',
			issueId: 'CAM-576',
			sessionId: 'new-session',
			workspacePath: '/project/.gship/worktrees/new-run',
			createdAt: '2026-08-15T11:00:00Z',
		});
		expect(migrated.getRun('new-run')?.workspacePath).toBe(
			'/project/.gship/worktrees/new-run',
		);
		expect(migrated.getSelectedProvider()).toBe('claude');
		migrated.setSelectedProvider('codex');
		expect(migrated.getSelectedProvider()).toBe('codex');
		migrated.createRun({
			id: 'codex-run',
			issueId: 'CAM-577',
			sessionId: 'provisional',
			providerId: 'codex',
			workspacePath: '/project/.gship/worktrees/codex-run',
			createdAt: '2026-08-15T12:00:00Z',
		});
		expect(migrated.getRun('codex-run')?.providerId).toBe('codex');
		migrated.close();
	});
});

// GSHIP-627: separates ephemeral provider/review stream chatter from durable
// decisions in the event log, so a derived read no longer depends on the same
// display-bounded window the screen uses.
describe('run event class migration', () => {
	test('classifies rows written before the column existed once, by kind suffix', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-event-class-'), 'runtime.sqlite');
		const legacy = new Database(dbPath, { create: true });
		legacy.exec(`
			CREATE TABLE runs (
				id TEXT PRIMARY KEY,
				issue_id TEXT NOT NULL,
				session_id TEXT,
				provider_id TEXT,
				workspace_path TEXT,
				state TEXT NOT NULL,
				fix_rounds INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				summary TEXT,
				error TEXT
			);
			CREATE TABLE run_events (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
				kind TEXT NOT NULL,
				from_state TEXT,
				to_state TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				created_at TEXT NOT NULL
			);
			INSERT INTO runs (
				id, issue_id, session_id, provider_id, workspace_path, state, fix_rounds, created_at, updated_at
			) VALUES (
				'legacy-run', 'CAM-70', 'legacy-session', 'claude', '/workspaces/legacy-run',
				'done', 0, '2026-08-10T10:00:00Z', '2026-08-10T10:05:00Z'
			);
			INSERT INTO run_events (run_id, kind, from_state, to_state, payload_json, created_at) VALUES
				('legacy-run', 'run.created', NULL, 'queued', '{}', '2026-08-10T10:00:00Z'),
				('legacy-run', 'provider.system', 'queued', 'queued', '{}', '2026-08-10T10:00:01Z'),
				('legacy-run', 'provider.activity', 'queued', 'queued', '{}', '2026-08-10T10:00:02Z'),
				('legacy-run', 'review.system', 'queued', 'queued', '{}', '2026-08-10T10:00:03Z'),
				('legacy-run', 'review.activity', 'queued', 'queued', '{}', '2026-08-10T10:00:04Z'),
				('legacy-run', 'run.verified', 'queued', 'ready-to-ship', '{}', '2026-08-10T10:00:05Z');
		`);
		legacy.close();

		const migrated = new RunStore(dbPath);
		expect(migrated.listRunEvents('legacy-run').map((event) => ({
			kind: event.kind,
			eventClass: event.eventClass,
		}))).toEqual([
			{ kind: 'run.created', eventClass: 'decision' },
			{ kind: 'provider.system', eventClass: 'activity' },
			{ kind: 'provider.activity', eventClass: 'activity' },
			{ kind: 'review.system', eventClass: 'activity' },
			{ kind: 'review.activity', eventClass: 'activity' },
			{ kind: 'run.verified', eventClass: 'decision' },
		]);
		migrated.close();
	});
});

describe('run event class', () => {
	test('paginates a run by exclusive seq without crossing runs', () => {
		const store = storeWithRun('run-page', 'GSHIP-829');
		store.createRun({ id: 'run-other-page', issueId: 'GSHIP-830', sessionId: 'session-other-page', workspacePath: '/other', createdAt: '2026-08-16T22:00:01.000Z' });
		for (let index = 0; index < 205; index += 1) {
			store.appendEvent({ runId: index % 2 === 0 ? 'run-page' : 'run-other-page', kind: 'provider.activity', createdAt: '2026-08-16T22:00:00.000Z', payload: { index } });
		}
		const first = store.listRunEventsPage('run-page', 20);
		expect(first.events).toHaveLength(20);
		expect(first.events.every((event) => event.runId === 'run-page')).toBe(true);
		expect(first.events.map((event) => event.seq)).toEqual([...first.events].map((event) => event.seq).sort((a, b) => a - b));
		expect(first.hasPrevious).toBe(true);
		const pages = [first];
		while (pages.at(-1)!.hasPrevious) {
			pages.push(store.listRunEventsPage('run-page', 20, pages.at(-1)!.previousCursor!));
		}
		const runSequences = [...pages].reverse().flatMap((page) => page.events.map((event) => event.seq));
		expect(runSequences).toHaveLength(104);
		expect(new Set(runSequences).size).toBe(runSequences.length);
		expect(runSequences).toEqual([...runSequences].sort((a, b) => a - b));
		store.close();
	});

	test('createRun and transition always record a decision, regardless of kind', () => {
		const store = new RunStore(':memory:');
		const { event: created } = store.createRun({
			id: 'run-class',
			issueId: 'CAM-71',
			sessionId: 'session-class',
			workspacePath: '/workspaces/run-class',
			createdAt: '2026-08-17T09:00:00.000Z',
		});
		expect(created.eventClass).toBe('decision');

		const { event: transitioned } = store.transition({
			runId: 'run-class',
			toState: 'working',
			kind: 'run.started',
			createdAt: '2026-08-17T09:00:01.000Z',
		});
		expect(transitioned.eventClass).toBe('decision');
		store.close();
	});

	test('appendEvent records the class its caller declares, and defaults an undeclared kind to decision', () => {
		const store = storeWithRun('run-class-append', 'CAM-72');

		const activity = store.appendEvent({
			runId: 'run-class-append',
			kind: 'provider.activity',
			createdAt: '2026-08-17T09:00:02.000Z',
			eventClass: 'activity',
		});
		expect(activity.eventClass).toBe('activity');

		// A kind nobody declared a class for -- new or forgotten -- must fail open
		// into the derived read rather than silently vanish from it.
		const undeclared = store.appendEvent({
			runId: 'run-class-append',
			kind: 'some.brand-new.kind',
			createdAt: '2026-08-17T09:00:03.000Z',
		});
		expect(undeclared.eventClass).toBe('decision');
		store.close();
	});

	test('the live read stays limited while the derived read returns every decision', () => {
		const store = storeWithRun('run-class-reads', 'CAM-73');
		const total = 210;
		for (let index = 0; index < total; index += 1) {
			store.appendEvent({
				runId: 'run-class-reads',
				kind: 'provider.activity',
				createdAt: '2026-08-17T09:00:00.000Z',
				eventClass: 'activity',
			});
			store.appendEvent({
				runId: 'run-class-reads',
				kind: 'run.operator-note',
				createdAt: '2026-08-17T09:00:00.000Z',
			});
		}

		// Live read: still capped at its historical default -- it serves the
		// screen, unaffected by this change.
		expect(store.listRunEvents('run-class-reads').length).toBe(200);

		// Derived read: every decision event, including the ones the window
		// above already dropped -- plus the run.created event createRun wrote.
		const decisions = store.listRunDecisionEvents('run-class-reads');
		expect(decisions.length).toBe(total + 1);
		expect(decisions.every((event) => event.eventClass === 'decision')).toBe(true);
		expect(decisions.some((event) => event.kind === 'run.operator-note')).toBe(true);
		expect(decisions.some((event) => event.kind === 'provider.activity')).toBe(false);
		store.close();
	});
});

describe('pull request delivery projection', () => {
	test('replays canonical PR evidence and the latest changed CI aggregate without schema state', () => {
		const store = storeWithRun('run-delivery', 'GSHIP-685');
		store.appendEvent({
			runId: 'run-delivery',
			kind: 'ship.pr-opened',
			payload: { prNumber: 685, url: 'https://github.com/gateship-dev/gateship/pull/685' },
			createdAt: '2026-08-21T20:00:00.000Z',
		});
		store.appendEvent({
			runId: 'run-delivery',
			kind: 'ship.ci-status',
			payload: {
				status: 'failed',
				failedChecks: [{ name: 'verify', url: 'https://github.com/actions/1' }],
			},
			createdAt: '2026-08-21T20:01:00.000Z',
		});
		store.appendEvent({
			runId: 'run-delivery',
			kind: 'ship.ci-status',
			payload: { status: 'passed' },
			createdAt: '2026-08-21T20:02:00.000Z',
		});

		expect(selectPullRequestDelivery(store.listRunDecisionEvents('run-delivery'))).toEqual({
			prNumber: 685,
			url: 'https://github.com/gateship-dev/gateship/pull/685',
			ciStatus: 'passed',
			failedChecks: [],
		});
		store.close();
	});

	test('reusing the same pull request preserves its last CI result', () => {
		const store = storeWithRun('run-reused-delivery', 'GSHIP-685');
		for (const [kind, payload] of [
			['ship.pr-opened', { prNumber: 685, url: 'https://github.com/gateship-dev/gateship/pull/685' }],
			['ship.ci-status', { status: 'passed' }],
			['ship.pr-reused', { prNumber: 685, url: 'https://github.com/gateship-dev/gateship/pull/685' }],
		] as const) {
			store.appendEvent({
				runId: 'run-reused-delivery',
				kind,
				payload,
				createdAt: '2026-08-21T20:00:00.000Z',
			});
		}
		expect(selectPullRequestDelivery(store.listRunDecisionEvents('run-reused-delivery'))?.ciStatus)
			.toBe('passed');
		store.close();
	});
});

// GSHIP-612: ideas the executor finds outside its issue are kept as evidence,
// without touching the run that produced them.
describe('derived proposals', () => {
	test('stores each idea as a pending derived-from record with a stable id', () => {
		const store = storeWithRun('run-proposals', 'CAM-40');

		const captured = store.recordProposals({
			runId: 'run-proposals',
			issueId: 'CAM-40',
			proposals: [
				{ title: 'Extrair o parser de eventos', evidence: 'Duplicado em dois adaptadores.' },
				{ title: 'Cobrir o caminho de erro do shipper', evidence: 'Sem teste para retry.' },
			],
			createdAt: '2026-08-16T22:10:00.000Z',
		});

		expect(captured).toEqual([
			{
				id: 'run-proposals-proposal-1',
				relationship: 'derived-from',
				status: 'pending',
				promotedIssueId: null,
				sourceRunId: 'run-proposals',
				sourceIssueId: 'CAM-40',
				title: 'Extrair o parser de eventos',
				evidence: 'Duplicado em dois adaptadores.',
				createdAt: '2026-08-16T22:10:00.000Z',
				updatedAt: '2026-08-16T22:10:00.000Z',
			},
			{
				id: 'run-proposals-proposal-2',
				relationship: 'derived-from',
				status: 'pending',
				promotedIssueId: null,
				sourceRunId: 'run-proposals',
				sourceIssueId: 'CAM-40',
				title: 'Cobrir o caminho de erro do shipper',
				evidence: 'Sem teste para retry.',
				createdAt: '2026-08-16T22:10:00.000Z',
				updatedAt: '2026-08-16T22:10:00.000Z',
			},
		]);
		// The read is deterministic: same order, same ids, no run state touched.
		expect(store.listProposals()).toEqual(captured);
		expect(store.getRun('run-proposals')).toMatchObject({ state: 'queued', fixRounds: 0 });
		expect(store.listRunEvents('run-proposals').map((event) => event.kind)).toEqual([
			'run.created',
		]);
		store.close();
	});

	test('a later capture on the same run continues the id sequence', () => {
		const store = storeWithRun('run-second', 'CAM-41');
		store.recordProposals({
			runId: 'run-second',
			issueId: 'CAM-41',
			proposals: [{ title: 'Primeira ideia', evidence: 'Vista na primeira passagem.' }],
			createdAt: '2026-08-16T22:10:00.000Z',
		});

		const second = store.recordProposals({
			runId: 'run-second',
			issueId: 'CAM-41',
			proposals: [{ title: 'Segunda ideia', evidence: 'Vista na rodada de correção.' }],
			createdAt: '2026-08-16T22:20:00.000Z',
		});

		expect(second.map((proposal) => proposal.id)).toEqual(['run-second-proposal-2']);
		expect(store.listProposals().map((proposal) => proposal.title)).toEqual([
			'Primeira ideia',
			'Segunda ideia',
		]);
		store.close();
	});

	test('drops unusable items and clamps the rest instead of failing the run', () => {
		const store = storeWithRun('run-noisy', 'CAM-42');

		const captured = store.recordProposals({
			runId: 'run-noisy',
			issueId: 'CAM-42',
			proposals: [
				{ title: '   ', evidence: 'Sem título.' },
				{ title: 'Sem evidência', evidence: '  ' },
				{ title: 't'.repeat(PROPOSAL_LIMITS.title + 40), evidence: 'e'.repeat(PROPOSAL_LIMITS.evidence + 40) },
				{ title: 'Ideia 2', evidence: 'Evidência 2.' },
				{ title: 'Ideia 3', evidence: 'Evidência 3.' },
				{ title: 'Ideia 4', evidence: 'Evidência 4.' },
			],
			createdAt: '2026-08-16T22:30:00.000Z',
		});

		expect(captured).toHaveLength(PROPOSAL_LIMITS.maxItems);
		expect(captured[0]?.title).toHaveLength(PROPOSAL_LIMITS.title);
		expect(captured[0]?.evidence).toHaveLength(PROPOSAL_LIMITS.evidence);
		expect(captured.slice(1).map((proposal) => proposal.title)).toEqual(['Ideia 2', 'Ideia 3']);
		expect(store.recordProposals({
			runId: 'run-noisy',
			issueId: 'CAM-42',
			proposals: [],
			createdAt: '2026-08-16T22:31:00.000Z',
		})).toEqual([]);
		store.close();
	});
});

// GSHIP-613: the operator settles each captured proposal exactly once, and
// neither decision reaches the run, the issue or the approval.
describe('proposal decisions', () => {
	function storeWithProposals(): RunStore {
		const store = storeWithRun('run-inbox', 'CAM-50');
		store.recordProposals({
			runId: 'run-inbox',
			issueId: 'CAM-50',
			proposals: [
				{ title: 'Descartável', evidence: 'Já resolvido em outro lugar.' },
				{ title: 'Promovível', evidence: 'Sem cobertura no caminho de erro.' },
			],
			createdAt: '2026-08-16T22:10:00.000Z',
		});
		return store;
	}

	test('a dismissed proposal leaves the inbox and refuses a second decision', () => {
		const store = storeWithProposals();

		const dismissed = store.dismissProposal('run-inbox-proposal-1', '2026-08-16T23:00:00.000Z');
		expect(dismissed).toMatchObject({
			id: 'run-inbox-proposal-1',
			status: 'dismissed',
			promotedIssueId: null,
			updatedAt: '2026-08-16T23:00:00.000Z',
		});
		// Durable, but settled: the record stays readable and leaves the inbox.
		expect(store.getProposal('run-inbox-proposal-1')).toEqual(dismissed);
		expect(store.listPendingProposals().map((proposal) => proposal.id))
			.toEqual(['run-inbox-proposal-2']);
		expect(store.listProposals()).toHaveLength(2);

		for (const second of [
			() => store.dismissProposal('run-inbox-proposal-1', '2026-08-16T23:05:00.000Z'),
			() => store.promoteProposal('run-inbox-proposal-1', 'CAM-90', '2026-08-16T23:05:00.000Z'),
		]) {
			expect(second).toThrow(ProposalTransitionError);
			try {
				second();
			} catch (error) {
				expect((error as ProposalTransitionError).code).toBe('proposal-not-pending');
				expect((error as ProposalTransitionError).status).toBe(409);
			}
		}
		// The refused decisions changed nothing.
		expect(store.getProposal('run-inbox-proposal-1')).toEqual(dismissed);
		// The run that produced the proposals is untouched by either decision.
		expect(store.getRun('run-inbox')).toMatchObject({ state: 'queued', fixRounds: 0 });
		expect(store.listRunEvents('run-inbox').map((event) => event.kind)).toEqual(['run.created']);
		store.close();
	});

	test('a promoted proposal keeps the issue it became and refuses to move again', () => {
		const store = storeWithProposals();

		const promoted = store.promoteProposal(
			'run-inbox-proposal-2',
			'CAM-91',
			'2026-08-16T23:10:00.000Z',
		);
		expect(promoted).toMatchObject({
			id: 'run-inbox-proposal-2',
			status: 'promoted',
			promotedIssueId: 'CAM-91',
			title: 'Promovível',
			evidence: 'Sem cobertura no caminho de erro.',
			updatedAt: '2026-08-16T23:10:00.000Z',
		});
		expect(store.listPendingProposals().map((proposal) => proposal.id))
			.toEqual(['run-inbox-proposal-1']);

		expect(() => store.promoteProposal('run-inbox-proposal-2', 'CAM-92', '2026-08-16T23:11:00.000Z'))
			.toThrow(ProposalTransitionError);
		expect(store.getProposal('run-inbox-proposal-2')?.promotedIssueId).toBe('CAM-91');
		// A promotion without a filed issue is a programming error, not a status.
		expect(() => store.promoteProposal('run-inbox-proposal-1', '  ', '2026-08-16T23:12:00.000Z'))
			.toThrow('promoted issueId is required');
		expect(store.getProposal('run-inbox-proposal-1')?.status).toBe('pending');
		store.close();
	});

	test('an unknown proposal is refused as missing, not as settled', () => {
		const store = storeWithProposals();
		for (const decide of [
			() => store.dismissProposal('run-inbox-proposal-9', '2026-08-16T23:20:00.000Z'),
			() => store.promoteProposal('run-inbox-proposal-9', 'CAM-93', '2026-08-16T23:20:00.000Z'),
		]) {
			try {
				decide();
				throw new Error('unreachable');
			} catch (error) {
				expect(error).toBeInstanceOf(ProposalTransitionError);
				expect((error as ProposalTransitionError).code).toBe('proposal-not-found');
				expect((error as ProposalTransitionError).status).toBe(404);
			}
		}
		expect(store.getProposal('run-inbox-proposal-9')).toBeNull();
		store.close();
	});

	// GSHIP-643: the operator can read what a settled proposal became, without
	// that history ever competing with the pending inbox above.
	test('resolved proposals are read newest-decided-first, distinct from the pending inbox', () => {
		const store = storeWithProposals();
		// Captured in order -1, -2 (storeWithProposals), but decided in the
		// opposite order: -2 first, -1 last. Newest-*decided*-first must read
		// -1 on top despite it having the lower capture sequence, or this would
		// pass just as well sorted by capture order alone.
		store.promoteProposal('run-inbox-proposal-2', 'CAM-91', '2026-08-16T23:00:00.000Z');
		store.dismissProposal('run-inbox-proposal-1', '2026-08-16T23:10:00.000Z');

		const { proposals, omittedCount } = store.listResolvedProposals();
		expect(proposals.map((proposal) => proposal.id)).toEqual([
			'run-inbox-proposal-1',
			'run-inbox-proposal-2',
		]);
		expect(omittedCount).toBe(0);
		expect(proposals[0]).toMatchObject({ status: 'dismissed', promotedIssueId: null });
		expect(proposals[1]).toMatchObject({ status: 'promoted', promotedIssueId: 'CAM-91' });
		// The pending inbox this run started with is now empty: neither decision
		// leaves anything behind for it to compete with.
		expect(store.listPendingProposals()).toEqual([]);
		store.close();
	});

	test('a resolved history beyond the limit reports how many were left out', () => {
		const store = storeWithProposals();
		store.dismissProposal('run-inbox-proposal-1', '2026-08-16T23:00:00.000Z');
		store.promoteProposal('run-inbox-proposal-2', 'CAM-91', '2026-08-16T23:10:00.000Z');

		const { proposals, omittedCount } = store.listResolvedProposals(1);
		expect(proposals.map((proposal) => proposal.id)).toEqual(['run-inbox-proposal-2']);
		expect(omittedCount).toBe(1);
		store.close();
	});

	test('a GSHIP-612 database gains the promoted column without losing its proposals', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-proposals-'), 'runtime.sqlite');
		const legacy = new Database(dbPath, { create: true });
		legacy.exec(`
			CREATE TABLE runs (
				id TEXT PRIMARY KEY,
				issue_id TEXT NOT NULL,
				session_id TEXT,
				provider_id TEXT,
				workspace_path TEXT,
				state TEXT NOT NULL,
				fix_rounds INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				summary TEXT,
				error TEXT
			);
			CREATE TABLE run_proposals (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT NOT NULL UNIQUE,
				run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
				issue_id TEXT NOT NULL,
				relationship TEXT NOT NULL,
				status TEXT NOT NULL,
				title TEXT NOT NULL,
				evidence TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			INSERT INTO runs (
				id, issue_id, session_id, state, fix_rounds, created_at, updated_at
			) VALUES (
				'legacy-run', 'CAM-612', 'legacy-session', 'done', 0,
				'2026-08-16T10:00:00Z', '2026-08-16T10:01:00Z'
			);
			INSERT INTO run_proposals (
				id, run_id, issue_id, relationship, status, title, evidence, created_at, updated_at
			) VALUES (
				'legacy-run-proposal-1', 'legacy-run', 'CAM-612', 'derived-from', 'pending',
				'Ideia capturada antes da caixa de entrada', 'Vista na implementação da etapa 4A.',
				'2026-08-16T10:01:00Z', '2026-08-16T10:01:00Z'
			);
		`);
		legacy.close();

		const migrated = new RunStore(dbPath);
		expect(migrated.getProposal('legacy-run-proposal-1')).toMatchObject({
			status: 'pending',
			relationship: 'derived-from',
			promotedIssueId: null,
			sourceRunId: 'legacy-run',
			sourceIssueId: 'CAM-612',
		});
		expect(migrated.promoteProposal('legacy-run-proposal-1', 'CAM-613', '2026-08-17T02:00:00Z'))
			.toMatchObject({ status: 'promoted', promotedIssueId: 'CAM-613' });
		expect(migrated.listPendingProposals()).toEqual([]);
		migrated.close();
	});
});

// GSHIP-617: the per-role model choice is one JSON row in runtime_settings,
// beside the selected provider, and never a new table or column.
describe('per-role model settings', () => {
	test('round-trips one slot per provider and role in a single settings row', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-models-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		expect(store.getModelSettings()).toEqual(EMPTY_MODEL_SETTINGS);

		store.setModelSettings({
			claude: {
				orchestrator: { model: 'sonnet' },
				executor: { model: 'opus', effort: 'xhigh' },
				reviewer: { effort: 'high' },
			},
			codex: {
				orchestrator: {},
				executor: { model: 'gpt-5-codex' },
				reviewer: {},
			},
		});
		expect(store.getModelSettings()).toEqual({
			claude: {
				orchestrator: { model: 'sonnet' },
				executor: { model: 'opus', effort: 'xhigh' },
				reviewer: { effort: 'high' },
			},
			codex: { orchestrator: {}, executor: { model: 'gpt-5-codex' }, reviewer: {} },
		});
		// The provider selection is a sibling row, so neither write disturbs the other.
		store.setSelectedProvider('codex');
		expect(store.getSelectedProvider()).toBe('codex');
		expect(store.getModelSettings().claude.executor).toEqual({ model: 'opus', effort: 'xhigh' });
		store.close();

		const rows = new Database(dbPath);
		const stored = rows.query('SELECT key, value FROM runtime_settings ORDER BY key')
			.all() as Array<{ key: string; value: string }>;
		expect(stored.map((row) => row.key)).toEqual(['model-settings', 'provider']);
		expect(JSON.parse(stored[0]?.value ?? 'null')).toMatchObject({
			claude: { executor: { model: 'opus', effort: 'xhigh' } },
		});
		rows.close();
	});

	test('distinguishes absent agent overrides from explicit project choices', () => {
		const store = new RunStore(':memory:');
		expect(store.getSelectedProviderOverride()).toBeNull();
		expect(store.getModelSettingsOverride()).toBeNull();
		store.setSelectedProvider('codex');
		store.setModelSettings(EMPTY_MODEL_SETTINGS);
		expect(store.getSelectedProviderOverride()).toBe('codex');
		expect(store.getModelSettingsOverride()).toEqual(EMPTY_MODEL_SETTINGS);
		store.clearSelectedProviderOverride();
		store.clearModelSettingsOverride();
		expect(store.getSelectedProviderOverride()).toBeNull();
		expect(store.getModelSettingsOverride()).toBeNull();
		store.close();
	});

	test('a corrupt or wrongly shaped row reads as no choice at all', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-models-corrupt-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setModelSettings({
			claude: { orchestrator: {}, executor: { model: 'opus' }, reviewer: {} },
			codex: { orchestrator: {}, executor: {}, reviewer: {} },
		});
		store.close();

		const corrupted = new Database(dbPath);
		corrupted.exec("UPDATE runtime_settings SET value = '{not json' WHERE key = 'model-settings';");
		corrupted.close();
		const reopened = new RunStore(dbPath);
		expect(reopened.getModelSettings()).toEqual(EMPTY_MODEL_SETTINGS);
		reopened.close();

		const reshaped = new Database(dbPath);
		reshaped.exec("UPDATE runtime_settings SET value = '[1,2]' WHERE key = 'model-settings';");
		reshaped.close();
		const rereopened = new RunStore(dbPath);
		expect(rereopened.getModelSettings()).toEqual(EMPTY_MODEL_SETTINGS);
		rereopened.close();
	});

	test('a value argv could not carry is dropped on read instead of stored', () => {
		const store = new RunStore(':memory:');
		store.setModelSettings({
			claude: {
				orchestrator: { model: '  sonnet  ' },
				executor: { model: 'two words', effort: '   ' },
				reviewer: {},
			},
			codex: { orchestrator: {}, executor: {}, reviewer: {} },
		});

		expect(store.getModelSettings().claude).toEqual({
			orchestrator: { model: 'sonnet' },
			executor: {},
			reviewer: {},
		});
		store.close();
	});
});

// GSHIP-638: the chain switch is off by default and survives a restart, kept
// beside the provider and the per-role model slots in `runtime_settings`.
describe('chain runs switch', () => {
	test('is off by default and round-trips through the same store', () => {
		const store = new RunStore(':memory:');
		expect(store.getChainRunsEnabled()).toBe(false);

		store.setChainRunsEnabled(true);
		expect(store.getChainRunsEnabled()).toBe(true);

		store.setChainRunsEnabled(false);
		expect(store.getChainRunsEnabled()).toBe(false);
		store.close();
	});

	test('survives a service restart, as its own runtime_settings row', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-chain-runs-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setChainRunsEnabled(true);
		store.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getChainRunsEnabled()).toBe(true);
		reopened.close();

		const rows = new Database(dbPath);
		const stored = rows.query('SELECT key, value FROM runtime_settings ORDER BY key')
			.all() as Array<{ key: string; value: string }>;
		expect(stored).toContainEqual({ key: 'chain-runs', value: 'true' });
		rows.close();
	});
});

describe('diagnostic schedule settings', () => {
	test('is off by default and survives a restart as one normalized settings row', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-diagnostic-schedule-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		expect(store.getDiagnosticSchedule()).toEqual({
			enabled: false,
			analyzer: 'react',
			cadence: 'weekly',
		});
		store.setDiagnosticSchedule({ enabled: true, analyzer: 'react', cadence: 'daily' });
		store.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getDiagnosticSchedule()).toEqual({
			enabled: true,
			analyzer: 'react',
			cadence: 'daily',
		});
		reopened.close();

		const rows = new Database(dbPath);
		expect(rows.query("SELECT value FROM runtime_settings WHERE key = 'diagnostic-schedule'")
			.get()).toEqual({ value: '{"enabled":true,"analyzer":"react","cadence":"daily"}' });
		rows.close();
	});

	test('a corrupt row fails closed instead of enabling background work', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-bad-diagnostic-schedule-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setDiagnosticSchedule({ enabled: true, analyzer: 'react', cadence: 'daily' });
		store.close();

		const rows = new Database(dbPath);
		rows.exec("UPDATE runtime_settings SET value = '{not json' WHERE key = 'diagnostic-schedule';");
		rows.close();
		const reopened = new RunStore(dbPath);
		expect(reopened.getDiagnosticSchedule().enabled).toBe(false);
		reopened.close();
	});
});

describe('operator profile', () => {
	test('round-trips as one runtime setting and survives reopen', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-operator-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		expect(store.getOperatorProfile()).toEqual({ name: '', timezone: '' });
		store.setOperatorProfile({ name: ' Eduardo ', timezone: 'America/Sao_Paulo' });
		store.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getOperatorProfile()).toEqual({
			name: 'Eduardo',
			timezone: 'America/Sao_Paulo',
		});
		reopened.close();

		const rows = new Database(dbPath);
		const stored = rows.query("SELECT value FROM runtime_settings WHERE key = 'operator-profile'")
			.get() as { value: string };
		expect(JSON.parse(stored.value)).toEqual({
			name: 'Eduardo',
			timezone: 'America/Sao_Paulo',
		});
		rows.close();
	});

	test('a corrupt row reads as empty instead of blocking the service', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-operator-corrupt-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setOperatorProfile({ name: 'Eduardo', timezone: 'UTC' });
		store.close();

		const corrupted = new Database(dbPath);
		corrupted.exec(
			"UPDATE runtime_settings SET value = '{not json' WHERE key = 'operator-profile';",
		);
		corrupted.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getOperatorProfile()).toEqual({ name: '', timezone: '' });
		reopened.close();
	});
});

describe('project brief', () => {
	test('does not create conversational tables in a new database and leaves legacy tables untouched', () => {
		const freshPath = join(createTestTmpdir('gship-run-store-fresh-schema-'), 'runtime.sqlite');
		const fresh = new RunStore(freshPath);
		fresh.close();
		const freshDb = new Database(freshPath);
		const freshTables = freshDb.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
		expect(freshTables.map((table) => table.name)).not.toContain('orchestrator_sessions');
		expect(freshTables.map((table) => table.name)).not.toContain('orchestrator_messages');
		expect(freshTables.map((table) => table.name)).not.toContain('orchestrator_handoff');
		freshDb.close();

		const dbPath = join(createTestTmpdir('gship-run-store-brief-schema-'), 'runtime.sqlite');
		const legacy = new Database(dbPath);
		legacy.exec(`
			CREATE TABLE orchestrator_sessions (legacy_value TEXT NOT NULL);
			CREATE TABLE orchestrator_messages (legacy_value TEXT NOT NULL);
			CREATE TABLE orchestrator_handoff (legacy_value TEXT NOT NULL);
			INSERT INTO orchestrator_sessions VALUES ('session');
			INSERT INTO orchestrator_messages VALUES ('message');
			INSERT INTO orchestrator_handoff VALUES ('handoff');
		`);
		legacy.close();

		const store = new RunStore(dbPath);
		store.setProjectBrief({ objective: 'Brief', decisions: [], constraints: [], openItems: [] }, '2026-09-05T13:00:00.000Z');
		store.close();

		const db = new Database(dbPath);
		const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
		expect(tables.map((table) => table.name)).toContain('project_brief');
		expect(tables.map((table) => table.name)).toContain('orchestrator_sessions');
		expect(tables.map((table) => table.name)).toContain('orchestrator_messages');
		expect(tables.map((table) => table.name)).toContain('orchestrator_handoff');
		expect(db.query('SELECT legacy_value FROM orchestrator_sessions').get()).toEqual({ legacy_value: 'session' });
		expect(db.query('SELECT legacy_value FROM orchestrator_messages').get()).toEqual({ legacy_value: 'message' });
		expect(db.query('SELECT legacy_value FROM orchestrator_handoff').get()).toEqual({ legacy_value: 'handoff' });
		db.close();
	});

	test('round-trips the brief', () => {
		const store = new RunStore(':memory:');
		expect(store.getProjectBrief()).toEqual(EMPTY_BRIEF);

		const brief = {
			objective: 'Manter o brief do produto sob controle do operador.',
			decisions: ['O brief é um registro único, não um histórico.'],
			constraints: ['Somente o serviço determinístico persiste o brief.'],
			openItems: ['Construir o editor web na fatia 2.'],
		};
		store.setProjectBrief(brief, '2026-08-16T21:00:00.000Z');
		expect(store.getProjectBrief()).toEqual(brief);

		const rewritten = { ...brief, objective: 'Objetivo substituído.', openItems: [] };
		store.setProjectBrief(rewritten, '2026-08-16T21:05:00.000Z');
		expect(store.getProjectBrief()).toEqual(rewritten);
		store.close();
	});

	test('a corrupt row reads as the empty brief instead of throwing', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-brief-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setProjectBrief(
			{ objective: 'Será corrompido.', decisions: [], constraints: [], openItems: [] },
			'2026-08-16T21:00:00.000Z',
		);
		store.close();

		const corrupted = new Database(dbPath);
		corrupted.exec("UPDATE project_brief SET brief_json = '{not json' WHERE id = 1;");
		corrupted.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getProjectBrief()).toEqual(EMPTY_BRIEF);
		reopened.close();
	});

	test('a row that parses into the wrong shape still reads as the empty brief', () => {
		const dbPath = join(createTestTmpdir('gship-run-store-brief-shape-'), 'runtime.sqlite');
		const store = new RunStore(dbPath);
		store.setProjectBrief(
			{ objective: 'Será substituído por uma lista.', decisions: [], constraints: [], openItems: [] },
			'2026-08-16T21:00:00.000Z',
		);
		store.close();

		const corrupted = new Database(dbPath);
		corrupted.exec("UPDATE project_brief SET brief_json = '[1, 2, 3]' WHERE id = 1;");
		corrupted.close();

		const reopened = new RunStore(dbPath);
		expect(reopened.getProjectBrief()).toEqual(EMPTY_BRIEF);
		reopened.close();
	});

	test('the write clamps the objective, the list length, and each item', () => {
		const store = new RunStore(':memory:');
		store.setProjectBrief({
			objective: 'o'.repeat(PROJECT_BRIEF_LIMITS.objective + 50),
			decisions: Array.from(
				{ length: PROJECT_BRIEF_LIMITS.listItems + 5 },
				(_, index) => `decisão ${index}`,
			),
			constraints: ['c'.repeat(PROJECT_BRIEF_LIMITS.itemLength + 20)],
			openItems: ['   ', '', 'Item que sobrevive.'],
		}, '2026-08-16T21:10:00.000Z');

		const stored = store.getProjectBrief();
		expect(stored.objective).toHaveLength(PROJECT_BRIEF_LIMITS.objective);
		expect(stored.decisions).toHaveLength(PROJECT_BRIEF_LIMITS.listItems);
		expect(stored.decisions.at(-1)).toBe(`decisão ${PROJECT_BRIEF_LIMITS.listItems - 1}`);
		expect(stored.constraints[0]).toHaveLength(PROJECT_BRIEF_LIMITS.itemLength);
		expect(stored.openItems).toEqual(['Item que sobrevive.']);
		store.close();
	});
});

// GSHIP-623: the run's total cost is derived server-side from every usage
// event it has, so no display limit can ever shrink the number shown.
describe('run cost summary', () => {
	function appendUsage(
		store: RunStore,
		runId: string,
		kind: 'provider.usage' | 'review.usage' | 'mutation-sensor.usage' | 'cycle-question.usage' | 'chain-reconciliation.usage'
			| 'run.cycle-response' | 'run.chain-reconciliation',
		payload: Record<string, unknown>,
	): void {
		store.appendEvent({ runId, kind, createdAt: '2026-08-17T10:00:00.000Z', payload });
	}

	test('sums the total and the per-role, per-model breakdown across every invocation', () => {
		const store = storeWithRun('run-cost', 'CAM-60');
		// First pass: executor on opus.
		appendUsage(store, 'run-cost', 'provider.usage', {
			model: 'opus',
			effort: 'high',
			totalCostUsd: 0.12,
			usage: { inputTokens: 900, outputTokens: 150 },
			modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 900, outputTokens: 150, costUsd: 0.12 }],
		});
		// Independent reviewer, its own model.
		appendUsage(store, 'run-cost', 'review.usage', {
			model: 'sonnet',
			totalCostUsd: 0.03,
			modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 40, costUsd: 0.03 }],
		});
		// The single automatic fix round: a second executor invocation, same
		// model, whose cost must add to the first instead of replacing it.
		appendUsage(store, 'run-cost', 'provider.usage', {
			model: 'opus',
			effort: 'high',
			totalCostUsd: 0.04,
			modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 200, outputTokens: 60, costUsd: 0.04 }],
		});

		expect(store.getRunCostSummary('run-cost')).toEqual({
			totalCostUsd: 0.19,
			costCoverage: 'complete',
			breakdown: [
				{
					role: 'executor',
					model: 'claude-opus-4-6',
					costUsd: 0.16,
					inputTokens: 1100,
					outputTokens: 210,
				},
				{
					role: 'reviewer',
					model: 'claude-sonnet-4-6',
					costUsd: 0.03,
					inputTokens: 300,
					outputTokens: 40,
				},
			],
			// The executor's two invocations agreed on 'high'; the reviewer never
			// reported an effort or a thinking count at all, so it has no row here.
			roles: [{ role: 'executor', effort: 'high' }],
			unpricedInvocations: 0,
		});
		store.close();
	});

	// GSHIP-893: the mutation sensor's own model call (`mutation-sensor.usage`,
	// emitted by `ClaudeCliMutationSelector`) is the reviewer's own read-only
	// step, so it must roll into the same 'reviewer' role and count toward
	// coverage exactly like `review.usage` does above -- never left out of the
	// total, which would otherwise understate the run's real cost every time
	// full-verify actually calls a model.
	test('folds mutation-sensor.usage into the reviewer role, alongside review.usage', () => {
		const store = storeWithRun('run-cost-mutation-sensor', 'CAM-893');
		appendUsage(store, 'run-cost-mutation-sensor', 'review.usage', {
			model: 'sonnet',
			totalCostUsd: 0.03,
			modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 40, costUsd: 0.03 }],
		});
		appendUsage(store, 'run-cost-mutation-sensor', 'mutation-sensor.usage', {
			model: 'sonnet',
			totalCostUsd: 0.02,
			modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 150, outputTokens: 20, costUsd: 0.02 }],
		});

		const summary = store.getRunCostSummary('run-cost-mutation-sensor');
		expect(summary.totalCostUsd).toBeCloseTo(0.05, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{
			role: 'reviewer',
			model: 'claude-sonnet-4-6',
			costUsd: expect.closeTo(0.05, 6),
			inputTokens: 450,
			outputTokens: 60,
		}]);
		store.close();
	});

	// GSHIP-628: effort and thinkingTokens describe the whole invocation, not
	// one model in it -- the effort flag it was called with, the thinking count
	// `usage` reports at the call level -- so both are reported per role
	// instead of matched against any model id. Real usage is always
	// multi-model: the model-settings alias sits at the top of the event, and
	// `modelUsage` carries the CLI's own resolved ids for the configured model
	// plus an auxiliary call the operator's settings never named. Thinking
	// always sums across a role's invocations, including the automatic fix
	// round; effort stays absent for the whole role the moment two of its
	// invocations disagree, instead of guessing by picking one.
	test('reports effort and thinking per role, never on a model row, dropping effort when a role\'s invocations disagree', () => {
		const store = storeWithRun('run-cost-thinking', 'CAM-64');
		// First pass: the executor's alias at the top, modelUsage resolved into
		// the configured model plus an auxiliary call.
		appendUsage(store, 'run-cost-thinking', 'provider.usage', {
			model: 'opus',
			effort: 'xhigh',
			totalCostUsd: 0.22,
			usage: { inputTokens: 500, outputTokens: 100, thinkingTokens: 35704 },
			modelUsage: [
				{ model: 'claude-opus-4-6', inputTokens: 500, outputTokens: 100, costUsd: 0.2 },
				{ model: 'claude-haiku-4-5', costUsd: 0.02 },
			],
		});
		// The automatic fix round: same role, same effort. Its thinking tokens
		// add to the first invocation's instead of replacing or duplicating it.
		appendUsage(store, 'run-cost-thinking', 'provider.usage', {
			model: 'opus',
			effort: 'xhigh',
			totalCostUsd: 0.07,
			usage: { thinkingTokens: 1200 },
			modelUsage: [
				{ model: 'claude-opus-4-6', costUsd: 0.05 },
				{ model: 'claude-haiku-4-5', costUsd: 0.02 },
			],
		});
		// The reviewer, called twice at two different efforts: the role's effort
		// must stay absent, but its thinking still sums across both invocations.
		appendUsage(store, 'run-cost-thinking', 'review.usage', {
			model: 'sonnet',
			effort: 'high',
			totalCostUsd: 0.02,
			usage: { thinkingTokens: 900 },
			modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }],
		});
		appendUsage(store, 'run-cost-thinking', 'review.usage', {
			model: 'sonnet',
			effort: 'medium',
			totalCostUsd: 0.01,
			usage: { thinkingTokens: 300 },
			modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});

		const summary = store.getRunCostSummary('run-cost-thinking');
		expect(summary.totalCostUsd).toBeCloseTo(0.32, 6);
		expect(summary.breakdown).toEqual([
			{
				role: 'executor',
				model: 'claude-opus-4-6',
				costUsd: expect.closeTo(0.25, 6),
				inputTokens: 500,
				outputTokens: 100,
			},
			{
				role: 'executor',
				model: 'claude-haiku-4-5',
				costUsd: expect.closeTo(0.04, 6),
			},
			{
				role: 'reviewer',
				model: 'claude-sonnet-4-6',
				costUsd: expect.closeTo(0.03, 6),
			},
		]);
		expect(summary.roles).toEqual([
			{ role: 'executor', thinkingTokens: 36904, effort: 'xhigh' },
			// 'high' and 'medium' disagree, so the reviewer's effort is absent --
			// its thinking still summed both invocations.
			{ role: 'reviewer', thinkingTokens: 1200 },
		]);
		store.close();
	});

	test('reads as null, never zero, when the run has no usage event at all', () => {
		const store = storeWithRun('run-cost-none', 'CAM-61');
		expect(store.getRunCostSummary('run-cost-none'))
			.toEqual({ totalCostUsd: null, costCoverage: 'unknown', breakdown: [], roles: [], unpricedInvocations: 0 });
		store.close();
	});

	test('a run with more events than listRunEvents\' read limit still reports its true total', () => {
		const store = storeWithRun('run-cost-many', 'CAM-62');
		const invocations = 210;
		for (let index = 0; index < invocations; index += 1) {
			appendUsage(store, 'run-cost-many', 'provider.usage', {
				model: 'opus',
				totalCostUsd: 0.01,
				modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 10, outputTokens: 2, costUsd: 0.01 }],
			});
		}
		// The display read is capped well under what was written...
		expect(store.listRunEvents('run-cost-many').length).toBeLessThan(invocations);
		// ...but the cost aggregate is not: it reads the complete, unbounded log.
		const summary = store.getRunCostSummary('run-cost-many');
		expect(summary.totalCostUsd).toBeCloseTo(invocations * 0.01, 6);
		expect(summary.breakdown).toEqual([{
			role: 'executor',
			model: 'claude-opus-4-6',
			costUsd: expect.closeTo(invocations * 0.01, 6),
			inputTokens: invocations * 10,
			outputTokens: invocations * 2,
		}]);
		store.close();
	});

	test('ignores an event whose model or cost is unusable instead of throwing', () => {
		const store = storeWithRun('run-cost-noisy', 'CAM-63');
		appendUsage(store, 'run-cost-noisy', 'provider.usage', {
			totalCostUsd: 0.05,
			modelUsage: [
				{ model: 'claude-opus-4-6', costUsd: 'not-a-number' },
				{ costUsd: 0.05 },
				{ model: 'claude-opus-4-6', costUsd: 0.05 },
			],
		});
		expect(store.getRunCostSummary('run-cost-noisy')).toEqual({
			totalCostUsd: 0.05,
			costCoverage: 'complete',
			breakdown: [{ role: 'executor', model: 'claude-opus-4-6', costUsd: 0.05 }],
			roles: [],
			unpricedInvocations: 0,
		});
		store.close();
	});

	// GSHIP-889: a raw `.usage` event and its response copy share the same
	// invocationId. Both the resolver's (`cycle-question.usage` /
	// `run.cycle-response`) and the reconciler's (`chain-reconciliation.usage` /
	// `run.chain-reconciliation`) pairs must fold into one invocation, not two.
	test('folds a raw usage event and its response copy into one invocation, never doubling the total', () => {
		const store = storeWithRun('run-cost-dup', 'CAM-889');
		appendUsage(store, 'run-cost-dup', 'cycle-question.usage', {
			provider: 'claude', invocationId: 'inv-1', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.05, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
		});
		appendUsage(store, 'run-cost-dup', 'run.cycle-response', {
			provider: 'claude', invocationId: 'inv-1', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.05, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
		});
		appendUsage(store, 'run-cost-dup', 'chain-reconciliation.usage', {
			provider: 'claude', invocationId: 'inv-2', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.01, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		appendUsage(store, 'run-cost-dup', 'run.chain-reconciliation', {
			provider: 'claude', invocationId: 'inv-2', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.01, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		const summary = store.getRunCostSummary('run-cost-dup');
		expect(summary.totalCostUsd).toBeCloseTo(0.06, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{
			role: 'orchestrator', model: 'claude-sonnet-4-6',
			costUsd: expect.closeTo(0.06, 6), inputTokens: 100, outputTokens: 20,
		}]);
		store.close();
	});

	// GSHIP-889: a run recorded before GSHIP-888 minted invocationId has a raw
	// resolver/reconciler usage event and its response copy with no id to match
	// them by. Counting the raw event here would double it against the copy --
	// the ambiguous legacy pair must still fold to one invocation, exactly as
	// it did before the raw kind was added as a source.
	test('never doubles a legacy raw usage event and its response copy when neither carries an invocationId', () => {
		const store = storeWithRun('run-cost-legacy-dup', 'CAM-889-f');
		appendUsage(store, 'run-cost-legacy-dup', 'cycle-question.usage', {
			provider: 'claude', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.05, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
		});
		appendUsage(store, 'run-cost-legacy-dup', 'run.cycle-response', {
			provider: 'claude', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.05, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 20, costUsd: 0.05 }],
		});
		appendUsage(store, 'run-cost-legacy-dup', 'chain-reconciliation.usage', {
			provider: 'claude', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.01, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		appendUsage(store, 'run-cost-legacy-dup', 'run.chain-reconciliation', {
			provider: 'claude', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.01, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		const summary = store.getRunCostSummary('run-cost-legacy-dup');
		expect(summary.totalCostUsd).toBeCloseTo(0.06, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{
			role: 'orchestrator', model: 'claude-sonnet-4-6',
			costUsd: expect.closeTo(0.06, 6), inputTokens: 100, outputTokens: 20,
		}]);
		store.close();
	});

	// GSHIP-889: a legacy resolver/reconciler failure has only the raw usage
	// event, no id, no copy at all. Its cost and tokens are skipped -- there is
	// no copy to add them from either -- but the invocation itself still
	// counts toward coverage as unpriced: with nothing else in the run, that
	// is the only invocation there is, and it was never priced, so coverage
	// reads 'unknown', never 'complete' for lack of anything to compare it to.
	test('skips a legacy raw resolver or reconciler usage event that never carries an invocationId and has no copy', () => {
		const store = storeWithRun('run-cost-legacy-orphan', 'CAM-889-g');
		appendUsage(store, 'run-cost-legacy-orphan', 'chain-reconciliation.usage', {
			provider: 'claude', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 50, outputTokens: 10, costUsd: 0.02 }],
		});
		expect(store.getRunCostSummary('run-cost-legacy-orphan'))
			.toEqual({ totalCostUsd: null, costCoverage: 'unknown', breakdown: [], roles: [], unpricedInvocations: 1 });
		store.close();
	});

	// GSHIP-889: the same legacy resolver failure as above, but beside a priced
	// executor call elsewhere in the run. The orphaned raw event still cannot
	// contribute its own cost or tokens -- there is no copy to add them from --
	// but it now counts toward coverage as an invocation this history cannot
	// account for, so coverage reads 'partial', never 'complete' just because
	// another call in the run happened to be priced.
	test('marks coverage partial, not complete, when a legacy resolver failure with no copy sits beside a priced executor call', () => {
		const store = storeWithRun('run-cost-legacy-partial-resolver', 'CAM-889-k');
		appendUsage(store, 'run-cost-legacy-partial-resolver', 'provider.usage', {
			model: 'opus', totalCostUsd: 0.12,
			modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 900, outputTokens: 150, costUsd: 0.12 }],
		});
		appendUsage(store, 'run-cost-legacy-partial-resolver', 'cycle-question.usage', {
			model: 'sonnet', totalCostUsd: 0.02,
			modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }],
		});
		const summary = store.getRunCostSummary('run-cost-legacy-partial-resolver');
		expect(summary.totalCostUsd).toBeCloseTo(0.12, 6);
		expect(summary.costCoverage).toBe('partial');
		expect(summary.breakdown).toEqual([{
			role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.12, 6), inputTokens: 900, outputTokens: 150,
		}]);
		store.close();
	});

	// GSHIP-889: two legacy raw chain-reconciliation.usage events but only one
	// legacy run.chain-reconciliation copy -- one raw event is unmatched. The
	// total is exactly the priced executor call plus the one matched copy: the
	// unmatched raw event contributes nothing (there is no second copy to add
	// it from), yet it still counts toward coverage, so the run reads
	// 'partial' instead of 'complete'.
	test('counts an unmatched legacy raw event toward coverage without adding its cost, when a matched copy sits beside it', () => {
		const store = storeWithRun('run-cost-legacy-partial-reconciler', 'CAM-889-l');
		appendUsage(store, 'run-cost-legacy-partial-reconciler', 'provider.usage', {
			model: 'opus', totalCostUsd: 0.1,
			modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.1 }],
		});
		appendUsage(store, 'run-cost-legacy-partial-reconciler', 'chain-reconciliation.usage', {
			model: 'sonnet', totalCostUsd: 0.01, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		appendUsage(store, 'run-cost-legacy-partial-reconciler', 'chain-reconciliation.usage', {
			model: 'sonnet', totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }],
		});
		appendUsage(store, 'run-cost-legacy-partial-reconciler', 'run.chain-reconciliation', {
			model: 'sonnet', totalCostUsd: 0.03, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.03 }],
		});
		const summary = store.getRunCostSummary('run-cost-legacy-partial-reconciler');
		expect(summary.totalCostUsd).toBeCloseTo(0.13, 6);
		expect(summary.costCoverage).toBe('partial');
		expect(summary.breakdown).toEqual([
			{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.1, 6) },
			{ role: 'orchestrator', model: 'claude-sonnet-4-6', costUsd: expect.closeTo(0.03, 6) },
		]);
		store.close();
	});

	// GSHIP-889: the reconciler's raw usage event is durable the instant its
	// call completes, before its final `run.chain-reconciliation` (which never
	// exists for a run that threw on an invalid response). The raw event alone
	// must still count.
	test('counts a resolver or reconciler usage report even when it never produced a final response', () => {
		const store = storeWithRun('run-cost-failed', 'CAM-889-b');
		appendUsage(store, 'run-cost-failed', 'chain-reconciliation.usage', {
			provider: 'claude', invocationId: 'inv-failed', model: 'sonnet', effort: 'medium',
			totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 50, outputTokens: 10, costUsd: 0.02 }],
		});
		const summary = store.getRunCostSummary('run-cost-failed');
		expect(summary.totalCostUsd).toBeCloseTo(0.02, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{
			role: 'orchestrator', model: 'claude-sonnet-4-6', costUsd: expect.closeTo(0.02, 6), inputTokens: 50, outputTokens: 10,
		}]);
		store.close();
	});

	// GSHIP-889: Codex never reports a per-model cost or a `modelUsage` array,
	// only flat token counts on `payload.usage`. Its tokens must still surface
	// in the breakdown, with cost absent rather than a fabricated zero, and the
	// run's coverage must read as partial once a priced Claude call sits beside
	// an unpriced Codex one.
	test('reports Codex tokens without a modelUsage array, cost absent, coverage partial beside a priced call', () => {
		const store = storeWithRun('run-cost-mixed', 'CAM-889-c');
		appendUsage(store, 'run-cost-mixed', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-claude', model: 'opus', effort: 'high',
			totalCostUsd: 0.1, modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 400, outputTokens: 80, costUsd: 0.1 }],
		});
		appendUsage(store, 'run-cost-mixed', 'review.usage', {
			provider: 'codex', invocationId: 'inv-codex', model: 'gpt-5-codex', effort: 'medium',
			usage: { inputTokens: 300, outputTokens: 60, cacheReadInputTokens: 120 },
		});
		const summary = store.getRunCostSummary('run-cost-mixed');
		expect(summary.totalCostUsd).toBeCloseTo(0.1, 6);
		expect(summary.costCoverage).toBe('partial');
		expect(summary.breakdown).toEqual([
			{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.1, 6), inputTokens: 400, outputTokens: 80 },
			{ role: 'reviewer', model: 'gpt-5-codex', inputTokens: 300, outputTokens: 60, cacheReadInputTokens: 120 },
		]);
		store.close();
	});

	// GSHIP-889: no invocation in the run ever reported a price at all -- the
	// tokens are known, but the run's cost coverage must read as unknown, never
	// upgraded to complete or partial just because tokens exist.
	test('reads coverage as unknown when every invocation reported tokens but never a price', () => {
		const store = storeWithRun('run-cost-unpriced', 'CAM-889-d');
		appendUsage(store, 'run-cost-unpriced', 'review.usage', {
			provider: 'codex', invocationId: 'inv-codex-only', model: 'gpt-5-codex',
			usage: { inputTokens: 30, outputTokens: 5 },
		});
		const summary = store.getRunCostSummary('run-cost-unpriced');
		expect(summary.totalCostUsd).toBeNull();
		expect(summary.costCoverage).toBe('unknown');
		expect(summary.breakdown).toEqual([{ role: 'reviewer', model: 'gpt-5-codex', inputTokens: 30, outputTokens: 5 }]);
		store.close();
	});

	// GSHIP-889: the default Codex slot (model-settings.ts) has no configured
	// model at all, so `emitCodexUsage` never sets `payload.model`. The
	// invocation's tokens must still appear in the breakdown, keyed to
	// 'provider-default' -- the same fallback `emitModelSelection` and the
	// resolvers already use for an unconfigured slot -- rather than vanishing
	// for lack of a model name.
	test('keys Codex tokens to provider-default when the invoked slot had no model configured', () => {
		const store = storeWithRun('run-cost-codex-default-model', 'CAM-889-p');
		appendUsage(store, 'run-cost-codex-default-model', 'review.usage', {
			provider: 'codex', invocationId: 'inv-codex-default',
			usage: { inputTokens: 30, outputTokens: 5, cacheReadInputTokens: 12 },
		});
		expect(store.getRunCostSummary('run-cost-codex-default-model')).toEqual({
			totalCostUsd: null,
			costCoverage: 'unknown',
			breakdown: [{ role: 'reviewer', model: 'provider-default', inputTokens: 30, outputTokens: 5, cacheReadInputTokens: 12 }],
			roles: [],
			unpricedInvocations: 1,
		});
		store.close();
	});

	// GSHIP-889: the same unconfigured-slot Codex call as above, but beside a
	// priced Claude executor call. The Codex tokens still surface under
	// 'provider-default', with cost absent, and coverage reads 'partial' since
	// one of the two invocations was never priced.
	test('reports an unconfigured-slot Codex call as provider-default beside a priced Claude call', () => {
		const store = storeWithRun('run-cost-codex-default-mixed', 'CAM-889-q');
		appendUsage(store, 'run-cost-codex-default-mixed', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-claude', model: 'opus',
			totalCostUsd: 0.1, modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.1 }],
		});
		appendUsage(store, 'run-cost-codex-default-mixed', 'provider.usage', {
			provider: 'codex', invocationId: 'inv-codex-default-mixed',
			usage: { inputTokens: 200, outputTokens: 40 },
		});
		const summary = store.getRunCostSummary('run-cost-codex-default-mixed');
		expect(summary.totalCostUsd).toBeCloseTo(0.1, 6);
		expect(summary.costCoverage).toBe('partial');
		expect(summary.breakdown).toEqual([
			{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.1, 6) },
			{ role: 'executor', model: 'provider-default', inputTokens: 200, outputTokens: 40 },
		]);
		store.close();
	});

	// GSHIP-889: a real reported zero is a known price, distinct from an
	// absent one -- it must count toward coverage and never be conflated with
	// "no price reported".
	test('treats a real reported zero as a known price, not as missing', () => {
		const store = storeWithRun('run-cost-zero', 'CAM-889-e');
		appendUsage(store, 'run-cost-zero', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-zero', model: 'haiku',
			totalCostUsd: 0, modelUsage: [{ model: 'claude-haiku-4-5', inputTokens: 40, outputTokens: 5, costUsd: 0 }],
		});
		const summary = store.getRunCostSummary('run-cost-zero');
		expect(summary.totalCostUsd).toBe(0);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{ role: 'executor', model: 'claude-haiku-4-5', costUsd: 0, inputTokens: 40, outputTokens: 5 }]);
		store.close();
	});

	// GSHIP-889: each invocation's own reported total is a delta on the running
	// sum, never a replacement -- the snapshot read after each append must be
	// the exact cumulative total of everything appended so far, not just the
	// final one computed once at the end.
	test('reports the exact cumulative snapshot after each delta, not just the final total', () => {
		const store = storeWithRun('run-cost-snapshots', 'CAM-889-h');
		appendUsage(store, 'run-cost-snapshots', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-a', model: 'opus', effort: 'high',
			totalCostUsd: 0.1, modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 500, outputTokens: 100, costUsd: 0.1 }],
		});
		const afterFirst = store.getRunCostSummary('run-cost-snapshots');
		expect(afterFirst.totalCostUsd).toBeCloseTo(0.1, 6);
		expect(afterFirst.breakdown).toEqual([{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.1, 6), inputTokens: 500, outputTokens: 100 }]);

		appendUsage(store, 'run-cost-snapshots', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-b', model: 'opus', effort: 'high',
			totalCostUsd: 0.04, modelUsage: [{ model: 'claude-opus-4-6', inputTokens: 200, outputTokens: 60, costUsd: 0.04 }],
		});
		const afterSecond = store.getRunCostSummary('run-cost-snapshots');
		expect(afterSecond.totalCostUsd).toBeCloseTo(0.14, 6);
		expect(afterSecond.breakdown).toEqual([{
			role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.14, 6), inputTokens: 700, outputTokens: 160,
		}]);
		store.close();
	});

	// GSHIP-889: claude-cli-executor.test.ts ("emits a separate usage event per
	// invocation on resume, without summing or dropping either call") confirms
	// against Claude's own primary source that a resumed session's usage
	// "starts fresh" per call -- unlike Codex's per-turn counters, it is never
	// a running total carried across the resume. Each resumed invocation's
	// totalCostUsd is therefore its own delta, so summing across invocations
	// here is correct: it is not double-counting a total the CLI itself
	// already accumulated.
	test('sums a resumed session\'s own fresh per-call delta instead of an already-cumulative total', () => {
		const store = storeWithRun('run-cost-resume', 'CAM-889-i');
		appendUsage(store, 'run-cost-resume', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-first', model: 'opus',
			totalCostUsd: 0.1234, modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.1234 }],
		});
		// A resumed call to the same session reports its own fresh figures
		// again -- never the session's running total to date.
		appendUsage(store, 'run-cost-resume', 'provider.usage', {
			provider: 'claude', invocationId: 'inv-resumed', model: 'opus',
			totalCostUsd: 0.1234, modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.1234 }],
		});
		const summary = store.getRunCostSummary('run-cost-resume');
		expect(summary.totalCostUsd).toBeCloseTo(0.2468, 6);
		expect(summary.breakdown).toEqual([{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.2468, 6) }]);
		store.close();
	});

	// GSHIP-889: executor, reviewer, resolver and reconciler all in the same
	// run, several of them with more than one model, combined into one exact
	// total and breakdown -- the resolver's and reconciler's shared
	// 'orchestrator' role folds their (role, model) pairs together, same as
	// any other repeated pair.
	test('combines executor, reviewer, resolver and reconciler in one run, each with multiple models, into one exact total', () => {
		const store = storeWithRun('run-cost-all-functions', 'CAM-889-j');
		appendUsage(store, 'run-cost-all-functions', 'provider.usage', {
			invocationId: 'inv-exec', model: 'opus', totalCostUsd: 0.12,
			modelUsage: [
				{ model: 'claude-opus-4-6', inputTokens: 400, outputTokens: 80, costUsd: 0.1 },
				{ model: 'claude-haiku-4-5', costUsd: 0.02 },
			],
		});
		appendUsage(store, 'run-cost-all-functions', 'review.usage', {
			invocationId: 'inv-review', model: 'sonnet', totalCostUsd: 0.03,
			modelUsage: [{ model: 'claude-sonnet-4-6', inputTokens: 300, outputTokens: 40, costUsd: 0.03 }],
		});
		appendUsage(store, 'run-cost-all-functions', 'cycle-question.usage', {
			invocationId: 'inv-resolver', model: 'sonnet', totalCostUsd: 0.01,
			modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.01 }],
		});
		appendUsage(store, 'run-cost-all-functions', 'chain-reconciliation.usage', {
			invocationId: 'inv-reconciler', model: 'sonnet', totalCostUsd: 0.005,
			modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.005 }],
		});
		const summary = store.getRunCostSummary('run-cost-all-functions');
		expect(summary.totalCostUsd).toBeCloseTo(0.165, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([
			{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.1, 6), inputTokens: 400, outputTokens: 80 },
			{ role: 'executor', model: 'claude-haiku-4-5', costUsd: expect.closeTo(0.02, 6) },
			{ role: 'reviewer', model: 'claude-sonnet-4-6', costUsd: expect.closeTo(0.03, 6), inputTokens: 300, outputTokens: 40 },
			{ role: 'orchestrator', model: 'claude-sonnet-4-6', costUsd: expect.closeTo(0.015, 6) },
		]);
		store.close();
	});

	// GSHIP-889: the operator's own guidance on a cycle question
	// (`#applyOperatorCycleGuidance`, run-runtime.ts) writes a `run.cycle-response`
	// with no invocationId and none of the usage fields `cycleUsageEventPayload`
	// would have set -- it never called a provider. A run fully priced on the
	// provider side must read as 'complete' even though it also received this
	// guidance: a human decision is not an unpriced invocation.
	test('does not count the operator\'s own cycle guidance as an invocation, so a fully priced run still reads complete', () => {
		const store = storeWithRun('run-cost-operator-guidance', 'CAM-889-m');
		appendUsage(store, 'run-cost-operator-guidance', 'provider.usage', {
			invocationId: 'inv-exec', model: 'opus', totalCostUsd: 0.12,
			modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.12 }],
		});
		appendUsage(store, 'run-cost-operator-guidance', 'run.cycle-response', {
			questionId: 'question-1', responder: 'operator', source: 'operator',
			outcome: 'continue', guidance: 'Proceed with the documented workaround.',
			findings: 'The executor asked whether to retry.', origin: 'review',
		});
		const summary = store.getRunCostSummary('run-cost-operator-guidance');
		expect(summary.totalCostUsd).toBeCloseTo(0.12, 6);
		expect(summary.costCoverage).toBe('complete');
		expect(summary.breakdown).toEqual([{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.12, 6) }]);
		expect(summary.roles).toEqual([]);
		store.close();
	});

	// GSHIP-889: the same operator guidance beside a legacy reconciler failure
	// that has no copy at all. The guidance still does not pair against the
	// orphaned raw event (it carries no usage to match), so the raw event stays
	// unmatched and coverage still reads 'partial', not 'complete'.
	test('leaves a legacy reconciler failure unmatched beside operator guidance with no usage of its own', () => {
		const store = storeWithRun('run-cost-operator-guidance-partial', 'CAM-889-n');
		appendUsage(store, 'run-cost-operator-guidance-partial', 'provider.usage', {
			invocationId: 'inv-exec', model: 'opus', totalCostUsd: 0.12,
			modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.12 }],
		});
		appendUsage(store, 'run-cost-operator-guidance-partial', 'run.chain-reconciliation', {
			questionId: 'question-2', responder: 'operator', source: 'operator',
			outcome: 'continue', guidance: 'Proceed anyway.', findings: 'Reconciliation asked a question.', origin: 'review',
		});
		appendUsage(store, 'run-cost-operator-guidance-partial', 'chain-reconciliation.usage', {
			model: 'sonnet', totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }],
		});
		const summary = store.getRunCostSummary('run-cost-operator-guidance-partial');
		expect(summary.totalCostUsd).toBeCloseTo(0.12, 6);
		expect(summary.costCoverage).toBe('partial');
		expect(summary.breakdown).toEqual([{ role: 'executor', model: 'claude-opus-4-6', costUsd: expect.closeTo(0.12, 6) }]);
		store.close();
	});

	// GSHIP-889: operator guidance with no other usage in the run at all is not
	// an invocation, so there is nothing to report -- never 'complete' for lack
	// of any actual provider call, and never a fabricated zero cost.
	test('reads as null and unknown when the only event is the operator\'s own cycle guidance', () => {
		const store = storeWithRun('run-cost-operator-guidance-only', 'CAM-889-o');
		appendUsage(store, 'run-cost-operator-guidance-only', 'run.cycle-response', {
			questionId: 'question-3', responder: 'operator', source: 'operator',
			outcome: 'continue', guidance: 'Proceed.', findings: 'The executor asked a question.', origin: 'executor',
		});
		expect(store.getRunCostSummary('run-cost-operator-guidance-only'))
			.toEqual({ totalCostUsd: null, costCoverage: 'unknown', breakdown: [], roles: [], unpricedInvocations: 0 });
		store.close();
	});
});

// GSHIP-891: `reevaluateHistoricalSample` reapplies T1-T3's own per-run
// evaluation (run-evaluation.ts) and cost projection (`summarizeRunCost`
// above) to an already-persisted sample -- reading only what
// `readPersistedRunHistory` already returns, never a second parser and never
// a write, so replay and a service restart are idempotent by construction.
describe('historical reevaluation', () => {
	function fileStore(id: string, issueId: string, dbPath: string): RunStore {
		const store = new RunStore(dbPath);
		store.createRun({ id, issueId, sessionId: `session-${id}`, workspacePath: `/workspaces/${id}`, createdAt: '2026-09-14T10:00:00.000Z' });
		return store;
	}

	test('returns the identical result on repeated reads and after a restart', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-idempotent-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-a', 'GSHIP-a', dbPath);
		store.appendEvent({ runId: 'run-reeval-a', kind: 'provider.model', createdAt: '2026-09-14T10:01:00.000Z', payload: { model: 'opus', provider: 'claude' } });
		store.appendEvent({
			runId: 'run-reeval-a', kind: 'provider.usage', createdAt: '2026-09-14T10:01:30.000Z',
			payload: { model: 'opus', totalCostUsd: 0.05, modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.05, inputTokens: 100, outputTokens: 20 }] },
		});
		store.close();

		const first = reevaluateHistoricalSample(readPersistedRunHistory(dbPath));
		expect(first).toEqual({
			sampleSize: 1,
			dispatchMethodologyVersion: DISPATCH_METHODOLOGY_VERSION,
			dispatches: { before: 1, after: { known: 1, unknown: 0 } },
			cost: { before: 1, after: { complete: 1, partial: 0, unknown: 0 }, knownCostUsd: expect.closeTo(0.05, 6) },
			nonRecoverable: { dispatches: 0, cost: 0, unpricedInvocations: 0, missingTokens: 0, discardedActivityEvents: 0 },
		});
		// A second read through the same on-demand path, no service restart.
		expect(reevaluateHistoricalSample(readPersistedRunHistory(dbPath))).toEqual(first);
		// A restart -- reopening and closing the mutable store -- changes nothing
		// this read-only path sees, since it opens its own connection each time.
		const reopened = new RunStore(dbPath);
		reopened.close();
		expect(reevaluateHistoricalSample(readPersistedRunHistory(dbPath))).toEqual(first);
	});

	test('dedupes a raw orchestrator usage event against its response copy, matching the per-run rule', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-dedup-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-b', 'GSHIP-b', dbPath);
		store.appendEvent({
			runId: 'run-reeval-b', kind: 'cycle-question.usage', createdAt: '2026-09-14T10:01:00.000Z',
			payload: { invocationId: 'inv-1', model: 'sonnet', totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }] },
		});
		store.appendEvent({
			runId: 'run-reeval-b', kind: 'run.cycle-response', createdAt: '2026-09-14T10:01:05.000Z',
			payload: { invocationId: 'inv-1', responder: 'orchestrator', outcome: 'continue', model: 'sonnet', totalCostUsd: 0.02, modelUsage: [{ model: 'claude-sonnet-4-6', costUsd: 0.02 }] },
		});
		store.close();
		const report = reevaluateHistoricalSample(readPersistedRunHistory(dbPath));
		// Raw `cycle-question.usage` is not itself dispatch-shaped -- only its
		// response copy is -- so `before` counts the pairing once, the same as
		// `after`, and the shared invocationId keeps the priced total from
		// doubling.
		expect(report.dispatches).toEqual({ before: 1, after: { known: 1, unknown: 0 } });
		expect(report.cost).toEqual({ before: 1, after: { complete: 1, partial: 0, unknown: 0 }, knownCostUsd: expect.closeTo(0.02, 6) });
	});

	test('flags a legacy responder-less cycle-response as non-recoverable dispatch provenance, never guessed', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-legacy-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-c', 'GSHIP-c', dbPath);
		store.appendEvent({ runId: 'run-reeval-c', kind: 'run.cycle-response', createdAt: '2026-09-14T10:01:00.000Z', payload: { outcome: 'continue' } });
		store.close();
		const report = reevaluateHistoricalSample(readPersistedRunHistory(dbPath));
		expect(report.dispatches).toEqual({ before: 1, after: { known: 0, unknown: 1 } });
		expect(report.nonRecoverable.dispatches).toBe(1);
	});

	test('counts an unpriced invocation as unknown cost coverage, present in `before` but not recalculable into a price', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-unpriced-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-d', 'GSHIP-d', dbPath);
		store.appendEvent({ runId: 'run-reeval-d', kind: 'provider.usage', createdAt: '2026-09-14T10:01:00.000Z', payload: { model: 'opus' } });
		store.close();
		const report = reevaluateHistoricalSample(readPersistedRunHistory(dbPath));
		expect(report.cost).toEqual({ before: 1, after: { complete: 0, partial: 0, unknown: 1 }, knownCostUsd: null });
		expect(report.nonRecoverable.cost).toBe(1);
	});

	test('includes a non-terminal run in the sample without fabricating its outcome or wall time', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-terminal-'), 'runtime.sqlite');
		const doneStore = fileStore('run-reeval-done', 'GSHIP-e', dbPath);
		doneStore.transition({ runId: 'run-reeval-done', toState: 'working', kind: 'run.started', createdAt: '2026-09-14T10:01:00.000Z' });
		doneStore.appendEvent({ runId: 'run-reeval-done', kind: 'provider.model', createdAt: '2026-09-14T10:01:10.000Z', payload: { model: 'opus', provider: 'claude' } });
		for (const [toState, kind] of [['verify', 'run.verify'], ['ready-to-ship', 'run.ready-to-ship'], ['shipping', 'run.shipping'], ['done', 'run.shipped']] as const) {
			doneStore.transition({ runId: 'run-reeval-done', toState, kind, createdAt: '2026-09-14T10:02:00.000Z' });
		}
		doneStore.createRun({ id: 'run-reeval-active', issueId: 'GSHIP-f', sessionId: 'session-run-reeval-active', workspacePath: '/workspaces/run-reeval-active', createdAt: '2026-09-14T10:05:00.000Z' });
		doneStore.transition({ runId: 'run-reeval-active', toState: 'working', kind: 'run.started', createdAt: '2026-09-14T10:05:30.000Z' });
		doneStore.appendEvent({ runId: 'run-reeval-active', kind: 'provider.model', createdAt: '2026-09-14T10:06:00.000Z', payload: { model: 'sonnet', provider: 'claude' } });
		doneStore.close();

		const history = readPersistedRunHistory(dbPath);
		const active = history.find((item) => item.run.id === 'run-reeval-active');
		expect(active?.evaluation.outcome).toBe('incomplete');
		expect(active?.evaluation.wallTimeMs).toBeNull();

		const report = reevaluateHistoricalSample(history);
		expect(report.sampleSize).toBe(2);
		expect(report.dispatches).toEqual({ before: 2, after: { known: 2, unknown: 0 } });
	});

	test('never mixes two projects\' samples, even with the same run id reused across separate files', () => {
		const dbPathA = join(createTestTmpdir('gship-reeval-isolation-a-'), 'runtime.sqlite');
		const dbPathB = join(createTestTmpdir('gship-reeval-isolation-b-'), 'runtime.sqlite');
		const storeA = fileStore('run-shared-id', 'GSHIP-g', dbPathA);
		storeA.appendEvent({ runId: 'run-shared-id', kind: 'provider.model', createdAt: '2026-09-14T10:01:00.000Z', payload: { model: 'opus', provider: 'claude' } });
		storeA.close();
		const storeB = fileStore('run-shared-id', 'GSHIP-h', dbPathB);
		storeB.close();

		expect(reevaluateHistoricalSample(readPersistedRunHistory(dbPathA)).dispatches.before).toBe(1);
		expect(reevaluateHistoricalSample(readPersistedRunHistory(dbPathB)).dispatches.before).toBe(0);
	});

	test('reports zero counts and a null total for an empty sample, never a fabricated zero cost', () => {
		expect(reevaluateHistoricalSample([])).toEqual({
			sampleSize: 0,
			dispatchMethodologyVersion: DISPATCH_METHODOLOGY_VERSION,
			dispatches: { before: 0, after: { known: 0, unknown: 0 } },
			cost: { before: 0, after: { complete: 0, partial: 0, unknown: 0 }, knownCostUsd: null },
			nonRecoverable: { dispatches: 0, cost: 0, unpricedInvocations: 0, missingTokens: 0, discardedActivityEvents: 0 },
		});
	});

	// GSHIP-891 review: a run's overall coverage can still read 'partial' while
	// one of its own invocations never priced at all -- that invocation must
	// not hide inside a coverage bucket that looks mostly recoverable.
	test('counts an unpriced invocation inside an otherwise partial run, not only a fully unknown run', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-partial-unpriced-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-partial', 'GSHIP-i', dbPath);
		store.appendEvent({
			runId: 'run-reeval-partial', kind: 'provider.usage', createdAt: '2026-09-14T10:01:00.000Z',
			payload: { model: 'opus', totalCostUsd: 0.05, modelUsage: [{ model: 'claude-opus-4-6', costUsd: 0.05 }] },
		});
		store.appendEvent({ runId: 'run-reeval-partial', kind: 'review.usage', createdAt: '2026-09-14T10:01:10.000Z', payload: { model: 'sonnet' } });
		store.close();
		const report = reevaluateHistoricalSample(readPersistedRunHistory(dbPath));
		expect(report.cost.after).toEqual({ complete: 0, partial: 1, unknown: 0 });
		// The run's own coverage bucket is 'partial', so the fully-unknown-run
		// counter stays untouched -- the unpriced invocation only shows up in
		// its own, more granular counter.
		expect(report.nonRecoverable.cost).toBe(0);
		expect(report.nonRecoverable.unpricedInvocations).toBe(1);
	});

	// GSHIP-891 review: a priced invocation whose tokens were never reported at
	// all (e.g. Codex, GSHIP-888) is a permanent gap distinct from an unpriced
	// invocation -- counted even on a run whose coverage otherwise reads
	// 'complete', never reconstructed from text by estimate.
	test('counts a priced breakdown row with no token field at all as a missing-tokens gap', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-missing-tokens-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-tokens', 'GSHIP-j', dbPath);
		store.appendEvent({
			runId: 'run-reeval-tokens', kind: 'provider.usage', createdAt: '2026-09-14T10:01:00.000Z',
			payload: { totalCostUsd: 0.03, modelUsage: [{ model: 'gpt-5-codex', costUsd: 0.03 }] },
		});
		store.close();
		const history = readPersistedRunHistory(dbPath);
		expect(history[0]?.cost.costCoverage).toBe('complete');
		expect(history[0]?.cost.breakdown).toEqual([{ role: 'executor', model: 'gpt-5-codex', costUsd: 0.03 }]);
		const report = reevaluateHistoricalSample(history);
		expect(report.nonRecoverable.missingTokens).toBe(1);
	});

	// GSHIP-891 review: an 'activity' event readPersistedRunHistory excludes
	// from events/evaluation/cost by design (GSHIP-628's ephemeral provider
	// activity) is still a discard the reevaluation must surface, never
	// silently dropped from the report.
	test('counts activity-class events readPersistedRunHistory excludes from decision-level projection', () => {
		const dbPath = join(createTestTmpdir('gship-reeval-activity-'), 'runtime.sqlite');
		const store = fileStore('run-reeval-activity', 'GSHIP-k', dbPath);
		store.appendEvent({ runId: 'run-reeval-activity', kind: 'provider.activity', createdAt: '2026-09-14T10:01:00.000Z', eventClass: 'activity', payload: { chunk: 'thinking...' } });
		store.appendEvent({ runId: 'run-reeval-activity', kind: 'provider.activity', createdAt: '2026-09-14T10:01:01.000Z', eventClass: 'activity', payload: { chunk: 'still thinking...' } });
		store.close();
		const history = readPersistedRunHistory(dbPath);
		expect(history[0]?.events.map((event) => event.kind)).toEqual(['run.created']);
		expect(history[0]?.activityEventCount).toBe(2);
		const report = reevaluateHistoricalSample(history);
		expect(report.nonRecoverable.discardedActivityEvents).toBe(2);
	});
});

// GSHIP-664: the subscription's rate-limit windows are shared across the whole
// install, not owned by one run, so this reads across every run's events --
// never invoking Claude itself, only replaying what a real invocation already
// reported through provider.rate-limit / review.rate-limit.
describe('claude usage windows', () => {
	function appendRateLimit(
		store: RunStore,
		runId: string,
		kind: 'provider.rate-limit' | 'review.rate-limit',
		createdAt: string,
		payload: Record<string, unknown>,
	): void {
		store.appendEvent({ runId, kind, createdAt, payload });
	}

	test('reads as empty, never fabricated, when no invocation ever reported a window', () => {
		const store = storeWithRun('run-usage-none', 'CAM-70');
		expect(store.getClaudeUsageWindows('2026-08-17T10:00:00.000Z')).toEqual([]);
		store.close();
	});

	test('keeps only the freshest observation per window across both roles', () => {
		const store = storeWithRun('run-usage-latest', 'CAM-71');
		appendRateLimit(store, 'run-usage-latest', 'provider.rate-limit', '2026-08-17T10:00:00.000Z', {
			status: 'allowed',
			limit: 'five_hour',
			usedPercent: 10,
		});
		// A later reviewer invocation reports the same window at a higher
		// utilization: this is the observation that must survive, not the first.
		appendRateLimit(store, 'run-usage-latest', 'review.rate-limit', '2026-08-17T11:00:00.000Z', {
			status: 'allowed_warning',
			limit: 'five_hour',
			usedPercent: 78,
			retryAt: '2026-08-17T15:00:00.000Z',
		});
		// A distinct window is kept alongside it, not merged into it.
		appendRateLimit(store, 'run-usage-latest', 'provider.rate-limit', '2026-08-17T10:30:00.000Z', {
			status: 'allowed',
			limit: 'seven_day',
			usedPercent: 20,
		});

		expect(store.getClaudeUsageWindows('2026-08-17T14:59:59.999Z')).toEqual([
			{
				window: 'five_hour',
				status: 'allowed_warning',
				usedPercent: 78,
				observedAt: '2026-08-17T11:00:00.000Z',
				resetsAt: '2026-08-17T15:00:00.000Z',
			},
			{
				window: 'seven_day',
				status: 'allowed',
				usedPercent: 20,
				observedAt: '2026-08-17T10:30:00.000Z',
			},
		]);
		expect(store.getClaudeUsageWindows('2026-08-17T15:00:00.000Z')).toEqual([
			{
				window: 'seven_day',
				status: 'allowed',
				usedPercent: 20,
				observedAt: '2026-08-17T10:30:00.000Z',
			},
		]);
		store.close();
	});

	test('drops an event with no reported window instead of inventing one', () => {
		const store = storeWithRun('run-usage-unnamed', 'CAM-72');
		// The malformed-payload shape consumeClaudeLine emits when readClaudeRateLimit
		// returned null (an unrecognized status, e.g.): no `limit`, no `status`.
		appendRateLimit(store, 'run-usage-unnamed', 'provider.rate-limit', '2026-08-17T10:00:00.000Z', {});
		expect(store.getClaudeUsageWindows('2026-08-17T10:00:00.000Z')).toEqual([]);
		store.close();
	});
});

import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';

import {
	readProjectOperationalOverview,
	readProjectHistoricalOverview,
	readQueueOverview,
	type ProjectOperationalStatus,
	type QueueRuntime,
} from '../../src/runtime/project-status.ts';
import { readPersistedRunHistory, readPersistedRunStatuses, RunStore, type PersistedRunHistory } from '../../src/runtime/run-store.ts';
import { fingerprintSpec } from '../../src/issues/spec.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

const project = {
	id: 'project-1',
	name: 'project',
	root: '/project',
	stateDir: '/state',
	readiness: 'ready' as const,
	repository: 'acme/project',
	current: true,
};

type HistoryRun = { id: string; createdAt: string; terminal: 'shipped' | 'failed' | 'cancelled' };

function history(id: string, updatedAt: string, providerId: 'claude' | 'codex' = 'claude'): PersistedRunHistory {
	return {
		run: { id, issueId: `GSHIP-${id}`, sessionId: id, providerId, workspacePath: '/private/workspace', state: 'done', fixRounds: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt, summary: null, error: null },
		events: [],
		evaluation: {
			specProfile: { version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null } },
			corrections: { verification: 0, review: 0, fullVerify: 0, ci: 0, total: 0 },
			cycleQuestions: { executor: 0, review: 0, fullVerify: 0, total: 0 },
			reconciliations: { unchanged: 0, adapted: 0, 'contract-change-required': 0, total: 0 },
			workflowRevision: null, provider: providerId, outcome: 'shipped', wallTimeMs: 1, attentionRequests: 0, operatorInterventions: 0, providerHolds: 0, roles: [],
		},
		cost: { totalCostUsd: null, breakdown: [], roles: [] },
	};
}

function runTime(run: HistoryRun, suffix: number): string {
	return `${run.createdAt.slice(0, -1)}${suffix}Z`;
}

function transitionShippedRun(store: RunStore, run: HistoryRun): void {
	for (const [index, toState] of (['verify', 'ready-to-ship', 'shipping', 'done'] as const).entries()) {
		store.transition({ runId: run.id, toState, kind: toState === 'done' ? 'run.shipped' : `run.${toState}`, createdAt: runTime(run, index + 2) });
	}
}

function transitionUndeliveredRun(store: RunStore, run: HistoryRun): void {
	const terminalState = run.terminal === 'cancelled' ? 'interrupted' : 'failed';
	store.transition({ runId: run.id, toState: terminalState, kind: `run.${run.terminal}`, createdAt: runTime(run, 2) });
	if (run.terminal === 'cancelled') store.transition({ runId: run.id, toState: 'cancelled', kind: 'run.cancelled', createdAt: runTime(run, 3) });
}

function createRunHistory(databasePath: string, runs: ReadonlyArray<HistoryRun>): void {
	const store = new RunStore(databasePath);
	for (const run of runs) {
		store.createRun({ id: run.id, issueId: `GSHIP-${run.id}`, sessionId: `session-${run.id}`, workspacePath: `/workspaces/${run.id}`, createdAt: run.createdAt });
		store.transition({ runId: run.id, toState: 'working', kind: 'run.started', createdAt: runTime(run, 1) });
		if (run.terminal === 'shipped') transitionShippedRun(store, run);
		else transitionUndeliveredRun(store, run);
	}
	store.close();
}

function statusForHistory(databasePath: string): ProjectOperationalStatus {
	const historyProject = { ...project, stateDir: databasePath.slice(0, databasePath.lastIndexOf('/')) };
	return {
		project: historyProject,
		root: { state: 'available' },
		backlog: { state: 'available', counts: { idea: 0, specified: 0, planned: 0 }, plannable: [], byStage: { idea: [], specified: [], planned: [] }, drafts: [] },
		database: { state: 'available', path: databasePath, runs: readPersistedRunStatuses(databasePath) },
	};
}

test('marks a project unavailable when its second database read fails', () => {
	const status: ProjectOperationalStatus = {
		project,
		root: { state: 'available' },
		backlog: {
			state: 'available',
			counts: { idea: 0, specified: 0, planned: 0 },
			plannable: [],
			byStage: { idea: [], specified: [], planned: [] },
			drafts: [],
		},
		database: {
			state: 'available',
			path: '/state/runtime.sqlite',
			runs: [],
		},
	};

	const overview = readProjectOperationalOverview(
		[project],
		() => status,
		() => { throw new Error('database changed during overview'); },
	);

	expect(overview.projects[0]?.database).toEqual({
		state: 'unavailable',
		path: '/state/runtime.sqlite',
		reason: 'database changed during overview',
	});
	expect(overview.projects[0]?.activeRun).toBeNull();
	expect(overview.summary).toMatchObject({
		readyProjects: 0,
		unavailableProjects: 1,
		nonTerminalRuns: 0,
	});
});

test('preserves an active run when the historical read fails', () => {
	const status: ProjectOperationalStatus = {
		project,
		root: { state: 'available' },
		backlog: { state: 'available', counts: { idea: 0, specified: 0, planned: 0 }, plannable: [], byStage: { idea: [], specified: [], planned: [] }, drafts: [] },
		database: { state: 'available', path: '/state/runtime.sqlite', runs: [] },
	};
	const activeRun = { id: 'run-active', issueId: 'GSHIP-731', providerId: 'claude' as const, state: 'working' as const, createdAt: '', updatedAt: '' };
	const overview = readProjectOperationalOverview([project], () => status, () => ({ activeRun, nonTerminalRuns: 1 }));
	const entry = overview.projects[0];
	expect(entry?.database).toEqual(status.database);
	expect(entry?.activeRun).toEqual(activeRun);
	expect(entry?.overview).toEqual({ overview: null, reason: 'unable to open database file' });
});

test('uses the latest delivered run when a newer run failed', () => {
	const databasePath = join(createTestTmpdir('gship-project-delivery-'), 'runtime.sqlite');
	createRunHistory(databasePath, [
		{ id: 'run-delivered', createdAt: '2026-08-23T10:00:00Z', terminal: 'shipped' },
		{ id: 'run-failed', createdAt: '2026-08-23T11:00:00Z', terminal: 'failed' },
	]);
	const status = statusForHistory(databasePath);
	const entry = readProjectOperationalOverview([status.project], () => status, () => ({ activeRun: null, nonTerminalRuns: 0 })).projects[0];

	expect(entry?.latestRun?.id).toBe('run-delivered');
	expect(entry?.latestRunOutcome).toBe('shipped');
});

test('returns no delivery when history contains only non-delivered runs', () => {
	const databasePath = join(createTestTmpdir('gship-project-no-delivery-'), 'runtime.sqlite');
	createRunHistory(databasePath, [
		{ id: 'run-failed', createdAt: '2026-08-23T10:00:00Z', terminal: 'failed' },
		{ id: 'run-cancelled', createdAt: '2026-08-23T11:00:00Z', terminal: 'cancelled' },
	]);
	const status = statusForHistory(databasePath);
	const entry = readProjectOperationalOverview([status.project], () => status, () => ({ activeRun: null, nonTerminalRuns: 0 })).projects[0];

	expect(entry?.latestRun).toBeNull();
	expect(entry?.latestRunOutcome).toBeNull();
});

test('keeps history unavailable distinct from no delivery', () => {
	const status: ProjectOperationalStatus = {
		project,
		root: { state: 'available' },
		backlog: { state: 'available', counts: { idea: 0, specified: 0, planned: 0 }, plannable: [], byStage: { idea: [], specified: [], planned: [] }, drafts: [] },
		database: { state: 'available', path: '/state/runtime.sqlite', runs: [] },
	};
	const entry = readProjectOperationalOverview([project], () => status, () => { throw new Error('history unavailable'); }).projects[0];

	expect(entry?.overview).toEqual({ overview: null, reason: 'history unavailable' });
	expect(entry?.latestRun).toBeNull();
	expect(entry?.latestRunOutcome).toBeNull();
});

test('ignores malformed activity events when reading historical decisions', () => {
	const databasePath = join(createTestTmpdir('gship-project-history-'), 'runtime.sqlite');
	const store = new RunStore(databasePath);
	store.createRun({
		id: 'run-history',
		issueId: 'GSHIP-730',
		sessionId: 'session-history',
		workspacePath: '/workspaces/history',
		createdAt: '2026-08-23T10:00:00.000Z',
	});
	store.appendEvent({
		runId: 'run-history',
		kind: 'provider.activity',
		createdAt: '2026-08-23T10:01:00.000Z',
		eventClass: 'activity',
	});
	store.close();

	const database = new Database(databasePath, { strict: true });
	database.query(`
		UPDATE run_events
		SET to_state = 'invalid-state', payload_json = '{malformed'
		WHERE event_class = 'activity'
	`).run();
	database.close();

	const history = readPersistedRunHistory(databasePath);
	expect(history).toHaveLength(1);
	expect(history[0]?.events.map((event) => event.kind)).toEqual(['run.created']);
	expect(history[0]?.evaluation.outcome).toBe('incomplete');
});

test('projects queues independently, keeps dispatcher order, and reports active work', () => {
	const approved = { scope: 'do it', verify: ['bun test'] };
	const backlog = [
		{ id: 'GSHIP-19', title: 'dependency', stage: 'planned' as const, status: 'open' as const, blockedBy: [], createdAt: '', updatedAt: '' },
		{ id: 'GSHIP-20', title: 'blocked', stage: 'specified' as const, status: 'open' as const, blockedBy: ['GSHIP-19'], createdAt: '', updatedAt: '', spec: approved, approval: { fingerprint: fingerprintSpec(approved), approvedAt: '' } },
		{ id: 'GSHIP-12', title: 'current', stage: 'specified' as const, status: 'open' as const, blockedBy: [], createdAt: '', updatedAt: '', spec: approved, approval: { fingerprint: fingerprintSpec(approved), approvedAt: '' } },
	];
	const queues = readQueueOverview([
		project,
		{ ...project, id: 'unavailable', name: 'unavailable', stateDir: '/missing-state' },
	], () => backlog, new Map<string, QueueRuntime>([[project.id, {
		listRuns: () => [{ id: 'run-queue', issueId: 'GSHIP-12', providerId: 'claude', state: 'working', createdAt: '', updatedAt: '' } as never],
		getChainRuns: () => true,
		getChainPause: () => null,
	}]]));
	expect(queues.queues[0]).toMatchObject({ chainEnabled: true, currentRun: { issueId: 'GSHIP-12' }, nextIssue: null, plannedIssues: [{ id: 'GSHIP-12' }] });
	expect(queues.errors).toEqual([{ projectId: 'unavailable', projectName: 'unavailable', code: 'project-unavailable', message: 'Project queue is unavailable.' }]);
});

test('keeps queue delivery history unavailable distinct from a valid empty history', () => {
	const context: QueueRuntime = { listRuns: () => [], getChainRuns: () => true, getChainPause: () => null };
	const available = readQueueOverview([project], () => [], new Map([[project.id, context]]), () => []);
	expect(available.queues[0]?.lastDelivery).toEqual({ state: 'available', run: null });

	const unavailable = readQueueOverview([project], () => [], new Map([[project.id, context]]), () => { throw new Error('history unavailable'); });
	expect(unavailable.queues[0]?.lastDelivery).toEqual({ state: 'unavailable' });
	expect(unavailable.errors).toEqual([]);
});

test('expõe derivações históricas, denominadores e desconhecidos sem inventar dados', () => {
	const shipped = history('derived', '2026-09-05T00:00:00.000Z');
	shipped.run.createdAt = '2026-09-05T00:00:00.000Z';
	shipped.events = [
		{ kind: 'run.started', createdAt: '2026-09-05T00:01:00.000Z' },
		{ kind: 'run.review-fix-requested', createdAt: '2026-09-05T00:02:00.000Z' },
		{ kind: 'run.ci-fix-requested', createdAt: '2026-09-05T00:03:00.000Z' },
		{ kind: 'run.started', createdAt: '2026-09-05T00:04:00.000Z' },
		{ kind: 'run.review-clean', createdAt: '2026-09-05T00:05:00.000Z' },
		{ kind: 'ship.merged', createdAt: '2026-09-05T00:10:00.000Z' },
	] as never;
	const overview = readProjectHistoricalOverview(project, '7d', new Date('2026-09-07T00:00:00.000Z'), () => [shipped]);
	expect(overview.overview).toMatchObject({
		totalRuns: 1, terminalRuns: 1, terminalWallTimeMs: 1, terminalWallTimeRuns: 1,
		shippedWithoutIntervention: 1, dispatchToMergeMs: 540000, dispatchToMergeRuns: 1, medianDispatchToMergeMs: 540000,
		firstReviewPasses: 0, firstReviewPassKnownRuns: 1, ciCorrections: 1,
	});
	expect(overview.overview?.daily[0]).toMatchObject({ terminalRuns: 1, shippedWithoutIntervention: 1, ciCorrections: 1 });

	const empty = readProjectHistoricalOverview(project, 'all', new Date(), () => []);
	expect(empty.overview).toMatchObject({ totalRuns: 0, terminalRuns: 0, terminalWallTimeMs: null, dispatchToMergeMs: null, medianDispatchToMergeMs: null, daily: [] });
	const incomplete = history('active', '2026-09-05T00:00:00.000Z');
	incomplete.evaluation.outcome = 'incomplete';
	const partial = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [incomplete]);
	expect(partial.overview).toMatchObject({ activeRuns: 1, terminalRuns: 0, terminalWallTimeMs: null, terminalWallTimeRuns: 0 });
});

test('filtra a proveniência por provider, papel, modelo e esforço', () => {
	const item = history('filtered', '2026-09-05T00:00:00.000Z', 'claude');
	item.events = [
		{ seq: 1, kind: 'provider.model', payload: { provider: 'codex', model: 'model-b', effort: 'high' } },
		{ seq: 2, kind: 'provider.model', payload: { provider: 'claude', model: 'model-a', effort: 'low' } },
	] as never;
	const read = (filters: Parameters<typeof readProjectHistoricalOverview>[4]) =>
		readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [item], filters).overview;
	// Provider filters use reconstructed configuration provenance, not the
	// initial run origin. Combined filters must match one configuration tuple.
	expect(read({ providerId: 'codex' })?.totalRuns).toBe(1);
	expect(read({ providerId: 'codex', role: 'executor', model: 'model-a', effort: 'high' })?.totalRuns).toBe(0);
	expect(read({ providerId: 'codex', role: 'executor', model: 'model-b', effort: 'high' })?.totalRuns).toBe(1);
	expect(read({ providerId: 'claude', role: 'executor', model: 'model-a', effort: 'low' })?.totalRuns).toBe(1);
	expect(read({ providerId: 'claude' })?.totalRuns).toBe(1);
	expect(read({ role: 'reviewer' })?.totalRuns).toBe(0);

	const legacy = history('legacy', '2026-09-05T00:00:00.000Z', 'claude');
	const readLegacy = (filters: Parameters<typeof readProjectHistoricalOverview>[4]) =>
		readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [legacy], filters).overview;
	expect(readLegacy({ providerId: 'claude' })?.totalRuns).toBe(1);
	expect(readLegacy({ providerId: 'claude', role: 'executor' })?.totalRuns).toBe(0);
});

test('calcula mediana ímpar, média par e ignora timestamps inválidos', () => {
	const dispatchHistory = (id: string, elapsedMs: number, provider: 'claude' | 'codex' = 'claude'): PersistedRunHistory => {
		const item = history(id, '2026-09-05T00:00:00.000Z', provider);
		const started = Date.parse('2026-09-05T00:00:00.000Z');
		item.events = [
			{ kind: 'provider.model', payload: { provider, model: 'model-a', effort: 'low' } },
			{ kind: 'run.started', createdAt: new Date(started).toISOString() },
			{ kind: 'ship.merged', createdAt: new Date(started + elapsedMs).toISOString() },
		] as never;
		return item;
	};
	const invalid = dispatchHistory('invalid', 1);
	invalid.events = [
		{ kind: 'run.started', createdAt: 'not-a-timestamp' },
		{ kind: 'ship.merged', createdAt: '2026-09-05T00:01:00.000Z' },
	] as never;
	const histories = [dispatchHistory('one', 1), dispatchHistory('three', 3), dispatchHistory('five', 5), invalid];
	const read = (items: PersistedRunHistory[]) => readProjectHistoricalOverview(
		project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => items,
	).overview;

	expect(read(histories)).toMatchObject({ dispatchToMergeRuns: 3, medianDispatchToMergeMs: 3 });
	expect(read([dispatchHistory('two', 2), dispatchHistory('eight', 8)])).toMatchObject({
		dispatchToMergeRuns: 2, medianDispatchToMergeMs: 5,
	});

	const filtered = readProjectHistoricalOverview(
		project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [
			dispatchHistory('claude', 10), dispatchHistory('codex', 20, 'codex'),
		], { providerId: 'codex' },
	).overview;
	expect(filtered).toMatchObject({ totalRuns: 1, dispatchToMergeRuns: 1, medianDispatchToMergeMs: 20 });
});

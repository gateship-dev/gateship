import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';

import {
	readProjectOperationalOverview,
	type ProjectOperationalStatus,
} from '../../src/runtime/project-status.ts';
import { readPersistedRunHistory, readPersistedRunStatuses, RunStore } from '../../src/runtime/run-store.ts';
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

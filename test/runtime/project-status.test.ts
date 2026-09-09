import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { join } from 'node:path';

import {
	readProjectOperationalOverview,
	readProjectHistoricalOverview,
	readQueueOverview,
	createCohortRegressionProposal,
	COHORT_MINIMUM_SAMPLE,
	COHORT_DEFAULT_LIMIT,
	COHORT_MAX_LIMIT,
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

test('publicly defines and applies the minimum cohort evidence threshold', () => {
	expect(COHORT_MINIMUM_SAMPLE).toBe(5);
	const terminal = history('cohort-threshold', '2026-09-01T00:01:00.000Z');
	const read = (count: number) => readProjectHistoricalOverview(
		project, 'all', new Date('2026-09-02T00:00:00.000Z'), () => Array.from({ length: count }, (_, index) => ({
			...terminal,
			run: { ...terminal.run, id: `cohort-${index}` },
			evaluation: { ...terminal.evaluation, workflowRevision: 'revision-a' },
			events: [{ seq: 1, runId: `cohort-${index}`, kind: 'run.created', fromState: null, toState: 'queued', payload: { workflowRevision: 'revision-a' }, createdAt: terminal.run.createdAt, eventClass: 'decision' as const }],
		}))
	);
	expect(read(COHORT_MINIMUM_SAMPLE - 1)).toMatchObject({ overview: { cohorts: [{ sampleSize: 4, evidenceSufficient: false }] } });
	expect(read(COHORT_MINIMUM_SAMPLE)).toMatchObject({ overview: { cohorts: [{ sampleSize: 5, evidenceSufficient: true }] } });
});

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
			phaseDurations: {
				queued: { durationMs: 0, entries: 0 }, working: { durationMs: 0, entries: 0 }, verify: { durationMs: 0, entries: 0 }, review: { durationMs: 0, entries: 0 },
				'full-verify': { durationMs: 0, entries: 0 }, shipping: { durationMs: 0, entries: 0 }, 'waiting-provider': { durationMs: 0, entries: 0 }, 'waiting-user': { durationMs: 0, entries: 0 },
			},
			unassignedDuration: { durationMs: 1, entries: 1 },
			durationReconciliation: { classifiedMs: 0, unassignedMs: 1, totalMs: 1, toleranceMs: 1000, reconciles: true },
		},
		cost: { totalCostUsd: null, breakdown: [], roles: [] },
	};
}

function cohortHistory(
	id: string,
	input: { revision: string | null; version: 'legacy' | 'v2' | 'unknown'; outcome?: 'shipped' | 'failed' | 'cancelled' | 'incomplete'; createdAt?: string; events?: string[] },
): PersistedRunHistory {
	const item = history(id, input.createdAt ?? '2026-09-05T00:00:00.000Z');
	item.run.createdAt = input.createdAt ?? item.run.createdAt;
	item.run.updatedAt = item.run.createdAt;
	item.evaluation = {
		...item.evaluation,
		workflowRevision: input.revision,
		specProfile: { ...item.evaluation.specProfile, version: input.version },
		outcome: input.outcome ?? 'shipped',
		attentionRequests: 1,
		operatorInterventions: 2,
		providerHolds: 3,
	};
	item.events = (input.events ?? []).map((kind, seq) => ({ seq, runId: id, kind, fromState: 'working', toState: 'working', payload: { origin: kind === 'run.cycle-question' ? 'executor' : undefined, outcome: kind === 'run.chain-reconciliation' ? 'unchanged' : undefined }, createdAt: item.run.createdAt, eventClass: 'decision' as const }));
	return item;
}

test('agrupa somente runs terminais pela combinação exata de revisão e versão, preserva contagens e filtros', () => {
	const histories = [
		cohortHistory('v2-a', { revision: 'revision-a', version: 'v2', events: ['run.verification-fix-requested', 'run.cycle-question', 'run.chain-reconciliation'] }),
		cohortHistory('v2-b', { revision: 'revision-a', version: 'v2', events: ['run.review-fix-requested'] }),
		cohortHistory('legacy-a', { revision: 'revision-a', version: 'legacy' }),
		cohortHistory('v2-other-revision', { revision: 'revision-b', version: 'v2' }),
		cohortHistory('unknown-revision', { revision: null, version: 'unknown' }),
		cohortHistory('active', { revision: 'revision-a', version: 'v2', outcome: 'incomplete' }),
		cohortHistory('old', { revision: 'revision-a', version: 'v2', createdAt: '2026-08-01T00:00:00.000Z' }),
	];
	const read = (window: '7d' | 'all' = 'all') => readProjectHistoricalOverview(project, window, new Date('2026-09-07T00:00:00.000Z'), () => histories).overview;
	const overview = read();
	expect(overview?.cohorts).toHaveLength(4);
	expect(overview?.cohorts.find((cohort) => cohort.workflowRevision === 'revision-a' && cohort.specVersion === 'v2')).toMatchObject({
		sampleSize: 3,
		evidenceSufficient: false,
		outcomes: { shipped: { count: 3, denominator: 3 } },
		corrections: { verification: { count: 1, denominator: 3 }, review: { count: 1, denominator: 3 } },
		cycleQuestions: { executor: { count: 1, denominator: 3 } },
		reconciliations: { unchanged: { count: 1, denominator: 3 } },
		attentionRequests: { count: 3, denominator: 3 }, operatorInterventions: { count: 6, denominator: 3 }, providerHolds: { count: 9, denominator: 3 },
	});
	expect(overview?.cohorts.some((cohort) => cohort.workflowRevision === null && cohort.specVersion === 'unknown')).toBe(true);
	expect(read('7d')?.cohorts.find((cohort) => cohort.workflowRevision === 'revision-a' && cohort.specVersion === 'v2')?.sampleSize).toBe(2);
});

test('mantém receipt coverage aplicável e não transforma histórico anterior em causa de falha', () => {
	const receipt = { url: 'https://example.com/doc', sourceType: 'official-documentation', contentHash: 'sha256:' + 'a'.repeat(64), claim: 'claim', applicability: 'applicability' };
	const research = { questions: ['claim'], sourceClasses: ['official-documentation'], freshness: { mode: 'current', resolvedAt: '2026-09-01T00:00:00.000Z' }, receipts: [receipt] };
	const source = { ...receipt, excerpt: 'claim applicability' };
	const required = (id: string, outcome: 'shipped' | 'failed', terminal: string, sourceOverride = source): PersistedRunHistory => {
		const item = cohortHistory(id, { revision: 'revision-research', version: 'v2', outcome });
		item.events = [
			{ seq: 1, runId: id, kind: 'run.created', fromState: null, toState: 'queued', payload: { research }, createdAt: item.run.createdAt, eventClass: 'decision' },
			{ seq: 2, runId: id, kind: 'run.research-receipts', fromState: 'research', toState: 'working', payload: { bundle: { sources: [sourceOverride] } }, createdAt: item.run.createdAt, eventClass: 'decision' },
			{ seq: 3, runId: id, kind: terminal, fromState: 'working', toState: 'failed', payload: { error: 'terminal evidence' }, createdAt: item.run.updatedAt, eventClass: 'decision' },
		];
		return item;
	};
	const implementationAfterResearch = required('implementation-after-research', 'failed', 'run.failed');
	const reviewAfterResearch = required('review-after-research', 'failed', 'run.failed');
	reviewAfterResearch.events.splice(2, 0, { seq: 3, runId: reviewAfterResearch.run.id, kind: 'run.review-fix-requested', fromState: 'review', toState: 'working', payload: {}, createdAt: reviewAfterResearch.run.updatedAt, eventClass: 'decision' });
	const unknown = required('unknown-failure', 'failed', 'run.unknown-failure');
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [implementationAfterResearch, reviewAfterResearch, unknown]).overview!;
	const cohort = overview.cohorts[0]!;
	expect(cohort.research.receiptCoverage).toEqual({ count: 3, denominator: 3 });
	expect(cohort.failures.implementation).toEqual({ count: 2, denominator: 3 });
	expect(cohort.failures.unknown).toEqual({ count: 1, denominator: 3 });
	expect(cohort.failures.spec).toEqual({ count: 0, denominator: 3 });
	expect(cohort.failures.evidence).toHaveLength(3);
	expect(cohort.failures.evidence.find((entry) => entry.runId === 'implementation-after-research')).toMatchObject({ event: 'run.failed', detail: 'terminal evidence' });
	expect(cohort.research.relatedCorrection).toEqual({ count: 0, denominator: 0 });
	implementationAfterResearch.events.splice(2, 0, { seq: 4, runId: implementationAfterResearch.run.id, kind: 'run.research-failed', fromState: 'research', toState: 'working', payload: { code: 'incomplete', error: 'changed version', cause: 'other' }, createdAt: implementationAfterResearch.run.updatedAt, eventClass: 'decision' });
	const generic = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [implementationAfterResearch]).overview!.cohorts[0]!;
	expect(generic.failures.providerReference).toEqual({ count: 1, denominator: 1 });
	expect(generic.failures.implementation).toEqual({ count: 0, denominator: 1 });
	expect(generic.failures.evidence[0]).toMatchObject({ category: 'providerReference', detail: JSON.stringify({ code: 'incomplete', error: 'changed version' }) });
	expect(generic.research.obsoleteSource).toEqual({ count: 0, denominator: 1 });
	expect(generic.research.versionMismatch).toEqual({ count: 0, denominator: 1 });
	const uppercaseHash = required('uppercase-hash', 'shipped', 'run.shipped', { ...source, contentHash: source.contentHash.toUpperCase() });
	const uppercaseCohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [uppercaseHash]).overview!.cohorts[0]!;
	expect(uppercaseCohort.research.receiptCoverage).toEqual({ count: 1, denominator: 1 });
	const differentHash = required('different-hash', 'shipped', 'run.shipped', { ...source, contentHash: `sha256:${'b'.repeat(64)}` });
	const differentCohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [differentHash]).overview!.cohorts[0]!;
	expect(differentCohort.research.receiptCoverage).toEqual({ count: 0, denominator: 1 });
	const obsolete = required('obsolete', 'failed', 'run.failed');
	obsolete.events.splice(2, 0, { seq: 4, runId: obsolete.run.id, kind: 'run.research-failed', fromState: 'research', toState: 'working', payload: { cause: 'obsolete-source', error: 'unchanged wording' }, createdAt: obsolete.run.updatedAt, eventClass: 'decision' });
	const obsoleteCohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [obsolete]).overview!.cohorts[0]!;
	expect(obsoleteCohort.research.obsoleteSource).toEqual({ count: 1, denominator: 1 });
	reviewAfterResearch.events[2]!.payload = { researchEventSeq: 2 };
	const linked = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [reviewAfterResearch]).overview!.cohorts[0]!;
	expect(linked.research.relatedCorrection).toEqual({ count: 1, denominator: 1 });
});

test('preserva arquivos alterados somente com evidência registrada e limita evidência de falhas', () => {
	const runs = Array.from({ length: 21 }, (_, index) => {
		const item = cohortHistory(`failure-${index}`, { revision: 'revision-files', version: 'v2', outcome: 'failed', createdAt: `2026-09-05T00:${String(index).padStart(2, '0')}:00.000Z` });
		item.events = [{ kind: 'run.failed', createdAt: item.run.updatedAt, payload: { error: `failure-${index}` } }, ...(index === 0 ? [{ kind: 'ship.committed', createdAt: item.run.updatedAt, payload: { changedPathCount: 3 } }] : [])] as never;
		return item;
	});
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!;
	const cohort = overview.cohorts[0]!;
	expect(cohort.profile.filesAltered).toEqual({ count: 3, denominator: 1 });
	expect(cohort.failures.implementation).toEqual({ count: 21, denominator: 21 });
	expect(cohort.failures.evidence).toHaveLength(20);
	expect(cohort.failures.evidenceTotal).toBe(21);
	expect(cohort.failures.evidenceTruncated).toBe(true);
});

test('mantém denominadores de falhas independentes da ordem dos runs terminais', () => {
	const makeRuns = (): PersistedRunHistory[] => [
		cohortHistory('failure-first', { revision: 'revision-order', version: 'v2', outcome: 'failed', events: ['run.failed'] }),
		cohortHistory('shipped-second', { revision: 'revision-order', version: 'v2', outcome: 'shipped' }),
		cohortHistory('cancelled-third', { revision: 'revision-order', version: 'v2', outcome: 'cancelled' }),
	];
	const read = (runs: PersistedRunHistory[]) => readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!.cohorts[0]!;
	for (const runs of [makeRuns(), makeRuns().reverse()]) {
		const failures = read(runs).failures;
		for (const key of ['spec', 'implementation', 'verification', 'providerReference', 'unknown'] as const) expect(failures[key].denominator).toBe(3);
		expect(failures.implementation.count).toBe(1);
		expect(failures.spec.count).toBe(0);
		expect(failures.verification.count).toBe(0);
		expect(failures.providerReference.count).toBe(0);
		expect(failures.unknown.count).toBe(0);
	}
});

test('usa cohortIds distintos para revisão ausente e revisão literal unknown', () => {
	const runs = [...Array.from({ length: 5 }, (_, index) => cohortHistory(`null-${index}`, { revision: null, version: 'v2' })), ...Array.from({ length: 5 }, (_, index) => cohortHistory(`unknown-${index}`, { revision: 'unknown', version: 'v2' }))];
	for (const item of runs.slice(0, 5)) item.evaluation.wallTimeMs = 10;
	for (const item of runs.slice(5)) item.evaluation.wallTimeMs = 20;
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!;
	const baseline = overview.cohorts.find((cohort) => cohort.workflowRevision === null)!;
	const candidate = overview.cohorts.find((cohort) => cohort.workflowRevision === 'unknown')!;
	expect(baseline.cohortId).not.toBe(candidate.cohortId);
	const input = { baselineCohortId: baseline.cohortId, candidateCohortId: candidate.cohortId, metric: 'wallTimeMs.median' as const, direction: 'increase' as const, threshold: 5, hypothesis: 'timing' };
	expect(createCohortRegressionProposal(overview.cohorts, input, '2026-09-07T00:00:00.000Z')).toMatchObject({ baselineCohortId: baseline.cohortId, candidateCohortId: candidate.cohortId, observedDelta: 10 });
	expect(createCohortRegressionProposal(overview.cohorts, { ...input, threshold: 10 })).toMatchObject({ regression: true });
	expect(createCohortRegressionProposal(overview.cohorts, { ...input, threshold: 10.000_001 })).toMatchObject({ regression: false });
	const decrease = { ...input, baselineCohortId: candidate.cohortId, candidateCohortId: baseline.cohortId, direction: 'decrease' as const, threshold: 10 };
	expect(createCohortRegressionProposal(overview.cohorts, decrease)).toMatchObject({ regression: true });
	expect(createCohortRegressionProposal(overview.cohorts, { ...decrease, threshold: 10.000_001 })).toMatchObject({ regression: false });
	expect(createCohortRegressionProposal(overview.cohorts, { ...input, threshold: 0 })).toBeNull();
	const equal = overview.cohorts.map((cohort) => ({ ...cohort, timing: { ...cohort.timing, wallTimeMs: { ...cohort.timing.wallTimeMs, median: 10, p90: 10 } } }));
	expect(createCohortRegressionProposal(equal, { ...input, threshold: 1 })).toMatchObject({ observedDelta: 0, regression: false });
	const sparse = equal.map((cohort) => cohort.cohortId === baseline.cohortId ? { ...cohort, timing: { ...cohort.timing, wallTimeMs: { ...cohort.timing.wallTimeMs, known: 1 } } } : cohort);
	expect(createCohortRegressionProposal(sparse, { ...input, threshold: 1 })).toBeNull();
	const researchInput = { ...input, metric: 'research.receiptCoverage' as const };
	const researchCohorts = overview.cohorts.map((cohort) => cohort.cohortId === baseline.cohortId
		? { ...cohort, research: { ...cohort.research, receiptCoverage: { count: 1, denominator: 5 } } }
		: { ...cohort, research: { ...cohort.research, receiptCoverage: { count: 3, denominator: 5 } } });
	const researchProposal = createCohortRegressionProposal(researchCohorts, researchInput)!;
	expect(researchProposal.observedDelta).toBeCloseTo(0.4);
	expect(researchProposal.regression).toBe(false);
	const sparseFailures = researchCohorts.map((cohort) => ({ ...cohort, failures: { ...cohort.failures, unknown: { count: 0, denominator: 4 } } }));
	expect(createCohortRegressionProposal(sparseFailures, { ...researchInput, metric: 'failures.unknown' })).toBeNull();
});

test('exige cinco observações de pesquisa e ignora runs sem pesquisa', () => {
	const runs = Array.from({ length: 10 }, (_, index) => cohortHistory(`no-research-${index}`, {
		revision: index < 5 ? 'revision-research-a' : 'revision-research-b', version: 'v2',
	}));
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!;
	const baseline = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-research-a')!;
	const candidate = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-research-b')!;
	expect(baseline.research.obsoleteSource).toEqual({ count: 0, denominator: 0 });
	expect(candidate.research.versionMismatch).toEqual({ count: 0, denominator: 0 });
	expect(createCohortRegressionProposal(overview.cohorts, {
		baselineCohortId: baseline.cohortId, candidateCohortId: candidate.cohortId,
		metric: 'research.obsoleteSource', direction: 'increase', threshold: 0.1, hypothesis: 'research',
	})).toBeNull();
});

test('ordena e pagina coortes estavelmente sem descartar versões factuais', () => {
	const histories = Array.from({ length: 12 }, (_, index) => cohortHistory(`paged-${index}`, {
		revision: `revision-${String(index).padStart(2, '0')}`, version: 'v2',
		createdAt: `2026-09-${String(20 - index).padStart(2, '0')}T00:00:00.000Z`,
	}));
	histories.push(
		cohortHistory('tie-z', { revision: 'revision-z', version: 'legacy', createdAt: '2026-09-20T00:00:00.000Z' }),
		cohortHistory('tie-a', { revision: 'revision-a', version: 'unknown', createdAt: '2026-09-20T00:00:00.000Z' }),
	);
	const read = (pagination?: { cohortLimit?: number; cohortOffset?: number }) => readProjectHistoricalOverview(
		project, 'all', new Date('2026-09-21T00:00:00.000Z'), () => histories, {}, pagination,
	).overview!;
	const first = read();
	expect(first.cohorts).toHaveLength(COHORT_DEFAULT_LIMIT);
	expect(first.cohortsPage).toEqual({ limit: COHORT_DEFAULT_LIMIT, offset: 0, returned: 10, total: 14 });
	expect(first.cohorts.slice(0, 3).map((cohort) => `${cohort.workflowRevision}:${cohort.specVersion}`)).toEqual(['revision-00:v2', 'revision-a:unknown', 'revision-z:legacy']);
	expect(read({ cohortLimit: 100 }).cohorts).toHaveLength(14);
	expect(read({ cohortLimit: 100 }).cohortsPage.limit).toBe(COHORT_MAX_LIMIT);
	const middle = read({ cohortLimit: 3, cohortOffset: 3 });
	const last = read({ cohortLimit: 3, cohortOffset: 12 });
	expect(middle.cohortsPage).toEqual({ limit: 3, offset: 3, returned: 3, total: 14 });
	expect(last.cohortsPage).toEqual({ limit: 3, offset: 12, returned: 2, total: 14 });
	expect(middle.cohorts.map((cohort) => cohort.workflowRevision)).toEqual(first.cohorts.slice(3, 6).map((cohort) => cohort.workflowRevision));
	expect(last.cohorts.map((cohort) => cohort.workflowRevision)).toEqual(['revision-10', 'revision-11']);
	expect(read({ cohortLimit: 1, cohortOffset: 1 }).cohorts[0]).toMatchObject({ specVersion: 'unknown' });
	expect(read({ cohortLimit: 1, cohortOffset: 2 }).cohorts[0]).toMatchObject({ specVersion: 'legacy' });
});

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

test('mede correção pelo intervalo durável da solicitação, não pela fase inteira', () => {
	const item = cohortHistory('correction-interval', { revision: 'revision-correction', version: 'v2' });
	item.evaluation.corrections.review = 1;
	item.evaluation.phaseDurations.review.durationMs = 100_000;
	item.events = [
		{ seq: 1, kind: 'run.review-fix-requested', createdAt: '2026-09-05T00:00:01.000Z', fromState: 'review', toState: 'working', payload: {} },
		{ seq: 2, kind: 'run.work-completed', createdAt: '2026-09-05T00:00:03.000Z', fromState: 'working', toState: 'verify', payload: {} },
		{ seq: 3, kind: 'run.review-started', createdAt: '2026-09-05T00:00:04.000Z', fromState: 'verify', toState: 'review', payload: {} },
	] as never;
	const cohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [item]).overview!.cohorts[0]!;
	expect(cohort.timing.corrections.review).toMatchObject({ median: 3_000, known: 1, denominator: 1 });
});

test('mede cada solicitação de correção como observação independente', () => {
	const item = cohortHistory('correction-multiple', { revision: 'revision-correction-multiple', version: 'v2' });
	item.events = [
		{ seq: 1, kind: 'run.review-fix-requested', createdAt: '2026-09-05T00:00:01.000Z', fromState: 'review', toState: 'working', payload: {} },
		{ seq: 2, kind: 'run.review-started', createdAt: '2026-09-05T00:00:03.000Z', fromState: 'working', toState: 'review', payload: {} },
		{ seq: 3, kind: 'run.review-fix-requested', createdAt: '2026-09-05T00:00:04.000Z', fromState: 'review', toState: 'working', payload: {} },
		{ seq: 4, kind: 'run.review-started', createdAt: '2026-09-05T00:00:08.000Z', fromState: 'working', toState: 'review', payload: {} },
	] as never;
	const cohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [item]).overview!.cohorts[0]!;
	expect(cohort.timing.corrections.review).toMatchObject({ known: 2, denominator: 2, median: 3_000 });

	const incomplete = cohortHistory('correction-incomplete', { revision: 'revision-correction-incomplete', version: 'v2' });
	incomplete.events = [{ seq: 1, kind: 'run.review-fix-requested', createdAt: '2026-09-05T00:00:01.000Z', fromState: 'review', toState: 'working', payload: {} }] as never;
	const incompleteCohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => [incomplete]).overview!.cohorts[0]!;
	expect(incompleteCohort.timing.corrections.review).toMatchObject({ known: 0, denominator: 1, median: null });
});

test('conta somente causas estruturadas de pesquisa sem receipts', () => {
	const makeFailure = (id: string, cause?: string): PersistedRunHistory => {
		const item = cohortHistory(id, { revision: 'revision-research-causes', version: 'v2', outcome: 'failed' });
		item.events = [{ kind: 'run.research-failed', createdAt: item.run.updatedAt, payload: cause === undefined ? {} : { cause } }] as never;
		return item;
	};
	const runs = [makeFailure('other', 'other'), makeFailure('obsolete', 'obsolete-source'), makeFailure('mismatch', 'version-mismatch'), makeFailure('legacy')];
	const cohort = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!.cohorts[0]!;
	expect(cohort.research.obsoleteSource).toEqual({ count: 1, denominator: 3 });
	expect(cohort.research.versionMismatch).toEqual({ count: 1, denominator: 2 });
});

test('trata version-mismatch como observação negativa de fonte obsoleta', () => {
	const makeMismatch = (id: string, revision: string): PersistedRunHistory => {
		const item = cohortHistory(id, { revision, version: 'v2', outcome: 'failed' });
		item.events = [{ kind: 'run.research-failed', createdAt: item.run.updatedAt, payload: { cause: 'version-mismatch' } }] as never;
		return item;
	};
	const runs = Array.from({ length: 10 }, (_, index) => makeMismatch(`version-mismatch-${index}`, index < 5 ? 'revision-mismatch-a' : 'revision-mismatch-b'));
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!;
	const baseline = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-mismatch-a')!;
	const candidate = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-mismatch-b')!;
	expect(baseline.research.obsoleteSource).toEqual({ count: 0, denominator: 5 });
	expect(baseline.research.versionMismatch).toEqual({ count: 5, denominator: 5 });
	expect(createCohortRegressionProposal(overview.cohorts, { baselineCohortId: baseline.cohortId, candidateCohortId: candidate.cohortId, metric: 'research.obsoleteSource', direction: 'increase', threshold: 0.1, hypothesis: 'research' })).not.toBeNull();
});

test('mantém version-mismatch desconhecido para causas obsolete-source', () => {
	const makeObsolete = (id: string, revision: string): PersistedRunHistory => {
		const item = cohortHistory(id, { revision, version: 'v2', outcome: 'failed' });
		item.events = [{ kind: 'run.research-failed', createdAt: item.run.updatedAt, payload: { cause: 'obsolete-source' } }] as never;
		return item;
	};
	const runs = Array.from({ length: 10 }, (_, index) => makeObsolete(`obsolete-${index}`, index < 5 ? 'revision-obsolete-a' : 'revision-obsolete-b'));
	const overview = readProjectHistoricalOverview(project, 'all', new Date('2026-09-07T00:00:00.000Z'), () => runs).overview!;
	const baseline = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-obsolete-a')!;
	const candidate = overview.cohorts.find((cohort) => cohort.workflowRevision === 'revision-obsolete-b')!;
	expect(baseline.research.obsoleteSource).toEqual({ count: 5, denominator: 5 });
	expect(baseline.research.versionMismatch).toEqual({ count: 0, denominator: 0 });
	expect(createCohortRegressionProposal(overview.cohorts, { baselineCohortId: baseline.cohortId, candidateCohortId: candidate.cohortId, metric: 'research.versionMismatch', direction: 'increase', threshold: 0.1, hypothesis: 'research' })).toBeNull();
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

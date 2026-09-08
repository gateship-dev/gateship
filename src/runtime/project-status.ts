import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';

import { readBacklogFromMain } from '../issues/backlog.ts';
import { type BacklogJsonView, deriveBacklogJson } from '../issues/list.ts';
import { isPlannable } from '../issues/plannable.ts';
import type { IssueEntry } from '../issues/types.ts';
import type { RegisteredProject } from './project-registry.ts';
import type { ChainPauseView, RunRuntime } from './run-runtime.ts';
import {
	type PersistedRunHistory,
	type PersistedRunStatus,
	readPersistedRunHistory,
	readPersistedRunOverview,
	readPersistedRunStatuses,
} from './run-store.ts';
import { isTerminalRunState } from './run-state.ts';
import { RUNTIME_SOURCE_REF } from './source-ref.ts';
import { selectRunRoundOrigins } from './round-origin.ts';

export const PROJECT_STATUS_RUN_LIMIT = 20;

export interface QueueIssue {
	id: string;
	title: string;
}

export interface ProjectQueueView {
	project: RegisteredProject;
	readiness: RegisteredProject['readiness'];
	chainEnabled: boolean;
	pause: { reason: string; createdAt: string } | null;
	currentRun: PersistedRunStatus | null;
	currentIssue: QueueIssue | null;
	plannedIssues: QueueIssue[];
	nextIssue: QueueIssue | null;
	lastDelivery: { state: 'available'; run: PersistedRunStatus | null } | { state: 'unavailable' };
}

export interface QueueOverviewError {
	projectId: string;
	projectName: string;
	code: 'project-unavailable';
	message: 'Project queue is unavailable.';
}

export interface QueueOverview {
	queues: ProjectQueueView[];
	errors: QueueOverviewError[];
}

const CHAIN_PAUSE_REASONS = new Set([
	'chain-disabled', 'previous-run-not-done', 'no-admissible-issue', 'run-active', 'chain-start-failed',
]);

function queueIssue(issue: IssueEntry | undefined): QueueIssue | null {
	return issue === undefined ? null : { id: issue.id, title: issue.title };
}

function pauseOf(event: ChainPauseView | null): ProjectQueueView['pause'] {
	if (event === null) return null;
	const reason = event.reason;
	if (typeof reason !== 'string' || !CHAIN_PAUSE_REASONS.has(reason)) return null;
	return { reason, createdAt: event.createdAt };
}

export type QueueRuntime = Pick<RunRuntime, 'listRuns' | 'getChainRuns' | 'getChainPause'>;

function queueRuntimeState(
	project: RegisteredProject,
	queueContexts: ReadonlyMap<string, QueueRuntime>,
	readHistory: typeof readPersistedRunHistory,
): {
	currentRun: ProjectQueueView['currentRun'];
	chainEnabled: boolean;
	lastPause: ChainPauseView | null;
	lastDelivery: ProjectQueueView['lastDelivery'];
} {
	const context = queueContexts.get(project.id);
	if (context === undefined) throw new Error('Project runtime context is unavailable.');
	let lastDelivery: ProjectQueueView['lastDelivery'];
	try {
		lastDelivery = { state: 'available', run: readHistory(join(project.stateDir, 'runtime.sqlite'))
			.findLast((history) => history.evaluation.outcome === 'shipped')?.run ?? null };
	} catch {
		lastDelivery = { state: 'unavailable' };
	}
	return {
		currentRun: context.listRuns().find((run) => !isTerminalRunState(run.state)) ?? null,
		chainEnabled: context.getChainRuns(),
		lastPause: context.getChainPause(),
		lastDelivery,
	};
}

/** Global, read-only queue projection. Each project is isolated so one bad checkout does not hide the others. */
export function readQueueOverview(
	projects: readonly RegisteredProject[],
	readBacklog: (project: RegisteredProject) => IssueEntry[] = (project) =>
		readBacklogFromMain(project.root, undefined, RUNTIME_SOURCE_REF),
	queueContexts: ReadonlyMap<string, QueueRuntime>,
	readHistory: typeof readPersistedRunHistory = readPersistedRunHistory,
): QueueOverview {
	const queues: ProjectQueueView[] = [];
	const errors: QueueOverviewError[] = [];
	for (const project of projects) {
		try {
			const backlog = readBacklog(project);
			const plannedIssues = backlog.filter((issue) => isPlannable(issue, backlog)).map((issue) => ({ id: issue.id, title: issue.title }));
			const { currentRun, chainEnabled, lastPause, lastDelivery } = queueRuntimeState(project, queueContexts, readHistory);
			const currentIssue = queueIssue(currentRun === null ? undefined : backlog.find((issue) => issue.id === currentRun.issueId));
			queues.push({
				project,
				readiness: project.readiness,
				chainEnabled,
				pause: pauseOf(lastPause),
				currentRun,
				currentIssue,
				plannedIssues,
			// The runtime serializes admission per project. While a run is active,
			// no backlog entry is admissible, even though approved candidates remain visible.
				nextIssue: currentRun === null ? plannedIssues[0] ?? null : null,
				lastDelivery,
			});
		} catch {
			errors.push({ projectId: project.id, projectName: project.name, code: 'project-unavailable', message: 'Project queue is unavailable.' });
		}
	}
	return { queues, errors };
}

export type OverviewWindow = '7d' | '30d' | 'all';

export interface HistoricalOverview {
	window: OverviewWindow;
	totalRuns: number;
	runsWithKnownCost: number;
	knownCostUsd: number | null;
	runsByOutcome: Record<'shipped' | 'failed' | 'cancelled' | 'incomplete', number>;
	activeRuns: number;
	terminalRuns: number;
	terminalWallTimeMs: number | null;
	terminalWallTimeRuns: number;
	shippedWithoutIntervention: number;
	dispatchToMergeMs: number | null;
	dispatchToMergeRuns: number;
	medianDispatchToMergeMs: number | null;
	firstReviewPasses: number;
	firstReviewPassKnownRuns: number;
	ciCorrections: number;
	fixRounds: number;
	attentionRequests: number;
	operatorInterventions: number;
	providerHolds: number;
	resolvedCycleQuestions: number;
	reportedTokens: {
	inputTokens: number | null;
	outputTokens: number | null;
	cacheCreationInputTokens: number | null;
	cacheReadInputTokens: number | null;
	thinkingTokens: number | null;
	};
	configurations: Array<{ provider: string; role: string; model?: string; effort?: string }>;
	cohorts: HistoricalCohort[];
	daily: Array<{
		date: string;
		totalRuns: number;
		runsByOutcome: HistoricalOverview['runsByOutcome'];
		runsWithKnownCost: number;
		knownCostUsd: number | null;
		terminalRuns: number;
		shippedWithoutIntervention: number;
		ciCorrections: number;
		inputTokens: number | null;
		outputTokens: number | null;
	}>;
}

export interface CohortMetric { count: number; denominator: number }
export interface HistoricalCohort {
	workflowRevision: string | null;
	specVersion: 'legacy' | 'v2' | 'unknown';
	sampleSize: number;
	evidenceSufficient: boolean;
	outcomes: Record<'shipped' | 'failed' | 'cancelled', CohortMetric>;
	corrections: Record<'verification' | 'review' | 'fullVerify' | 'ci', CohortMetric>;
	cycleQuestions: Record<'executor' | 'review' | 'fullVerify', CohortMetric>;
	reconciliations: Record<'unchanged' | 'adapted' | 'contract-change-required', CohortMetric>;
	attentionRequests: CohortMetric;
	operatorInterventions: CohortMetric;
	providerHolds: CohortMetric;
}

export interface HistoricalOverviewRead {
	overview: HistoricalOverview | null;
	reason?: string;
}

export interface HistoricalOverviewFilters {
	projectId?: string;
	providerId?: 'claude' | 'codex';
	model?: string;
	role?: 'orchestrator' | 'executor' | 'reviewer';
	effort?: string;
}

const OVERVIEW_WINDOWS: Readonly<Record<OverviewWindow, number | null>> = { '7d': 7, '30d': 30, all: null };

const dispatchToMergeSamples = new WeakMap<HistoricalOverview, number[]>();

function addNullable(total: number | null, value: number | undefined): number | null {
	return value === undefined ? total : (total ?? 0) + value;
}

function emptyOutcomes(): HistoricalOverview['runsByOutcome'] {
	return { shipped: 0, failed: 0, cancelled: 0, incomplete: 0 };
}

function emptyHistoricalOverview(window: OverviewWindow): HistoricalOverview {
	return {
		window, totalRuns: 0, runsWithKnownCost: 0, knownCostUsd: null,
		runsByOutcome: emptyOutcomes(), activeRuns: 0, terminalRuns: 0, terminalWallTimeMs: null, terminalWallTimeRuns: 0,
		shippedWithoutIntervention: 0, dispatchToMergeMs: null, dispatchToMergeRuns: 0, medianDispatchToMergeMs: null,
		firstReviewPasses: 0, firstReviewPassKnownRuns: 0, ciCorrections: 0,
		fixRounds: 0, attentionRequests: 0, operatorInterventions: 0, providerHolds: 0,
		resolvedCycleQuestions: 0,
		reportedTokens: { inputTokens: null, outputTokens: null, cacheCreationInputTokens: null,
			cacheReadInputTokens: null, thinkingTokens: null },
		configurations: [], daily: [],
		cohorts: [],
	};
}

export const COHORT_MINIMUM_SAMPLE = 5;

function cohortMetric(count: number, denominator: number): CohortMetric {
	return { count, denominator };
}

function emptyCohort(workflowRevision: string | null, specVersion: HistoricalCohort['specVersion']): HistoricalCohort {
	const metric = (): CohortMetric => cohortMetric(0, 0);
	return {
		workflowRevision, specVersion, sampleSize: 0, evidenceSufficient: false,
		outcomes: { shipped: metric(), failed: metric(), cancelled: metric() },
		corrections: { verification: metric(), review: metric(), fullVerify: metric(), ci: metric() },
		cycleQuestions: { executor: metric(), review: metric(), fullVerify: metric() },
		reconciliations: { unchanged: metric(), adapted: metric(), 'contract-change-required': metric() },
		attentionRequests: metric(), operatorInterventions: metric(), providerHolds: metric(),
	};
}

function cohortMetricFromEvents(item: PersistedRunHistory, kind: string, origin?: string): number {
	return item.events.filter((event) => event.kind === kind && (origin === undefined || event.payload['origin'] === origin)).length;
}

function updateCohortOutcomes(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	for (const outcome of Object.keys(cohort.outcomes) as Array<keyof typeof cohort.outcomes>) {
		cohort.outcomes[outcome] = cohortMetric(cohort.outcomes[outcome].count + (item.evaluation.outcome === outcome ? 1 : 0), denominator);
	}
}

function updateCohortCorrections(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	for (const source of Object.keys(cohort.corrections) as Array<keyof typeof cohort.corrections>) {
		const eventKind = `run.${source === 'fullVerify' ? 'full-verify' : source}-fix-requested`;
		cohort.corrections[source] = cohortMetric(cohort.corrections[source].count + (cohortMetricFromEvents(item, eventKind) > 0 ? 1 : 0), denominator);
	}
}

function updateCohortQuestions(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	for (const source of Object.keys(cohort.cycleQuestions) as Array<keyof typeof cohort.cycleQuestions>) {
		const origin = source === 'fullVerify' ? 'full-verify' : source;
		cohort.cycleQuestions[source] = cohortMetric(cohort.cycleQuestions[source].count + cohortMetricFromEvents(item, 'run.cycle-question', origin), denominator);
	}
}

function updateCohortReconciliations(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	for (const outcome of Object.keys(cohort.reconciliations) as Array<keyof typeof cohort.reconciliations>) {
		const eventOutcome = outcome === 'adapted' ? 'clarified' : outcome === 'contract-change-required' ? 'material' : outcome;
		const count = item.events.filter((event) => event.kind === 'run.chain-reconciliation' && event.payload['outcome'] === eventOutcome).length;
		cohort.reconciliations[outcome] = cohortMetric(cohort.reconciliations[outcome].count + count, denominator);
	}
}

function updateCohortScalars(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	cohort.attentionRequests = cohortMetric(cohort.attentionRequests.count + item.evaluation.attentionRequests, denominator);
	cohort.operatorInterventions = cohortMetric(cohort.operatorInterventions.count + item.evaluation.operatorInterventions, denominator);
	cohort.providerHolds = cohortMetric(cohort.providerHolds.count + item.evaluation.providerHolds, denominator);
}

function finalizeCohortEvidence(cohort: HistoricalCohort): HistoricalCohort {
	return { ...cohort, evidenceSufficient: cohort.sampleSize >= COHORT_MINIMUM_SAMPLE };
}

function historicalCohorts(items: readonly PersistedRunHistory[]): HistoricalCohort[] {
	const groups = new Map<string, HistoricalCohort>();
	for (const item of items) {
		if (item.evaluation.outcome === 'incomplete') continue;
		const revision = item.evaluation.workflowRevision;
		const specVersion = item.evaluation.specProfile.version;
		const key = `${revision ?? ''}\0${specVersion}`;
		const cohort = groups.get(key) ?? emptyCohort(revision, specVersion);
		groups.set(key, cohort);
		cohort.sampleSize += 1;
		const denominator = cohort.sampleSize;
		updateCohortOutcomes(cohort, item, denominator);
		updateCohortCorrections(cohort, item, denominator);
		updateCohortQuestions(cohort, item, denominator);
		updateCohortReconciliations(cohort, item, denominator);
		updateCohortScalars(cohort, item, denominator);
	}
	return [...groups.values()].map(finalizeCohortEvidence);
}

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const ordered = [...values].sort((a, b) => a - b);
	const middle = Math.floor(ordered.length / 2);
	return ordered.length % 2 === 1
		? ordered[middle] ?? null
		: ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

// The branches below preserve unknown coverage instead of coercing it to zero.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: historical replay keeps each independently observable derivation explicit
function addRunMetrics(result: HistoricalOverview, item: PersistedRunHistory): void {
	const evaluation = item.evaluation;
	result.totalRuns += 1;
	result.runsByOutcome[evaluation.outcome] += 1;
	result.activeRuns += evaluation.outcome === 'incomplete' ? 1 : 0;
	result.terminalRuns += evaluation.outcome === 'incomplete' ? 0 : 1;
	if (evaluation.outcome !== 'incomplete' && evaluation.wallTimeMs !== null) {
		result.terminalWallTimeRuns += 1;
		result.terminalWallTimeMs = (result.terminalWallTimeMs ?? 0) + evaluation.wallTimeMs;
	}
	if (evaluation.outcome === 'shipped' && evaluation.operatorInterventions === 0) result.shippedWithoutIntervention += 1;
	result.ciCorrections += selectRunRoundOrigins(item.events).ci ?? 0;
	const dispatch = item.events.find((event) => event.kind === 'run.started');
	const merge = item.events.findLast((event) => event.kind === 'ship.merged');
	if (dispatch !== undefined && merge !== undefined) {
		const elapsed = Date.parse(merge.createdAt) - Date.parse(dispatch.createdAt);
		if (Number.isFinite(elapsed) && elapsed >= 0) {
			result.dispatchToMergeRuns += 1;
			result.dispatchToMergeMs = (result.dispatchToMergeMs ?? 0) + elapsed;
			dispatchToMergeSamples.get(result)?.push(elapsed);
		}
	}
	const firstReview = item.events.find((event) => event.kind === 'run.review-clean' || event.kind === 'run.review-fix-requested');
	if (firstReview !== undefined) {
		result.firstReviewPassKnownRuns += 1;
		if (firstReview.kind === 'run.review-clean') result.firstReviewPasses += 1;
	}
	result.fixRounds += item.run.fixRounds;
	result.attentionRequests += evaluation.attentionRequests;
	result.operatorInterventions += evaluation.operatorInterventions;
	result.providerHolds += evaluation.providerHolds;
	result.resolvedCycleQuestions += evaluation.resolvedCycleQuestions ?? 0;
	if (item.cost.totalCostUsd !== null) {
		result.runsWithKnownCost += 1;
		result.knownCostUsd = (result.knownCostUsd ?? 0) + item.cost.totalCostUsd;
	}
}

function modelProviderMap(item: PersistedRunHistory): Map<number, string> {
	const modelProviders = new Map<number, string>();
	for (const event of item.events) {
		if (event.kind === 'provider.model' || event.kind === 'review.model') {
			modelProviders.set(
				event.seq,
				event.payload['provider'] === 'claude' || event.payload['provider'] === 'codex'
					? event.payload['provider'] : item.run.providerId,
			);
		}
	}
	return modelProviders;
}

function remapModelProvider(
	providers: Map<number, string>,
	item: PersistedRunHistory,
	transition: PersistedRunHistory['events'][number],
): void {
	const role = transition.kind === 'run.executor-handoff' ? 'executor'
		: transition.kind === 'run.review-fallback' ? 'reviewer' : null;
	if (role === null) return;
	const modelKind = role === 'executor' ? 'provider.model' : 'review.model';
	const candidates = item.events.filter((event) => event.seq < transition.seq
		&& event.kind === modelKind && providers.get(event.seq) === item.run.providerId);
	const targetModel = transition.payload['model'];
	const targetEffort = transition.payload['effort'];
	const candidate = typeof targetModel === 'string'
		? candidates.findLast((event) => event.payload['model'] === targetModel
			&& (typeof targetEffort !== 'string' || event.payload['effort'] === targetEffort))
		: candidates.at(-1);
	const targetProvider = transition.payload['to'];
	if (candidate !== undefined && (targetProvider === 'claude' || targetProvider === 'codex')) {
		providers.set(candidate.seq, targetProvider);
	}
}

function addModelConfiguration(
	configurations: Set<string>,
	providers: Map<number, string>,
	item: PersistedRunHistory,
	event: PersistedRunHistory['events'][number],
): void {
	const role = event.kind === 'provider.model' ? 'executor'
		: event.kind === 'review.model' ? 'reviewer'
			: event.kind === 'run.cycle-response' ? 'orchestrator' : null;
	if (role === null) return;
	configurations.add(JSON.stringify({
		provider: providers.get(event.seq) ?? item.run.providerId, role,
		...(typeof event.payload['model'] === 'string' ? { model: event.payload['model'] } : {}),
		...(typeof event.payload['effort'] === 'string' ? { effort: event.payload['effort'] } : {}),
	}));
}

function runModelConfigurations(item: PersistedRunHistory): HistoricalOverview['configurations'] {
	const providers = modelProviderMap(item);
	const configurations = new Set<string>();
	for (const event of item.events) remapModelProvider(providers, item, event);
	for (const event of item.events) addModelConfiguration(configurations, providers, item, event);
	return [...configurations].map((value) => JSON.parse(value) as HistoricalOverview['configurations'][number]);
}

function addRunConfigurations(configurations: Set<string>, item: PersistedRunHistory): void {
	for (const configuration of runModelConfigurations(item)) configurations.add(JSON.stringify(configuration));
}

function addReportedTokens(result: HistoricalOverview, item: PersistedRunHistory): void {
	const fields = ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens'] as const;
	for (const field of fields) {
		const entries = item.cost.breakdown.filter((entry) => entry[field] !== undefined);
		if (entries.length > 0) result.reportedTokens[field] = addNullable(
			result.reportedTokens[field], entries.reduce((sum, entry) => sum + (entry[field] ?? 0), 0),
		);
	}
	const thinkingEntries = item.cost.roles.filter((entry) => entry.thinkingTokens !== undefined);
	if (thinkingEntries.length > 0) result.reportedTokens.thinkingTokens = addNullable(
		result.reportedTokens.thinkingTokens,
		thinkingEntries.reduce((sum, entry) => sum + (entry.thinkingTokens ?? 0), 0),
	);
}

function addDailyRun(daily: Map<string, HistoricalOverview['daily'][number]>, item: PersistedRunHistory): void {
	const date = runDate(item.run.createdAt);
	if (date === null) return;
	const day = daily.get(date) ?? { date, totalRuns: 0, runsByOutcome: emptyOutcomes(), runsWithKnownCost: 0, knownCostUsd: null, terminalRuns: 0, shippedWithoutIntervention: 0, ciCorrections: 0, inputTokens: null, outputTokens: null };
	day.totalRuns += 1;
	day.runsByOutcome[evaluationOutcome(item)] += 1;
	if (item.evaluation.outcome !== 'incomplete') day.terminalRuns += 1;
	if (item.evaluation.outcome === 'shipped' && item.evaluation.operatorInterventions === 0) day.shippedWithoutIntervention += 1;
	day.ciCorrections += selectRunRoundOrigins(item.events).ci ?? 0;
	if (item.cost.totalCostUsd !== null) {
		day.runsWithKnownCost += 1;
		day.knownCostUsd = (day.knownCostUsd ?? 0) + item.cost.totalCostUsd;
	}
	for (const field of ['inputTokens', 'outputTokens'] as const) {
		const entries = item.cost.breakdown.filter((entry) => entry[field] !== undefined);
		if (entries.length > 0) day[field] = addNullable(day[field], entries.reduce((sum, entry) => sum + (entry[field] ?? 0), 0));
	}
	daily.set(date, day);
}

function evaluationOutcome(item: PersistedRunHistory): keyof HistoricalOverview['runsByOutcome'] {
	return item.evaluation.outcome;
}

function historicalOverview(
	history: readonly PersistedRunHistory[],
	window: OverviewWindow,
	now: Date,
	filters: HistoricalOverviewFilters = {},
): HistoricalOverview {
	const days = OVERVIEW_WINDOWS[window];
	const cutoff = days === null ? -Infinity : now.getTime() - days * 24 * 60 * 60 * 1000;
	const selected = history.filter((item) => {
		const { run } = item;
		const timestamp = Date.parse(run.createdAt);
		if (!Number.isFinite(timestamp) || timestamp < cutoff) return false;
		const hasRoleProvenanceFilter = filters.model !== undefined || filters.role !== undefined || filters.effort !== undefined;
		if (!hasRoleProvenanceFilter) {
			if (filters.providerId === undefined) return true;
			const configurations = runModelConfigurations(item);
			return configurations.length > 0
				? configurations.some((configuration) => configuration.provider === filters.providerId)
				: run.providerId === filters.providerId;
		}
		return runModelConfigurations(item).some((configuration) =>
			(filters.providerId === undefined || configuration.provider === filters.providerId)
			&& (filters.role === undefined || configuration.role === filters.role)
			&& (filters.model === undefined || configuration.model === filters.model)
			&& (filters.effort === undefined || configuration.effort === filters.effort));
	});
	const result = emptyHistoricalOverview(window);
	dispatchToMergeSamples.set(result, []);
	const configurations = new Set<string>();
	const daily = new Map<string, HistoricalOverview['daily'][number]>();
	for (const item of selected) {
		addRunMetrics(result, item);
		addRunConfigurations(configurations, item);
		addReportedTokens(result, item);
		addDailyRun(daily, item);
	}
	result.medianDispatchToMergeMs = median(dispatchToMergeSamples.get(result) ?? []);
	result.configurations = [...configurations].map((value) => JSON.parse(value) as HistoricalOverview['configurations'][number]);
	result.configurations.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
	result.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
	result.cohorts = historicalCohorts(selected);
	return result;
}

function runDate(value: string): string | null {
	const time = Date.parse(value);
	return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

export function readProjectHistoricalOverview(
	project: RegisteredProject,
	window: OverviewWindow = '7d',
	now = new Date(),
	readHistory: typeof readPersistedRunHistory = readPersistedRunHistory,
	filters: HistoricalOverviewFilters = {},
): HistoricalOverviewRead {
	try {
		return { overview: historicalOverview(readHistory(join(project.stateDir, 'runtime.sqlite')), window, now, filters) };
	} catch (error) {
		return { overview: null, reason: error instanceof Error ? error.message : String(error) };
	}
}

type Availability = { state: 'available' } | { state: 'unavailable'; reason: string };

export interface ProjectOperationalStatus {
	project: RegisteredProject;
	root: Availability;
	backlog: ({ state: 'available' } & BacklogJsonView) | { state: 'unavailable'; reason: string };
	database:
		| { state: 'available'; path: string; runs: PersistedRunStatus[] }
		| { state: 'unavailable'; path: string; reason: string };
}

export interface ProjectOperationalOverview {
	window: OverviewWindow;
	overview: HistoricalOverview;
	summary: {
		totalProjects: number;
		readyProjects: number;
		unavailableProjects: number;
		nonTerminalRuns: number;
		backlog: BacklogJsonView['counts'];
	};
	projects: Array<ProjectOperationalStatus & {
		overview: HistoricalOverviewRead;
		activeRun: PersistedRunStatus | null;
		latestRun: PersistedRunStatus | null;
			latestRunOutcome: 'shipped' | 'failed' | 'cancelled' | 'incomplete' | null;
		recentRuns: PersistedRunStatus[];
	}>;
}

function unavailableReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function rootAvailability(root: string): Availability {
	try {
		if (!statSync(root).isDirectory()) {
			return { state: 'unavailable', reason: 'Project root is not a directory.' };
		}
		accessSync(root, constants.R_OK | constants.X_OK);
		return { state: 'available' };
	} catch (error) {
		return { state: 'unavailable', reason: unavailableReason(error) };
	}
}

export function readProjectOperationalStatus(project: RegisteredProject): ProjectOperationalStatus {
	const root = rootAvailability(project.root);
	let backlog: ProjectOperationalStatus['backlog'];
	if (root.state === 'unavailable') {
		backlog = { state: 'unavailable', reason: 'Project root is unavailable.' };
	} else {
		try {
			backlog = {
				state: 'available',
				...deriveBacklogJson(readBacklogFromMain(project.root, undefined, RUNTIME_SOURCE_REF)),
			};
		} catch (error) {
			backlog = { state: 'unavailable', reason: unavailableReason(error) };
		}
	}

	const databasePath = join(project.stateDir, 'runtime.sqlite');
	let database: ProjectOperationalStatus['database'];
	try {
		const stat = statSync(databasePath);
		if (!stat.isFile()) throw new Error('Runtime database is not a file.');
		database = {
			state: 'available',
			path: databasePath,
			runs: readPersistedRunStatuses(databasePath, PROJECT_STATUS_RUN_LIMIT),
		};
	} catch (error) {
		database = { state: 'unavailable', path: databasePath, reason: unavailableReason(error) };
	}

	return { project, root, backlog, database };
}

export function readProjectOperationalOverview(
	projects: readonly RegisteredProject[],
	readStatus: (project: RegisteredProject) => ProjectOperationalStatus = readProjectOperationalStatus,
	readRunOverview: typeof readPersistedRunOverview = readPersistedRunOverview,
	window: OverviewWindow = '7d',
	now = new Date(),
	filters: HistoricalOverviewFilters = {},
): ProjectOperationalOverview {
	const statuses = projects.map(readStatus);
	const overviewProjects: Array<ProjectOperationalStatus & {
		overview: HistoricalOverviewRead;
		activeRun: PersistedRunStatus | null;
		latestRun: PersistedRunStatus | null;
		latestRunOutcome: 'shipped' | 'failed' | 'cancelled' | 'incomplete' | null;
		recentRuns: PersistedRunStatus[];
		nonTerminalRuns: number;
	}> = statuses.map((status) => {
		if (status.database.state !== 'available') {
			return {
				...status,
				overview: { overview: null, reason: status.database.reason },
				activeRun: null,
				latestRun: null,
				latestRunOutcome: null,
				recentRuns: [],
				nonTerminalRuns: 0,
			};
		}
		let runOverview: ReturnType<typeof readPersistedRunOverview>;
		try {
			runOverview = readRunOverview(status.database.path);
		} catch (error) {
			return {
				...status,
				database: {
					state: 'unavailable' as const,
					path: status.database.path,
					reason: unavailableReason(error),
				},
				overview: { overview: null, reason: unavailableReason(error) },
				activeRun: null,
				latestRun: status.database.runs[0] ?? null,
				latestRunOutcome: null,
				recentRuns: status.database.runs,
				nonTerminalRuns: 0,
			};
		}
		try {
			const latestDeliveredHistory = readPersistedRunHistory(status.database.path)
				.findLast((history) => history.evaluation.outcome === 'shipped');
			return {
				...status,
				overview: readProjectHistoricalOverview(status.project, window, now, readPersistedRunHistory, filters),
				activeRun: runOverview.activeRun,
				latestRun: latestDeliveredHistory?.run ?? null,
				latestRunOutcome: latestDeliveredHistory === undefined ? null : 'shipped',
				recentRuns: status.database.runs,
				nonTerminalRuns: runOverview.nonTerminalRuns,
			};
		} catch (error) {
			return {
				...status,
				overview: { overview: null, reason: unavailableReason(error) },
				activeRun: runOverview.activeRun,
				latestRun: status.database.runs[0] ?? null,
				latestRunOutcome: null,
				recentRuns: status.database.runs,
				nonTerminalRuns: runOverview.nonTerminalRuns,
			};
		}
	});
	const availableHistory = overviewProjects
		.map((project) => project.overview.overview)
		.filter((overview): overview is HistoricalOverview => overview !== null);
	// Re-aggregate from the same read-only histories to preserve project-level
	// coverage while keeping the product view free of unavailable databases.
	const productOverview = combineHistoricalOverviews(availableHistory, window);
	const backlog = { idea: 0, specified: 0, planned: 0 };
	let readyProjects = 0;
	let nonTerminalRuns = 0;

	for (const status of overviewProjects) {
		const available = status.root.state === 'available'
			&& status.backlog.state === 'available'
			&& status.database.state === 'available';
		if (available) readyProjects += 1;
		if (status.database.state === 'available') {
			nonTerminalRuns += status.nonTerminalRuns;
		}
		if (status.backlog.state === 'available') {
			backlog.idea += status.backlog.counts.idea;
			backlog.specified += status.backlog.counts.specified;
			backlog.planned += status.backlog.counts.planned;
		}
	}

	return {
		window,
		overview: productOverview,
		summary: {
			totalProjects: statuses.length,
			readyProjects,
			unavailableProjects: statuses.length - readyProjects,
			nonTerminalRuns,
			backlog,
		},
		projects: overviewProjects.map(({ nonTerminalRuns: _nonTerminalRuns, ...project }) => project),
	};
}

function mergeHistoricalTotals(combined: HistoricalOverview, item: HistoricalOverview): void {
	combined.totalRuns += item.totalRuns;
	combined.runsWithKnownCost += item.runsWithKnownCost;
	if (item.knownCostUsd !== null) combined.knownCostUsd = (combined.knownCostUsd ?? 0) + item.knownCostUsd;
	for (const outcome of Object.keys(combined.runsByOutcome) as Array<keyof HistoricalOverview['runsByOutcome']>) {
		combined.runsByOutcome[outcome] += item.runsByOutcome[outcome];
	}
	for (const field of ['activeRuns', 'terminalRuns', 'terminalWallTimeRuns', 'shippedWithoutIntervention', 'dispatchToMergeRuns', 'firstReviewPasses', 'firstReviewPassKnownRuns', 'ciCorrections', 'fixRounds', 'attentionRequests',
		'operatorInterventions', 'providerHolds', 'resolvedCycleQuestions'] as const) {
		combined[field] += item[field];
	}
	if (item.terminalWallTimeMs !== null) combined.terminalWallTimeMs = (combined.terminalWallTimeMs ?? 0) + item.terminalWallTimeMs;
	if (item.dispatchToMergeMs !== null) combined.dispatchToMergeMs = (combined.dispatchToMergeMs ?? 0) + item.dispatchToMergeMs;
	dispatchToMergeSamples.get(combined)?.push(...(dispatchToMergeSamples.get(item) ?? []));
	for (const key of Object.keys(combined.reportedTokens) as Array<keyof HistoricalOverview['reportedTokens']>) {
		combined.reportedTokens[key] = addNullable(combined.reportedTokens[key], item.reportedTokens[key] ?? undefined);
	}
}

function mergeHistoricalDay(
	daily: Map<string, HistoricalOverview['daily'][number]>,
	itemDay: HistoricalOverview['daily'][number],
): void {
	const day = daily.get(itemDay.date) ?? { ...itemDay, totalRuns: 0, runsByOutcome: emptyOutcomes(), runsWithKnownCost: 0, knownCostUsd: null, terminalRuns: 0, shippedWithoutIntervention: 0, ciCorrections: 0, inputTokens: null, outputTokens: null };
	day.totalRuns += itemDay.totalRuns;
	for (const outcome of Object.keys(day.runsByOutcome) as Array<keyof HistoricalOverview['runsByOutcome']>) day.runsByOutcome[outcome] += itemDay.runsByOutcome[outcome];
	day.runsWithKnownCost += itemDay.runsWithKnownCost;
	day.terminalRuns += itemDay.terminalRuns;
	day.shippedWithoutIntervention += itemDay.shippedWithoutIntervention;
	day.ciCorrections += itemDay.ciCorrections;
	if (itemDay.knownCostUsd !== null) day.knownCostUsd = (day.knownCostUsd ?? 0) + itemDay.knownCostUsd;
	day.inputTokens = addNullable(day.inputTokens, itemDay.inputTokens ?? undefined);
	day.outputTokens = addNullable(day.outputTokens, itemDay.outputTokens ?? undefined);
	daily.set(day.date, day);
}

function addHistoricalOverview(
	combined: HistoricalOverview,
	item: HistoricalOverview,
	configurations: Set<string>,
	daily: Map<string, HistoricalOverview['daily'][number]>,
): void {
	mergeHistoricalTotals(combined, item);
	for (const entry of item.configurations) configurations.add(JSON.stringify(entry));
	for (const itemDay of item.daily) mergeHistoricalDay(daily, itemDay);
}

function combineHistoricalOverviews(overviews: readonly HistoricalOverview[], window: OverviewWindow): HistoricalOverview {
	const combined = emptyHistoricalOverview(window);
	dispatchToMergeSamples.set(combined, []);
	const configurations = new Set<string>();
	const daily = new Map<string, HistoricalOverview['daily'][number]>();
	for (const item of overviews) addHistoricalOverview(combined, item, configurations, daily);
	combined.medianDispatchToMergeMs = median(dispatchToMergeSamples.get(combined) ?? []);
	combined.configurations = [...configurations].map((value) => JSON.parse(value) as HistoricalOverview['configurations'][number]);
	const cohortGroups = new Map<string, HistoricalCohort>();
	for (const item of overviews.flatMap((overview) => overview.cohorts)) {
		const key = `${item.workflowRevision ?? ''}\0${item.specVersion}`;
		const existing = cohortGroups.get(key);
		if (existing === undefined) { cohortGroups.set(key, structuredClone(item)); continue; }
		const denominator = existing.sampleSize + item.sampleSize;
		existing.sampleSize = denominator;
		existing.evidenceSufficient = denominator >= COHORT_MINIMUM_SAMPLE;
		const mergeMetrics = <T extends Record<string, CohortMetric>>(target: T, source: T): void => {
			for (const key of Object.keys(target)) {
				const targetMetric = target[key];
				const sourceMetric = source[key];
				Object.assign(target, { [key]: cohortMetric((targetMetric?.count ?? 0) + (sourceMetric?.count ?? 0), denominator) });
			}
		};
		mergeMetrics(existing.outcomes, item.outcomes);
		mergeMetrics(existing.corrections, item.corrections);
		mergeMetrics(existing.cycleQuestions, item.cycleQuestions);
		mergeMetrics(existing.reconciliations, item.reconciliations);
		for (const field of ['attentionRequests', 'operatorInterventions', 'providerHolds'] as const) existing[field] = cohortMetric(existing[field].count + item[field].count, denominator);
	}
	combined.cohorts = [...cohortGroups.values()];
	combined.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
	return combined;
}

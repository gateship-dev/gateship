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
import { RUN_DURATION_PHASES, type RunDurationPhase } from './run-evaluation.ts';

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
	cohortsPage: { limit: number; offset: number; returned: number; total: number };
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
export interface CohortDistribution { median: number | null; p90: number | null; known: number; denominator: number }
export interface CohortTiming {
	wallTimeMs: CohortDistribution;
	phases: Record<RunDurationPhase, CohortDistribution>;
	waits: { provider: CohortDistribution; user: CohortDistribution };
	corrections: Record<'verification' | 'review' | 'fullVerify' | 'ci', CohortDistribution>;
}
export interface CohortResearchFacts {
	requiredRuns: CohortMetric;
	receiptCoverage: CohortMetric;
	obsoleteSource: CohortMetric;
	versionMismatch: CohortMetric;
	relatedCorrection: CohortMetric;
}
export interface CohortFailureFacts {
	spec: CohortMetric;
	implementation: CohortMetric;
	verification: CohortMetric;
	providerReference: CohortMetric;
	unknown: CohortMetric;
	evidence: Array<{ runId: string; category: FailureCategory; event: string; detail: string | null; createdAt: string }>;
	evidenceTotal: number;
	evidenceTruncated: boolean;
}
type FailureCategory = 'spec' | 'implementation' | 'verification' | 'providerReference' | 'unknown';
export interface HistoricalCohort {
	cohortId: string;
	workflowRevision: string | null;
	specVersion: 'legacy' | 'v2' | 'unknown';
	latestTerminalRunAt: string | null;
	sampleSize: number;
	evidenceSufficient: boolean;
	outcomes: Record<'shipped' | 'failed' | 'cancelled', CohortMetric>;
	corrections: Record<'verification' | 'review' | 'fullVerify' | 'ci', CohortMetric>;
	cycleQuestions: Record<'executor' | 'review' | 'fullVerify', CohortMetric>;
	reconciliations: Record<'unchanged' | 'adapted' | 'contract-change-required', CohortMetric>;
	attentionRequests: CohortMetric;
	operatorInterventions: CohortMetric;
	providerHolds: CohortMetric;
	timing: CohortTiming;
	research: CohortResearchFacts;
	failures: CohortFailureFacts;
	profile: { commands: CohortMetric; corrections: CohortMetric; filesAltered: CohortMetric; researchRequired: CohortMetric };
}

export type CohortRegressionMetric =
	| 'wallTimeMs.median'
	| 'wallTimeMs.p90'
	| 'research.receiptCoverage'
	| 'research.obsoleteSource'
	| 'research.versionMismatch'
	| 'research.relatedCorrection'
	| 'failures.spec'
	| 'failures.implementation'
	| 'failures.verification'
	| 'failures.providerReference'
	| 'failures.unknown';
export interface CohortRegressionProposal {
	schemaVersion: 1;
	baselineCohortId: string;
	candidateCohortId: string;
	metric: CohortRegressionMetric;
	direction: 'increase' | 'decrease';
	threshold: number;
	observedDelta: number;
	hypothesis: string;
	createdAt: string;
	regression: boolean;
}
export interface CohortRegressionProposalInput {
	baselineCohortId: string;
	candidateCohortId: string;
	metric: CohortRegressionMetric;
	direction: 'increase' | 'decrease';
	threshold: number;
	hypothesis: string;
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
	cohortSortBy?: CohortSort;
	cohortSortDirection?: SortDirection;
}

export type CohortSort = 'latestTerminalRunAt' | 'sampleSize' | 'workflowRevision' | 'specVersion';
export type SortDirection = 'asc' | 'desc';

export interface HistoricalOverviewPagination {
	cohortLimit?: number;
	cohortOffset?: number;
	cohortSortBy?: CohortSort;
	cohortSortDirection?: SortDirection;
}

export const COHORT_DEFAULT_LIMIT = 10;
export const COHORT_MAX_LIMIT = 100;

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
		cohortsPage: { limit: COHORT_DEFAULT_LIMIT, offset: 0, returned: 0, total: 0 },
	};
}

export const COHORT_MINIMUM_SAMPLE = 5;

function cohortMetric(count: number, denominator: number): CohortMetric {
	return { count, denominator };
}

function emptyCohort(workflowRevision: string | null, specVersion: HistoricalCohort['specVersion']): HistoricalCohort {
	const metric = (): CohortMetric => cohortMetric(0, 0);
	const distribution = (): CohortDistribution => ({ median: null, p90: null, known: 0, denominator: 0 });
	return {
		cohortId: `workflow:${JSON.stringify(workflowRevision)}:spec:${JSON.stringify(specVersion)}`,
		workflowRevision, specVersion, latestTerminalRunAt: null, sampleSize: 0, evidenceSufficient: false,
		outcomes: { shipped: metric(), failed: metric(), cancelled: metric() },
		corrections: { verification: metric(), review: metric(), fullVerify: metric(), ci: metric() },
		cycleQuestions: { executor: metric(), review: metric(), fullVerify: metric() },
		reconciliations: { unchanged: metric(), adapted: metric(), 'contract-change-required': metric() },
		attentionRequests: metric(), operatorInterventions: metric(), providerHolds: metric(),
		timing: {
			wallTimeMs: distribution(),
			phases: Object.fromEntries(RUN_DURATION_PHASES.map((phase) => [phase, distribution()])) as Record<RunDurationPhase, CohortDistribution>,
			waits: { provider: distribution(), user: distribution() },
			corrections: { verification: distribution(), review: distribution(), fullVerify: distribution(), ci: distribution() },
		},
		research: { requiredRuns: metric(), receiptCoverage: metric(), obsoleteSource: metric(), versionMismatch: metric(), relatedCorrection: metric() },
		failures: { spec: metric(), implementation: metric(), verification: metric(), providerReference: metric(), unknown: metric(), evidence: [], evidenceTotal: 0, evidenceTruncated: false },
		profile: { commands: metric(), corrections: metric(), filesAltered: metric(), researchRequired: metric() },
	};
}

/** Builds reviewable evidence only when the operator names both compatible cohorts. */
export function createCohortRegressionProposal(
	cohorts: readonly HistoricalCohort[],
	input: CohortRegressionProposalInput,
	createdAt = new Date().toISOString(),
): CohortRegressionProposal | null {
	if (input.baselineCohortId.trim().length === 0 || input.candidateCohortId.trim().length === 0
		|| input.baselineCohortId === input.candidateCohortId || !Number.isFinite(input.threshold) || input.threshold <= 0
		|| input.hypothesis.trim().length === 0 || !isCohortRegressionMetric(input.metric)
		|| (input.direction !== 'increase' && input.direction !== 'decrease')) return null;
	const baseline = cohorts.find((cohort) => cohort.cohortId === input.baselineCohortId);
	const candidate = cohorts.find((cohort) => cohort.cohortId === input.candidateCohortId);
	if (baseline === undefined || candidate === undefined || !baseline.evidenceSufficient || !candidate.evidenceSufficient
		|| baseline.specVersion !== candidate.specVersion) return null;
	const baselineMetric = cohortRegressionMetricValue(baseline, input.metric);
	const candidateMetric = cohortRegressionMetricValue(candidate, input.metric);
	const baselineValue = baselineMetric.value;
	const candidateValue = candidateMetric.value;
	const baselineKnown = baselineMetric.known;
	const candidateKnown = candidateMetric.known;
	if (baselineValue === null || candidateValue === null || baselineKnown < COHORT_MINIMUM_SAMPLE || candidateKnown < COHORT_MINIMUM_SAMPLE) return null;
	const observedDelta = candidateValue - baselineValue;
	const regression = input.direction === 'increase' ? observedDelta >= input.threshold : observedDelta <= -input.threshold;
	return {
		schemaVersion: 1,
		baselineCohortId: baseline.cohortId,
		candidateCohortId: candidate.cohortId,
		metric: input.metric,
		direction: input.direction,
		threshold: input.threshold,
		observedDelta,
		hypothesis: input.hypothesis.trim(),
		createdAt,
		regression,
	};
}

function isCohortRegressionMetric(metric: string): metric is CohortRegressionMetric {
	return [
		'wallTimeMs.median', 'wallTimeMs.p90', 'research.receiptCoverage', 'research.obsoleteSource',
		'research.versionMismatch', 'research.relatedCorrection', 'failures.spec', 'failures.implementation',
		'failures.verification', 'failures.providerReference', 'failures.unknown',
	].includes(metric);
}

function cohortRegressionMetricValue(cohort: HistoricalCohort, metric: CohortRegressionMetric): { value: number | null; known: number } {
	if (metric === 'wallTimeMs.median' || metric === 'wallTimeMs.p90') {
		const distribution = cohort.timing.wallTimeMs;
		return { value: distribution[metric === 'wallTimeMs.median' ? 'median' : 'p90'], known: distribution.known };
	}
	const [section, key] = metric.split('.') as ['research' | 'failures', string];
	const factual = cohort[section][key as keyof typeof cohort[typeof section]] as CohortMetric;
	return { value: factual.denominator > 0 ? factual.count / factual.denominator : null, known: factual.denominator };
}

export function readCohortRegressionProposal(
	project: RegisteredProject,
	input: CohortRegressionProposalInput,
	createdAt = new Date().toISOString(),
): CohortRegressionProposal | null {
	const overview = readProjectHistoricalOverview(project, 'all', new Date(createdAt), readPersistedRunHistory, undefined, null).overview;
	return overview === null ? null : createCohortRegressionProposal(overview.cohorts, input, createdAt);
}

function percentile(values: readonly number[], fraction: number): number | null {
	if (values.length === 0) return null;
	const ordered = [...values].sort((a, b) => a - b);
	return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)] ?? null;
}

function distribution(values: readonly number[], denominator: number): CohortDistribution {
	return { median: median(values), p90: percentile(values, 0.9), known: values.length, denominator };
}

function researchFacts(item: PersistedRunHistory): { required: boolean; covered: boolean; obsolete: boolean; obsoleteObserved: boolean; mismatch: boolean; mismatchObserved: boolean; relatedCorrection: boolean; relatedCorrectionObserved: boolean } {
	const created = item.events.find((event) => event.kind === 'run.created');
	const contract = created?.payload['research'];
	const required = contract !== null && typeof contract === 'object' && !Array.isArray(contract);
	const receiptEvent = item.events.findLast((event) => event.kind === 'run.research-receipts');
	const failed = item.events.findLast((event) => event.kind === 'run.research-failed');
	const bundle = receiptEvent?.payload['bundle'];
	const sources = bundle !== null && typeof bundle === 'object' && !Array.isArray(bundle) && Array.isArray((bundle as Record<string, unknown>)['sources'])
		? (bundle as Record<string, unknown>)['sources'] as unknown[] : [];
	const receipts = required && Array.isArray((contract as Record<string, unknown>)['receipts']) ? (contract as Record<string, unknown>)['receipts'] as unknown[] : [];
	const sourceMatchesReceipt = (source: unknown, receipt: unknown): boolean => {
		if (source === null || typeof source !== 'object' || receipt === null || typeof receipt !== 'object') return false;
		const left = source as Record<string, unknown>;
		const right = receipt as Record<string, unknown>;
		const leftRef = left['resolvedRef'];
		const rightRef = right['resolvedRef'];
		const leftHash = left['contentHash'];
		const rightHash = right['contentHash'];
		const sameHash = typeof leftHash === 'string' && typeof rightHash === 'string' && leftHash.toLowerCase() === rightHash.toLowerCase();
		return left['url'] === right['url'] && left['sourceType'] === right['sourceType']
			&& sameHash && left['claim'] === right['claim']
			&& left['applicability'] === right['applicability'] && left['installedVersion'] === right['installedVersion']
			&& left['targetVersion'] === right['targetVersion']
			&& (leftRef === rightRef || (leftRef !== null && typeof leftRef === 'object' && rightRef !== null && typeof rightRef === 'object'
				&& (leftRef as Record<string, unknown>)['kind'] === (rightRef as Record<string, unknown>)['kind']
				&& (leftRef as Record<string, unknown>)['value'] === (rightRef as Record<string, unknown>)['value']));
	};
	const covered = required && receiptEvent !== undefined && receipts.length > 0 && receipts.every((receipt) => sources.some((source) => sourceMatchesReceipt(source, receipt)));
	const structuredResearchObserved = required && receiptEvent !== undefined && Array.isArray(sources) && Array.isArray(receipts);
	const obsolete = failed?.payload['cause'] === 'obsolete-source';
	const mismatch = failed?.payload['cause'] === 'version-mismatch';
	const structuredFailureObserved = failed?.payload['cause'] === 'obsolete-source' || failed?.payload['cause'] === 'version-mismatch' || failed?.payload['cause'] === 'other';
	const obsoleteObserved = structuredResearchObserved || obsolete || mismatch || (structuredFailureObserved && failed?.payload['cause'] === 'other');
	const receiptSeq = receiptEvent?.seq;
	const receiptUrls = new Set(receipts.flatMap((receipt) => receipt !== null && typeof receipt === 'object' && typeof (receipt as Record<string, unknown>)['url'] === 'string' ? [(receipt as Record<string, unknown>)['url'] as string] : []));
	const correctionKinds = new Set(['run.verification-fix-requested', 'run.review-fix-requested', 'run.full-verify-fix-requested', 'run.ci-fix-requested']);
	const linkedCorrection = item.events.some((event) => {
		if (!correctionKinds.has(event.kind)) return false;
		const payload = event.payload;
		if (payload === null || typeof payload !== 'object') return false;
		return (receiptSeq !== undefined && payload['researchEventSeq'] === receiptSeq)
			|| (typeof payload['researchReceiptUrl'] === 'string' && receiptUrls.has(payload['researchReceiptUrl']));
	});
	const relatedCorrectionObserved = required && item.events.some((event) => {
		if (!correctionKinds.has(event.kind) || event.payload === null || typeof event.payload !== 'object') return false;
		return 'researchEventSeq' in event.payload || 'researchReceiptUrl' in event.payload;
	});
	return { required, covered, obsolete, obsoleteObserved, mismatch, mismatchObserved: structuredResearchObserved || mismatch || (structuredFailureObserved && failed?.payload['cause'] === 'other'), relatedCorrection: linkedCorrection, relatedCorrectionObserved };
}

type FailureClassification = { category: FailureCategory; terminalKind: string };
function failureClass(item: PersistedRunHistory): FailureClassification | null {
	if (item.evaluation.outcome !== 'failed') return null;
	const researchFailure = item.events.findLast((event) => event.kind === 'run.research-failed');
	if (researchFailure !== undefined) return { category: 'providerReference', terminalKind: researchFailure.kind };
	const terminal = item.events.findLast((event) => event.toState === 'failed' || event.kind === 'run.failed');
	if (terminal?.kind === 'run.evidence-diverged') return { category: 'spec', terminalKind: terminal.kind };
	if (terminal?.kind === 'run.verification-failed' || terminal?.kind === 'run.full-verify-failed') return { category: 'verification', terminalKind: terminal.kind };
	if (terminal?.kind === 'run.provider-failed' || terminal?.kind === 'run.provider-retry-unavailable') return { category: 'providerReference', terminalKind: terminal.kind };
	if (terminal?.kind === 'run.failed' || terminal?.kind === 'run.ship-failed') return { category: 'implementation', terminalKind: terminal.kind };
	return { category: 'unknown', terminalKind: terminal?.kind ?? 'unknown' };
}

function updateCohortTiming(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	const runs = (cohort as HistoricalCohort & { _timingValues?: Record<string, number[]> })._timingValues ?? {};
	const add = (key: string, value: number | null): void => { if (value !== null) (runs[key] ??= []).push(value); };
	add('wallTimeMs', item.evaluation.wallTimeMs);
	for (const phase of RUN_DURATION_PHASES) add(`phase:${phase}`, item.evaluation.phaseDurations[phase].durationMs);
	add('wait:provider', item.evaluation.phaseDurations['waiting-provider'].durationMs);
	add('wait:user', item.evaluation.phaseDurations['waiting-user'].durationMs);
	const correctionEndState: Record<keyof typeof cohort.timing.corrections, string> = { verification: 'verify', review: 'review', fullVerify: 'full-verify', ci: 'ready-to-ship' };
	for (const source of Object.keys(cohort.timing.corrections) as Array<keyof typeof cohort.timing.corrections>) {
		const requestKind = `run.${source === 'fullVerify' ? 'full-verify' : source}-fix-requested`;
		const requestCount = item.events.filter((event) => event.kind === requestKind).length;
		const durations = item.events.flatMap((event) => {
			if (event.kind !== requestKind) return [];
			const start = Date.parse(event.createdAt);
			const end = item.events.find((candidate) => candidate.seq > event.seq && candidate.toState === correctionEndState[source]);
			const finish = end === undefined ? Number.NaN : Date.parse(end.createdAt);
			return Number.isFinite(start) && Number.isFinite(finish) && finish >= start ? [finish - start] : [];
		});
		for (const duration of durations) add(`correction:${source}`, duration);
		const correctionDenominator = cohort.timing.corrections[source].denominator + requestCount;
		cohort.timing.corrections[source] = distribution(runs[`correction:${source}`] ?? [], correctionDenominator);
	}
	(cohort as HistoricalCohort & { _timingValues: Record<string, number[]> })._timingValues = runs;
	cohort.timing.wallTimeMs = distribution(runs.wallTimeMs ?? [], denominator);
	for (const phase of RUN_DURATION_PHASES) cohort.timing.phases[phase] = distribution(runs[`phase:${phase}`] ?? [], denominator);
	cohort.timing.waits.provider = distribution(runs['wait:provider'] ?? [], denominator);
	cohort.timing.waits.user = distribution(runs['wait:user'] ?? [], denominator);
}

function updateCohortResearch(cohort: HistoricalCohort, research: ReturnType<typeof researchFacts>): void {
	cohort.research.receiptCoverage = cohortMetric(cohort.research.receiptCoverage.count + Number(research.covered), cohort.research.requiredRuns.count);
	if (research.obsoleteObserved) cohort.research.obsoleteSource = cohortMetric(cohort.research.obsoleteSource.count + Number(research.obsolete), cohort.research.obsoleteSource.denominator + 1);
	if (research.mismatchObserved) cohort.research.versionMismatch = cohortMetric(cohort.research.versionMismatch.count + Number(research.mismatch), cohort.research.versionMismatch.denominator + 1);
	if (research.relatedCorrectionObserved) cohort.research.relatedCorrection = cohortMetric(cohort.research.relatedCorrection.count + Number(research.relatedCorrection), cohort.research.relatedCorrection.denominator + 1);
}

function updateCohortFiles(cohort: HistoricalCohort, item: PersistedRunHistory): void {
	const committed = item.events.findLast((event) => event.kind === 'ship.committed');
	const changedPathCount = committed?.payload['changedPathCount'];
	if (typeof changedPathCount === 'number' && Number.isSafeInteger(changedPathCount) && changedPathCount >= 0) {
		cohort.profile.filesAltered = cohortMetric(cohort.profile.filesAltered.count + changedPathCount, cohort.profile.filesAltered.denominator + 1);
	}
}

function updateCohortFailures(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	const failure = failureClass(item);
	for (const key of ['spec', 'implementation', 'verification', 'providerReference', 'unknown'] as const) {
		cohort.failures[key] = cohortMetric(cohort.failures[key].count + Number(failure?.category === key), denominator);
	}
	if (failure === null) return;
	const terminal = item.events.findLast((event) => event.kind === failure.terminalKind);
	const detail = terminal?.kind === 'run.research-failed' && terminal.payload !== null && typeof terminal.payload === 'object'
		? JSON.stringify({ code: terminal.payload['code'] ?? null, error: terminal.payload['error'] ?? null })
		: typeof terminal?.payload['error'] === 'string' ? terminal.payload['error'] : null;
	cohort.failures.evidenceTotal += 1;
	cohort.failures.evidence.push({ runId: item.run.id, category: failure.category, event: terminal?.kind ?? failure.terminalKind, detail, createdAt: terminal?.createdAt ?? item.run.updatedAt });
	cohort.failures.evidence.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId));
	cohort.failures.evidence = cohort.failures.evidence.slice(0, 20);
	cohort.failures.evidenceTruncated = cohort.failures.evidenceTotal > cohort.failures.evidence.length;
}

function updateCohortFacts(cohort: HistoricalCohort, item: PersistedRunHistory, denominator: number): void {
	const research = researchFacts(item);
	cohort.profile.commands = cohortMetric(cohort.profile.commands.count + (item.evaluation.specProfile.counts.verify ?? 0), denominator);
	cohort.profile.corrections = cohortMetric(cohort.profile.corrections.count + item.evaluation.corrections.total, denominator);
	cohort.profile.researchRequired = cohortMetric(cohort.profile.researchRequired.count + Number(research.required), denominator);
	cohort.research.requiredRuns = cohortMetric(cohort.research.requiredRuns.count + Number(research.required), denominator);
	updateCohortResearch(cohort, research);
	updateCohortFiles(cohort, item);
	updateCohortFailures(cohort, item, denominator);
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
		if (cohort.latestTerminalRunAt === null || item.run.createdAt > cohort.latestTerminalRunAt) cohort.latestTerminalRunAt = item.run.createdAt;
		const denominator = cohort.sampleSize;
		updateCohortOutcomes(cohort, item, denominator);
		updateCohortCorrections(cohort, item, denominator);
		updateCohortQuestions(cohort, item, denominator);
		updateCohortReconciliations(cohort, item, denominator);
		updateCohortScalars(cohort, item, denominator);
		updateCohortTiming(cohort, item, denominator);
		updateCohortFacts(cohort, item, denominator);
	}
	return [...groups.values()].map((cohort) => { delete (cohort as HistoricalCohort & { _timingValues?: unknown })._timingValues; return finalizeCohortEvidence(cohort); }).sort((a, b) =>
		(b.latestTerminalRunAt ?? '').localeCompare(a.latestTerminalRunAt ?? '')
		|| `${a.workflowRevision ?? ''}\0${a.specVersion}`.localeCompare(`${b.workflowRevision ?? ''}\0${b.specVersion}`));
}

function cohortPagination(pagination: HistoricalOverviewPagination = {}): { limit: number; offset: number } {
	const limit = Number.isSafeInteger(pagination.cohortLimit) && (pagination.cohortLimit ?? 0) > 0
		? Math.min(pagination.cohortLimit!, COHORT_MAX_LIMIT) : COHORT_DEFAULT_LIMIT;
	const offset = Number.isSafeInteger(pagination.cohortOffset) && (pagination.cohortOffset ?? 0) >= 0
		? pagination.cohortOffset! : 0;
	return { limit, offset };
}

function sortHistoricalCohorts(cohorts: HistoricalCohort[], sortBy: CohortSort = 'latestTerminalRunAt', direction: SortDirection = 'desc'): HistoricalCohort[] {
	const value = (cohort: HistoricalCohort): string | number | null => sortBy === 'sampleSize' ? cohort.sampleSize : sortBy === 'workflowRevision' ? cohort.workflowRevision : sortBy === 'specVersion' ? cohort.specVersion : cohort.latestTerminalRunAt;
	const compare = (left: string | number | null, right: string | number | null): number => {
		if (left === null && right === null) return 0;
		if (left === null) return 1;
		if (right === null) return -1;
		const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
		return direction === 'asc' ? result : -result;
	};
	return cohorts.sort((left, right) => compare(value(left), value(right)) || left.cohortId.localeCompare(right.cohortId));
}

function paginateHistoricalOverview(overview: HistoricalOverview, pagination: HistoricalOverviewPagination | null = {}, sortBy?: CohortSort, sortDirection?: SortDirection): HistoricalOverview {
	const sorted = sortHistoricalCohorts([...overview.cohorts], sortBy, sortDirection);
	if (pagination === null) return { ...overview, cohorts: sorted, cohortsPage: { limit: sorted.length, offset: 0, returned: sorted.length, total: sorted.length } };
	const { limit, offset } = cohortPagination(pagination);
	const total = sorted.length;
	return { ...overview, cohorts: sorted.slice(offset, offset + limit), cohortsPage: { limit, offset, returned: Math.min(limit, Math.max(0, total - offset)), total } };
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
	pagination: HistoricalOverviewPagination | null = {},
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
	return paginateHistoricalOverview(result, pagination, filters.cohortSortBy, filters.cohortSortDirection);
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
	pagination: HistoricalOverviewPagination | null = {},
): HistoricalOverviewRead {
	try {
		return { overview: historicalOverview(readHistory(join(project.stateDir, 'runtime.sqlite')), window, now, filters, pagination) };
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
	pagination: HistoricalOverviewPagination = {},
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
				overview: readProjectHistoricalOverview(status.project, window, now, readPersistedRunHistory, filters, null),
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
	const productOverview = paginateHistoricalOverview(combineHistoricalOverviews(availableHistory, window), pagination, pagination.cohortSortBy, pagination.cohortSortDirection);
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
		projects: overviewProjects.map(({ nonTerminalRuns: _nonTerminalRuns, ...project }) => ({
			...project,
			overview: project.overview.overview === null
				? project.overview
				: { ...project.overview, overview: paginateHistoricalOverview(project.overview.overview, pagination, pagination.cohortSortBy, pagination.cohortSortDirection) },
		})),
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
		if ((item.latestTerminalRunAt ?? '') > (existing.latestTerminalRunAt ?? '')) existing.latestTerminalRunAt = item.latestTerminalRunAt;
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
	combined.cohorts = [...cohortGroups.values()].sort((a, b) =>
		(b.latestTerminalRunAt ?? '').localeCompare(a.latestTerminalRunAt ?? '')
		|| `${a.workflowRevision ?? ''}\0${a.specVersion}`.localeCompare(`${b.workflowRevision ?? ''}\0${b.specVersion}`));
	combined.daily = [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
	return combined;
}

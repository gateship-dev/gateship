import { join } from 'node:path';

import { readBacklogFromMain } from '../issues/backlog.ts';
import type { RegisteredProject } from './project-registry.ts';
import { type PullRequestDelivery, selectPullRequestDelivery } from './pull-request-delivery.ts';
import { isRunState, type RunState } from './run-state.ts';
import {
	type PersistedRunHistory,
	readPersistedRunHistory,
} from './run-store.ts';
import { RUNTIME_SOURCE_REF } from './source-ref.ts';

export const RUN_OVERVIEW_DEFAULT_LIMIT = 20;
export const RUN_OVERVIEW_MAX_LIMIT = 100;
export const RUN_OVERVIEW_MAX_OFFSET = 10_000;

export type RunOverviewPeriod = '7d' | '30d' | 'all';
export type RunOverviewSort = 'updatedAt' | 'createdAt' | 'projectName' | 'issueId' | 'state' | 'providerId' | 'duration' | 'cost';
export type SortDirection = 'asc' | 'desc';

export interface RunOverviewFilters {
	limit?: number;
	offset?: number;
	projectId?: string;
	state?: RunState;
	group?: RunOverviewGroup;
	providerId?: 'claude' | 'codex';
	period?: RunOverviewPeriod;
	search?: string;
	sortBy?: RunOverviewSort;
	sortDirection?: SortDirection;
}

/**
 * The operator's quick views over the state machine: what is moving, what
 * waits on them, what shipped, what failed. The mapping is the one the
 * shell's attention signal uses, so a row the sidebar counts as "needs you"
 * is a row this filter returns.
 */
export type RunOverviewGroup = 'active' | 'needs-you' | 'shipped' | 'failed';
export const RUN_OVERVIEW_GROUPS: readonly RunOverviewGroup[] = ['active', 'needs-you', 'shipped', 'failed'];
const GROUP_STATES: Readonly<Record<RunOverviewGroup, readonly RunState[]>> = {
	active: ['queued', 'working', 'verify', 'review', 'full-verify', 'shipping'],
	'needs-you': ['ready-to-ship', 'waiting-user', 'waiting-provider', 'failed', 'interrupted'],
	shipped: ['done'],
	failed: ['failed'],
};

export interface RunOverviewRow {
	projectId: string;
	projectName: string;
	repository?: string;
	runId: string;
	issueId: string;
	/** What the issue is called on the source ref. Null when the backlog cannot be read or no longer holds the issue. */
	issueTitle: string | null;
	state: RunState;
	createdAt: string;
	updatedAt: string;
	providerId: 'claude' | 'codex';
	/** The run's recorded failure, so a failed row can say why without opening it. */
	error: string | null;
	/**
	 * Wall time minus the time the run sat waiting on the operator: how long
	 * the run itself took, which is what a duration column compares. Null
	 * when the wall time is unknown.
	 */
	activeDurationMs: number | null;
	evaluation: PersistedRunHistory['evaluation'];
	cost: PersistedRunHistory['cost'];
	roles: PersistedRunHistory['evaluation']['roles'];
	coverage: {
		verified: boolean;
		reviewed: boolean;
		fullVerification: boolean;
	};
	pullRequest: PullRequestDelivery | null;
	ci: { status: NonNullable<RunOverviewRow['pullRequest']>['ciStatus'] } | null;
	merge: { status: 'merged' } | null;
}

export interface RunOverviewError {
	projectId: string;
	projectName: string;
	code: 'project-unavailable';
	message: 'Project runs are unavailable.';
}

export interface RunOverviewPage {
	runs: RunOverviewRow[];
	page: { limit: number; offset: number; returned: number; total: number };
	errors: RunOverviewError[];
}

export interface RunOverviewReadOptions {
	readHistory?: typeof readPersistedRunHistory;
	/** Issue id to title, per project. Read only for the projects on the returned page. */
	readTitles?: (project: RegisteredProject) => ReadonlyMap<string, string>;
	now?: () => number;
}

function readIssueTitles(project: RegisteredProject): ReadonlyMap<string, string> {
	return new Map(readBacklogFromMain(project.root, undefined, RUNTIME_SOURCE_REF).map((issue) => [issue.id, issue.title]));
}

function parseRunOverviewPageNumber(params: URLSearchParams, name: 'limit' | 'offset'): number | undefined {
	const value = params.get(name);
	if (value === null) return undefined;
	const parsed = Number(value);
	const valid = Number.isSafeInteger(parsed) && (name === 'limit' ? parsed > 0 : parsed >= 0);
	if (!valid) throw new Error(`${name} must be a safe integer ${name === 'limit' ? 'greater than 0' : 'greater than or equal to 0'}.`);
	return parsed;
}

function validateRunOverviewParams(params: URLSearchParams): void {
	const state = params.get('state');
	const group = params.get('group');
	const providerId = params.get('providerId');
	const period = params.get('period');
	const sortBy = params.get('sortBy');
	const sortDirection = params.get('sortDirection');
	if (state !== null && !isRunState(state)) throw new Error('state must be a valid run state.');
	if (group !== null && !RUN_OVERVIEW_GROUPS.includes(group as RunOverviewGroup)) throw new Error('group must be active, needs-you, shipped or failed.');
	if (providerId !== null && providerId !== 'claude' && providerId !== 'codex') throw new Error('providerId must be claude or codex.');
	if (period !== null && period !== '7d' && period !== '30d' && period !== 'all') throw new Error('period must be 7d, 30d or all.');
	const sortFields: readonly RunOverviewSort[] = ['updatedAt', 'createdAt', 'projectName', 'issueId', 'state', 'providerId', 'duration', 'cost'];
	if (sortBy !== null && !sortFields.includes(sortBy as RunOverviewSort)) throw new Error('sortBy must be a valid run field.');
	if (sortDirection !== null && sortDirection !== 'asc' && sortDirection !== 'desc') throw new Error('sortDirection must be asc or desc.');
}

function boundedPage(filters: RunOverviewFilters): { limit: number; offset: number } {
	const limit = Number.isSafeInteger(filters.limit) && (filters.limit ?? 0) > 0
		? Math.min(filters.limit!, RUN_OVERVIEW_MAX_LIMIT) : RUN_OVERVIEW_DEFAULT_LIMIT;
	const offset = Number.isSafeInteger(filters.offset) && (filters.offset ?? 0) >= 0
		? Math.min(filters.offset!, RUN_OVERVIEW_MAX_OFFSET) : 0;
	return { limit, offset };
}

function compareNullable(left: string | number | null, right: string | number | null, direction: SortDirection): number {
	if (left === null && right === null) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
	return direction === 'asc' ? result : -result;
}

function compareRuns(left: RunOverviewRow, right: RunOverviewRow, sortBy: RunOverviewSort, direction: SortDirection): number {
	const value = (row: RunOverviewRow): string | number | null => {
		switch (sortBy) {
			case 'updatedAt': return row.updatedAt;
			case 'createdAt': return row.createdAt;
			case 'projectName': return row.projectName;
			case 'issueId': return row.issueId;
			case 'state': return row.state;
			case 'providerId': return row.providerId;
			case 'duration': return row.activeDurationMs;
			case 'cost': return row.cost.totalCostUsd;
		}
	};
	return compareNullable(value(left), value(right), direction) || left.projectId.localeCompare(right.projectId) || left.runId.localeCompare(right.runId);
}

function activeDurationOf(evaluation: PersistedRunHistory['evaluation']): number | null {
	if (evaluation.wallTimeMs === null) return null;
	return Math.max(0, evaluation.wallTimeMs - (evaluation.phaseDurations['waiting-user'].durationMs ?? 0));
}

function coverageOf(item: PersistedRunHistory): RunOverviewRow['coverage'] {
	const kinds = new Set(item.events.map((event) => event.kind));
	return {
		verified: kinds.has('run.verified'),
		reviewed: kinds.has('run.review-clean'),
		fullVerification: kinds.has('run.full-verify-clean'),
	};
}

function projectRun(project: RegisteredProject, item: PersistedRunHistory): RunOverviewRow {
	const delivery = selectPullRequestDelivery(item.events);
	return {
		projectId: project.id,
		projectName: project.name,
		...(project.repository === undefined ? {} : { repository: project.repository }),
		runId: item.run.id,
		issueId: item.run.issueId,
		issueTitle: null,
		state: item.run.state,
		createdAt: item.run.createdAt,
		updatedAt: item.run.updatedAt,
		providerId: item.run.providerId,
		error: item.run.error,
		activeDurationMs: activeDurationOf(item.evaluation),
		evaluation: item.evaluation,
		cost: item.cost,
		roles: item.evaluation.roles,
		coverage: coverageOf(item),
		pullRequest: delivery,
		ci: delivery === null ? null : { status: delivery.ciStatus },
		merge: delivery !== null && item.evaluation.outcome === 'shipped' ? { status: 'merged' } : null,
	};
}

function matches(row: RunOverviewRow, filters: RunOverviewFilters, now: number): boolean {
	const periodStart = filters.period === '7d' ? now - 7 * 24 * 60 * 60 * 1000
		: filters.period === '30d' ? now - 30 * 24 * 60 * 60 * 1000 : null;
	const search = filters.search?.trim().toLowerCase();
	return (filters.projectId === undefined || row.projectId === filters.projectId)
		&& (filters.state === undefined || row.state === filters.state)
		&& (filters.group === undefined || GROUP_STATES[filters.group].includes(row.state))
		&& (filters.providerId === undefined || row.providerId === filters.providerId)
		&& (periodStart === null || Date.parse(row.createdAt) >= periodStart)
		&& (search === undefined || search === '' || row.runId.toLowerCase().includes(search) || row.issueId.toLowerCase().includes(search));
}

/** A title is a courtesy: a backlog that cannot be read leaves the ids, and is not an error of the listing. */
function nameIssues(page: RunOverviewRow[], projects: readonly RegisteredProject[], readTitles: NonNullable<RunOverviewReadOptions['readTitles']>): void {
	for (const project of projects) {
		const own = page.filter((row) => row.projectId === project.id);
		if (own.length === 0) continue;
		try {
			const titles = readTitles(project);
			for (const row of own) row.issueTitle = titles.get(row.issueId) ?? null;
		} catch { /* ids only */ }
	}
}

export function readRunOverview(
	projects: readonly RegisteredProject[],
	filters: RunOverviewFilters = {},
	options: RunOverviewReadOptions = {},
): RunOverviewPage {
	const readHistory = options.readHistory ?? readPersistedRunHistory;
	const now = options.now?.() ?? Date.now();
	const errors: RunOverviewError[] = [];
	const rows: RunOverviewRow[] = [];
	for (const project of projects) {
		if (filters.projectId !== undefined && project.id !== filters.projectId) continue;
		try {
			for (const item of readHistory(join(project.stateDir, 'runtime.sqlite'))) {
				const row = projectRun(project, item);
				if (matches(row, filters, now)) rows.push(row);
			}
		} catch {
			errors.push({
				projectId: project.id,
				projectName: project.name,
				code: 'project-unavailable',
				message: 'Project runs are unavailable.',
			});
		}
	}
	rows.sort((left, right) => compareRuns(left, right, filters.sortBy ?? 'updatedAt', filters.sortDirection ?? 'desc'));
	const { limit, offset } = boundedPage(filters);
	const page = rows.slice(offset, offset + limit);
	nameIssues(page, projects, options.readTitles ?? readIssueTitles);
	return {
		runs: page,
		page: { limit, offset, returned: Math.min(limit, Math.max(0, rows.length - offset)), total: rows.length },
		errors,
	};
}

export function parseRunOverviewFilters(params: URLSearchParams): RunOverviewFilters {
	validateRunOverviewParams(params);
	const state = params.get('state');
	const group = params.get('group');
	const providerId = params.get('providerId');
	const period = params.get('period');
	const sortBy = params.get('sortBy');
	const sortDirection = params.get('sortDirection');
	return {
		limit: parseRunOverviewPageNumber(params, 'limit'), offset: parseRunOverviewPageNumber(params, 'offset'),
		...(params.get('projectId') === null ? {} : { projectId: params.get('projectId')! }),
		...(state === null ? {} : { state: state as RunState }),
		...(group === null ? {} : { group: group as RunOverviewGroup }),
		...(providerId === null ? {} : { providerId: providerId as RunOverviewFilters['providerId'] }),
		...(period === null ? {} : { period: period as RunOverviewPeriod }),
		...(params.get('search') === null ? {} : { search: params.get('search')! }),
		...(sortBy === null ? {} : { sortBy: sortBy as RunOverviewSort }),
		...(sortDirection === null ? {} : { sortDirection: sortDirection as SortDirection }),
	};
}

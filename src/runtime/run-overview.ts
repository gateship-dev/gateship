import { join } from 'node:path';

import type { RegisteredProject } from './project-registry.ts';
import { type PullRequestDelivery, selectPullRequestDelivery } from './pull-request-delivery.ts';
import { isRunState, type RunState } from './run-state.ts';
import {
	type PersistedRunHistory,
	readPersistedRunHistory,
} from './run-store.ts';

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
	providerId?: 'claude' | 'codex';
	period?: RunOverviewPeriod;
	search?: string;
	sortBy?: RunOverviewSort;
	sortDirection?: SortDirection;
}

export interface RunOverviewRow {
	projectId: string;
	projectName: string;
	repository?: string;
	runId: string;
	issueId: string;
	state: RunState;
	createdAt: string;
	updatedAt: string;
	providerId: 'claude' | 'codex';
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
	now?: () => number;
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
	const providerId = params.get('providerId');
	const period = params.get('period');
	const sortBy = params.get('sortBy');
	const sortDirection = params.get('sortDirection');
	if (state !== null && !isRunState(state)) throw new Error('state must be a valid run state.');
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
			case 'duration': return row.evaluation.wallTimeMs;
			case 'cost': return row.cost.totalCostUsd;
		}
	};
	return compareNullable(value(left), value(right), direction) || left.projectId.localeCompare(right.projectId) || left.runId.localeCompare(right.runId);
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
		state: item.run.state,
		createdAt: item.run.createdAt,
		updatedAt: item.run.updatedAt,
		providerId: item.run.providerId,
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
		&& (filters.providerId === undefined || row.providerId === filters.providerId)
		&& (periodStart === null || Date.parse(row.createdAt) >= periodStart)
		&& (search === undefined || search === '' || row.runId.toLowerCase().includes(search) || row.issueId.toLowerCase().includes(search));
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
	return {
		runs: rows.slice(offset, offset + limit),
		page: { limit, offset, returned: Math.min(limit, Math.max(0, rows.length - offset)), total: rows.length },
		errors,
	};
}

export function parseRunOverviewFilters(params: URLSearchParams): RunOverviewFilters {
	validateRunOverviewParams(params);
	const state = params.get('state');
	const providerId = params.get('providerId');
	const period = params.get('period');
	const sortBy = params.get('sortBy');
	const sortDirection = params.get('sortDirection');
	return {
		limit: parseRunOverviewPageNumber(params, 'limit'), offset: parseRunOverviewPageNumber(params, 'offset'),
		...(params.get('projectId') === null ? {} : { projectId: params.get('projectId')! }),
		...(state === null ? {} : { state: state as RunState }),
		...(providerId === null ? {} : { providerId: providerId as RunOverviewFilters['providerId'] }),
		...(period === null ? {} : { period: period as RunOverviewPeriod }),
		...(params.get('search') === null ? {} : { search: params.get('search')! }),
		...(sortBy === null ? {} : { sortBy: sortBy as RunOverviewSort }),
		...(sortDirection === null ? {} : { sortDirection: sortDirection as SortDirection }),
	};
}

// webui/src/overview-counts.ts

import type { ProjectOperationalOverviewView } from './client.ts';

type ProjectEntry = ProjectOperationalOverviewView['projects'][number];

/** A project waits on the operator when its registry needs attention or its run stopped for them. */
export function projectNeedsOperator(entry: ProjectEntry): boolean {
	return entry.project.readiness === 'needs-attention' || entry.activeRun?.state === 'waiting-user' || entry.activeRun?.state === 'interrupted';
}

/** Projects waiting on the operator: the number Now shows, and the rows it marks. */
export function overviewAttention(overview: ProjectOperationalOverviewView): number {
	return overview.projects.filter(projectNeedsOperator).length;
}

/** Urgency first: what waits on the operator, then what is running, then the rest, each in the order it came. */
export function sortProjectsByUrgency(projects: readonly ProjectEntry[]): ProjectEntry[] {
	const rank = (entry: ProjectEntry): number => projectNeedsOperator(entry) ? 0 : entry.activeRun !== null ? 1 : 2;
	return projects.map((entry, index) => ({ entry, index })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index).map(({ entry }) => entry);
}

export interface NavigationCounts { now: number; runs: number | null; queue: number | null }

/**
 * The figures the sidebar shows beside Now, Runs and Queue, scoped the way
 * the rows themselves are: every project, or the selected one. `null` is
 * unknown (the project is missing from the overview or its backlog did not
 * load) and renders as nothing rather than a fabricated zero. Now is always
 * global because the row is.
 */
export function navigationCounts(overview: ProjectOperationalOverviewView | null, projectId: string | null): NavigationCounts | null {
	/* The client casts the payload rather than validating it, and a surface may
	 * hold a partial one (Insights carries the history alone). Without the
	 * project list there is nothing to count, so the rows say nothing. */
	if (overview === null || !Array.isArray(overview.projects) || overview.summary === undefined) return null;
	const now = overviewAttention(overview);
	if (projectId === null) return { now, runs: overview.summary.nonTerminalRuns, queue: overview.summary.backlog.planned };
	const entry = overview.projects.find((project) => project.project.id === projectId);
	if (entry === undefined) return { now, runs: null, queue: null };
	return { now, runs: entry.activeRun === null ? 0 : 1, queue: entry.backlog.state === 'available' ? entry.backlog.counts.planned : null };
}

// webui/src/overview-counts.ts

import type { ProjectOperationalOverviewView } from './client.ts';

/** Projects waiting on the operator: registry attention or a run that stopped for them. */
export function overviewAttention(overview: ProjectOperationalOverviewView): number {
	return overview.projects.filter((project) => project.project.readiness === 'needs-attention'
		|| project.activeRun?.state === 'waiting-user' || project.activeRun?.state === 'interrupted').length;
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
	if (overview === null) return null;
	const now = overviewAttention(overview);
	if (projectId === null) return { now, runs: overview.summary.nonTerminalRuns, queue: overview.summary.backlog.planned };
	const entry = overview.projects.find((project) => project.project.id === projectId);
	if (entry === undefined) return { now, runs: null, queue: null };
	return { now, runs: entry.activeRun === null ? 0 : 1, queue: entry.backlog.state === 'available' ? entry.backlog.counts.planned : null };
}

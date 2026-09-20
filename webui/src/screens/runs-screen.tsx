// webui/src/screens/runs-screen.tsx

import React from 'react';
import type { AppProps } from '../app-props.ts';
import type { IssueReviewDraft } from '../client.ts';
import { CardSplit, CardStack } from '../components/ui/card-layout.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { routeSelection, routeOf, runIdOf } from '../routes.ts';
import { OperationalReadPanel } from '../operational-unavailable.tsx';
import { TEXT_LINK_CLASS } from './operator-links.ts';
import { ProjectRunsTable } from './overview-runs-screen.tsx';
import { RunActivity, RunCard, RunCostPanel, RunReport, WorkflowBenchmarkPanel, WorkflowInsightsPanel, WorkspaceNoticesPanel } from './runs.tsx';

/*
 * A project's Runs is its list of runs, the same table the control center
 * shows, scoped by the path. One run is inspected at `/runs/:runId`. The
 * unscoped `/` and `/runs` keep opening the latest run: they are where a
 * "Gateship needs you" notification lands, and that run is the one it means.
 */
export function RunsSurface(props: AppProps): React.ReactElement {
	const route = String(props.surfaceRoute ?? props.route);
	const requestedRunId = runIdOf(route);
	const projectId = route.startsWith('/projects/') ? routeSelection(routeOf(route), null).projectId : null;
	const localeCatalog = LOCALE_CATALOG[props.locale];
	const snapshotFailure = props.operationalFailures?.Snapshot;
	const snapshotLoaded = props.operationalLoaded?.Snapshot === true;
	const snapshotPending = props.operationalPending?.Snapshot === true;
	const runsFailure = props.operationalFailures?.Runs;
	const runsLoaded = props.operationalLoaded?.Runs === true;
	const runsPending = props.operationalPending?.Runs === true;
	if (requestedRunId === null && projectId !== null) {
		return (
			<SurfaceColumn label={localeCatalog.shell.routeLabels.runs} status={props.status}>
				<ProjectRunsTable projectId={projectId} props={props} />
				{/* What the project's runs add up to, and what they left behind: facts about the list, not about one run. */}
				<OperationalReadPanel detail={runsFailure} loaded={runsLoaded} locale={props.locale} pending={runsPending} resource="Runs">
					<WorkflowInsightsPanel catalog={localeCatalog.runsWorkflow} locale={props.locale} runs={props.runs} />
					<WorkflowBenchmarkPanel catalog={localeCatalog.runsWorkflow} locale={props.locale} runs={props.runs} />
				</OperationalReadPanel>
				<OperationalReadPanel detail={snapshotFailure} loaded={snapshotLoaded} locale={props.locale} pending={snapshotPending} resource="Snapshot">
					<WorkspaceNoticesPanel catalog={localeCatalog.runsOperational} workspaceNotices={props.workspaceNotices} />
				</OperationalReadPanel>
			</SurfaceColumn>
		);
	}
	const run = requestedRunId === null
		? props.runs[0] ?? null
		: props.runs.find((candidate) => candidate.id === requestedRunId) ?? null;
	const catalog = localeCatalog.runInspector;
	const activityFailure = props.operationalFailures?.['Run activity'];
	const activityLoaded = props.operationalLoaded?.['Run activity'] === true;
	const activityPending = props.operationalPending?.['Run activity'] === true;
	return (
		<SurfaceColumn label={localeCatalog.shell.routeLabels.runs} status={props.status}>
			{projectId === null ? null : <a className={TEXT_LINK_CLASS} href={`/projects/${encodeURIComponent(projectId)}/runs`}>{catalog.allRunsLabel}</a>}
			<OperationalReadPanel detail={runsFailure} loaded={runsLoaded} locale={props.locale} pending={runsPending} resource="Runs">
			<RunCard
				catalog={catalog}
				events={props.events}
				locale={props.locale}
				onAbandon={props.onAbandon}
				onCancel={props.onCancel}
				onResume={props.onResume}
				onShip={props.onShip}
				pending={props.pending}
				run={run}
				title={requestedRunId === null ? catalog.latestRunTitle : catalog.runTitle}
			/>
			{/* What happened on the left (activity, report), what it cost on the right. */}
			<OperationalReadPanel detail={activityFailure} loaded={activityLoaded} locale={props.locale} pending={activityPending} resource="Run activity">
				<RunActivity catalog={localeCatalog.runsOperational} events={props.events} locale={props.locale} run={run} hasPrevious={props.runEventsHasPrevious} loading={props.runEventsLoading} onLoadPrevious={props.onLoadPreviousRunEvents} />
			</OperationalReadPanel>
			{run === null ? null : (
				<CardSplit>
					<CardStack className="min-w-0"><RunReport catalog={catalog} run={run} /></CardStack>
					<CardStack className="min-w-0"><RunCostPanel catalog={localeCatalog.runsOperational} locale={props.locale} run={run} /></CardStack>
				</CardSplit>
			)}
			</OperationalReadPanel>
		</SurfaceColumn>
	);
}

export function draftChanged(draft: IssueReviewDraft, objective: string, acceptance: string[], boundaries: string[], verify: string[]): boolean {
	return objective !== draft.objective || JSON.stringify(acceptance) !== JSON.stringify(draft.acceptance)
		|| JSON.stringify(boundaries) !== JSON.stringify(draft.boundaries ?? []) || JSON.stringify(verify) !== JSON.stringify(draft.verify);
}

/** The editable contract of one draft: its revision, its approval, and its abandonment. */

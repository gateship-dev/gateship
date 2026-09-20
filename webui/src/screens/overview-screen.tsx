import React, { useMemo } from 'react';
import type { AppProps } from '../app-props.ts';
import type { ProjectOperationalOverviewView, ProjectOverviewView, RegisteredProjectView } from '../client.ts';
import type { BadgeVariant } from '../components/ui/badge.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardPanel } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
import { DataTable, gateshipTableFeatures, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { StatusDot } from '../components/ui/status-dot.tsx';
import { Tag } from '../components/ui/tag.tsx';
import { cn } from '../lib/cn.ts';
import type { Locale, OverviewCatalog } from '../locale.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import type { RunState } from '../run-view.ts';
import { isRunActive, toneOf } from '../run-view.ts';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { overviewAttention, sortProjectsByUrgency } from '../overview-counts.ts';
import { formatDate, formatTime } from './overview-runs-screen.tsx';
import { SurfaceColumn } from './surface-column.tsx';

export const READINESS_TONE: Readonly<Record<RegisteredProjectView['readiness'], BadgeVariant>> = {
	ready: 'success', empty: 'neutral', 'needs-attention': 'warning',
};

export const OUTCOME_TONE: Readonly<Record<string, BadgeVariant>> = {
	shipped: 'success', failed: 'error', cancelled: 'neutral', incomplete: 'warning',
};

function stateLabel(state: string, locale: Locale): string {
	return LOCALE_CATALOG[locale].runInspector.stateLabels[state as RunState] ?? state;
}

export function OverviewFact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
	return <div className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 text-right">{children}</dd></div>;
}

type ProjectEntry = ProjectOverviewView;

export function ProjectActivity({ entry, catalog, locale }: { entry: ProjectEntry; catalog: OverviewCatalog; locale: Locale }): React.ReactElement {
	if (entry.database.state !== 'available') return <span className="text-muted-foreground">{catalog.databaseUnavailable}</span>;
	if (entry.activeRun === null) return <span className="text-muted-foreground">{catalog.noRun}</span>;
	/* Straight to the run: whoever reads "waiting for you" wants that run, not the list it sits in. */
	return <a className={cn(TEXT_LINK_CLASS, 'inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1')} href={`/projects/${encodeURIComponent(entry.project.id)}/runs/${encodeURIComponent(entry.activeRun.id)}`}>
		<span className="type-data text-xs">{entry.activeRun.issueId}</span>
		<StatusDot active={isRunActive(entry.activeRun.state as RunState)} tone={toneOf(entry.activeRun.state as RunState)}>{stateLabel(entry.activeRun.state, locale)}</StatusDot>
	</a>;
}

function LastDelivery({ entry, catalog }: { entry: ProjectEntry; catalog: OverviewCatalog }): React.ReactElement {
	if (entry.overview.overview === null) return <span className="text-muted-foreground">{catalog.historyUnavailable}</span>;
	if (entry.latestRun === null || entry.latestRunOutcome === null) return <span className="text-muted-foreground">{catalog.noDelivery}</span>;
	return <StatusDot tone={OUTCOME_TONE[entry.latestRunOutcome] ?? 'neutral'}>{catalog.outcomes[entry.latestRunOutcome]}</StatusDot>;
}

function deliveredAt(entry: ProjectEntry): string | null {
	return entry.overview.overview === null || entry.latestRun === null || entry.latestRunOutcome === null ? null : entry.latestRun.updatedAt;
}

/*
 * The one list of the page, in the product's table: what waits on the operator
 * leads and carries the acid rule, running work follows, idle projects close.
 */
function ProjectStatusTable({ overview, catalog, locale }: { overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; locale: Locale }): React.ReactElement {
	const projectCatalog = LOCALE_CATALOG[locale].projects;
	const runsCatalog = LOCALE_CATALOG[locale].overviewRuns;
	const data = useMemo(() => sortProjectsByUrgency(overview.projects), [overview.projects]);
	const columns = useMemo<GateshipColumnDef<ProjectEntry>[]>(() => {
		const mono = 'type-data whitespace-nowrap text-xs';
		const when = (entry: ProjectEntry, format: (value: string, locale: Locale) => string): React.ReactNode => { const value = deliveredAt(entry); return value === null ? null : <time dateTime={value}>{format(value, locale)}</time>; };
		const defs: GateshipColumnDef<ProjectEntry>[] = [
			{ id: 'project', header: catalog.project, meta: { className: 'max-w-44 sm:max-w-52' }, cell: ({ row }) => <span className="flex min-w-0 flex-wrap items-center gap-2"><a className={cn(TITLE_LINK_CLASS, 'truncate')} href={`/projects/${encodeURIComponent(row.original.project.id)}`}>{row.original.project.name}</a>{row.original.project.current ? <span className="hidden @xl:inline-flex"><Tag>{projectCatalog.currentBadge}</Tag></span> : null}</span> },
			{ id: 'activity', header: catalog.activity, meta: { className: 'max-w-56' }, cell: ({ row }) => <ProjectActivity catalog={catalog} entry={row.original} locale={locale} /> },
			{ id: 'readiness', header: projectCatalog.readinessLabel, meta: { hideBelow: 'sm' }, cell: ({ row }) => <Badge variant={READINESS_TONE[row.original.project.readiness]}>{projectCatalog.readiness[row.original.project.readiness]}</Badge> },
			{ id: 'backlog', header: catalog.backlogLabel, meta: { align: 'end', className: 'type-data', hideBelow: 'sm' }, cell: ({ row }) => row.original.backlog.state === 'available' ? row.original.backlog.counts.planned : <span className="font-sans text-muted-foreground">{catalog.partial}</span> },
			{ id: 'lastDelivery', header: catalog.lastDelivery, meta: { hideBelow: 'md' }, cell: ({ row }) => <LastDelivery catalog={catalog} entry={row.original} /> },
			{ id: 'date', header: runsCatalog.date, meta: { className: mono, hideBelow: 'md' }, cell: ({ row }) => when(row.original, formatDate) },
			{ id: 'time', header: runsCatalog.time, meta: { className: `${mono} text-muted-foreground`, hideBelow: 'md' }, cell: ({ row }) => when(row.original, formatTime) },
		];
		/* A handful of projects in a fixed order: nothing here sorts or hides. */
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, projectCatalog, runsCatalog, locale]);
	const table = useGateshipTable({ columns, data, features: gateshipTableFeatures, getRowId: (entry) => entry.project.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: data.length });
	return <section aria-labelledby="overview-project-status">
		<h2 className="sr-only" id="overview-project-status">{catalog.projectStatus}</h2>
		<DataTable locale={locale} table={table} />
	</section>;
}

export function OverviewData({ props, overview, catalog, attention }: { props: AppProps; overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; attention: number }): React.ReactElement {
	/* Each figure that has a list behind it leads there. Attention does not: its list is the table right below. */
	return <>
		<CardGrid className="grid-cols-2 xl:grid-cols-4" compact equalHeight>
			<Stat label={catalog.metrics.attention} tone={attention > 0 ? 'attention' : 'default'} value={attention} />
			<Stat href="/overview/runs" label={catalog.metrics.activeRuns} value={overview.summary.nonTerminalRuns} />
			<Stat href="/overview/queues" label={catalog.metrics.approvedIssues} value={overview.summary.backlog.planned} />
			<Stat href="/overview/runs?group=shipped&period=7d" label={catalog.metrics.deliveries} value={overview.overview.runsByOutcome.shipped} />
		</CardGrid>
		<ProjectStatusTable catalog={catalog} locale={props.locale} overview={overview} />
		{props.overviewLoading ? <p className="text-muted-foreground text-xs" role="status">{catalog.loading}</p> : null}
	</>;
}

export function OverviewSurface(props: AppProps): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overview;
	const overview = props.overview ?? null;
	const attention = overview === null ? 0 : overviewAttention(overview);
	return <SurfaceColumn label={LOCALE_CATALOG[props.locale].shell.routeLabels.now} status={props.status}>
		{props.overviewLoading && overview === null ? <div role="status" aria-label={catalog.loading}><Skeleton className="h-20 w-full" /><span className="sr-only">{catalog.loading}</span></div> : null}
		{overview === null && props.overviewError !== null && props.overviewError !== undefined ? <Card><CardPanel><p role="alert">{catalog.error}</p><p className="text-muted-foreground text-xs">{props.overviewError}</p></CardPanel></Card> : null}
		{(overview === null || overview.projects.length === 0) && !props.overviewLoading && !props.overviewError && props.projects.length === 0 ? <EmptyState>{catalog.empty}</EmptyState> : null}
		{props.overviewError ? <p className="text-warning-foreground text-sm" role="alert">{catalog.error}: {props.overviewError}</p> : null}
		{overview === null || overview.projects.length === 0 ? null : <OverviewData props={props} overview={overview} catalog={catalog} attention={attention} />}
	</SurfaceColumn>;
}

import React from 'react';
import type { AppProps } from '../app-props.ts';
import type { ProjectOperationalOverviewView, ProjectOverviewView, RegisteredProjectView } from '../client.ts';
import { AttentionCard } from '../components/ui/attention-card.tsx';
import type { BadgeVariant } from '../components/ui/badge.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardPanel } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Item, ItemContent, ItemGroup } from '../components/ui/item.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { cn } from '../lib/cn.ts';
import type { Locale, OverviewCatalog, ProjectsCatalog } from '../locale.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import type { RunState } from '../run-view.ts';
import { toneOf } from '../run-view.ts';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { formatRunTimestamp } from './runs.tsx';
import { SurfaceColumn } from './surface-column.tsx';

export const READINESS_TONE: Readonly<Record<RegisteredProjectView['readiness'], BadgeVariant>> = {
	ready: 'success', empty: 'secondary', 'needs-attention': 'warning',
};

export const OUTCOME_TONE: Readonly<Record<string, BadgeVariant>> = {
	shipped: 'success', failed: 'error', cancelled: 'secondary', incomplete: 'warning',
};

function stateLabel(state: string, locale: Locale): string {
	return LOCALE_CATALOG[locale].runInspector.stateLabels[state as RunState] ?? state;
}

export function OverviewFact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
	return <div className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-muted-foreground">{label}</dt><dd className="min-w-0 text-right">{children}</dd></div>;
}

function ProjectActivity({ entry, catalog, locale }: { entry: ProjectOverviewView; catalog: OverviewCatalog; locale: Locale }): React.ReactElement {
	if (entry.database.state !== 'available') return <span className="text-muted-foreground">{catalog.databaseUnavailable}</span>;
	if (entry.activeRun === null) return <span className="text-muted-foreground">{catalog.noRun}</span>;
	return <a className={cn(TEXT_LINK_CLASS, 'inline-flex max-w-full flex-wrap items-center gap-2')} href={`/projects/${encodeURIComponent(entry.project.id)}/runs`}>
		<span className="break-all font-mono text-xs">{entry.activeRun.issueId}</span>
		<Badge variant={toneOf(entry.activeRun.state as RunState)}>{stateLabel(entry.activeRun.state, locale)}</Badge>
	</a>;
}

function ActiveWork({ overview, catalog, locale }: { overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; locale: Locale }): React.ReactElement {
	const entries = overview.projects.filter((entry) => entry.activeRun !== null);
	return <section aria-labelledby="overview-active-work" className="flex flex-col gap-3">
		<h2 className="sr-only" id="overview-active-work">{catalog.activeWork}</h2>
		{entries.length === 0 ? <EmptyState compact>{catalog.noActiveWork}</EmptyState> : (
			<ItemGroup aria-label={catalog.activeWork}>{entries.map((entry) => <Item key={entry.project.id}>
				<ItemContent><a className={cn(TITLE_LINK_CLASS, 'block truncate')} href={`/projects/${encodeURIComponent(entry.project.id)}/runs`}>{entry.project.name}</a></ItemContent>
				<ProjectActivity entry={entry} catalog={catalog} locale={locale} />
			</Item>)}</ItemGroup>
		)}
	</section>;
}

function ProjectStatusTable({ overview, catalog, projectCatalog, locale }: { overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; projectCatalog: ProjectsCatalog; locale: Locale }): React.ReactElement {
	return <section aria-labelledby="overview-project-status" className="flex flex-col gap-3">
		<h2 className="sr-only" id="overview-project-status">{catalog.projectStatus}</h2>
		<div className="rounded-lg border">
			<Table>
				<caption className="sr-only">{catalog.projectStatus}</caption>
				<TableHeader className="bg-muted/40"><TableRow>
					<TableHead>{catalog.project}</TableHead><TableHead>{projectCatalog.readinessLabel}</TableHead><TableHead>{catalog.activity}</TableHead>
					<TableHead className="hidden sm:table-cell">{catalog.backlogLabel}</TableHead><TableHead className="hidden md:table-cell">{catalog.lastDelivery}</TableHead>
				</TableRow></TableHeader>
				<TableBody>{overview.projects.map((entry) => <TableRow key={entry.project.id}>
					<TableCell className="max-w-44"><span className="flex min-w-0 flex-wrap items-center gap-2"><a className={cn(TITLE_LINK_CLASS, 'truncate')} href={`/projects/${encodeURIComponent(entry.project.id)}`}>{entry.project.name}</a>{entry.project.current ? <Badge variant="info">{projectCatalog.currentBadge}</Badge> : null}</span></TableCell>
					<TableCell><Badge variant={READINESS_TONE[entry.project.readiness]}>{projectCatalog.readiness[entry.project.readiness]}</Badge></TableCell><TableCell className="max-w-56"><ProjectActivity entry={entry} catalog={catalog} locale={locale} /></TableCell>
					<TableCell className="hidden font-mono tabular-nums sm:table-cell">{entry.backlog.state === 'available' ? entry.backlog.counts.planned : <span className="text-muted-foreground">{catalog.partial}</span>}</TableCell>
					<TableCell className="hidden md:table-cell">{entry.overview.overview === null ? <span className="text-muted-foreground">{catalog.historyUnavailable}</span> : entry.latestRun === null || entry.latestRunOutcome === null ? <span className="text-muted-foreground">{catalog.noDelivery}</span> : <span className="inline-flex flex-wrap items-center gap-2"><Badge variant={OUTCOME_TONE[entry.latestRunOutcome] ?? 'secondary'}>{catalog.outcomes[entry.latestRunOutcome]}</Badge><time className="font-mono text-muted-foreground text-xs" dateTime={entry.latestRun.updatedAt}>{formatRunTimestamp(entry.latestRun.updatedAt, locale)}</time></span>}</TableCell>
				</TableRow>)}</TableBody>
			</Table>
		</div>
	</section>;
}

export function OverviewData({ props, overview, catalog, attention }: { props: AppProps; overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; attention: number }): React.ReactElement {
	return <>
		<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight>
			{attention > 0 ? <AttentionCard title={catalog.metrics.attention}><p className="type-data text-2xl">{attention}</p></AttentionCard> : <Stat label={catalog.metrics.attention} value={attention} />}
			<Stat label={catalog.metrics.activeRuns} value={overview.summary.nonTerminalRuns} />
			<Stat label={catalog.metrics.approvedIssues} value={overview.summary.backlog.planned} />
			<Stat label={catalog.metrics.deliveries} value={overview.overview.runsByOutcome.shipped} />
		</CardGrid>
		<ActiveWork overview={overview} catalog={catalog} locale={props.locale} />
		<ProjectStatusTable overview={overview} catalog={catalog} projectCatalog={LOCALE_CATALOG[props.locale].projects} locale={props.locale} />
		{props.overviewLoading ? <p className="text-muted-foreground text-xs" role="status">{catalog.loading}</p> : null}
	</>;
}

export function OverviewSurface(props: AppProps): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overview;
	const overview = props.overview ?? null;
	const attention = overview?.projects.filter((project) => project.project.readiness === 'needs-attention'
		|| project.activeRun?.state === 'waiting-user' || project.activeRun?.state === 'interrupted').length ?? 0;
	return <SurfaceColumn label={LOCALE_CATALOG[props.locale].shell.routeLabels.overview} status={props.status}>
		{props.overviewLoading && overview === null ? <div role="status" aria-label={catalog.loading}><Skeleton className="h-20 w-full" /><span className="sr-only">{catalog.loading}</span></div> : null}
		{overview === null && props.overviewError !== null && props.overviewError !== undefined ? <Card><CardPanel><p role="alert">{catalog.error}</p><p className="text-muted-foreground text-xs">{props.overviewError}</p></CardPanel></Card> : null}
		{(overview === null || overview.projects.length === 0) && !props.overviewLoading && !props.overviewError && props.projects.length === 0 ? <EmptyState>{catalog.empty}</EmptyState> : null}
		{props.overviewError ? <p className="text-warning-foreground text-sm" role="alert">{catalog.error}: {props.overviewError}</p> : null}
		{overview === null || overview.projects.length === 0 ? null : <OverviewData props={props} overview={overview} catalog={catalog} attention={attention} />}
	</SurfaceColumn>;
}

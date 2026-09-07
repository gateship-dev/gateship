import React from 'react';
import type { AppProps } from '../app-props.ts';
import type { ProjectOperationalOverviewView, ProjectOverviewView, RegisteredProjectView } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import type { BadgeVariant } from '../components/ui/badge.tsx';
import { Card, CardPanel } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { cn } from '../lib/cn.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import type { Locale, OverviewCatalog, ProjectsCatalog } from '../locale.ts';
import { toneOf } from '../run-view.ts';
import type { RunState } from '../run-view.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { formatRunTimestamp } from './runs.tsx';

export const READINESS_TONE: Readonly<Record<RegisteredProjectView['readiness'], BadgeVariant>> = {
	ready: 'success', empty: 'secondary', 'needs-attention': 'warning',
};

export const OUTCOME_TONE: Readonly<Record<string, BadgeVariant>> = {
	shipped: 'success', failed: 'error', cancelled: 'secondary', incomplete: 'warning',
};

export function ControlCenterNavigation({ locale, current }: { locale: Locale; current: 'now' | 'runs' }): React.ReactElement {
	const catalog = LOCALE_CATALOG[locale].overview.navigation;
	return <nav aria-label={catalog.label} className="border-b">
		<ul className="flex gap-5">
			{([{ href: '/overview', key: 'now', label: catalog.now }, { href: '/overview/runs', key: 'runs', label: catalog.runs }] as const).map((item) => <li key={item.key}>
				<a aria-current={current === item.key ? 'page' : undefined} className={cn('inline-flex min-h-10 items-center border-b-2 px-1 text-sm', current === item.key ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')} href={item.href}>{item.label}</a>
			</li>)}
		</ul>
	</nav>;
}

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
			<ul className="divide-y divide-border rounded-lg border" aria-label={catalog.activeWork}>
				{entries.map((entry) => <li className="flex min-w-0 flex-wrap items-center justify-between gap-3 px-4 py-3" key={entry.project.id}>
					<a className={cn(TITLE_LINK_CLASS, 'min-w-0 truncate')} href={`/projects/${encodeURIComponent(entry.project.id)}/runs`}>{entry.project.name}</a>
					<ProjectActivity entry={entry} catalog={catalog} locale={locale} />
				</li>)}
			</ul>
		)}
	</section>;
}

function ProjectStatusTable({ overview, catalog, projectCatalog, locale }: { overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; projectCatalog: ProjectsCatalog; locale: Locale }): React.ReactElement {
	return <section aria-labelledby="overview-project-status" className="flex flex-col gap-3">
		<h2 className="sr-only" id="overview-project-status">{catalog.projectStatus}</h2>
		<div className="overflow-hidden rounded-lg border">
			<table className="w-full text-sm">
				<caption className="sr-only">{catalog.projectStatus}</caption>
				<thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>
					<th className="px-4 py-3 font-medium">{catalog.project}</th>
					<th className="px-4 py-3 font-medium">{projectCatalog.readinessLabel}</th>
					<th className="px-4 py-3 font-medium">{catalog.activity}</th>
					<th className="hidden px-4 py-3 font-medium sm:table-cell">{catalog.backlogLabel}</th>
					<th className="hidden px-4 py-3 font-medium md:table-cell">{catalog.lastDelivery}</th>
				</tr></thead>
				<tbody className="divide-y divide-border">
					{overview.projects.map((entry) => <tr key={entry.project.id}>
						<td className="max-w-44 px-4 py-3"><span className="flex min-w-0 flex-wrap items-center gap-2"><a className={cn(TITLE_LINK_CLASS, 'truncate')} href={`/projects/${encodeURIComponent(entry.project.id)}`}>{entry.project.name}</a>{entry.project.current ? <Badge variant="info">{projectCatalog.currentBadge}</Badge> : null}</span></td>
						<td className="px-4 py-3"><Badge variant={READINESS_TONE[entry.project.readiness]}>{projectCatalog.readiness[entry.project.readiness]}</Badge></td>
						<td className="max-w-56 px-4 py-3"><ProjectActivity entry={entry} catalog={catalog} locale={locale} /></td>
						<td className="hidden px-4 py-3 font-mono tabular-nums sm:table-cell">{entry.backlog.state === 'available' ? entry.backlog.counts.planned : <span className="text-muted-foreground">{catalog.partial}</span>}</td>
						<td className="hidden px-4 py-3 md:table-cell">{entry.overview.overview === null ? <span className="text-muted-foreground">{catalog.historyUnavailable}</span> : entry.latestRun === null || entry.latestRunOutcome === null ? <span className="text-muted-foreground">{catalog.noDelivery}</span> : <span className="inline-flex flex-wrap items-center gap-2"><Badge variant={OUTCOME_TONE[entry.latestRunOutcome] ?? 'secondary'}>{catalog.outcomes[entry.latestRunOutcome]}</Badge><time className="font-mono text-muted-foreground text-xs" dateTime={entry.latestRun.updatedAt}>{formatRunTimestamp(entry.latestRun.updatedAt, locale)}</time></span>}</td>
					</tr>)}
				</tbody>
			</table>
		</div>
	</section>;
}

export function OverviewData({ props, overview, catalog, attention }: { props: AppProps; overview: ProjectOperationalOverviewView; catalog: OverviewCatalog; attention: number }): React.ReactElement {
	return <>
		<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight>
			<Stat className={cn(attention > 0 && 'border-attention-ui bg-attention-surface shadow-[0_6px_28px_rgba(200,255,0,0.09)]')} label={catalog.metrics.attention} value={attention} />
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
	return <SurfaceColumn label={catalog.title} status={props.status}>
		<ControlCenterNavigation current="now" locale={props.locale} />
		{props.overviewLoading && overview === null ? <p role="status">{catalog.loading}</p> : null}
		{overview === null && props.overviewError !== null && props.overviewError !== undefined ? <Card><CardPanel><p role="alert">{catalog.error}</p><p className="text-muted-foreground text-xs">{props.overviewError}</p></CardPanel></Card> : null}
		{(overview === null || overview.projects.length === 0) && !props.overviewLoading && !props.overviewError && props.projects.length === 0 ? <EmptyState>{catalog.empty}</EmptyState> : null}
		{props.overviewError ? <p className="text-warning-foreground text-sm" role="alert">{catalog.error}: {props.overviewError}</p> : null}
		{overview === null || overview.projects.length === 0 ? null : <OverviewData props={props} overview={overview} catalog={catalog} attention={attention} />}
	</SurfaceColumn>;
}

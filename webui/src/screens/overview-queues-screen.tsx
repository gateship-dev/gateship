import React, { useEffect, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import { fetchOverviewQueues, type ProjectQueueView, type QueueOverviewView } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import type { Locale, OverviewCatalog } from '../locale.ts';
import type { RunState } from '../run-view.ts';
import { cn } from '../lib/cn.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ControlCenterNavigation } from './overview-screen.tsx';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { formatRunTimestamp } from './runs.tsx';

interface QueueBrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function runtime(): QueueBrowserRuntime { return globalThis as unknown as QueueBrowserRuntime; }
function projectFilter(): string | undefined { return new URLSearchParams(runtime().location?.search ?? '').get('projectId') ?? undefined; }
function queueUrl(projectId: string | undefined): string { return projectId === undefined ? '/overview/queues' : `/overview/queues?projectId=${encodeURIComponent(projectId)}`; }
export function queueErrorsForFilter(errors: QueueOverviewView['errors'], filter: string | undefined): QueueOverviewView['errors'] {
	return errors.filter((error) => filter === undefined || error.projectId === filter);
}

function issueLink(queue: ProjectQueueView, issue: { id: string; title: string } | null): React.ReactElement {
	if (issue === null) return <span>—</span>;
	return <a className={cn(TEXT_LINK_CLASS, 'font-mono text-xs')} href={`/projects/${encodeURIComponent(queue.project.id)}/work#${encodeURIComponent(issue.id)}`}>{issue.id}<span className="sr-only">: {issue.title}</span></a>;
}

function QueueSequence({ queue, catalog }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues'] }): React.ReactElement {
	return <ol className="flex flex-col gap-2 border-l pl-4" aria-label={catalog.sequence}>
		{queue.plannedIssues.map((issue, index) => <li className="relative flex min-w-0 items-center gap-2 text-sm" key={issue.id}>
			<span aria-hidden="true" className="absolute -left-[21px] size-2 rounded-full border-2 border-background bg-muted-foreground" />
			<span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{index + 1}</span>
			{issueLink(queue, issue)}
			{queue.currentIssue?.id === issue.id ? <Badge variant="info">{catalog.current}</Badge> : null}
		</li>)}
	</ol>;
}

function needsOperator(reason: string): boolean { return reason === 'chain-disabled' || reason === 'no-admissible-issue' || reason === 'chain-start-failed'; }

function runStateLabel(state: string, locale: Locale, catalog: OverviewCatalog['queues']): string {
	return state === 'waiting-provider' ? catalog.providerWait : LOCALE_CATALOG[locale].runInspector.stateLabels[state as RunState] ?? state;
}

function QueueFact({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
	return <span className="flex min-w-0 flex-col gap-0.5"><span className="text-muted-foreground text-xs">{label}</span><span className="min-w-0">{children}</span></span>;
}

function deliveryLabel(queue: ProjectQueueView, catalog: OverviewCatalog['queues'], locale: Locale): string | null {
	if (queue.lastDelivery.state === 'unavailable') return locale === 'pt-BR' ? 'Histórico de entregas indisponível.' : 'Delivery history unavailable.';
	return queue.lastDelivery.run === null ? catalog.noDelivery : null;
}

export function QueueEmptyState({ projectCount, filter, queues, errors, catalog, locale }: { projectCount: number; filter: string | undefined; queues: ProjectQueueView[]; errors: QueueOverviewView['errors']; catalog: OverviewCatalog['queues']; locale: Locale }): React.ReactElement | null {
	if (projectCount === 0) return <EmptyState>{catalog.empty}</EmptyState>;
	if (queues.length > 0) return null;
	const filteredError = filter !== undefined && errors.some((error) => error.projectId === filter);
	if (filteredError || filter === undefined) return null;
	return <EmptyState>{locale === 'pt-BR' ? 'Nenhuma fila corresponde ao projeto selecionado.' : 'No queue matches the selected project.'}</EmptyState>;
}

function QueueSummary({ queue, catalog, locale, projectHref, currentState, pauseReason }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale; projectHref: string; currentState: string; pauseReason: string | null }): React.ReactElement {
	const lastDelivery = queue.lastDelivery.state === 'available' ? queue.lastDelivery.run : null;
	const noDeliveryLabel = deliveryLabel(queue, catalog, locale);
	return <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring">
		<span className="min-w-32 flex-1"><a className={cn(TITLE_LINK_CLASS, 'font-semibold')} href={projectHref}>{queue.project.name}</a></span>
		<Badge variant={queue.chainEnabled ? 'success' : 'secondary'}>{queue.chainEnabled ? catalog.enabled : catalog.disabled}</Badge>
		<Badge variant={queue.readiness === 'needs-attention' ? 'warning' : 'outline'}>{LOCALE_CATALOG[locale].projects.readiness[queue.readiness]}</Badge>
		<div className="grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-5">
			<QueueFact label={catalog.current}>{queue.currentRun === null ? issueLink(queue, queue.currentIssue) : <span className="flex flex-wrap items-center gap-2">{issueLink(queue, queue.currentIssue)} <span className="text-muted-foreground text-xs">{currentState}</span></span>}</QueueFact>
			<QueueFact label={catalog.next}>{issueLink(queue, queue.nextIssue)}</QueueFact>
			<QueueFact label={catalog.planned}><span className="font-mono tabular-nums">{queue.plannedIssues.length}</span></QueueFact>
			<QueueFact label={catalog.lastDelivery}>{lastDelivery === null ? <span className="text-muted-foreground">{noDeliveryLabel}</span> : <a className={cn(TEXT_LINK_CLASS, 'font-mono text-xs')} href={`${projectHref}/runs/${encodeURIComponent(lastDelivery.id)}`}>{lastDelivery.issueId}</a>}</QueueFact>
			{pauseReason === null ? null : <QueueFact label={catalog.paused}><span className={needsOperator(queue.pause!.reason) ? 'text-attention-foreground' : 'text-muted-foreground'}>{pauseReason}{needsOperator(queue.pause!.reason) ? '' : ` · ${catalog.automaticResume}`}</span></QueueFact>}
		</div>
		<span className="ml-auto text-muted-foreground text-xs group-open:hidden">{catalog.expand}</span><span className="ml-auto hidden text-muted-foreground text-xs group-open:inline">{catalog.collapse}</span>
	</summary>;
}

function QueueDetails({ queue, catalog, locale, projectHref, currentState, pauseReason }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale; projectHref: string; currentState: string; pauseReason: string | null }): React.ReactElement {
	const runHref = queue.currentRun === null ? null : `${projectHref}/runs/${encodeURIComponent(queue.currentRun.id)}`;
	const lastDelivery = queue.lastDelivery.state === 'available' ? queue.lastDelivery.run : null;
	const noDeliveryLabel = deliveryLabel(queue, catalog, locale);
	return <>
		<dl className="grid gap-4 border-t px-4 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
			<div><dt className="text-muted-foreground">{catalog.current}</dt><dd className="mt-1">{queue.currentRun === null ? issueLink(queue, queue.currentIssue) : <span className="flex flex-wrap items-center gap-2">{issueLink(queue, queue.currentIssue)} <a className={cn(TEXT_LINK_CLASS, 'font-mono text-xs')} href={runHref!}>{currentState}</a></span>}</dd></div>
			<div><dt className="text-muted-foreground">{catalog.next}</dt><dd className="mt-1">{issueLink(queue, queue.nextIssue)}</dd></div>
			<div><dt className="text-muted-foreground">{catalog.planned}</dt><dd className="mt-1 font-mono tabular-nums">{queue.plannedIssues.length}</dd></div>
			<div><dt className="text-muted-foreground">{catalog.lastDelivery}</dt><dd className="mt-1">{lastDelivery === null ? <span className="text-muted-foreground">{noDeliveryLabel}</span> : <span className="flex flex-wrap items-center gap-2"><a className={cn(TEXT_LINK_CLASS, 'font-mono text-xs')} href={`${projectHref}/runs/${encodeURIComponent(lastDelivery.id)}`}>{lastDelivery.issueId}</a><time className="text-muted-foreground text-xs" dateTime={lastDelivery.updatedAt}>{formatRunTimestamp(lastDelivery.updatedAt, locale)}</time></span>}</dd></div>
			{queue.pause !== null ? <div className={needsOperator(queue.pause.reason) ? 'sm:col-span-2' : 'sm:col-span-2 text-muted-foreground'}><dt className="text-muted-foreground">{catalog.paused}</dt><dd className="mt-1">{pauseReason}{needsOperator(queue.pause.reason) ? '' : ` · ${catalog.automaticResume}`}</dd></div> : null}
		</dl>
		<div className="border-t px-4 py-4"><h3 className="mb-3 font-mono text-xs uppercase tracking-wide text-muted-foreground">{catalog.sequence}</h3><QueueSequence queue={queue} catalog={catalog} /></div>
	</>;
}

export function QueueRow({ queue, catalog, locale }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale }): React.ReactElement {
	const projectHref = `/projects/${encodeURIComponent(queue.project.id)}`;
	const currentState = queue.currentRun === null ? catalog.none : runStateLabel(queue.currentRun.state, locale, catalog);
	const pauseReason = queue.pause === null ? null : catalog.pauseReasons[queue.pause.reason] ?? queue.pause.reason;
	return <details className="group rounded-lg border" open={queue.plannedIssues.length > 0}>
		<QueueSummary catalog={catalog} currentState={currentState} locale={locale} pauseReason={pauseReason} projectHref={projectHref} queue={queue} />
		<QueueDetails catalog={catalog} currentState={currentState} locale={locale} pauseReason={pauseReason} projectHref={projectHref} queue={queue} />
	</details>;
}

export function OverviewQueuesSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overview;
	const queueCatalog = catalog.queues;
	const [data, setData] = useState<QueueOverviewView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<string | undefined>(() => projectFilter());
	useEffect(() => { let disposed = false; let timeout: ReturnType<typeof setTimeout> | undefined; let controller: AbortController | undefined; const read = (): void => { controller = new AbortController(); void fetchOverviewQueues(controller.signal).then((value) => { if (!disposed) { setData(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) timeout = setTimeout(read, 15_000); }); }; read(); return () => { disposed = true; controller?.abort(); if (timeout !== undefined) clearTimeout(timeout); }; }, []);
	useEffect(() => { const onPop = (): void => setFilter(projectFilter()); runtime().addEventListener?.('popstate', onPop); return () => runtime().removeEventListener?.('popstate', onPop); }, []);
	const updateFilter = (value: string): void => { const next = value || undefined; runtime().history?.pushState(null, '', queueUrl(next)); setFilter(next); };
	const queues = data?.queues.filter((queue) => filter === undefined || queue.project.id === filter) ?? [];
	const errors = queueErrorsForFilter(data?.errors ?? [], filter);
	return <SurfaceColumn label={queueCatalog.title} status={props.status}>
		<ControlCenterNavigation current="queues" locale={props.locale} />
		<div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold">{queueCatalog.title}</h1><p className="text-muted-foreground text-sm">{queueCatalog.description}</p></div>
		<select aria-label={queueCatalog.filterProject} className="min-h-10 w-full rounded-lg border bg-background px-3 text-sm sm:max-w-xs" value={filter ?? ''} onChange={(event) => updateFilter((event.currentTarget as unknown as { value: string }).value)}><option value="">{queueCatalog.allProjects}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
		{data === null && error === null ? <p role="status">{queueCatalog.loading}</p> : null}
		{error !== null ? <p role="alert">{queueCatalog.error}: {error}</p> : null}
		{data !== null ? <QueueEmptyState catalog={queueCatalog} errors={errors} filter={filter} locale={props.locale} projectCount={props.projects.length} queues={queues} /> : null}
		<div className="flex flex-col gap-3">{queues.map((queue) => <QueueRow catalog={queueCatalog} key={queue.project.id} locale={props.locale} queue={queue} />)}</div>
		{errors.map((item) => <p className="text-warning-foreground text-sm" role="alert" key={item.projectId}>{item.projectName}: {queueCatalog.unavailable}</p>)}
	</SurfaceColumn>;
}

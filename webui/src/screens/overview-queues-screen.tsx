import React, { useEffect, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import { fetchOverviewQueues, type ProjectQueueView, type QueueOverviewView } from '../client.ts';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge, type BadgeVariant } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { Skeleton } from '../components/ui/skeleton.tsx';
import { cn } from '../lib/cn.ts';
import type { Locale, OverviewCatalog } from '../locale.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import type { RunState } from '../run-view.ts';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { formatRunTimestamp } from './runs.tsx';
import { SurfaceColumn } from './surface-column.tsx';

interface QueueBrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function runtime(): QueueBrowserRuntime { return globalThis as unknown as QueueBrowserRuntime; }
function projectFilter(): string | undefined { return new URLSearchParams(runtime().location?.search ?? '').get('projectId') ?? undefined; }
export function queueErrorsForFilter(errors: QueueOverviewView['errors'], filter: string | undefined): QueueOverviewView['errors'] {
	return errors.filter((error) => filter === undefined || error.projectId === filter);
}

/* What a queue is doing, in the order an operator needs to hear it. */
export type QueueStatus = 'needs-you' | 'running' | 'paused' | 'ready' | 'empty';
const STATUS_ORDER: readonly QueueStatus[] = ['needs-you', 'running', 'paused', 'ready', 'empty'];
/* Mirrors the `needs-you` group in src/runtime/run-overview.ts and the shell's attention map. */
const RUN_NEEDS_YOU: ReadonlySet<string> = new Set(['ready-to-ship', 'waiting-user', 'waiting-provider', 'failed', 'interrupted']);

/** A pause only the operator can lift. `no-admissible-issue` counts only while something is planned: an empty queue is done, not stuck. */
function pauseNeedsOperator(queue: ProjectQueueView): boolean {
	const reason = queue.pause?.reason;
	return reason === 'chain-disabled' || reason === 'chain-start-failed' || (reason === 'no-admissible-issue' && queue.plannedIssues.length > 0);
}

export function queueStatus(queue: ProjectQueueView): QueueStatus {
	if (queue.readiness === 'needs-attention' || pauseNeedsOperator(queue) || (queue.currentRun !== null && RUN_NEEDS_YOU.has(queue.currentRun.state))) return 'needs-you';
	if (queue.currentRun !== null) return 'running';
	if (queue.plannedIssues.length === 0) return 'empty';
	return queue.pause === null ? 'ready' : 'paused';
}

/** Queues that wait on the operator first, then what moves, then what waits on its own, then the empty ones; registry order within each. */
export function sortQueuesByUrgency(queues: readonly ProjectQueueView[]): ProjectQueueView[] {
	return queues.map((queue, index) => ({ queue, index })).sort((left, right) => STATUS_ORDER.indexOf(queueStatus(left.queue)) - STATUS_ORDER.indexOf(queueStatus(right.queue)) || left.index - right.index).map((entry) => entry.queue);
}

function runStateLabel(state: string, locale: Locale, catalog: OverviewCatalog['queues']): string {
	return state === 'waiting-provider' ? catalog.providerWait : LOCALE_CATALOG[locale].runInspector.stateLabels[state as RunState] ?? state;
}

export function QueueEmptyState({ projectCount, filter, queues, errors, catalog, locale }: { projectCount: number; filter: string | undefined; queues: ProjectQueueView[]; errors: QueueOverviewView['errors']; catalog: OverviewCatalog['queues']; locale: Locale }): React.ReactElement | null {
	if (projectCount === 0) return <EmptyState>{catalog.empty}</EmptyState>;
	if (queues.length > 0) return null;
	const filteredError = filter !== undefined && errors.some((error) => error.projectId === filter);
	if (filteredError || filter === undefined) return null;
	return <EmptyState>{locale === 'pt-BR' ? 'Nenhuma fila corresponde ao projeto selecionado.' : 'No queue matches the selected project.'}</EmptyState>;
}

const STATUS_BADGE: Readonly<Record<QueueStatus, BadgeVariant>> = { 'needs-you': 'attention', running: 'info', paused: 'secondary', ready: 'outline', empty: 'outline' };

/* The one sentence that says what the queue is doing and, when it is stopped, why. */
function QueueStatusLine({ queue, status, catalog, locale, projectHref }: { queue: ProjectQueueView; status: QueueStatus; catalog: OverviewCatalog['queues']; locale: Locale; projectHref: string }): React.ReactElement {
	const reason = queue.pause === null ? null : catalog.pauseReasons[queue.pause.reason] ?? queue.pause.reason;
	const run = queue.currentRun;
	const detail = [
		reason,
		status === 'paused' ? catalog.automaticResume : null,
		queue.readiness === 'needs-attention' ? LOCALE_CATALOG[locale].projects.readiness[queue.readiness] : null,
	].filter((part): part is string => part !== null);
	return (
		<p className="flex min-w-0 flex-wrap items-center gap-2 text-sm" data-slot="queue-status">
			<Badge variant={STATUS_BADGE[status]}>{catalog.status[status]}</Badge>
			{run === null ? null : <a className={cn(TEXT_LINK_CLASS, 'font-mono text-xs')} href={`${projectHref}/runs/${encodeURIComponent(run.id)}`}>{run.issueId} · {runStateLabel(run.state, locale, catalog)}</a>}
			{detail.length === 0 ? null : <span className="text-muted-foreground">{detail.join(' · ')}</span>}
		</p>
	);
}

function QueueSequence({ queue, catalog, locale, projectHref }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale; projectHref: string }): React.ReactElement | null {
	/* The service plans only what is approved, open and unblocked, so an issue
	 * can be running and no longer planned (blocked or respecified after it
	 * started). It still leads the list, unnumbered: it holds no place in the
	 * order, it is simply what is happening. */
	const running = queue.currentIssue !== null && !queue.plannedIssues.some((issue) => issue.id === queue.currentIssue?.id) ? queue.currentIssue : null;
	const rows = [...(running === null ? [] : [{ issue: running, order: null }]), ...queue.plannedIssues.map((issue, index) => ({ issue, order: index + 1 }))];
	if (rows.length === 0) return null;
	return (
		<ol aria-label={catalog.sequence} className="divide-y divide-border border-t" data-slot="queue-sequence">
			{rows.map(({ issue, order }) => (
				<li className="flex min-h-8 items-center gap-3 px-4 py-1 text-sm" key={issue.id}>
					<span className="w-4 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">{order}</span>
					<a className={cn(TEXT_LINK_CLASS, 'shrink-0 font-mono text-xs')} href={`${projectHref}/work#${encodeURIComponent(issue.id)}`}>{issue.id}</a>
					<span className="min-w-0 flex-1 truncate" title={issue.title}>{issue.title}</span>
					{queue.currentIssue?.id === issue.id && queue.currentRun !== null ? <Badge variant="info">{runStateLabel(queue.currentRun.state, locale, catalog)}</Badge> : null}
					{queue.nextIssue?.id === issue.id && queue.currentIssue?.id !== issue.id ? <span className="shrink-0 text-muted-foreground text-xs">{catalog.next}</span> : null}
				</li>
			))}
		</ol>
	);
}

function QueueFacts({ queue, catalog, locale, projectHref }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale; projectHref: string }): React.ReactElement {
	const delivery = queue.lastDelivery.state === 'available' ? queue.lastDelivery.run : null;
	const missing = queue.lastDelivery.state === 'unavailable' ? (locale === 'pt-BR' ? 'Histórico de entregas indisponível.' : 'Delivery history unavailable.') : catalog.noDelivery;
	return (
		<dl className="flex flex-wrap gap-x-6 gap-y-1 border-t px-4 py-2 text-muted-foreground text-xs" data-slot="queue-facts">
			<div className="flex items-center gap-2"><dt>{catalog.lastDelivery}</dt><dd>{delivery === null ? missing : <span className="inline-flex items-center gap-2"><a className={cn(TEXT_LINK_CLASS, 'font-mono')} href={`${projectHref}/runs/${encodeURIComponent(delivery.id)}`}>{delivery.issueId}</a><time className="font-mono tabular-nums" dateTime={delivery.updatedAt}>{formatRunTimestamp(delivery.updatedAt, locale)}</time></span>}</dd></div>
			<div className="flex items-center gap-2"><dt>{catalog.chain}</dt><dd>{queue.chainEnabled ? catalog.enabled : <a className={TEXT_LINK_CLASS} href={`${projectHref}/settings`}>{catalog.disabled}</a>}</dd></div>
		</dl>
	);
}

/* One project's queue: what it is doing, the ordered work, and two facts. The
 * sequence is the page, so nothing hides it behind a disclosure. A queue that
 * waits on the operator carries the acid rule, the product's one acid signal. */
export function QueueRow({ queue, catalog, locale }: { queue: ProjectQueueView; catalog: OverviewCatalog['queues']; locale: Locale }): React.ReactElement {
	const projectHref = `/projects/${encodeURIComponent(queue.project.id)}`;
	const status = queueStatus(queue);
	return (
		<section aria-label={queue.project.name} className={cn('overflow-hidden rounded-lg border bg-card', status === 'needs-you' && 'shadow-attention-rule')} data-slot="queue" data-status={status}>
			<header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
				<h2 className="type-editorial-title min-w-32 text-base"><a className={TITLE_LINK_CLASS} href={`${projectHref}/work`}>{queue.project.name}</a></h2>
				<QueueStatusLine catalog={catalog} locale={locale} projectHref={projectHref} queue={queue} status={status} />
				<span className="ml-auto font-mono text-muted-foreground text-xs tabular-nums">{catalog.queued(queue.plannedIssues.length)}</span>
			</header>
			<QueueSequence catalog={catalog} locale={locale} projectHref={projectHref} queue={queue} />
			<QueueFacts catalog={catalog} locale={locale} projectHref={projectHref} queue={queue} />
		</section>
	);
}

export function OverviewQueuesSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overview;
	const queueCatalog = catalog.queues;
	const [data, setData] = useState<QueueOverviewView | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [retryAttempt, setRetryAttempt] = useState(0);
	const [filter, setFilter] = useState<string | undefined>(() => projectFilter());
	useEffect(() => { let disposed = false; let timeout: ReturnType<typeof setTimeout> | undefined; let controller: AbortController | undefined; const read = (): void => { controller = new AbortController(); void fetchOverviewQueues(controller.signal).then((value) => { if (!disposed) { setData(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) timeout = setTimeout(read, 15_000); }); }; read(); return () => { disposed = true; controller?.abort(); if (timeout !== undefined) clearTimeout(timeout); }; }, [retryAttempt]);
	useEffect(() => { const onPop = (): void => setFilter(projectFilter()); runtime().addEventListener?.('popstate', onPop); return () => runtime().removeEventListener?.('popstate', onPop); }, []);
	const queues = sortQueuesByUrgency(data?.queues.filter((queue) => filter === undefined || queue.project.id === filter) ?? []);
	const errors = queueErrorsForFilter(data?.errors ?? [], filter);
	return <SurfaceColumn label={queueCatalog.title} status={props.status}>
		{data === null && error === null ? <div role="status" aria-label={queueCatalog.loading}><Skeleton className="h-28 w-full" /><span className="sr-only">{queueCatalog.loading}</span></div> : null}
		{error !== null ? <Alert variant="destructive"><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>{queueCatalog.error}</AlertTitle><AlertDescription>{error}</AlertDescription><AlertAction><Button size="sm" type="button" variant="outline" onClick={() => setRetryAttempt((attempt) => attempt + 1)}>{queueCatalog.retry}</Button></AlertAction></Alert> : null}
		{data !== null ? <QueueEmptyState catalog={queueCatalog} errors={errors} filter={filter} locale={props.locale} projectCount={props.projects.length} queues={queues} /> : null}
		<div className="flex flex-col gap-4">{queues.map((queue) => <QueueRow catalog={queueCatalog} key={queue.project.id} locale={props.locale} queue={queue} />)}</div>
		{errors.map((item) => <Alert key={item.projectId} variant="warning"><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>{item.projectName}</AlertTitle><AlertDescription>{queueCatalog.unavailable}</AlertDescription></Alert>)}
	</SurfaceColumn>;
}

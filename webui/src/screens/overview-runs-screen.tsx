import React, { useEffect, useState } from 'react';
import type { OverviewRunsPageView, OverviewRunsQuery } from '../client.ts';
import { fetchOverviewRuns } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Input } from '../components/ui/input.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import { toneOf } from '../run-view.ts';
import type { RunState } from '../run-view.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ControlCenterNavigation } from './overview-screen.tsx';
import { ciBadgeVariant } from './runs.tsx';

interface OverviewBrowserRuntime {
	location?: { search: string };
	history?: { pushState: (data: null, unused: string, url: string) => void };
	addEventListener?: (type: 'popstate', listener: () => void) => void;
	removeEventListener?: (type: 'popstate', listener: () => void) => void;
}

function browserRuntime(): OverviewBrowserRuntime {
	return globalThis as unknown as OverviewBrowserRuntime;
}

function queryFromUrl(runtime = browserRuntime()): OverviewRunsQuery {
	const params = new URLSearchParams(runtime.location?.search ?? '');
	const value = (key: string): string | undefined => params.get(key) ?? undefined;
	return { projectId: value('projectId'), state: value('state') as OverviewRunsQuery['state'], providerId: value('providerId') as OverviewRunsQuery['providerId'], period: value('period') as OverviewRunsQuery['period'], search: value('search'), limit: 20, offset: Number(value('offset') ?? 0) || 0 };
}

function duration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms)) return '—';
	const seconds = Math.round(ms / 1000);
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function overviewRunsUrl(query: OverviewRunsQuery): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== '' && !(key === 'limit' && value === 20) && !(key === 'offset' && value === 0)) params.set(key, String(value));
	}
	return `/overview/runs${params.toString() ? `?${params}` : ''}`;
}

function useOverviewRunsQuery(): [OverviewRunsQuery, (changes: Partial<OverviewRunsQuery>) => void] {
	const [query, setQuery] = useState<OverviewRunsQuery>(() => queryFromUrl());
	useEffect(() => {
		const onPop = () => setQuery(queryFromUrl());
		const runtime = browserRuntime();
		runtime.addEventListener?.('popstate', onPop);
		return () => runtime.removeEventListener?.('popstate', onPop);
	}, []);
	const update = (changes: Partial<OverviewRunsQuery>): void => {
		const next = { ...query, ...changes, offset: changes.offset ?? 0 };
		browserRuntime().history?.pushState(null, '', overviewRunsUrl(next));
		setQuery(next);
	};
	return [query, update];
}

function useOverviewRunsPage(query: OverviewRunsQuery): { page: OverviewRunsPageView | null; loading: boolean; error: string | null } {
	const [page, setPage] = useState<OverviewRunsPageView | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		let disposed = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const read = (): void => {
			setLoading(true);
			void fetchOverviewRuns(query, controller.signal).then((value) => { if (!disposed) { setPage(value); setError(null); } }).catch((reason: unknown) => {
				if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason));
			}).finally(() => {
				if (!disposed) {
					setLoading(false);
					timeout = setTimeout(read, 15_000);
				}
			});
		};
		read();
		return () => { disposed = true; controller.abort(); if (timeout !== undefined) clearTimeout(timeout); };
	}, [query]);
	return { page, loading, error };
}

function OverviewRunRow({ run, props }: { run: OverviewRunsPageView['runs'][number]; props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns;
	const inspector = LOCALE_CATALOG[props.locale].runInspector;
	const href = `/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`;
	const ciStatus = run.ci?.status as NonNullable<typeof run.pullRequest>['ciStatus'] | undefined;
	const models = run.roles.flatMap((role) => role.models).join(', ');
	const provider = run.providerId === 'claude' ? 'Claude Code' : 'Codex';
	return <tr className="relative">
		<td className="px-4 py-3"><span className="inline-flex items-center gap-2"><Badge variant={toneOf(run.state as RunState)}>{inspector.stateLabels[run.state as RunState]}</Badge>{run.merge ? <Badge variant="merged">{catalog.merged}</Badge> : null}</span></td>
		<td className="px-4 py-3 font-mono"><a className="after:absolute after:inset-0 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={href}>{run.issueId}<span className="sr-only">, {run.runId}</span></a></td>
		<td className="px-4 py-3">{run.projectName}</td>
		<td className="px-4 py-3 font-mono tabular-nums">{duration(run.evaluation.wallTimeMs)}</td>
		<td className="relative z-10 px-4 py-3">{run.pullRequest ? <a className="underline-offset-2 hover:underline" href={run.pullRequest.url} target="_blank" rel="noreferrer">PR #{run.pullRequest.prNumber}</a> : '—'}</td>
		<td className="px-4 py-3">{ciStatus ? <Badge variant={ciBadgeVariant(ciStatus)}>{inspector.ciLabels[ciStatus]}</Badge> : '—'}</td>
		<td className="hidden px-4 py-3 text-muted-foreground xl:table-cell">{provider}{models === '' ? '' : ` / ${models}`}</td>
	</tr>;
}

function OverviewRunsFilters({ props, query, update }: { props: AppProps; query: OverviewRunsQuery; update: (changes: Partial<OverviewRunsQuery>) => void }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns;
	return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label={catalog.title}>
		<Input aria-label={catalog.search} placeholder={catalog.search} value={query.search ?? ''} onChange={(event) => update({ search: (event.currentTarget as unknown as { value: string }).value })} />
		<select aria-label={catalog.project} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.projectId ?? ''} onChange={(event) => { const value = (event.currentTarget as unknown as { value: string }).value; update({ projectId: value || undefined }); }}><option value="">{catalog.project}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
		<select aria-label={catalog.state} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.state ?? ''} onChange={(event) => { const value = (event.currentTarget as unknown as { value: string }).value; update({ state: value ? value as OverviewRunsQuery['state'] : undefined }); }}><option value="">{catalog.state}</option>{['queued','working','verify','review','full-verify','ready-to-ship','shipping','done','waiting-user','waiting-provider','failed','interrupted','cancelled'].map((state) => <option key={state} value={state}>{state}</option>)}</select>
		<select aria-label={catalog.provider} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.providerId ?? ''} onChange={(event) => { const value = (event.currentTarget as unknown as { value: string }).value; update({ providerId: value ? value as OverviewRunsQuery['providerId'] : undefined }); }}><option value="">{catalog.provider}</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select>
		<select aria-label={catalog.period} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.period ?? 'all'} onChange={(event) => update({ period: (event.currentTarget as unknown as { value: string }).value as OverviewRunsQuery['period'] })}><option value="all">{catalog.all}</option><option value="7d">{catalog.last7d}</option><option value="30d">{catalog.last30d}</option></select>
	</div>;
}

export function OverviewRunsSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns;
	const [query, update] = useOverviewRunsQuery();
	const { page, loading, error } = useOverviewRunsPage(query);
	const rows = page?.runs ?? [];
	const from = page?.page.total === 0 ? 0 : (page?.page.offset ?? 0) + 1;
	const to = (page?.page.offset ?? 0) + rows.length;
	return <SurfaceColumn label={catalog.title} status={props.status}>
		<ControlCenterNavigation current="runs" locale={props.locale} />
		<OverviewRunsFilters props={props} query={query} update={update} />
		{error ? <p role="alert" className="text-destructive-foreground text-sm">{catalog.error}: {error}</p> : null}
		{page !== null && page.errors.length > 0 ? <p role="status" className="text-warning-foreground text-sm">{catalog.partial}</p> : null}
		<div className="scroll-container overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.title}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.state,catalog.issue,catalog.project,catalog.duration,catalog.delivery,catalog.ci].map((label) => <th className="whitespace-nowrap px-4 py-3 font-medium" key={label}>{label}</th>)}<th className="hidden whitespace-nowrap px-4 py-3 font-medium xl:table-cell">{catalog.model}</th></tr></thead><tbody className="divide-y divide-border">
			{rows.map((run) => <OverviewRunRow key={`${run.projectId}:${run.runId}`} props={props} run={run} />)}
		</tbody></table>{!loading && rows.length === 0 ? <p className="p-6 text-center text-muted-foreground text-sm">{catalog.empty}</p> : null}</div>
		<div className="flex items-center justify-between gap-3 text-sm"><span aria-live="polite">{loading ? catalog.loading : page ? catalog.page(from, to, page.page.total) : ''}</span><div className="flex gap-2"><button className="rounded-md border px-3 py-2 disabled:opacity-50" disabled={(page?.page.offset ?? 0) === 0 || loading} onClick={() => update({ offset: Math.max(0, (page?.page.offset ?? 0) - (page?.page.limit ?? 20)) })}>{catalog.previous}</button><button className="rounded-md border px-3 py-2 disabled:opacity-50" disabled={!page || to >= page.page.total || loading} onClick={() => update({ offset: (page?.page.offset ?? 0) + (page?.page.limit ?? 20) })}>{catalog.next}</button></div></div>
	</SurfaceColumn>;
}

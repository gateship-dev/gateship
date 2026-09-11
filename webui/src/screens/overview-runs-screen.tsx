import React, { useEffect, useMemo, useState } from 'react';
import type { ColumnPinningState } from '@tanstack/react-table';
import type { OverviewRunsPageView, OverviewRunsQuery } from '../client.ts';
import { fetchOverviewRuns } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Badge } from '../components/ui/badge.tsx';
import { DataTable, DataTableColumnVisibility, DataTableFilter, DataTablePagination, DataTableToolbar, gateshipTableFeatures, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import { toneOf, type RunState } from '../run-view.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ciBadgeVariant } from './runs.tsx';

interface BrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function browserRuntime(): BrowserRuntime { return globalThis as unknown as BrowserRuntime; }
const RUN_STATES = ['queued', 'working', 'verify', 'review', 'full-verify', 'ready-to-ship', 'shipping', 'done', 'waiting-user', 'waiting-provider', 'failed', 'interrupted', 'cancelled'] as const;
const RUN_SORT_FIELDS = new Set(['updatedAt', 'createdAt', 'projectName', 'issueId', 'state', 'providerId', 'duration', 'cost']);
const TABLE_PREFERENCES_KEY = 'gateship:overview-runs:table:v1';
const RUNS_DEFAULT_PINNING: ColumnPinningState = { start: ['runId'], end: [] };
type RunRow = OverviewRunsPageView['runs'][number];
type OverviewRunsCatalog = (typeof LOCALE_CATALOG)[keyof typeof LOCALE_CATALOG]['overviewRuns'];
type RunInspectorCatalog = (typeof LOCALE_CATALOG)[keyof typeof LOCALE_CATALOG]['runInspector'];

export function queryFromUrl(runtime = browserRuntime()): OverviewRunsQuery {
	const params = new URLSearchParams(runtime.location?.search ?? '');
	const value = (key: string): string | undefined => params.get(key) ?? undefined;
	const allowed = (raw: string | undefined, values: ReadonlySet<string>): string | undefined => raw !== undefined && values.has(raw) ? raw : undefined;
	const positive = (raw: string | undefined, fallback: number): number => { const parsed = Number(raw ?? fallback); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback; };
	const nonNegative = (raw: string | undefined): number => { const parsed = Number(raw ?? 0); return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0; };
	return { projectId: value('projectId'), state: allowed(value('state'), new Set(RUN_STATES)) as OverviewRunsQuery['state'], providerId: allowed(value('providerId'), new Set(['claude', 'codex'])) as OverviewRunsQuery['providerId'], period: allowed(value('period'), new Set(['7d', '30d', 'all'])) as OverviewRunsQuery['period'], search: value('search'), sortBy: allowed(value('sortBy'), RUN_SORT_FIELDS) as OverviewRunsQuery['sortBy'], sortDirection: allowed(value('sortDirection'), new Set(['asc', 'desc'])) as OverviewRunsQuery['sortDirection'], limit: positive(value('limit'), 20), offset: nonNegative(value('offset')) };
}

function overviewRunsUrl(query: OverviewRunsQuery): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '' && !(key === 'limit' && value === 20) && !(key === 'offset' && value === 0)) params.set(key, String(value));
	return `/overview/runs${params.toString() ? `?${params}` : ''}`;
}
function useOverviewRunsQuery(): [OverviewRunsQuery, (changes: Partial<OverviewRunsQuery>) => void] {
	const [query, setQuery] = useState<OverviewRunsQuery>(() => queryFromUrl());
	useEffect(() => { const onPop = () => setQuery(queryFromUrl()); const runtime = browserRuntime(); runtime.addEventListener?.('popstate', onPop); return () => runtime.removeEventListener?.('popstate', onPop); }, []);
	const update = (changes: Partial<OverviewRunsQuery>): void => { const next = { ...query, ...changes, offset: changes.offset ?? 0 }; browserRuntime().history?.pushState(null, '', overviewRunsUrl(next)); setQuery(next); };
	return [query, update];
}
function useOverviewRunsPage(query: OverviewRunsQuery): { page: OverviewRunsPageView | null; loading: boolean; error: string | null } {
	const [page, setPage] = useState<OverviewRunsPageView | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
	useEffect(() => { const controller = new AbortController(); let disposed = false; let timeout: ReturnType<typeof setTimeout> | undefined; const read = (): void => { setLoading(true); void fetchOverviewRuns(query, controller.signal).then((value) => { if (!disposed) { setPage(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) { setLoading(false); timeout = setTimeout(read, 15_000); } }); }; read(); return () => { disposed = true; controller.abort(); if (timeout !== undefined) clearTimeout(timeout); }; }, [query]);
	return { page, loading, error };
}
function duration(ms: number | null): string { if (ms === null || !Number.isFinite(ms)) return '—'; const seconds = Math.round(ms / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function readPreferences(): { columnVisibility?: Record<string, boolean>; columnPinning?: ColumnPinningState; columnSizing?: Record<string, number> } { try { const value: unknown = JSON.parse(globalThis.localStorage?.getItem(TABLE_PREFERENCES_KEY) ?? 'null'); if (value === null || typeof value !== 'object') return {}; const stored = value as ReturnType<typeof readPreferences>; return { ...stored, columnPinning: { start: stored.columnPinning?.start ?? [], end: stored.columnPinning?.end ?? [] } }; } catch { return {}; } }

function overviewRunsColumns(catalog: OverviewRunsCatalog, inspector: RunInspectorCatalog): GateshipColumnDef<RunRow>[] {
	const href = (run: RunRow) => `/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`;
	return [
		{ id: 'runId', accessorKey: 'runId', header: catalog.execution, enableSorting: false, cell: ({ row }) => <a className="font-mono underline-offset-2 hover:underline" href={href(row.original)}>{row.original.runId}</a> },
		{ id: 'state', accessorKey: 'state', header: catalog.state, enableSorting: true, cell: ({ row }) => <span className="inline-flex items-center gap-2"><Badge variant={toneOf(row.original.state as RunState)}>{inspector.stateLabels[row.original.state as RunState]}</Badge>{row.original.merge ? <Badge variant="merged">{catalog.merged}</Badge> : null}</span> },
		{ id: 'issueId', accessorKey: 'issueId', header: catalog.issue, enableSorting: true, cell: ({ row }) => <a className="font-mono underline-offset-2 hover:underline" href={href(row.original)}>{row.original.issueId}<span className="sr-only">, {row.original.runId}</span></a> },
		{ id: 'projectName', accessorKey: 'projectName', header: catalog.project, enableSorting: true },
		{ id: 'duration', accessorFn: (row) => row.evaluation.wallTimeMs ?? -1, header: catalog.duration, enableSorting: true, cell: ({ row }) => <span className="font-mono tabular-nums">{duration(row.original.evaluation.wallTimeMs)}</span> },
		{ id: 'delivery', header: catalog.delivery, cell: ({ row }) => row.original.pullRequest ? <a className="underline-offset-2 hover:underline" href={row.original.pullRequest.url} target="_blank" rel="noreferrer">PR #{row.original.pullRequest.prNumber}</a> : '—' },
		{ id: 'ci', header: catalog.ci, cell: ({ row }) => row.original.ci ? <Badge variant={ciBadgeVariant(row.original.ci.status as NonNullable<RunRow['pullRequest']>['ciStatus'])}>{inspector.ciLabels[row.original.ci.status as keyof typeof inspector.ciLabels]}</Badge> : '—' },
		{ id: 'providerId', accessorKey: 'providerId', header: catalog.model, enableSorting: true, cell: ({ row }) => { const models = row.original.roles.flatMap((role) => role.models).join(', '); return <span>{row.original.providerId === 'claude' ? 'Claude Code' : 'Codex'}{models === '' ? '' : ` / ${models}`}</span>; } },
	];
}

function OverviewRunsFilters({ props, query, update, catalog }: { props: AppProps; query: OverviewRunsQuery; update: (changes: Partial<OverviewRunsQuery>) => void; catalog: OverviewRunsCatalog }): React.ReactElement {
	return <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4" role="search" aria-label={catalog.title}><select aria-label={catalog.project} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.projectId ?? ''} onChange={(event) => update({ projectId: (event.currentTarget as unknown as { value: string }).value || undefined })}><option value="">{catalog.project}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label={catalog.state} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.state ?? ''} onChange={(event) => update({ state: ((event.currentTarget as unknown as { value: string }).value || undefined) as OverviewRunsQuery['state'] })}><option value="">{catalog.state}</option>{RUN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}</select><select aria-label={catalog.provider} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.providerId ?? ''} onChange={(event) => update({ providerId: ((event.currentTarget as unknown as { value: string }).value || undefined) as OverviewRunsQuery['providerId'] })}><option value="">{catalog.provider}</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select><select aria-label={catalog.period} className="min-h-9 rounded-lg border bg-background px-3 text-sm" value={query.period ?? 'all'} onChange={(event) => update({ period: (event.currentTarget as unknown as { value: string }).value as OverviewRunsQuery['period'] })}><option value="all">{catalog.all}</option><option value="7d">{catalog.last7d}</option><option value="30d">{catalog.last30d}</option></select></div>;
}

type RunSorting = { id: string; desc: boolean }[];
type RunPagination = { pageIndex: number; pageSize: number };
function updateRunSorting(value: RunSorting | ((current: RunSorting) => RunSorting), current: RunSorting, update: (changes: Partial<OverviewRunsQuery>) => void): void { const next = typeof value === 'function' ? value(current) : value; const first = next[0]; update({ sortBy: first?.id as OverviewRunsQuery['sortBy'] | undefined, sortDirection: first === undefined ? undefined : first.desc ? 'desc' : 'asc' }); }
function updateRunPagination(value: RunPagination | ((current: RunPagination) => RunPagination), current: RunPagination, update: (changes: Partial<OverviewRunsQuery>) => void): void { const next = typeof value === 'function' ? value(current) : value; update({ limit: next.pageSize, offset: next.pageSize === current.pageSize ? next.pageIndex : 0 }); }

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the screen owns one controlled table query boundary
function OverviewRunsTable({ props, query, update, page, loading, error }: { props: AppProps; query: OverviewRunsQuery; update: (changes: Partial<OverviewRunsQuery>) => void; page: OverviewRunsPageView | null; loading: boolean; error: string | null }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns; const inspector = LOCALE_CATALOG[props.locale].runInspector;
	const [preferences] = useState(readPreferences); const [columnVisibility, setColumnVisibility] = useState(preferences.columnVisibility ?? {}); const [columnPinning, setColumnPinning] = useState<ColumnPinningState>(preferences.columnPinning ?? RUNS_DEFAULT_PINNING); const [columnSizing, setColumnSizing] = useState(preferences.columnSizing ?? {});
	const rows = page?.runs ?? [];
	const columns = useMemo(() => overviewRunsColumns(catalog, inspector), [catalog, inspector]);
	const sorting: RunSorting = query.sortBy === undefined ? [] : [{ id: query.sortBy, desc: query.sortDirection === 'desc' }]; const pagination: RunPagination = { pageIndex: 0, pageSize: query.limit ?? 20 };
	const table = useGateshipTable({ columns, data: rows, features: gateshipTableFeatures, getRowId: (row) => `${row.projectId}:${row.runId}`, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: page?.page.total ?? 0, state: { globalFilter: query.search ?? '', sorting, pagination, columnVisibility, columnPinning, columnSizing }, onGlobalFilterChange: (value) => update({ search: String(value ?? '') || undefined }), onSortingChange: (value) => updateRunSorting(value, sorting, update), onPaginationChange: (value) => updateRunPagination(value, pagination, update), onColumnVisibilityChange: (value) => setColumnVisibility(typeof value === 'function' ? value(columnVisibility) : value), onColumnPinningChange: (value) => setColumnPinning(typeof value === 'function' ? value(columnPinning) : value), onColumnSizingChange: (value) => setColumnSizing(typeof value === 'function' ? value(columnSizing) : value) });
	useEffect(() => { try { globalThis.localStorage?.setItem(TABLE_PREFERENCES_KEY, JSON.stringify({ version: 1, columnVisibility, columnPinning, columnSizing })); } catch { /* storage is optional */ } }, [columnVisibility, columnPinning, columnSizing]);
	return <><DataTableToolbar><DataTableFilter className="flex-1" label={catalog.search} placeholder={catalog.search} locale={props.locale} table={table} /><DataTableColumnVisibility defaultColumnPinning={RUNS_DEFAULT_PINNING} locale={props.locale} table={table} /></DataTableToolbar><OverviewRunsFilters props={props} query={query} update={update} catalog={catalog} />{error ? <p role="alert" className="text-destructive-foreground text-sm">{catalog.error}: {error}</p> : null}{page !== null && page.errors.length > 0 ? <p role="status" className="text-warning-foreground text-sm">{catalog.partial}</p> : null}<div className="scroll-container overflow-x-auto rounded-lg border"><DataTable className="min-w-max" error={error ? `${catalog.error}: ${error}` : undefined} emptyState={catalog.empty} locale={props.locale} status={error ? 'error' : loading && page === null ? 'loading' : loading ? 'updating' : 'ready'} table={table} /><DataTablePagination locale={props.locale} offset={page?.page.offset ?? query.offset ?? 0} total={page?.page.total ?? 0} onOffsetChange={(offset) => update({ offset })} onPageSizeChange={(limit) => update({ limit, offset: 0 })} table={table} /></div>{page ? <p aria-live="polite" className="text-sm text-muted-foreground">{loading ? `${catalog.loading} ` : ''}{catalog.page((page.page.offset ?? 0) + 1, (page.page.offset ?? 0) + rows.length, page.page.total)}</p> : null}</>;
}

export function OverviewRunsSurface({ props }: { props: AppProps }): React.ReactElement { const catalog = LOCALE_CATALOG[props.locale].overviewRuns; const [query, update] = useOverviewRunsQuery(); const result = useOverviewRunsPage(query); return <SurfaceColumn label={catalog.title} status={props.status}><OverviewRunsTable {...{ props, query, update }} {...result} /></SurfaceColumn>; }

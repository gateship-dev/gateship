// webui/src/screens/overview-runs-screen.tsx
//
// Every project's runs in one table (shadcn data table recipe on TanStack
// Table v9, server-side filtering, sorting and paging). The row's identity
// is the issue; the run id is secondary. Quick views sit above the filters
// because they are the operator's first question: what moves, what waits on
// me, what shipped, what failed. Rows that wait on the operator carry the
// acid rule, the product's one acid signal.

import { Alert02Icon, Copy01Icon, LinkSquare02Icon, MoreHorizontalIcon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import React, { useEffect, useMemo, useState } from 'react';
import type { OverviewRunsPageView, OverviewRunsQuery } from '../client.ts';
import { fetchOverviewRuns } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { DataTable, DataTableFilter, DataTablePagination, DataTableToolbar, DataTableViewOptions, gateshipTableFeatures, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../components/ui/dropdown-menu.tsx';
import { SelectField } from '../components/ui/select.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { HintTooltip } from '../components/ui/tooltip.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import type { Locale, OverviewRunsCatalog, RunInspectorCatalog } from '../locale.ts';
import { toneOf, type RunState } from '../run-view.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ciBadgeVariant, formatCostUsd } from './runs.tsx';

interface BrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function browserRuntime(): BrowserRuntime { return globalThis as unknown as BrowserRuntime; }
const RUN_STATES = ['queued', 'working', 'verify', 'review', 'full-verify', 'ready-to-ship', 'shipping', 'done', 'waiting-user', 'waiting-provider', 'failed', 'interrupted', 'cancelled'] as const;
const RUN_GROUPS = ['active', 'needs-you', 'shipped', 'failed'] as const;
const RUN_SORT_FIELDS = new Set(['updatedAt', 'createdAt', 'projectName', 'issueId', 'state', 'providerId', 'duration', 'cost']);
/* Mirrors the `needs-you` group in src/runtime/run-overview.ts and the shell's attention map. */
const NEEDS_YOU: ReadonlySet<string> = new Set(['ready-to-ship', 'waiting-user', 'waiting-provider', 'failed', 'interrupted']);
const TABLE_PREFERENCES_KEY = 'gateship:overview-runs:table:v3';
/* Lean by default: the audit columns are one menu away. */
const DEFAULT_VISIBILITY: Record<string, boolean> = { providerId: false, orchestratorModels: false, executorModels: false, reviewerModels: false, rounds: false, interventions: false, cost: false, runId: false };
type RunRow = OverviewRunsPageView['runs'][number];
type Update = (changes: Partial<OverviewRunsQuery>) => void;

export function queryFromUrl(runtime = browserRuntime()): OverviewRunsQuery {
	const params = new URLSearchParams(runtime.location?.search ?? '');
	const value = (key: string): string | undefined => params.get(key) ?? undefined;
	const allowed = (raw: string | undefined, values: ReadonlySet<string>): string | undefined => raw !== undefined && values.has(raw) ? raw : undefined;
	const positive = (raw: string | undefined, fallback: number): number => { const parsed = Number(raw ?? fallback); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback; };
	const nonNegative = (raw: string | undefined): number => { const parsed = Number(raw ?? 0); return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0; };
	return { projectId: value('projectId'), state: allowed(value('state'), new Set(RUN_STATES)) as OverviewRunsQuery['state'], group: allowed(value('group'), new Set(RUN_GROUPS)) as OverviewRunsQuery['group'], providerId: allowed(value('providerId'), new Set(['claude', 'codex'])) as OverviewRunsQuery['providerId'], period: allowed(value('period'), new Set(['7d', '30d', 'all'])) as OverviewRunsQuery['period'], search: value('search'), sortBy: allowed(value('sortBy'), RUN_SORT_FIELDS) as OverviewRunsQuery['sortBy'], sortDirection: allowed(value('sortDirection'), new Set(['asc', 'desc'])) as OverviewRunsQuery['sortDirection'], limit: positive(value('limit'), 20), offset: nonNegative(value('offset')) };
}

/* A project's own runs page is this same table with the project fixed by its path, not by a parameter. */
function overviewRunsUrl(query: OverviewRunsQuery, scopeProjectId?: string): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '' && !(key === 'limit' && value === 20) && !(key === 'offset' && value === 0) && !(key === 'projectId' && scopeProjectId !== undefined)) params.set(key, String(value));
	const path = scopeProjectId === undefined ? '/overview/runs' : `/projects/${encodeURIComponent(scopeProjectId)}/runs`;
	return `${path}${params.toString() ? `?${params}` : ''}`;
}
function useOverviewRunsQuery(scopeProjectId?: string): [OverviewRunsQuery, Update] {
	const read = (): OverviewRunsQuery => scopeProjectId === undefined ? queryFromUrl() : { ...queryFromUrl(), projectId: scopeProjectId };
	const [query, setQuery] = useState<OverviewRunsQuery>(read);
	useEffect(() => { const onPop = () => setQuery(read()); const runtime = browserRuntime(); runtime.addEventListener?.('popstate', onPop); return () => runtime.removeEventListener?.('popstate', onPop); }, [scopeProjectId]);
	const update: Update = (changes) => { const next = { ...query, ...changes, offset: changes.offset ?? 0, ...(scopeProjectId === undefined ? {} : { projectId: scopeProjectId }) }; browserRuntime().history?.pushState(null, '', overviewRunsUrl(next, scopeProjectId)); setQuery(next); };
	return [query, update];
}
function useOverviewRunsPage(query: OverviewRunsQuery, revision: number): { page: OverviewRunsPageView | null; loading: boolean; error: string | null } {
	const [page, setPage] = useState<OverviewRunsPageView | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
	useEffect(() => { const controller = new AbortController(); let disposed = false; let timeout: ReturnType<typeof setTimeout> | undefined; const read = (): void => { setLoading(true); void fetchOverviewRuns(query, controller.signal).then((value) => { if (!disposed) { setPage(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) { setLoading(false); timeout = setTimeout(read, 15_000); } }); }; read(); return () => { disposed = true; controller.abort(); if (timeout !== undefined) clearTimeout(timeout); }; }, [query, revision]);
	return { page, loading, error };
}
function duration(ms: number | null): string { if (ms === null || !Number.isFinite(ms)) return '—'; const seconds = Math.round(ms / 1000); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`; }
function readPreferences(): Record<string, boolean> { try { const value: unknown = JSON.parse(globalThis.localStorage?.getItem(TABLE_PREFERENCES_KEY) ?? 'null'); const stored = value !== null && typeof value === 'object' ? (value as { columnVisibility?: Record<string, boolean> }).columnVisibility : undefined; return stored ?? DEFAULT_VISIBILITY; } catch { return DEFAULT_VISIBILITY; } }
function runHref(run: RunRow): string { return `/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`; }
export function formatDate(value: string, locale: Locale): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' });
}
export function formatTime(value: string, locale: Locale): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
}
/**
 * The server computes the active duration; a service older than that field
 * still sends the evaluation, so the row derives the same figure from it
 * rather than showing nothing.
 */
function activeDuration(run: RunRow): number | null {
	if (run.activeDurationMs !== undefined) return run.activeDurationMs;
	const wall = run.evaluation.wallTimeMs;
	return wall === null ? null : Math.max(0, wall - (run.evaluation.phaseDurations['waiting-user']?.durationMs ?? 0));
}
/** The models one role ran, as the provider names them; a run before role tracking says nothing. */
function roleModels(run: RunRow, role: RunRow['roles'][number]['role']): string {
	return [...new Set(run.roles.filter((entry) => entry.role === role).flatMap((entry) => entry.models))].join(', ');
}

/* One badge per row (H4): the merge is the outcome, so a merged run says
 * "merged" and nothing else; every other row says its state. A failed row
 * carries its recorded error in the tooltip. */
function StateBadge({ run, catalog, inspector }: { run: RunRow; catalog: OverviewRunsCatalog; inspector: RunInspectorCatalog }): React.ReactElement {
	const state = run.state as RunState;
	const badge = run.merge ? <Badge variant="merged">{catalog.merged}</Badge> : <Badge variant={toneOf(state)}>{inspector.stateLabels[state]}</Badge>;
	if (!run.error) return badge;
	return <HintTooltip label={run.error} side="bottom"><span className="inline-flex" tabIndex={0}>{badge}<span className="sr-only">: {run.error}</span></span></HintTooltip>;
}

function RowActions({ run, catalog }: { run: RunRow; catalog: OverviewRunsCatalog }): React.ReactElement {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button aria-label={catalog.actions} className="size-6 sm:size-6" size="icon" type="button" variant="ghost" />}>
				<HugeiconsIcon aria-hidden="true" icon={MoreHorizontalIcon} size={16} strokeWidth={2.25} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44">
				<DropdownMenuItem render={<a href={runHref(run)} />}>{catalog.openRun}</DropdownMenuItem>
				{run.pullRequest ? <DropdownMenuItem render={<a href={run.pullRequest.url} rel="noreferrer" target="_blank" />}>{catalog.openPullRequest}<HugeiconsIcon aria-hidden="true" className="ml-auto opacity-70" icon={LinkSquare02Icon} size={16} strokeWidth={2.25} /></DropdownMenuItem> : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => { void (globalThis as unknown as { navigator?: { clipboard?: { writeText: (text: string) => Promise<void> } } }).navigator?.clipboard?.writeText(run.runId); }}><HugeiconsIcon icon={Copy01Icon} size={16} strokeWidth={2.25} />{catalog.copyRunId}<span className="ml-auto font-mono text-muted-foreground text-xs">{run.runId.slice(0, 8)}</span></DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function overviewRunsColumns(catalog: OverviewRunsCatalog, inspector: RunInspectorCatalog, locale: Locale): GateshipColumnDef<RunRow>[] {
	const mono = 'font-mono tabular-nums';
	const muted = <span className="text-muted-foreground">—</span>;
	const models = (role: RunRow['roles'][number]['role'], header: string): GateshipColumnDef<RunRow> => ({ id: `${role}Models`, accessorFn: (row) => roleModels(row, role), header, enableSorting: false, meta: { className: 'font-mono text-xs' }, cell: ({ row }) => roleModels(row.original, role) || muted });
	return [
		{ id: 'issueId', accessorKey: 'issueId', header: catalog.issue, enableSorting: true, enableHiding: false, cell: ({ row }) => <a className="font-medium font-mono underline-offset-4 hover:underline" href={runHref(row.original)}>{row.original.issueId}</a> },
		/* The short id is what an operator reads aloud or pastes; the whole id is one column away. */
		{ id: 'run', accessorKey: 'runId', header: catalog.run, enableSorting: false, meta: { className: 'font-mono text-muted-foreground text-xs' }, cell: ({ row }) => <span title={row.original.runId}>{row.original.runId.slice(0, 8)}</span> },
		{ id: 'state', accessorKey: 'state', header: catalog.state, enableSorting: true, cell: ({ row }) => <StateBadge catalog={catalog} inspector={inspector} run={row.original} /> },
		{ id: 'projectName', accessorKey: 'projectName', header: catalog.project, enableSorting: true },
		/* A merged pull request already passed CI; the badge only says something while the PR is open. */
		{ id: 'delivery', header: catalog.delivery, enableSorting: false, cell: ({ row }) => row.original.pullRequest ? <span className="inline-flex items-center gap-2"><a className="inline-flex items-center gap-1 underline-offset-4 hover:underline" href={row.original.pullRequest.url} rel="noreferrer" target="_blank">PR #{row.original.pullRequest.prNumber}<HugeiconsIcon aria-hidden="true" className="size-3.5 opacity-60" icon={LinkSquare02Icon} size={14} strokeWidth={2.25} /></a>{row.original.ci && !row.original.merge ? <Badge variant={ciBadgeVariant(row.original.ci.status as NonNullable<RunRow['pullRequest']>['ciStatus'])}>{inspector.ciLabels[row.original.ci.status as keyof typeof inspector.ciLabels]}</Badge> : null}</span> : muted },
		/* Active time: the wall clock minus the wait on the operator, computed by the server so the sort agrees. */
		{ id: 'duration', accessorFn: (row) => activeDuration(row) ?? -1, header: catalog.duration, enableSorting: true, meta: { className: mono, align: 'end' }, cell: ({ row }) => duration(activeDuration(row.original)) },
		{ id: 'updatedAt', accessorKey: 'updatedAt', header: catalog.date, enableSorting: true, meta: { className: `${mono} text-muted-foreground` }, cell: ({ row }) => <time dateTime={row.original.updatedAt}>{formatDate(row.original.updatedAt, locale)}</time> },
		{ id: 'updatedTime', accessorKey: 'updatedAt', header: catalog.time, enableSorting: false, meta: { className: `${mono} text-muted-foreground` }, cell: ({ row }) => <time dateTime={row.original.updatedAt}>{formatTime(row.original.updatedAt, locale)}</time> },
		{ id: 'providerId', accessorKey: 'providerId', header: catalog.provider, enableSorting: true, cell: ({ row }) => row.original.providerId === 'claude' ? 'Claude Code' : 'Codex' },
		models('orchestrator', catalog.roles.orchestrator),
		models('executor', catalog.roles.executor),
		models('reviewer', catalog.roles.reviewer),
		{ id: 'rounds', accessorFn: (row) => row.evaluation.corrections.total, header: catalog.rounds, enableSorting: false, meta: { className: mono, align: 'end' } },
		{ id: 'interventions', accessorFn: (row) => row.evaluation.operatorInterventions, header: catalog.interventions, enableSorting: false, meta: { className: mono, align: 'end' } },
		{ id: 'cost', accessorFn: (row) => row.cost.totalCostUsd ?? -1, header: catalog.cost, enableSorting: true, meta: { className: mono, align: 'end' }, cell: ({ row }) => row.original.cost.totalCostUsd === null ? muted : formatCostUsd(row.original.cost.totalCostUsd, locale, 2) },
		{ id: 'runId', accessorKey: 'runId', header: catalog.runId, enableSorting: false, meta: { className: 'font-mono text-muted-foreground text-xs' } },
		{ id: 'actions', header: () => <span className="sr-only">{catalog.actions}</span>, enableSorting: false, enableHiding: false, meta: { className: 'w-10', align: 'end' }, cell: ({ row }) => <RowActions catalog={catalog} run={row.original} /> },
	];
}

function hasFilters(query: OverviewRunsQuery, scopeProjectId?: string): boolean {
	return Boolean(query.search) || query.projectId !== scopeProjectId || query.state !== undefined || query.providerId !== undefined || (query.period !== undefined && query.period !== 'all');
}

/* No project select: the sidebar switcher is the project filter. A `?projectId=` link still scopes the list, and Clear filters lifts it. */
function OverviewRunsFilters({ query, update, catalog, inspector, scopeProjectId }: { query: OverviewRunsQuery; update: Update; catalog: OverviewRunsCatalog; inspector: RunInspectorCatalog; scopeProjectId?: string }): React.ReactElement {
	const select = 'w-auto min-w-36';
	return (
		<>
			<SelectField aria-label={catalog.state} className={select} items={[{ value: '', label: catalog.state }, ...RUN_STATES.map((state) => ({ value: state, label: inspector.stateLabels[state] }))]} value={query.state ?? ''} onValueChange={(value) => update({ state: (value || undefined) as OverviewRunsQuery['state'] })} />
			<SelectField aria-label={catalog.provider} className={select} items={[{ value: '', label: catalog.provider }, { value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} value={query.providerId ?? ''} onValueChange={(value) => update({ providerId: (value || undefined) as OverviewRunsQuery['providerId'] })} />
			<SelectField aria-label={catalog.period} className={select} items={[{ value: 'all', label: catalog.all }, { value: '7d', label: catalog.last7d }, { value: '30d', label: catalog.last30d }]} value={query.period ?? 'all'} onValueChange={(value) => update({ period: value as OverviewRunsQuery['period'] })} />
			{hasFilters(query, scopeProjectId) ? (
				<Button type="button" variant="ghost" onClick={() => update({ search: undefined, projectId: undefined, state: undefined, providerId: undefined, period: undefined })}>
					{catalog.clearFilters}<HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} size={14} strokeWidth={2.5} />
				</Button>
			) : null}
		</>
	);
}

function QuickViews({ query, update, catalog }: { query: OverviewRunsQuery; update: Update; catalog: OverviewRunsCatalog }): React.ReactElement {
	const views: readonly { value: OverviewRunsQuery['group'] | 'all'; label: string }[] = [
		{ value: 'all', label: catalog.views.all }, { value: 'active', label: catalog.views.active }, { value: 'needs-you', label: catalog.views.needsYou }, { value: 'shipped', label: catalog.views.shipped }, { value: 'failed', label: catalog.views.failed },
	];
	return (
		<ToggleGroup aria-label={catalog.viewsLabel} className="flex-wrap" data-slot="overview-runs-views" spacing={1} value={[query.group ?? 'all']} variant="outline" onValueChange={(value) => { const next = value[0]; if (next !== undefined) update({ group: next === 'all' ? undefined : next as OverviewRunsQuery['group'] }); }}>
			{views.map((view) => <ToggleGroupItem aria-label={view.label} key={view.value} value={view.value ?? 'all'}>{view.label}</ToggleGroupItem>)}
		</ToggleGroup>
	);
}

type RunSorting = { id: string; desc: boolean }[];
type RunPagination = { pageIndex: number; pageSize: number };
function updateRunSorting(value: RunSorting | ((current: RunSorting) => RunSorting), current: RunSorting, update: Update): void { const next = typeof value === 'function' ? value(current) : value; const first = next[0]; update({ sortBy: first?.id as OverviewRunsQuery['sortBy'] | undefined, sortDirection: first === undefined ? undefined : first.desc ? 'desc' : 'asc' }); }
function updateRunPagination(value: RunPagination | ((current: RunPagination) => RunPagination), current: RunPagination, update: Update): void { const next = typeof value === 'function' ? value(current) : value; update({ limit: next.pageSize, offset: next.pageSize === current.pageSize ? next.pageIndex * next.pageSize : 0 }); }

function useOverviewRunsTable({ catalog, inspector, locale, query, update, page }: { catalog: OverviewRunsCatalog; inspector: RunInspectorCatalog; locale: Locale; query: OverviewRunsQuery; update: Update; page: OverviewRunsPageView | null }): ReturnType<typeof useGateshipTable<RunRow>> {
	const [columnVisibility, setColumnVisibility] = useState(readPreferences);
	const columns = useMemo(() => overviewRunsColumns(catalog, inspector, locale), [catalog, inspector, locale]);
	/* The server's default order is the newest change first; the header shows it as such. */
	const sorting: RunSorting = [{ id: query.sortBy ?? 'updatedAt', desc: (query.sortDirection ?? 'desc') === 'desc' }];
	const pagination: RunPagination = { pageIndex: Math.floor((query.offset ?? 0) / (query.limit ?? 20)), pageSize: query.limit ?? 20 };
	const table = useGateshipTable({
		columns, data: page?.runs ?? [], features: gateshipTableFeatures, getRowId: (row) => `${row.projectId}:${row.runId}`,
		manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: page?.page.total ?? 0,
		/* A project filter makes the project column say one thing on every row. */
		state: { globalFilter: query.search ?? '', sorting, pagination, columnVisibility: { ...columnVisibility, projectName: query.projectId === undefined && (columnVisibility.projectName ?? true) } },
		onGlobalFilterChange: (value) => update({ search: String(value ?? '') || undefined }),
		onSortingChange: (value) => updateRunSorting(value, sorting, update),
		onPaginationChange: (value) => updateRunPagination(value, pagination, update),
		onColumnVisibilityChange: (value) => setColumnVisibility(typeof value === 'function' ? value(columnVisibility) : value),
	});
	useEffect(() => { try { globalThis.localStorage?.setItem(TABLE_PREFERENCES_KEY, JSON.stringify({ version: 2, columnVisibility })); } catch { /* storage is optional */ } }, [columnVisibility]);
	return table;
}

function OverviewRunsAlerts({ catalog, error, page, onRetry }: { catalog: OverviewRunsCatalog; error: string | null; page: OverviewRunsPageView | null; onRetry: () => void }): React.ReactElement | null {
	if (error !== null) {
		return (
			<Alert variant="destructive">
				<HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} />
				<AlertTitle>{catalog.error}</AlertTitle>
				<AlertDescription>{error}</AlertDescription>
				<AlertAction><Button size="sm" type="button" variant="outline" onClick={onRetry}>{catalog.retry}</Button></AlertAction>
			</Alert>
		);
	}
	if (page === null || page.errors.length === 0) return null;
	return (
		<Alert variant="warning">
			<HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} />
			<AlertTitle>{catalog.partial}</AlertTitle>
			<AlertDescription>{page.errors.map((entry) => <p key={entry.projectId}>{catalog.partialProject(entry.projectName, entry.message)}</p>)}</AlertDescription>
		</Alert>
	);
}

function OverviewRunsTable({ props, query, update, onRetry, page, loading, error, scopeProjectId }: { props: AppProps; query: OverviewRunsQuery; update: Update; onRetry: () => void; page: OverviewRunsPageView | null; loading: boolean; error: string | null; scopeProjectId?: string }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns; const inspector = LOCALE_CATALOG[props.locale].runInspector;
	const table = useOverviewRunsTable({ catalog, inspector, locale: props.locale, query, update, page });
	const status = error !== null && page === null ? 'error' : loading && page === null ? 'loading' : loading ? 'updating' : 'ready';
	const clear = (): void => update({ search: undefined, projectId: undefined, state: undefined, providerId: undefined, period: undefined, group: undefined });
	return (
		<>
			<DataTableToolbar>
				<QuickViews catalog={catalog} query={query} update={update} />
				<DataTableFilter className="sm:max-w-64" locale={props.locale} placeholder={catalog.search} table={table} />
				<DataTableViewOptions locale={props.locale} table={table} />
			</DataTableToolbar>
			<DataTableToolbar>
				<OverviewRunsFilters catalog={catalog} inspector={inspector} query={query} scopeProjectId={scopeProjectId} update={update} />
			</DataTableToolbar>
			<OverviewRunsAlerts catalog={catalog} error={error} page={page} onRetry={onRetry} />
			<DataTable
				emptyAction={hasFilters(query, scopeProjectId) || query.group !== undefined ? <Button size="sm" type="button" variant="outline" onClick={clear}>{catalog.clearFilters}</Button> : undefined}
				emptyDetail={catalog.emptyDetail}
				emptyState={catalog.empty}
				locale={props.locale}
				needsOperator={(run) => NEEDS_YOU.has(run.state)}
				status={status}
				table={table}
			/>
			<DataTablePagination locale={props.locale} offset={page?.page.offset ?? query.offset ?? 0} total={page?.page.total ?? 0} onOffsetChange={(offset) => update({ offset })} onPageSizeChange={(limit) => update({ limit, offset: 0 })} table={table} />
		</>
	);
}

export function OverviewRunsSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewRuns;
	const [query, update] = useOverviewRunsQuery();
	const [revision, setRevision] = useState(0);
	const result = useOverviewRunsPage(query, revision);
	return <SurfaceColumn label={catalog.title} status={props.status}><OverviewRunsTable onRetry={() => setRevision((current) => current + 1)} {...{ props, query, update }} {...result} /></SurfaceColumn>;
}

/** One project's runs: the same table, scoped by the project's path. */
export function ProjectRunsTable({ props, projectId }: { props: AppProps; projectId: string }): React.ReactElement {
	const [query, update] = useOverviewRunsQuery(projectId);
	const [revision, setRevision] = useState(0);
	const result = useOverviewRunsPage(query, revision);
	return <OverviewRunsTable onRetry={() => setRevision((current) => current + 1)} scopeProjectId={projectId} {...{ props, query, update }} {...result} />;
}

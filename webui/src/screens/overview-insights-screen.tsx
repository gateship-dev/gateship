import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SortingState } from '@tanstack/react-table';
import { fetchOverview, type AutonomyDenominatorCode, type AutonomyPercentileMethodCode, type DispatchCeilingReasonCode, type HistoricalOverviewView, type OverviewWindow, type ProjectOperationalOverviewView } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Card, CardPanel, CardTitle } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
import { ChartContainer, ChartLegendContent, ChartTooltipContent, type ChartConfig } from '../components/ui/chart.tsx';
import { DataTable, DataTableColumnVisibility, DataTableFilter, DataTablePagination, DataTableToolbar, gateshipTableFeatures, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { LOCALE_CATALOG, type OverviewInsightsCatalog } from '../locale.ts';
import { SurfaceColumn } from './surface-column.tsx';

const window = globalThis as unknown as { dispatchEvent: (event: Event) => boolean };

function formatDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms)) return '—';
	const minutes = Math.round(ms / 60_000);
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(value: number | null): string { return value === null ? '—' : `$${value.toFixed(2)}`; }
function formatTokens(value: number | null, locale: AppProps['locale']): string { return value === null ? '—' : value.toLocaleString(locale); }
function formatRevision(value: string | null): string { return value === null ? 'unknown' : value.length <= 12 ? value : `${value.slice(0, 8)}…`; }
function formatDateTime(value: string | null | undefined, locale: AppProps['locale']): string { return value == null ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function metric(value: { count: number; denominator: number }): string { return `${value.count}/${value.denominator}`; }
function knownMetric(value: { count: number; denominator: number }): string { return value.denominator === 0 ? '—' : metric(value); }
function distribution(value: { median: number | null; p90: number | null; known: number; denominator: number }, medianLabel: string): string { return `${medianLabel} ${formatDuration(value.median)} · p90 ${formatDuration(value.p90)} · ${value.known}/${value.denominator}`; }
function distributions(items: Record<string, { median: number | null; p90: number | null; known: number; denominator: number }>, medianLabel: string): string { return Object.entries(items).map(([key, value]) => `${key}: ${distribution(value, medianLabel)}`).join(' · '); }
function comparative(value: { median: number | null; p90: number | null; max: number | null; known: number; denominator: number }, medianLabel: string, insufficientLabel: string, duration = false): string {
	if (value.known < 5) return `${insufficientLabel} · ${value.known}/${value.denominator}`;
	const format = (number: number | null): string => number === null ? '—' : duration ? formatDuration(number) : String(number);
	return `${medianLabel} ${format(value.median)} · p90 ${format(value.p90)} · max ${format(value.max)} · ${value.known}/${value.denominator}`;
}
function autonomyDenominator(code: AutonomyDenominatorCode, locale: AppProps['locale']): string {
	return code === 'selected-historical-runs' ? (locale === 'en-US' ? 'runs in the selected historical slice; known is available measurements and does not replace the denominator' : 'runs do recorte histórico selecionado; known representa medições disponíveis e não substitui o denominador') : code;
}
function autonomyPercentileMethod(code: AutonomyPercentileMethodCode, locale: AppProps['locale']): string {
	return code === 'median-center-nearest-rank-p90' ? (locale === 'en-US' ? 'median uses the center, averaging the two central values when needed; p90 uses ceil(n*0.9), limited to the largest observed value' : 'a mediana usa o centro, com média dos dois valores centrais quando necessário; p90 usa ceil(n*0.9), limitado ao maior valor observado') : code;
}
function dispatchCeilingReason(code: DispatchCeilingReasonCode, locale: AppProps['locale']): string {
	return code === 'equivalent-outcome-not-demonstrated' ? (locale === 'en-US' ? 'the history does not demonstrate an equivalent outcome under a ceiling' : 'o histórico não demonstra resultado equivalente sob um teto') : code;
}
function factualMetrics(items: Record<string, { count: number; denominator: number }>): string { return Object.entries(items).filter(([, value]) => value !== null && typeof value === 'object' && 'count' in value && 'denominator' in value).map(([key, value]) => `${key}: ${metric(value)}`).join(' · '); }
function cohortComparisons(cohorts: HistoricalOverviewView['cohorts']): Array<[HistoricalOverviewView['cohorts'][number], HistoricalOverviewView['cohorts'][number]]> {
	const eligible = cohorts.filter((cohort) => cohort.evidenceSufficient && cohort.cohortId !== undefined);
	const pairs: Array<[HistoricalOverviewView['cohorts'][number], HistoricalOverviewView['cohorts'][number]]> = [];
	for (let index = 0; index < eligible.length; index += 1) for (let next = index + 1; next < eligible.length; next += 1) {
		const left = eligible[index]!;
		const right = eligible[next]!;
		if (left.specVersion === right.specVersion) pairs.push([left, right]);
	}
	return pairs;
}
function labeledMetrics(items: Array<[string, { count: number; denominator: number }]>): React.ReactElement {
	return <div className="flex flex-col gap-1">{items.map(([label, value]) => <span key={label}><span className="text-muted-foreground">{label}: </span>{metric(value)}</span>)}</div>;
}

interface BrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void; replaceState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function browserRuntime(): BrowserRuntime { return globalThis as unknown as BrowserRuntime; }
type InsightsQuery = { window: OverviewWindow; projectId?: string; cohortLimit: number; cohortOffset: number; cohortFilter?: string; cohortSortBy?: 'latestTerminalRunAt' | 'sampleSize' | 'workflowRevision' | 'specVersion'; cohortSortDirection?: 'asc' | 'desc' };
export function queryFromUrl(runtime = browserRuntime()): InsightsQuery {
	const params = new URLSearchParams(runtime.location?.search ?? '');
	const rawWindow = params.get('window');
	const rawOffset = Number(params.get('cohortOffset') ?? 0);
	const sortBy = params.get('cohortSortBy');
	const sortDirection = params.get('cohortSortDirection');
	const cohortFilter = params.get('cohortFilter') || undefined;
	const rawLimit = Number(params.get('cohortLimit') ?? 10);
	return { window: rawWindow === '30d' || rawWindow === 'all' ? rawWindow : '7d', projectId: params.get('projectId') ?? undefined, cohortLimit: Number.isSafeInteger(rawLimit) && rawLimit > 0 ? rawLimit : 10, cohortOffset: Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0, cohortFilter, cohortSortBy: ['latestTerminalRunAt', 'sampleSize', 'workflowRevision', 'specVersion'].includes(sortBy ?? '') ? sortBy as InsightsQuery['cohortSortBy'] : undefined, cohortSortDirection: sortDirection === 'asc' || sortDirection === 'desc' ? sortDirection : undefined };
}
export function insightUrl(window: OverviewWindow, projectId?: string, cohortOffset = 0, cohortSortBy?: InsightsQuery['cohortSortBy'], cohortSortDirection?: InsightsQuery['cohortSortDirection'], cohortLimit = 10, cohortFilter?: string): string {
	const params = new URLSearchParams({ window });
	if (projectId !== undefined) params.set('projectId', projectId);
	if (cohortOffset > 0) params.set('cohortOffset', String(cohortOffset));
	if (cohortLimit !== 10) params.set('cohortLimit', String(cohortLimit));
	if (cohortSortBy !== undefined) params.set('cohortSortBy', cohortSortBy);
	if (cohortSortDirection !== undefined) params.set('cohortSortDirection', cohortSortDirection);
	if (cohortFilter !== undefined) params.set('cohortFilter', cohortFilter);
	return `/overview/insights?${params}`;
}
export function updatedInsightsQuery(query: InsightsQuery, changes: Partial<InsightsQuery>): InsightsQuery {
	const projectChanged = Object.prototype.hasOwnProperty.call(changes, 'projectId');
	const cohortLimitChanged = Object.prototype.hasOwnProperty.call(changes, 'cohortLimit');
	const cohortSortChanged = Object.prototype.hasOwnProperty.call(changes, 'cohortSortBy') || Object.prototype.hasOwnProperty.call(changes, 'cohortSortDirection');
	const cohortFilterChanged = Object.prototype.hasOwnProperty.call(changes, 'cohortFilter');
	return { ...query, ...changes, cohortOffset: projectChanged || changes.window !== undefined || cohortLimitChanged || cohortSortChanged || cohortFilterChanged ? 0 : (changes.cohortOffset ?? query.cohortOffset) };
}
export function normalizedCohortOffset(page: NonNullable<HistoricalOverviewView['cohortsPage']>): number | null {
	if (page.total === 0 || page.offset < page.total) return null;
	return Math.floor((page.total - 1) / Math.max(1, page.limit)) * Math.max(1, page.limit);
}
function invalidCohortOffset(data: ProjectOperationalOverviewView | null): boolean {
	const page = data?.overview.cohortsPage;
	return page !== undefined && normalizedCohortOffset(page) !== null;
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
	return <Card><CardPanel><CardTitle>{title}</CardTitle><div className="mt-4">{children}</div></CardPanel></Card>;
}
function MetricList({ items }: { items: Array<[string, React.ReactNode]> }): React.ReactElement {
	return <dl className="grid gap-3 text-sm sm:grid-cols-2">{items.map(([label, value]) => <div className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-0" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value}</dd></div>)}</dl>;
}

function AutonomyEvidenceSection({ history, labels, locale }: { history: HistoricalOverviewView; labels: Record<string, string>; locale: AppProps['locale'] }): React.ReactElement | null {
	const evidence = history.autonomyEvidence;
	if (evidence === undefined) return null;
	const medianLabel = labels.median ?? 'mediana';
	const values = evidence.comparables;
	const outcome = evidence.outcomes;
	const specFacts = LOCALE_CATALOG[locale].runInspector.specFacts;
	const list = (items: string[]): string => items.length === 0 ? labels.insufficient! : items.join(', ');
	return <MetricSection title={labels.autonomyEvidence!}>
		<div className="flex flex-col gap-2 text-xs">
			<p>{labels.sample}: {evidence.count} · {labels.period}: {formatDateTime(evidence.period.from, locale)} → {formatDateTime(evidence.period.to, locale)}</p>
			<p>{labels.workflows}: {list(evidence.workflows)} · {labels.models}: {list(evidence.models)} · {labels.efforts}: {list(evidence.efforts)}</p>
			<p>{labels.outcomeCounts}: {labels.shipped} {outcome.shipped}, {labels.failed} {outcome.failed}, {labels.cancelled} {outcome.cancelled}, {labels.incomplete} {outcome.incomplete} · {labels.interventionRuns}: {evidence.interventionRuns}</p>
			<p>{labels.guidanceChannels}: {specFacts.guidanceCounts(evidence.guidance.channels.web, evidence.guidance.channels['agent-cli'], evidence.guidance.channels.other, evidence.guidance.channels.unknown)} · {labels.authorizationEvidence}: {specFacts.authorizationCounts(evidence.guidance.authorization.observed, evidence.guidance.authorization.absent, evidence.guidance.authorization.unknown)}</p>
			<p>{labels.missing}: {Object.keys(evidence.missing).length === 0 ? labels.none : Object.entries(evidence.missing).map(([key, count]) => `${key} ${count}`).join(', ')}</p>
			<p className="font-medium">{labels.comparables}</p>
			<p>{labels.corrections}: {Object.entries(values.corrections).map(([key, value]) => `${key} ${comparative(value, medianLabel, labels.insufficient!, false)}`).join(' · ')}</p>
			<p>{labels.dispatches}: {comparative(values.dispatches, medianLabel, labels.insufficient!)} · {labels.providerWait}: {comparative(values.waits.provider, medianLabel, labels.insufficient!, true)} · {labels.userWait}: {comparative(values.waits.operator, medianLabel, labels.insufficient!, true)}</p>
			<p>{labels.totalDuration}: {comparative(values.totalDuration, medianLabel, labels.insufficient!, true)} · {labels.activeRecovery}: {comparative(values.activeRecoveryDuration, medianLabel, labels.insufficient!, true)}</p>
			<p>{labels.phases}: {Object.entries(values.phases).map(([key, value]) => `${key} ${comparative(value, medianLabel, labels.insufficient!, true)}`).join(' · ')}</p>
			<p className="text-muted-foreground">{labels.denominator}: {autonomyDenominator(evidence.denominator, locale)} · {labels.percentileMethod}: {autonomyPercentileMethod(evidence.percentileMethod, locale)}</p>
			<p>{labels.ceilings}: {history.dispatchCeilings === undefined ? labels.insufficient : `${labels.coverage} ${history.dispatchCeilings.known}/${history.dispatchCeilings.denominator} · ${history.dispatchCeilings.candidates.map((candidate) => candidate.observedRuns === null ? `${candidate.ceiling}: ${labels.insufficient}` : `${candidate.ceiling}: ${candidate.observedRuns} runs, ${candidate.cappedDispatches} ${labels.capped}`).join(' · ')}`}{history.dispatchCeilings?.recommended === null ? ` · ${labels.noRecommendation}: ${dispatchCeilingReason(history.dispatchCeilings.reason, locale)}` : ''}</p>
		</div>
	</MetricSection>;
}

function CohortComparisonSection({ cohorts, labels }: { cohorts: HistoricalOverviewView['cohorts']; labels: Record<string, string> }): React.ReactElement | null {
	const comparisons = cohortComparisons(cohorts);
	if (comparisons.length === 0) return null;
	return <MetricSection title={labels.comparisons!}><div className="flex flex-col gap-3">{comparisons.map(([left, right]) => {
		const profile = (cohort: HistoricalOverviewView['cohorts'][number]) => cohort.profile ?? { commands: { count: cohort.specVersion === 'unknown' ? 0 : cohort.sampleSize, denominator: cohort.specVersion === 'unknown' ? 0 : cohort.sampleSize }, corrections: cohort.corrections.review, filesAltered: { count: 0, denominator: 0 }, researchRequired: cohort.research?.requiredRuns ?? { count: 0, denominator: 0 } };
		const leftProfile = profile(left);
		const rightProfile = profile(right);
		return <div className="rounded-lg border p-3 text-xs" key={`${left.cohortId}:${right.cohortId}`}><p className="font-medium">{labels.cohortA}: <code>{left.cohortId}</code> · {labels.cohortB}: <code>{right.cohortId}</code></p><dl className="mt-2 grid gap-1 font-mono sm:grid-cols-2"><dt>{labels.commands}</dt><dd>{metric(leftProfile.commands)} → {metric(rightProfile.commands)}</dd><dt>{labels.corrections}</dt><dd>{metric(leftProfile.corrections)} → {metric(rightProfile.corrections)}</dd><dt>{labels.filesAltered}</dt><dd>{knownMetric(leftProfile.filesAltered)} → {knownMetric(rightProfile.filesAltered)}</dd><dt>{labels.researchRequired}</dt><dd>{metric(leftProfile.researchRequired)} → {metric(rightProfile.researchRequired)}</dd></dl><p className="mt-2 text-muted-foreground">{labels.noComparison}</p></div>;
	})}</div></MetricSection>;
}

type CohortRow = HistoricalOverviewView['cohorts'][number];
function CohortTable({ history, catalog, locale, filter, sortBy, sortDirection }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog; locale: AppProps['locale']; filter?: string; sortBy?: InsightsQuery['cohortSortBy']; sortDirection?: InsightsQuery['cohortSortDirection'] }): React.ReactElement {
	const rows = history.cohorts;
	const sorting: SortingState = sortBy === undefined ? [] : [{ id: sortBy === 'workflowRevision' ? 'identity' : sortBy, desc: sortDirection === 'desc' }];
	const globalFilter = filter ?? '';
	const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
	const [columnPinning, setColumnPinning] = useState({ start: ['identity'], end: [] as string[] });
	const columns = useMemo<GateshipColumnDef<CohortRow>[]>(() => [
		{ id: 'identity', header: catalog.workflowRevision, accessorFn: (row) => formatRevision(row.workflowRevision), enableHiding: false, enableSorting: true, minSize: 140 },
		{ id: 'latestTerminalRunAt', header: locale === 'pt-BR' ? 'Última run terminal' : 'Latest terminal run', accessorFn: (row) => row.latestTerminalRunAt, cell: ({ row }) => formatDateTime(row.original.latestTerminalRunAt, locale), enableSorting: true },
		{ id: 'specVersion', header: catalog.specVersion, accessorKey: 'specVersion', enableSorting: true },
		{ id: 'sampleSize', header: catalog.sample, accessorKey: 'sampleSize', cell: ({ row }) => `${row.original.sampleSize}${row.original.evidenceSufficient ? '' : ` (${catalog.cohortEvidenceInsufficient})`}`, enableSorting: true },
		{ id: 'outcomes', header: catalog.outcomeCounts, accessorFn: (row) => `${metric(row.outcomes.shipped)} ${metric(row.outcomes.failed)} ${metric(row.outcomes.cancelled)}`, enableSorting: false, cell: ({ row }) => labeledMetrics([[catalog.shipped, row.original.outcomes.shipped], [catalog.failed, row.original.outcomes.failed], [catalog.cancelled, row.original.outcomes.cancelled]]) },
		{ id: 'corrections', header: catalog.corrections, accessorFn: (row) => factualMetrics(row.corrections), enableSorting: false, cell: ({ row }) => labeledMetrics([[catalog.verification, row.original.corrections.verification], [catalog.review, row.original.corrections.review], [catalog.fullVerify, row.original.corrections.fullVerify], [catalog.ci, row.original.corrections.ci]]) },
		{ id: 'cycleQuestions', header: catalog.cycleQuestions, accessorFn: (row) => factualMetrics(row.cycleQuestions), enableSorting: false, cell: ({ row }) => labeledMetrics([[catalog.executor, row.original.cycleQuestions.executor], [catalog.review, row.original.cycleQuestions.review], [catalog.fullVerify, row.original.cycleQuestions.fullVerify]]) },
		{ id: 'reconciliations', header: catalog.reconciliations, accessorFn: (row) => factualMetrics(row.reconciliations), enableSorting: false, cell: ({ row }) => labeledMetrics([[catalog.unchanged, row.original.reconciliations.unchanged], [catalog.adapted, row.original.reconciliations.adapted], [catalog.contractChangeRequired, row.original.reconciliations['contract-change-required']]]) },
		{ id: 'attentionRequests', header: catalog.attentionRequests, accessorFn: (row) => metric(row.attentionRequests), enableSorting: false, cell: ({ row }) => metric(row.original.attentionRequests) },
		{ id: 'operatorInterventions', header: catalog.cohortOperatorInterventions, accessorFn: (row) => metric(row.operatorInterventions), enableSorting: false, cell: ({ row }) => metric(row.original.operatorInterventions) },
		{ id: 'providerHolds', header: catalog.cohortProviderHolds, accessorFn: (row) => metric(row.providerHolds), enableSorting: false, cell: ({ row }) => metric(row.original.providerHolds) },
	], [catalog, locale]);
	const changeSorting = (value: SortingState): void => { const next = value[0]; const cohortSortBy = next?.id === 'identity' ? 'workflowRevision' : next?.id === 'latestTerminalRunAt' || next?.id === 'sampleSize' || next?.id === 'specVersion' ? next.id : undefined; window.dispatchEvent(new CustomEvent('gateship-cohort-sort', { detail: cohortSortBy === undefined ? { cohortSortBy: undefined, cohortSortDirection: undefined } : { cohortSortBy, cohortSortDirection: next?.desc ? 'desc' : 'asc' } })); };
	const table = useGateshipTable({ columns, data: rows, features: gateshipTableFeatures, getRowId: (row) => row.cohortId ?? `${row.workflowRevision ?? 'unknown'}:${row.specVersion}`, state: { globalFilter, sorting, columnVisibility, columnPinning }, onGlobalFilterChange: (value) => window.dispatchEvent(new CustomEvent('gateship-cohort-filter', { detail: { cohortFilter: String(value ?? '') || undefined } })), onSortingChange: (value) => changeSorting(typeof value === 'function' ? value(sorting) : value), onColumnVisibilityChange: (value) => setColumnVisibility(typeof value === 'function' ? value(columnVisibility) : value), onColumnPinningChange: (value) => setColumnPinning(typeof value === 'function' ? value(columnPinning) : value), manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: history.cohortsPage?.total ?? rows.length });
	return <><DataTableToolbar><DataTableFilter className="flex-1" label={catalog.cohorts} placeholder={catalog.cohorts} locale={locale} table={table} /><DataTableColumnVisibility defaultColumnPinning={{ start: ['identity'], end: [] }} locale={locale} table={table} /></DataTableToolbar><div className="mt-3 overflow-x-auto rounded-lg border"><DataTable emptyState={catalog.noData} locale={locale} table={table} /></div><p className="mt-3 text-muted-foreground text-xs">{catalog.cohortLegend}</p><DataTablePagination locale={locale} offset={history.cohortsPage?.offset ?? 0} total={history.cohortsPage?.total ?? rows.length} onOffsetChange={(offset) => window.dispatchEvent(new CustomEvent('gateship-cohort-page', { detail: offset }))} onPageSizeChange={(limit) => window.dispatchEvent(new CustomEvent('gateship-cohort-page-size', { detail: { cohortLimit: limit } }))} table={table} /></>;
}

function OutcomeTrend({ history, catalog }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const config: ChartConfig = { shipped: { label: catalog.shipped, color: 'var(--success)' }, failed: { label: catalog.failed, color: 'var(--destructive)' }, cancelled: { label: catalog.cancelled, color: 'var(--muted-foreground)' }, incomplete: { label: catalog.incomplete, color: 'var(--foreground)' } };
	const patternIds = { shipped: 'insights-pattern-shipped', failed: 'insights-pattern-failed', cancelled: 'insights-pattern-cancelled', incomplete: 'insights-pattern-incomplete' };
	const chartData = history.daily.map((day) => ({ date: day.date, shipped: day.runsByOutcome.shipped, failed: day.runsByOutcome.failed, cancelled: day.runsByOutcome.cancelled, incomplete: day.runsByOutcome.incomplete }));
	return <section aria-labelledby="insights-outcomes" className="flex flex-col gap-3"><h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground" id="insights-outcomes">{catalog.outcomes}</h2>{history.daily.length === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <><ChartContainer config={config} aria-label={catalog.outcomes} role="img" data-outcome-patterns={Object.values(patternIds).join(' ')}><svg aria-hidden="true" className="absolute h-0 w-0"><defs><pattern id={patternIds.shipped} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-shipped)" /><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="var(--background)" strokeWidth="1" /></pattern><pattern id={patternIds.failed} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-failed)" /><path d="M0 0L6 6M6 0L0 6" stroke="var(--background)" strokeWidth="1" /></pattern><pattern id={patternIds.cancelled} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-cancelled)" /><circle cx="1.5" cy="1.5" r="1" fill="var(--background)" /><circle cx="4.5" cy="4.5" r="1" fill="var(--background)" /></pattern><pattern id={patternIds.incomplete} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-incomplete)" /><path d="M1 0V6M4 0V6" stroke="var(--background)" strokeWidth="1" /></pattern></defs></svg><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} label={{ value: catalog.runs, angle: -90, position: 'insideLeft', style: { fill: 'var(--muted-foreground)', fontSize: 11 } }} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltipContent />} /><Bar dataKey="shipped" stackId="outcomes" fill={`url(#${patternIds.shipped})`} isAnimationActive={false} /><Bar dataKey="failed" stackId="outcomes" fill={`url(#${patternIds.failed})`} isAnimationActive={false} /><Bar dataKey="cancelled" stackId="outcomes" fill={`url(#${patternIds.cancelled})`} isAnimationActive={false} /><Bar dataKey="incomplete" stackId="outcomes" fill={`url(#${patternIds.incomplete})`} isAnimationActive={false} /></BarChart></ResponsiveContainer></ChartContainer><ChartLegendContent config={config} label={catalog.outcomes} patternIds={patternIds} /></>}<div className="scroll-container overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.exactValues}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.date, catalog.runs, catalog.shipped, catalog.failed, catalog.cancelled, catalog.incomplete].map((label) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{history.daily.map((day) => <tr key={day.date}><td className="px-3 py-2 font-mono text-xs">{day.date}</td><td className="px-3 py-2 font-mono">{day.totalRuns}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.shipped}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.failed}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.cancelled}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.incomplete}</td></tr>)}</tbody></table></div></section>;
}

function InsightsData({ history, catalog, labels, locale, filter, sortBy, sortDirection }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog; labels: Record<string, string>; locale: AppProps['locale']; filter?: string; sortBy?: InsightsQuery['cohortSortBy']; sortDirection?: InsightsQuery['cohortSortDirection'] }): React.ReactElement {
	catalog = { ...catalog, phases: labels.phases ?? 'Phases', failures: labels.failures ?? 'Failures' };
	const medianLabel = labels.median ?? 'median';
	return <><CohortComparisonSection cohorts={history.cohorts} labels={labels} />
		<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight><Stat label={catalog.runs} value={history.totalRuns} /><Stat label={catalog.shipped} value={history.runsByOutcome.shipped} /><Stat label={catalog.dispatchToMerge} value={formatDuration(history.medianDispatchToMergeMs)} /><Stat label={catalog.costCoverage} value={`${history.runsWithKnownCost}/${history.totalRuns}`} /></CardGrid>
		<MetricSection title={catalog.delivery}><OutcomeTrend catalog={catalog} history={history} /></MetricSection>
		<MetricSection title={catalog.autonomy}><MetricList items={[[catalog.dispatchToMerge, formatDuration(history.medianDispatchToMergeMs)], [catalog.reviewRounds, history.fixRounds], [catalog.operatorInterventions, history.operatorInterventions], [catalog.resolvedQuestions, history.resolvedCycleQuestions], [catalog.providerHolds, history.providerHolds], [catalog.ciCorrections, history.ciCorrections]]} /></MetricSection>
		<MetricSection title={catalog.providers}><MetricList items={[[catalog.reviewRounds, history.firstReviewPasses], [catalog.configurations, history.configurations.length]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.noComparison}</p>{history.configurations.length === 0 ? null : <ul className="mt-3 flex flex-wrap gap-2 text-xs">{history.configurations.map((configuration) => <li className="rounded-md border px-2 py-1 font-mono" key={JSON.stringify(configuration)}>{configuration.provider} / {configuration.role}{configuration.model === undefined ? '' : ` / ${configuration.model}`}</li>)}</ul>}</MetricSection>
		<MetricSection title={catalog.economy}><MetricList items={[[catalog.knownCost, formatCost(history.knownCostUsd)], [catalog.apiEquivalent, formatCost(history.knownCostUsd)], [catalog.inputTokens, formatTokens(history.reportedTokens.inputTokens, locale)], [catalog.outputTokens, formatTokens(history.reportedTokens.outputTokens, locale)]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.subscriptionSeparate}</p></MetricSection>
		<AutonomyEvidenceSection history={history} labels={labels} locale={locale} />
		<MetricSection title={catalog.cohorts}><CohortTable catalog={catalog} history={history} locale={locale} filter={filter} sortBy={sortBy} sortDirection={sortDirection} />
			{history.cohorts.map((cohort) => cohort.timing === undefined ? null : <div className="mt-3 rounded-lg border p-3 text-xs" key={`facts:${cohort.workflowRevision ?? 'unknown'}:${cohort.specVersion}`}><p className="font-medium">{labels.factualTiming}</p><p className="mt-1 font-mono">{labels.wallTime}: {distribution(cohort.timing.wallTimeMs, medianLabel)} · {labels.providerWait}: {distribution(cohort.timing.waits.provider, medianLabel)} · {labels.userWait}: {distribution(cohort.timing.waits.user, medianLabel)}</p><p className="mt-1 font-mono">{catalog.phases}: {distributions(cohort.timing.phases, medianLabel)} · {catalog.corrections}: {distributions(cohort.timing.corrections, medianLabel)}</p><p className="mt-1 text-muted-foreground">{labels.research}: {cohort.research === undefined ? '—' : `${labels.required}: ${metric(cohort.research.requiredRuns)} · ${labels.receiptCoverage}: ${metric(cohort.research.receiptCoverage)} · ${labels.obsoleteSource}: ${metric(cohort.research.obsoleteSource)} · ${labels.versionMismatch}: ${metric(cohort.research.versionMismatch)} · ${labels.relatedCorrection}: ${metric(cohort.research.relatedCorrection)}`}</p><p className="mt-1 text-muted-foreground">{catalog.failures}: {cohort.failures === undefined ? '—' : factualMetrics(cohort.failures)}</p></div>)}
		</MetricSection>
	</>;
}

function insightLabels(catalog: OverviewInsightsCatalog, locale: AppProps['locale']): Record<string, string> {
	const text = (value: string | undefined, fallbackValue: string): string => value ?? fallbackValue;
	if (locale === 'en-US') return { factualTiming: text(catalog.factualTiming, 'Factual timing'), wallTime: text(catalog.wallTime, 'Wall time'), providerWait: text(catalog.providerWait, 'Provider wait'), userWait: text(catalog.userWait, 'User wait'), research: text(catalog.research, 'Research facts'), required: text(catalog.required, 'required runs'), receiptCoverage: text(catalog.receiptCoverage, 'receipt coverage'), obsoleteSource: text(catalog.obsoleteSource, 'obsolete source'), versionMismatch: text(catalog.versionMismatch, 'version mismatch'), relatedCorrection: text(catalog.relatedCorrection, 'related correction'), phases: text(catalog.phases, 'Phases'), failures: text(catalog.failures, 'Failures'), comparisons: 'Factual comparisons', cohortA: 'Cohort A', cohortB: 'Cohort B', commands: 'commands', corrections: text(catalog.corrections, 'corrections'), filesAltered: 'files altered', researchRequired: 'research required', median: 'median', autonomyEvidence: 'Autonomy evidence', sample: 'sample', period: 'period', workflows: 'workflows', models: 'models', efforts: 'efforts', outcomeCounts: 'outcomes', interventionRuns: 'runs with interventions', guidanceChannels: 'guidance channels', authorizationEvidence: 'authorization evidence', missing: 'missing fields', comparables: 'Comparable measurements', dispatches: 'dispatches', totalDuration: 'total duration', activeRecovery: 'active recovery duration', denominator: 'denominator', percentileMethod: 'percentile method', ceilings: 'counterfactual ceilings', capped: 'dispatches capped', noRecommendation: 'no recommendation', insufficient: 'insufficient data', none: 'none', coverage: 'coverage' };
	return { factualTiming: text(catalog.factualTiming, 'Tempos factuais'), wallTime: text(catalog.wallTime, 'Tempo total'), providerWait: text(catalog.providerWait, 'Espera de provider'), userWait: text(catalog.userWait, 'Espera do operador'), research: text(catalog.research, 'Fatos da pesquisa'), required: text(catalog.required, 'runs que exigiram'), receiptCoverage: text(catalog.receiptCoverage, 'cobertura de receipts'), obsoleteSource: text(catalog.obsoleteSource, 'fonte obsoleta'), versionMismatch: text(catalog.versionMismatch, 'mismatch de versão'), relatedCorrection: text(catalog.relatedCorrection, 'correção relacionada'), phases: text(catalog.phases, 'Fases'), failures: text(catalog.failures, 'Falhas'), comparisons: 'Comparações factuais', cohortA: 'Coorte A', cohortB: 'Coorte B', commands: 'comandos', corrections: text(catalog.corrections, 'correções'), filesAltered: 'arquivos alterados', researchRequired: 'pesquisa exigida', median: 'mediana', autonomyEvidence: 'Evidência de autonomia', sample: 'amostra', period: 'período', workflows: 'workflows', models: 'modelos', efforts: 'esforços', outcomeCounts: 'desfechos', interventionRuns: 'runs com intervenções', guidanceChannels: 'canais da orientação', authorizationEvidence: 'evidência de autorização', missing: 'campos ausentes', comparables: 'Medições comparáveis', dispatches: 'despachos', totalDuration: 'duração total', activeRecovery: 'duração ativa de recuperação', denominator: 'denominador', percentileMethod: 'método de percentil', ceilings: 'tetos contrafactuais', capped: 'despachos cortados', noRecommendation: 'sem recomendação', insufficient: 'dados insuficientes', none: 'nenhum', coverage: 'cobertura' };
}

function useInsightsState(initialOverview: ProjectOperationalOverviewView | null): { query: InsightsQuery; data: ProjectOperationalOverviewView | null; error: string | null; update: (changes: Partial<InsightsQuery>) => void } {
	const [query, setQuery] = useState(queryFromUrl);
	const [data, setData] = useState<ProjectOperationalOverviewView | null>(initialOverview);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { const onChange = (event: Event): void => { const detail = (event as CustomEvent<Partial<InsightsQuery>>).detail; const next = updatedInsightsQuery(queryFromUrl(), detail); browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId, next.cohortOffset, next.cohortSortBy, next.cohortSortDirection, next.cohortLimit, next.cohortFilter)); setData(null); setQuery(next); }; globalThis.addEventListener('gateship-cohort-sort', onChange); globalThis.addEventListener('gateship-cohort-page-size', onChange); globalThis.addEventListener('gateship-cohort-filter', onChange); return () => { globalThis.removeEventListener('gateship-cohort-sort', onChange); globalThis.removeEventListener('gateship-cohort-page-size', onChange); globalThis.removeEventListener('gateship-cohort-filter', onChange); }; }, []);
	useEffect(() => { const onPop = (): void => setQuery(queryFromUrl()); const onPage = (event: Event): void => { const offset = (event as CustomEvent<number>).detail; const next = { ...queryFromUrl(), cohortOffset: offset }; browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId, offset, next.cohortSortBy, next.cohortSortDirection, next.cohortLimit, next.cohortFilter)); setQuery(next); }; const runtime = browserRuntime(); runtime.addEventListener?.('popstate', onPop); globalThis.addEventListener('gateship-cohort-page', onPage); return () => { runtime.removeEventListener?.('popstate', onPop); globalThis.removeEventListener('gateship-cohort-page', onPage); }; }, []);
	useEffect(() => { if (!invalidCohortOffset(data)) return; const page = data?.overview.cohortsPage; if (page === undefined) return; const offset = normalizedCohortOffset(page); if (offset === null) return; const next = { ...query, cohortOffset: offset }; browserRuntime().history?.replaceState(null, '', insightUrl(next.window, next.projectId, offset, next.cohortSortBy, next.cohortSortDirection, next.cohortLimit, next.cohortFilter)); setData(null); setQuery(next); }, [data, query]);
	useEffect(() => { const controller = new AbortController(); let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined; const read = (): void => { void fetchOverview(query.window, { ...(query.projectId === undefined ? {} : { projectId: query.projectId }), cohortLimit: query.cohortLimit, cohortOffset: query.cohortOffset, ...(query.cohortFilter === undefined ? {} : { cohortFilter: query.cohortFilter }), ...(query.cohortSortBy === undefined ? {} : { cohortSortBy: query.cohortSortBy }), ...(query.cohortSortDirection === undefined ? {} : { cohortSortDirection: query.cohortSortDirection }) }, controller.signal).then((value) => { if (!disposed) { setData(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) timer = setTimeout(read, 15_000); }); }; read(); return () => { disposed = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); }; }, [query]);
	const update = (changes: Partial<InsightsQuery>): void => { const next = updatedInsightsQuery(query, changes); browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId, next.cohortOffset, next.cohortSortBy, next.cohortSortDirection, next.cohortLimit, next.cohortFilter)); setQuery(next); };
	return { query, data, error, update };
}

export function OverviewInsightsSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewInsights;
	const labels = insightLabels(catalog, props.locale);
	const { query, data, error, update } = useInsightsState(props.overview ?? null);
	const history = data?.overview ?? null;
	return <SurfaceColumn label={LOCALE_CATALOG[props.locale].shell.routeLabels.overviewInsights} status={props.status}><div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm"><span>{catalog.project}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.projectId ?? ''} onChange={(event) => update({ projectId: (event.currentTarget as unknown as { value: string }).value || undefined })}><option value="">{catalog.allProjects}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="flex flex-col gap-1 text-sm"><span>{catalog.window}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.window} onChange={(event) => update({ window: (event.currentTarget as unknown as { value: string }).value as OverviewWindow })}><option value="7d">{catalog.last7d}</option><option value="30d">{catalog.last30d}</option><option value="all">{catalog.all}</option></select></label></div>{(data === null || invalidCohortOffset(data)) && error === null ? <p role="status">{catalog.loading}</p> : null}{error !== null ? <p role="alert">{catalog.error}: {error}</p> : null}{history === null || invalidCohortOffset(data) ? null : history.totalRuns === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <InsightsData catalog={catalog} labels={labels} history={history} locale={props.locale} filter={query.cohortFilter} sortBy={query.cohortSortBy} sortDirection={query.cohortSortDirection} />}</SurfaceColumn>;
}

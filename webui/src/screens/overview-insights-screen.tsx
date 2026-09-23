import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SortingState } from '@tanstack/react-table';
import { fetchOverview, type AutonomyDenominatorCode, type AutonomyPercentileMethodCode, type DispatchCeilingReasonCode, type DispatchMethodologyVersion, type HistoricalOverviewView, type OverviewWindow, type ProjectOperationalOverviewView } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Badge } from '../components/ui/badge.tsx';
import { PageLoading } from '../components/ui/page-loading.tsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Card, CardHeader, CardPanel, CardTitle } from '../components/ui/card.tsx';
import { CardGrid, PageToolbar } from '../components/ui/card-layout.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.tsx';
import { ChartContainer, ChartLegendContent, ChartTooltipContent, type ChartConfig } from '../components/ui/chart.tsx';
import { DataTable, DataTableFilter, DataTableNote, DataTablePagination, DataTableToolbar, DataTableViewOptions, type GateshipColumnDef, gateshipTableFeatures, useGateshipTable } from '../components/ui/data-table.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { SelectField } from '../components/ui/select.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { cn } from '../lib/cn.ts';
import { LOCALE_CATALOG, type OverviewInsightsCatalog } from '../locale.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { formatWhen } from './overview-runs-screen.tsx';

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
function dispatchMethodologyVersion(code: DispatchMethodologyVersion, locale: AppProps['locale']): string {
	return code === 'cli-process-v1' ? (locale === 'en-US' ? 'counts one CLI process invocation per dispatch; internal LLM calls, subagents and usage outside this run are not observed and are not counted as zero' : 'conta uma invocação do processo CLI por despacho; chamadas LLM internas, subagentes e uso fora desta run não são observados e não são contados como zero') : code;
}
function factualMetrics(items: Record<string, { count: number; denominator: number }>): string { return Object.entries(items).filter(([, value]) => value !== null && typeof value === 'object' && 'count' in value && 'denominator' in value).map(([key, value]) => `${key}: ${metric(value)}`).join(' · '); }
type CohortRow = HistoricalOverviewView['cohorts'][number];
function cohortKey(cohort: CohortRow): string { return cohort.cohortId ?? `${cohort.workflowRevision ?? 'unknown'}:${cohort.specVersion}`; }
/** Two cohorts compare only with enough evidence on both sides and the same spec version. */
function comparableCohorts(left: CohortRow, cohorts: CohortRow[]): CohortRow[] {
	if (!left.evidenceSufficient || left.cohortId === undefined) return [];
	return cohorts.filter((cohort) => cohort !== left && cohort.evidenceSufficient && cohort.cohortId !== undefined && cohort.specVersion === left.specVersion);
}
/** The pair the comparison opens on: the first cohort that has anything to be compared with. */
function firstComparable(cohorts: CohortRow[]): CohortRow | undefined { return cohorts.find((cohort) => comparableCohorts(cohort, cohorts).length > 0); }

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
	return <Card><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardPanel>{children}</CardPanel></Card>;
}
function MetricRows({ items, className }: { items: Array<[string, React.ReactNode]>; className?: string }): React.ReactElement {
	return <dl className={cn('flex flex-col gap-2 text-sm', className)}>{items.map(([label, value]) => <div className="flex items-baseline justify-between gap-4" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="type-data whitespace-nowrap">{value}</dd></div>)}</dl>;
}
/** One question the page answers: the number that leads, then the ones that qualify it. */
function MetricGroup({ title, value, hint, items, children }: { title: string; value: React.ReactNode; hint: React.ReactNode; items: Array<[string, React.ReactNode]>; children?: React.ReactNode }): React.ReactElement {
	return <section aria-label={title} className="flex" data-slot="insights-group"><Stat className="flex-1" hint={hint} label={title} value={value}><MetricRows className="max-w-md" items={items} />{children}</Stat></section>;
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
			<p className="text-muted-foreground">{labels.denominator}: {autonomyDenominator(evidence.denominator, locale)} · {labels.percentileMethod}: {autonomyPercentileMethod(evidence.percentileMethod, locale)} · {labels.dispatchMethodologyVersion}: {dispatchMethodologyVersion(evidence.dispatchMethodologyVersion, locale)}</p>
			<p>{labels.ceilings}: {history.dispatchCeilings === undefined ? labels.insufficient : `${labels.coverage} ${history.dispatchCeilings.known}/${history.dispatchCeilings.denominator} · ${history.dispatchCeilings.candidates.map((candidate) => candidate.observedRuns === null ? `${candidate.ceiling}: ${labels.insufficient}` : `${candidate.ceiling}: ${candidate.observedRuns} runs, ${candidate.cappedDispatches} ${labels.capped}`).join(' · ')}`}{history.dispatchCeilings?.recommended === null ? ` · ${labels.noRecommendation}: ${dispatchCeilingReason(history.dispatchCeilings.reason, locale)}` : ''}</p>
		</div>
	</MetricSection>;
}

function cohortLabel(cohort: CohortRow): string { return `${formatRevision(cohort.workflowRevision)} · ${cohort.specVersion} · n=${cohort.sampleSize}`; }
function cohortProfile(cohort: CohortRow): NonNullable<CohortRow['profile']> {
	const commands = cohort.specVersion === 'unknown' ? 0 : cohort.sampleSize;
	return cohort.profile ?? { commands: { count: commands, denominator: commands }, corrections: cohort.corrections.review, filesAltered: { count: 0, denominator: 0 }, researchRequired: cohort.research?.requiredRuns ?? { count: 0, denominator: 0 } };
}
function CohortFacts({ cohort, catalog, labels }: { cohort: CohortRow; catalog: OverviewInsightsCatalog; labels: Record<string, string> }): React.ReactElement | null {
	if (cohort.timing === undefined) return null;
	const medianLabel = labels.median ?? 'median';
	const research = cohort.research;
	return <div className="flex flex-col gap-3" data-slot="cohort-facts"><p className="type-eyebrow text-muted-foreground">{formatRevision(cohort.workflowRevision)} · {labels.factualTiming}</p><MetricRows className="sm:max-w-md" items={[
		[labels.wallTime!, distribution(cohort.timing.wallTimeMs, medianLabel)],
		[labels.providerWait!, distribution(cohort.timing.waits.provider, medianLabel)],
		[labels.userWait!, distribution(cohort.timing.waits.user, medianLabel)],
	]} /><dl className="flex flex-col gap-2 text-muted-foreground text-xs"><div><dt className="inline">{catalog.phases}: </dt><dd className="type-data inline">{distributions(cohort.timing.phases, medianLabel) || '—'}</dd></div><div><dt className="inline">{catalog.corrections}: </dt><dd className="type-data inline">{distributions(cohort.timing.corrections, medianLabel) || '—'}</dd></div><div><dt className="inline">{labels.research}: </dt><dd className="type-data inline">{research === undefined ? '—' : `${labels.required}: ${metric(research.requiredRuns)} · ${labels.receiptCoverage}: ${metric(research.receiptCoverage)} · ${labels.obsoleteSource}: ${metric(research.obsoleteSource)} · ${labels.versionMismatch}: ${metric(research.versionMismatch)} · ${labels.relatedCorrection}: ${metric(research.relatedCorrection)}`}</dd></div><div><dt className="inline">{catalog.failures}: </dt><dd className="type-data inline">{cohort.failures === undefined ? '—' : factualMetrics(cohort.failures) || '—'}</dd></div></dl></div>;
}

/*
 * One cohort in detail, against one other. The page used to print every
 * comparable pair and every cohort's timing: with a real history that is
 * hundreds of blocks nobody chose. Comparing is choosing two.
 */
function CohortDetail({ cohorts, catalog, labels }: { cohorts: CohortRow[]; catalog: OverviewInsightsCatalog; labels: Record<string, string> }): React.ReactElement | null {
	const [leftKey, setLeftKey] = useState<string | undefined>(undefined);
	const [rightKey, setRightKey] = useState<string | undefined>(undefined);
	const left = cohorts.find((cohort) => cohortKey(cohort) === leftKey) ?? firstComparable(cohorts) ?? cohorts[0];
	if (left === undefined) return null;
	const candidates = comparableCohorts(left, cohorts);
	const right = candidates.find((cohort) => cohortKey(cohort) === rightKey) ?? candidates[0];
	if (right === undefined && left.timing === undefined) return null;
	const items = (list: CohortRow[]) => list.map((cohort) => ({ value: cohortKey(cohort), label: cohortLabel(cohort) }));
	const select = 'w-full sm:w-auto sm:min-w-56';
	const a = cohortProfile(left);
	const b = right === undefined ? undefined : cohortProfile(right);
	return <Collapsible data-slot="cohort-detail"><CollapsibleTrigger>{labels.comparisons}</CollapsibleTrigger><CollapsibleContent><div className="flex flex-col gap-4 p-3">
		<div className="flex flex-wrap items-center gap-2"><SelectField aria-label={labels.cohortA} className={select} items={items(cohorts)} value={cohortKey(left)} onValueChange={(value) => { setLeftKey(value); setRightKey(undefined); }} />{right === undefined ? null : <><span aria-hidden="true" className="text-muted-foreground">→</span><SelectField aria-label={labels.cohortB} className={select} items={items(candidates)} value={cohortKey(right)} onValueChange={setRightKey} /></>}</div>
		{right === undefined || b === undefined ? <p className="text-muted-foreground text-xs">{left.evidenceSufficient ? labels.noPair : catalog.cohortEvidenceInsufficient}</p> : <MetricRows className="sm:max-w-md" items={[
			[labels.commands!, `${metric(a.commands)} → ${metric(b.commands)}`],
			[labels.corrections!, `${metric(a.corrections)} → ${metric(b.corrections)}`],
			[labels.filesAltered!, `${knownMetric(a.filesAltered)} → ${knownMetric(b.filesAltered)}`],
			[labels.researchRequired!, `${metric(a.researchRequired)} → ${metric(b.researchRequired)}`],
		]} />}
		<CohortFacts catalog={catalog} cohort={left} labels={labels} />
		{right === undefined ? null : <CohortFacts catalog={catalog} cohort={right} labels={labels} />}
	</div></CollapsibleContent></Collapsible>;
}

/** What a cohort row opens into: the figures that come in groups, each group under its name. */
export function CohortRowDetail({ cohort, catalog }: { cohort: CohortRow; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const groups: Array<[string, Array<[string, React.ReactNode]>]> = [
		[catalog.corrections, [[catalog.verification, metric(cohort.corrections.verification)], [catalog.review, metric(cohort.corrections.review)], [catalog.fullVerify, metric(cohort.corrections.fullVerify)], [catalog.ci, metric(cohort.corrections.ci)]]],
		[catalog.cycleQuestions, [[catalog.executor, metric(cohort.cycleQuestions.executor)], [catalog.review, metric(cohort.cycleQuestions.review)], [catalog.fullVerify, metric(cohort.cycleQuestions.fullVerify)]]],
		[catalog.reconciliations, [[catalog.unchanged, metric(cohort.reconciliations.unchanged)], [catalog.adapted, metric(cohort.reconciliations.adapted)], [catalog.contractChangeRequired, metric(cohort.reconciliations['contract-change-required'])]]],
	];
	return <div className="grid gap-6 sm:grid-cols-3" data-slot="cohort-row-detail">{groups.map(([title, items]) => <section className="flex flex-col gap-3" key={title}><h4 className="type-eyebrow text-muted-foreground">{title}</h4><MetricRows items={items} /></section>)}</div>;
}

/* The four columns a cohort is read by; single figures are one menu away and remembered, and the figures that come in groups open under the row. */
const COHORT_PREFERENCES_KEY = 'gateship:overview-insights:cohorts:v1';
const DEFAULT_COHORT_VISIBILITY: Record<string, boolean> = { specVersion: false, attentionRequests: false, operatorInterventions: false, providerHolds: false };
function readCohortPreferences(): Record<string, boolean> { try { const value: unknown = JSON.parse(globalThis.localStorage?.getItem(COHORT_PREFERENCES_KEY) ?? 'null'); const stored = value !== null && typeof value === 'object' ? (value as { columnVisibility?: Record<string, boolean> }).columnVisibility : undefined; return stored ?? DEFAULT_COHORT_VISIBILITY; } catch { return DEFAULT_COHORT_VISIBILITY; } }

function CohortTable({ history, catalog, locale, filter, sortBy, sortDirection }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog; locale: AppProps['locale']; filter?: string; sortBy?: InsightsQuery['cohortSortBy']; sortDirection?: InsightsQuery['cohortSortDirection'] }): React.ReactElement {
	const rows = history.cohorts;
	const sorting: SortingState = sortBy === undefined ? [] : [{ id: sortBy === 'workflowRevision' ? 'identity' : sortBy, desc: sortDirection === 'desc' }];
	const globalFilter = filter ?? '';
	const [columnVisibility, setColumnVisibility] = useState(readCohortPreferences);
	useEffect(() => { try { globalThis.localStorage?.setItem(COHORT_PREFERENCES_KEY, JSON.stringify({ columnVisibility })); } catch { /* storage is optional */ } }, [columnVisibility]);
	const columns = useMemo<GateshipColumnDef<CohortRow>[]>(() => [
		{ id: 'identity', header: catalog.workflowRevision, accessorFn: (row) => formatRevision(row.workflowRevision), enableHiding: false, enableSorting: true, meta: { kind: 'code', primary: true } },
		{ id: 'latestTerminalRunAt', header: locale === 'pt-BR' ? 'Última run terminal' : 'Latest terminal run', accessorFn: (row) => row.latestTerminalRunAt, meta: { kind: 'moment', className: 'text-muted-foreground', hideBelow: 'sm' }, cell: ({ row }) => row.original.latestTerminalRunAt == null ? '—' : <time dateTime={row.original.latestTerminalRunAt}>{formatWhen(row.original.latestTerminalRunAt, locale)}</time>, enableSorting: true },
		{ id: 'specVersion', header: catalog.specVersion, accessorKey: 'specVersion', enableSorting: true, meta: { kind: 'code', hideBelow: 'md' } },
		{ id: 'sampleSize', header: catalog.sample, accessorKey: 'sampleSize', meta: { kind: 'measure' }, cell: ({ row }) => row.original.evidenceSufficient ? row.original.sampleSize : <span className="inline-flex items-center gap-2" title={catalog.cohortEvidenceInsufficient}>{row.original.sampleSize}<span className="hidden @xl:inline-flex"><Badge variant="neutral">{catalog.cohortSmallSample}</Badge></span><span className="sr-only">{catalog.cohortEvidenceInsufficient}</span></span>, enableSorting: true },
		{ id: 'outcomes', header: catalog.outcomeCounts, accessorFn: (row) => `${metric(row.outcomes.shipped)} ${metric(row.outcomes.failed)} ${metric(row.outcomes.cancelled)}`, enableSorting: false, meta: { kind: 'measure', hideBelow: 'sm' }, cell: ({ row }) => [row.original.outcomes.shipped, row.original.outcomes.failed, row.original.outcomes.cancelled].map(metric).join(' · ') },
		{ id: 'attentionRequests', header: catalog.attentionRequests, accessorFn: (row) => metric(row.attentionRequests), enableSorting: false, meta: { kind: 'measure', hideBelow: 'md' }, cell: ({ row }) => metric(row.original.attentionRequests) },
		{ id: 'operatorInterventions', header: catalog.cohortOperatorInterventions, accessorFn: (row) => metric(row.operatorInterventions), enableSorting: false, meta: { kind: 'measure', hideBelow: 'md' }, cell: ({ row }) => metric(row.original.operatorInterventions) },
		{ id: 'providerHolds', header: catalog.cohortProviderHolds, accessorFn: (row) => metric(row.providerHolds), enableSorting: false, meta: { kind: 'measure', hideBelow: 'md' }, cell: ({ row }) => metric(row.original.providerHolds) },
	], [catalog, locale]);
	const changeSorting = (value: SortingState): void => { const next = value[0]; const cohortSortBy = next?.id === 'identity' ? 'workflowRevision' : next?.id === 'latestTerminalRunAt' || next?.id === 'sampleSize' || next?.id === 'specVersion' ? next.id : undefined; window.dispatchEvent(new CustomEvent('gateship-cohort-sort', { detail: cohortSortBy === undefined ? { cohortSortBy: undefined, cohortSortDirection: undefined } : { cohortSortBy, cohortSortDirection: next?.desc ? 'desc' : 'asc' } })); };
	const table = useGateshipTable({ columns, data: rows, features: gateshipTableFeatures, getRowId: (row) => row.cohortId ?? `${row.workflowRevision ?? 'unknown'}:${row.specVersion}`, state: { globalFilter, sorting, columnVisibility, /* The server pages the cohorts; the pager counts in its page size, not the table's default of 10. */ pagination: { pageIndex: Math.floor((history.cohortsPage?.offset ?? 0) / Math.max(1, history.cohortsPage?.limit ?? 10)), pageSize: history.cohortsPage?.limit ?? 10 } }, onGlobalFilterChange: (value) => window.dispatchEvent(new CustomEvent('gateship-cohort-filter', { detail: { cohortFilter: String(value ?? '') || undefined } })), onSortingChange: (value) => changeSorting(typeof value === 'function' ? value(sorting) : value), onColumnVisibilityChange: (value) => setColumnVisibility(typeof value === 'function' ? value(columnVisibility) : value), manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: history.cohortsPage?.total ?? rows.length });
	/* The legend reads the table's figures, so it is the table's appendix: after the pager, in the same frame. */
	return <DataTable
		emptyState={catalog.noData}
		foot={<>
			<DataTablePagination locale={locale} offset={history.cohortsPage?.offset ?? 0} total={history.cohortsPage?.total ?? rows.length} onOffsetChange={(offset) => window.dispatchEvent(new CustomEvent('gateship-cohort-page', { detail: offset }))} onPageSizeChange={(limit) => window.dispatchEvent(new CustomEvent('gateship-cohort-page-size', { detail: { cohortLimit: limit } }))} table={table} />
			<DataTableNote>{catalog.cohortLegend}</DataTableNote>
		</>}
		head={<DataTableToolbar><DataTableFilter label={catalog.cohorts} placeholder={catalog.cohorts} locale={locale} table={table} /><DataTableViewOptions locale={locale} table={table} /></DataTableToolbar>}
		locale={locale}
		renderExpanded={(row) => <CohortRowDetail catalog={catalog} cohort={row} />}
		table={table}
	/>;
}

function OutcomeTrend({ history, catalog }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const config: ChartConfig = { shipped: { label: catalog.shipped, color: 'var(--success)' }, failed: { label: catalog.failed, color: 'var(--destructive)' }, cancelled: { label: catalog.cancelled, color: 'var(--muted-foreground)' }, incomplete: { label: catalog.incomplete, color: 'var(--foreground)' } };
	const patternIds = { shipped: 'insights-pattern-shipped', failed: 'insights-pattern-failed', cancelled: 'insights-pattern-cancelled', incomplete: 'insights-pattern-incomplete' };
	const chartData = history.daily.map((day) => ({ date: day.date, shipped: day.runsByOutcome.shipped, failed: day.runsByOutcome.failed, cancelled: day.runsByOutcome.cancelled, incomplete: day.runsByOutcome.incomplete }));
	return <section aria-labelledby="insights-outcomes"><Card><CardHeader><CardTitle id="insights-outcomes">{catalog.outcomes}</CardTitle></CardHeader><CardPanel>{history.daily.length === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <><ChartContainer config={config} aria-label={catalog.outcomes} role="img" data-outcome-patterns={Object.values(patternIds).join(' ')}><svg aria-hidden="true" className="absolute h-0 w-0"><defs><pattern id={patternIds.shipped} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-shipped)" /><path d="M-1 1L1 -1M0 6L6 0M5 7L7 5" stroke="var(--background)" strokeWidth="1" /></pattern><pattern id={patternIds.failed} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-failed)" /><path d="M0 0L6 6M6 0L0 6" stroke="var(--background)" strokeWidth="1" /></pattern><pattern id={patternIds.cancelled} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-cancelled)" /><circle cx="1.5" cy="1.5" r="1" fill="var(--background)" /><circle cx="4.5" cy="4.5" r="1" fill="var(--background)" /></pattern><pattern id={patternIds.incomplete} width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="var(--color-incomplete)" /><path d="M1 0V6M4 0V6" stroke="var(--background)" strokeWidth="1" /></pattern></defs></svg><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} label={{ value: catalog.runs, angle: -90, position: 'insideLeft', style: { fill: 'var(--muted-foreground)', fontSize: 11 } }} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltipContent />} /><Bar dataKey="shipped" stackId="outcomes" fill={`url(#${patternIds.shipped})`} isAnimationActive={false} /><Bar dataKey="failed" stackId="outcomes" fill={`url(#${patternIds.failed})`} isAnimationActive={false} /><Bar dataKey="cancelled" stackId="outcomes" fill={`url(#${patternIds.cancelled})`} isAnimationActive={false} /><Bar dataKey="incomplete" stackId="outcomes" fill={`url(#${patternIds.incomplete})`} isAnimationActive={false} /></BarChart></ResponsiveContainer></ChartContainer><ChartLegendContent config={config} label={catalog.outcomes} patternIds={patternIds} /></>}{/* The chart's numbers, for whoever reads rows instead of bars: present in the document, folded out of the way. */}
		<Collapsible data-slot="insights-exact-values"><CollapsibleTrigger>{catalog.exactValues}</CollapsibleTrigger><CollapsibleContent><div className="type-data"><Table><caption className="sr-only">{catalog.exactValues}</caption><TableHeader><TableRow>{[catalog.date, catalog.runs, catalog.shipped, catalog.failed, catalog.cancelled, catalog.incomplete].map((label, index) => <TableHead className={index === 0 ? undefined : 'text-end'} key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{history.daily.map((day) => <TableRow key={day.date}><TableCell>{day.date}</TableCell>{[day.totalRuns, day.runsByOutcome.shipped, day.runsByOutcome.failed, day.runsByOutcome.cancelled, day.runsByOutcome.incomplete].map((value, index) => <TableCell className="text-end" key={index}>{value}</TableCell>)}</TableRow>)}</TableBody></Table></div></CollapsibleContent></Collapsible></CardPanel></Card></section>;
}

function InsightsData({ history, catalog, labels, locale, filter, sortBy, sortDirection }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog; labels: Record<string, string>; locale: AppProps['locale']; filter?: string; sortBy?: InsightsQuery['cohortSortBy']; sortDirection?: InsightsQuery['cohortSortDirection'] }): React.ReactElement {
	catalog = { ...catalog, phases: labels.phases ?? 'Phases', failures: labels.failures ?? 'Failures' };
	const costCoverageValue = history.runsByCostCoverage === undefined
		? `${history.runsWithKnownCost}/${history.totalRuns}`
		: catalog.costCoverageCounts(history.runsByCostCoverage.complete, history.runsByCostCoverage.partial, history.runsByCostCoverage.unknown, history.totalRuns);
	// GSHIP-889: the known subtotal sums every run's known portion, partial included -- the marker sits under the number rather than letting it read as if every counted run were fully priced.
	const partialCost = history.knownCostUsd !== null && history.runsByCostCoverage !== undefined && history.runsByCostCoverage.complete < history.totalRuns;
	const coverage = history.runsByCostCoverage;
	const shipped = history.runsByOutcome.shipped;
	return <>
		<CardGrid className="@3xl:grid-cols-3" compact>
			<MetricGroup title={catalog.delivery} value={`${shipped}/${history.totalRuns}`} hint={catalog.shipped} items={[[catalog.failed, history.runsByOutcome.failed], [catalog.cancelled, history.runsByOutcome.cancelled], [catalog.incomplete, history.runsByOutcome.incomplete], [catalog.dispatchToMerge, formatDuration(history.medianDispatchToMergeMs)]]} />
			<MetricGroup title={catalog.autonomy} value={`${history.shippedWithoutIntervention}/${shipped}`} hint={catalog.shippedWithoutIntervention} items={[[catalog.firstReviewPasses, `${history.firstReviewPasses}/${history.firstReviewPassKnownRuns}`], [catalog.reviewRounds, history.fixRounds], [catalog.operatorInterventions, history.operatorInterventions], [catalog.resolvedQuestions, history.resolvedCycleQuestions], [catalog.providerHolds, history.providerHolds], [catalog.ciCorrections, history.ciCorrections]]} />
			<MetricGroup title={catalog.economy} value={formatCost(history.knownCostUsd)} hint={partialCost ? `${catalog.knownCost} · ${LOCALE_CATALOG[locale].runsOperational.cost.partialCoverage}` : catalog.knownCost} items={[[catalog.costCoverage, coverage === undefined ? `${history.runsWithKnownCost}/${history.totalRuns}` : `${coverage.complete}/${history.totalRuns}`], [catalog.inputTokens, formatTokens(history.reportedTokens.inputTokens, locale)], [catalog.outputTokens, formatTokens(history.reportedTokens.outputTokens, locale)]]}>
				<p className="mt-4 text-muted-foreground text-xs">{coverage === undefined ? null : `${costCoverageValue}. `}{catalog.apiEquivalent}. {catalog.subscriptionSeparate}</p>
			</MetricGroup>
		</CardGrid>
		<OutcomeTrend catalog={catalog} history={history} />
		{/* Nothing to say about providers until a configuration was observed. */}
		{history.configurations.length === 0 ? null : <MetricSection title={catalog.providers}><ul className="flex flex-wrap gap-2 text-xs">{history.configurations.map((configuration) => <li className="type-data rounded-md border px-2 py-1" key={JSON.stringify(configuration)}>{configuration.provider} / {configuration.role}{configuration.model === undefined ? '' : ` / ${configuration.model}`}</li>)}</ul><p className="text-muted-foreground text-xs">{catalog.noComparison}</p></MetricSection>}
		<AutonomyEvidenceSection history={history} labels={labels} locale={locale} />
		<MetricSection title={catalog.cohorts}><CohortTable catalog={catalog} history={history} locale={locale} filter={filter} sortBy={sortBy} sortDirection={sortDirection} /><CohortDetail catalog={catalog} cohorts={history.cohorts} labels={labels} /></MetricSection>
	</>;
}

function insightLabels(catalog: OverviewInsightsCatalog, locale: AppProps['locale']): Record<string, string> {
	const text = (value: string | undefined, fallbackValue: string): string => value ?? fallbackValue;
	if (locale === 'en-US') return { factualTiming: text(catalog.factualTiming, 'Factual timing'), wallTime: text(catalog.wallTime, 'Wall time'), providerWait: text(catalog.providerWait, 'Provider wait'), userWait: text(catalog.userWait, 'User wait'), research: text(catalog.research, 'Research facts'), required: text(catalog.required, 'required runs'), receiptCoverage: text(catalog.receiptCoverage, 'receipt coverage'), obsoleteSource: text(catalog.obsoleteSource, 'obsolete source'), versionMismatch: text(catalog.versionMismatch, 'version mismatch'), relatedCorrection: text(catalog.relatedCorrection, 'related correction'), phases: text(catalog.phases, 'Phases'), failures: text(catalog.failures, 'Failures'), comparisons: 'Factual comparisons', cohortA: 'Cohort A', cohortB: 'Cohort B', commands: 'commands', corrections: text(catalog.corrections, 'corrections'), filesAltered: 'files altered', researchRequired: 'research required', median: 'median', autonomyEvidence: 'Autonomy evidence', sample: 'sample', period: 'period', workflows: 'workflows', models: 'models', efforts: 'efforts', outcomeCounts: 'outcomes', interventionRuns: 'runs with interventions', guidanceChannels: 'guidance channels', authorizationEvidence: 'authorization evidence', missing: 'missing fields', comparables: 'Comparable measurements', dispatches: 'dispatches', totalDuration: 'total duration', activeRecovery: 'active recovery duration', denominator: 'denominator', percentileMethod: 'percentile method', dispatchMethodologyVersion: 'dispatch methodology', ceilings: 'counterfactual ceilings', capped: 'dispatches capped', noRecommendation: 'no recommendation', insufficient: 'insufficient data', none: 'none', coverage: 'coverage', noPair: 'No comparable cohort on this page: it takes the same spec version and at least 5 terminal runs on both sides.' };
	return { factualTiming: text(catalog.factualTiming, 'Tempos factuais'), wallTime: text(catalog.wallTime, 'Tempo total'), providerWait: text(catalog.providerWait, 'Espera de provider'), userWait: text(catalog.userWait, 'Espera do operador'), research: text(catalog.research, 'Fatos da pesquisa'), required: text(catalog.required, 'runs que exigiram'), receiptCoverage: text(catalog.receiptCoverage, 'cobertura de receipts'), obsoleteSource: text(catalog.obsoleteSource, 'fonte obsoleta'), versionMismatch: text(catalog.versionMismatch, 'mismatch de versão'), relatedCorrection: text(catalog.relatedCorrection, 'correção relacionada'), phases: text(catalog.phases, 'Fases'), failures: text(catalog.failures, 'Falhas'), comparisons: 'Comparações factuais', cohortA: 'Coorte A', cohortB: 'Coorte B', commands: 'comandos', corrections: text(catalog.corrections, 'correções'), filesAltered: 'arquivos alterados', researchRequired: 'pesquisa exigida', median: 'mediana', autonomyEvidence: 'Evidência de autonomia', sample: 'amostra', period: 'período', workflows: 'workflows', models: 'modelos', efforts: 'esforços', outcomeCounts: 'desfechos', interventionRuns: 'runs com intervenções', guidanceChannels: 'canais da orientação', authorizationEvidence: 'evidência de autorização', missing: 'campos ausentes', comparables: 'Medições comparáveis', dispatches: 'despachos', totalDuration: 'duração total', activeRecovery: 'duração ativa de recuperação', denominator: 'denominador', percentileMethod: 'método de percentil', dispatchMethodologyVersion: 'metodologia de despacho', ceilings: 'tetos contrafactuais', capped: 'despachos cortados', noRecommendation: 'sem recomendação', insufficient: 'dados insuficientes', none: 'nenhum', coverage: 'cobertura', noPair: 'Nenhuma coorte comparável nesta página: é preciso a mesma versão da spec e ao menos 5 runs terminais dos dois lados.' };
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
	const windows: Array<[OverviewWindow, string]> = [['7d', catalog.last7d], ['30d', catalog.last30d], ['all', catalog.all]];
	const loading = (data === null || invalidCohortOffset(data)) && error === null;
	/* No project select: the sidebar switcher is the project filter, and a `?projectId=` link still scopes the history. */
	return <SurfaceColumn label={LOCALE_CATALOG[props.locale].shell.routeLabels.overviewInsights} status={props.status}>
		<PageToolbar><ToggleGroup aria-label={catalog.window} className="flex-wrap" data-slot="insights-window" spacing={1} value={[query.window]} variant="outline" onValueChange={(value) => { const next = value[0]; if (next !== undefined) update({ window: next as OverviewWindow }); }}>{windows.map(([value, label]) => <ToggleGroupItem aria-label={label} key={value} value={value}>{label}</ToggleGroupItem>)}</ToggleGroup></PageToolbar>
		{loading ? <PageLoading label={catalog.loading} /> : null}
		{error !== null ? <Alert variant="destructive"><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>{catalog.error}</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
		{history === null || invalidCohortOffset(data) ? null : history.totalRuns === 0 ? <EmptyState>{catalog.noData}</EmptyState> : <InsightsData catalog={catalog} labels={labels} history={history} locale={props.locale} filter={query.cohortFilter} sortBy={query.cohortSortBy} sortDirection={query.cohortSortDirection} />}
	</SurfaceColumn>;
}

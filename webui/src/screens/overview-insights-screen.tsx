import React, { useEffect, useState } from 'react';
import { fetchOverview, type HistoricalOverviewView, type OverviewWindow, type ProjectOperationalOverviewView } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Card, CardPanel, CardTitle } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
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
function formatTokens(value: number | null): string { return value === null ? '—' : value.toLocaleString('en-US'); }
function formatRevision(value: string | null): string { return value === null ? 'unknown' : value.length <= 12 ? value : `${value.slice(0, 8)}…`; }
function metric(value: { count: number; denominator: number }): string { return `${value.count}/${value.denominator}`; }
function knownMetric(value: { count: number; denominator: number }): string { return value.denominator === 0 ? '—' : metric(value); }
function distribution(value: { median: number | null; p90: number | null; known: number; denominator: number }, medianLabel: string): string { return `${medianLabel} ${formatDuration(value.median)} · p90 ${formatDuration(value.p90)} · ${value.known}/${value.denominator}`; }
function distributions(items: Record<string, { median: number | null; p90: number | null; known: number; denominator: number }>, medianLabel: string): string { return Object.entries(items).map(([key, value]) => `${key}: ${distribution(value, medianLabel)}`).join(' · '); }
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
function queryFromUrl(): { window: OverviewWindow; projectId?: string; cohortOffset: number } {
	const params = new URLSearchParams(browserRuntime().location?.search ?? '');
	const rawWindow = params.get('window');
	const rawOffset = Number(params.get('cohortOffset') ?? 0);
	return { window: rawWindow === '30d' || rawWindow === 'all' ? rawWindow : '7d', projectId: params.get('projectId') ?? undefined, cohortOffset: Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0 };
}
export function insightUrl(window: OverviewWindow, projectId?: string, cohortOffset = 0): string {
	const params = new URLSearchParams({ window });
	if (projectId !== undefined) params.set('projectId', projectId);
	if (cohortOffset > 0) params.set('cohortOffset', String(cohortOffset));
	return `/overview/insights?${params}`;
}
type InsightsQuery = { window: OverviewWindow; projectId?: string; cohortOffset: number };
export function updatedInsightsQuery(query: InsightsQuery, changes: Partial<InsightsQuery>): InsightsQuery {
	const projectChanged = Object.prototype.hasOwnProperty.call(changes, 'projectId');
	return { ...query, ...changes, cohortOffset: projectChanged || changes.window !== undefined ? 0 : (changes.cohortOffset ?? query.cohortOffset) };
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

function OutcomeTrend({ history, catalog }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const max = Math.max(1, ...history.daily.map((day) => day.totalRuns));
	return <section aria-labelledby="insights-outcomes" className="flex flex-col gap-3"><h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground" id="insights-outcomes">{catalog.outcomes}</h2><div className="flex min-h-40 items-end gap-1 border-b border-l p-3" aria-hidden="true">{history.daily.map((day) => <div className="flex min-w-0 flex-1 flex-col justify-end gap-1" key={day.date} title={`${day.date}: ${day.totalRuns}`}><div className="bg-emerald-500" style={{ height: `${(day.runsByOutcome.shipped / max) * 100}%`, minHeight: day.runsByOutcome.shipped > 0 ? '2px' : 0 }} /><div className="bg-red-500" style={{ height: `${(day.runsByOutcome.failed / max) * 100}%`, minHeight: day.runsByOutcome.failed > 0 ? '2px' : 0 }} /><div className="bg-muted-foreground" style={{ height: `${((day.runsByOutcome.cancelled + day.runsByOutcome.incomplete) / max) * 100}%`, minHeight: day.runsByOutcome.cancelled + day.runsByOutcome.incomplete > 0 ? '2px' : 0 }} /></div>)}</div><div className="scroll-container overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.exactValues}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.date, catalog.runs, catalog.shipped, catalog.failed, catalog.cancelled, catalog.incomplete].map((label) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{history.daily.map((day) => <tr key={day.date}><td className="px-3 py-2 font-mono text-xs">{day.date}</td><td className="px-3 py-2 font-mono">{day.totalRuns}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.shipped}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.failed}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.cancelled}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.incomplete}</td></tr>)}</tbody></table></div></section>;
}

function InsightsData({ history, catalog, labels }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog; labels: Record<string, string> }): React.ReactElement {
	catalog = { ...catalog, phases: labels.phases ?? 'Phases', failures: labels.failures ?? 'Failures' };
	const medianLabel = labels.median ?? 'median';
	const page = history.cohortsPage ?? { limit: history.cohorts.length || 10, offset: 0, returned: history.cohorts.length, total: history.cohorts.length };
	return <><CohortComparisonSection cohorts={history.cohorts} labels={labels} />
		<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight><Stat label={catalog.runs} value={history.totalRuns} /><Stat label={catalog.shipped} value={history.runsByOutcome.shipped} /><Stat label={catalog.dispatchToMerge} value={formatDuration(history.medianDispatchToMergeMs)} /><Stat label={catalog.costCoverage} value={`${history.runsWithKnownCost}/${history.totalRuns}`} /></CardGrid>
		<MetricSection title={catalog.delivery}><OutcomeTrend catalog={catalog} history={history} /></MetricSection>
		<MetricSection title={catalog.autonomy}><MetricList items={[[catalog.dispatchToMerge, formatDuration(history.medianDispatchToMergeMs)], [catalog.reviewRounds, history.fixRounds], [catalog.operatorInterventions, history.operatorInterventions], [catalog.resolvedQuestions, history.resolvedCycleQuestions], [catalog.providerHolds, history.providerHolds], [catalog.ciCorrections, history.ciCorrections]]} /></MetricSection>
		<MetricSection title={catalog.providers}><MetricList items={[[catalog.reviewRounds, history.firstReviewPasses], [catalog.configurations, history.configurations.length]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.noComparison}</p>{history.configurations.length === 0 ? null : <ul className="mt-3 flex flex-wrap gap-2 text-xs">{history.configurations.map((configuration) => <li className="rounded-md border px-2 py-1 font-mono" key={JSON.stringify(configuration)}>{configuration.provider} / {configuration.role}{configuration.model === undefined ? '' : ` / ${configuration.model}`}</li>)}</ul>}</MetricSection>
		<MetricSection title={catalog.economy}><MetricList items={[[catalog.knownCost, formatCost(history.knownCostUsd)], [catalog.apiEquivalent, formatCost(history.knownCostUsd)], [catalog.inputTokens, formatTokens(history.reportedTokens.inputTokens)], [catalog.outputTokens, formatTokens(history.reportedTokens.outputTokens)]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.subscriptionSeparate}</p></MetricSection>
		<MetricSection title={catalog.cohorts}>{page.total === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <div className="flex flex-col gap-3"><div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.cohorts}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.workflowRevision, catalog.specVersion, catalog.sample, catalog.outcomeCounts, catalog.corrections, catalog.cycleQuestions, catalog.reconciliations, catalog.attentionRequests, catalog.cohortOperatorInterventions, catalog.cohortProviderHolds].map((label) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{history.cohorts.map((cohort) => <tr key={`${cohort.workflowRevision ?? 'unknown'}:${cohort.specVersion}`}><td className="px-3 py-2 font-mono text-xs">{formatRevision(cohort.workflowRevision)}</td><td className="px-3 py-2">{cohort.specVersion}</td><td className="px-3 py-2 font-mono">{cohort.sampleSize}{cohort.evidenceSufficient ? '' : ` (${catalog.cohortEvidenceInsufficient})`}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.shipped, cohort.outcomes.shipped], [catalog.failed, cohort.outcomes.failed], [catalog.cancelled, cohort.outcomes.cancelled]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.verification, cohort.corrections.verification], [catalog.review, cohort.corrections.review], [catalog.fullVerify, cohort.corrections.fullVerify], [catalog.ci, cohort.corrections.ci]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.executor, cohort.cycleQuestions.executor], [catalog.review, cohort.cycleQuestions.review], [catalog.fullVerify, cohort.cycleQuestions.fullVerify]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.unchanged, cohort.reconciliations.unchanged], [catalog.adapted, cohort.reconciliations.adapted], [catalog.contractChangeRequired, cohort.reconciliations['contract-change-required']]])}</td><td className="px-3 py-2 font-mono">{metric(cohort.attentionRequests)}</td><td className="px-3 py-2 font-mono">{metric(cohort.operatorInterventions)}</td><td className="px-3 py-2 font-mono">{metric(cohort.providerHolds)}</td></tr>)}</tbody></table></div><p className="text-muted-foreground text-xs">{catalog.cohortLegend}</p>{history.cohorts.map((cohort) => cohort.timing === undefined ? null : <div className="rounded-lg border p-3 text-xs" key={`facts:${cohort.workflowRevision ?? 'unknown'}:${cohort.specVersion}`}><p className="font-medium">{labels.factualTiming}</p><p className="mt-1 font-mono">{labels.wallTime}: {distribution(cohort.timing.wallTimeMs, medianLabel)} · {labels.providerWait}: {distribution(cohort.timing.waits.provider, medianLabel)} · {labels.userWait}: {distribution(cohort.timing.waits.user, medianLabel)}</p><p className="mt-1 font-mono">{catalog.phases}: {distributions(cohort.timing.phases, medianLabel)} · {catalog.corrections}: {distributions(cohort.timing.corrections, medianLabel)}</p><p className="mt-1 text-muted-foreground">{labels.research}: {cohort.research === undefined ? '—' : `${labels.required}: ${metric(cohort.research.requiredRuns)} · ${labels.receiptCoverage}: ${metric(cohort.research.receiptCoverage)} · ${labels.obsoleteSource}: ${metric(cohort.research.obsoleteSource)} · ${labels.versionMismatch}: ${metric(cohort.research.versionMismatch)} · ${labels.relatedCorrection}: ${metric(cohort.research.relatedCorrection)}`}</p><p className="mt-1 text-muted-foreground">{catalog.failures}: {cohort.failures === undefined ? '—' : factualMetrics(cohort.failures)}</p></div>)}<div className="flex items-center justify-between gap-3" aria-label={catalog.cohorts}><button className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={page.offset === 0} aria-label={catalog.previousCohorts} onClick={() => window.dispatchEvent(new CustomEvent('gateship-cohort-page', { detail: Math.max(0, page.offset - page.limit) }))}>{catalog.previousCohorts}</button><span className="text-muted-foreground text-sm">{catalog.cohortPage(page.offset + 1, page.offset + page.returned, page.total)}</span><button className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={page.offset + page.returned >= page.total} aria-label={catalog.nextCohorts} onClick={() => window.dispatchEvent(new CustomEvent('gateship-cohort-page', { detail: page.offset + page.limit }))}>{catalog.nextCohorts}</button></div></div>}</MetricSection>
	</>;
}

function insightLabels(catalog: OverviewInsightsCatalog, locale: AppProps['locale']): Record<string, string> {
	const text = (value: string | undefined, fallbackValue: string): string => value ?? fallbackValue;
	if (locale === 'en-US') return { factualTiming: text(catalog.factualTiming, 'Factual timing'), wallTime: text(catalog.wallTime, 'Wall time'), providerWait: text(catalog.providerWait, 'Provider wait'), userWait: text(catalog.userWait, 'User wait'), research: text(catalog.research, 'Research facts'), required: text(catalog.required, 'required runs'), receiptCoverage: text(catalog.receiptCoverage, 'receipt coverage'), obsoleteSource: text(catalog.obsoleteSource, 'obsolete source'), versionMismatch: text(catalog.versionMismatch, 'version mismatch'), relatedCorrection: text(catalog.relatedCorrection, 'related correction'), phases: text(catalog.phases, 'Phases'), failures: text(catalog.failures, 'Failures'), comparisons: 'Factual comparisons', cohortA: 'Cohort A', cohortB: 'Cohort B', commands: 'commands', corrections: text(catalog.corrections, 'corrections'), filesAltered: 'files altered', researchRequired: 'research required', median: 'median' };
	return { factualTiming: text(catalog.factualTiming, 'Tempos factuais'), wallTime: text(catalog.wallTime, 'Tempo total'), providerWait: text(catalog.providerWait, 'Espera de provider'), userWait: text(catalog.userWait, 'Espera do operador'), research: text(catalog.research, 'Fatos da pesquisa'), required: text(catalog.required, 'runs que exigiram'), receiptCoverage: text(catalog.receiptCoverage, 'cobertura de receipts'), obsoleteSource: text(catalog.obsoleteSource, 'fonte obsoleta'), versionMismatch: text(catalog.versionMismatch, 'mismatch de versão'), relatedCorrection: text(catalog.relatedCorrection, 'correção relacionada'), phases: text(catalog.phases, 'Fases'), failures: text(catalog.failures, 'Falhas'), comparisons: 'Comparações factuais', cohortA: 'Coorte A', cohortB: 'Coorte B', commands: 'comandos', corrections: text(catalog.corrections, 'correções'), filesAltered: 'arquivos alterados', researchRequired: 'pesquisa exigida', median: 'mediana' };
}

function useInsightsState(initialOverview: ProjectOperationalOverviewView | null): { query: InsightsQuery; data: ProjectOperationalOverviewView | null; error: string | null; update: (changes: Partial<InsightsQuery>) => void } {
	const [query, setQuery] = useState(queryFromUrl);
	const [data, setData] = useState<ProjectOperationalOverviewView | null>(initialOverview);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { const onPop = (): void => setQuery(queryFromUrl()); const onPage = (event: Event): void => { const offset = (event as CustomEvent<number>).detail; const next = { ...queryFromUrl(), cohortOffset: offset }; browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId, offset)); setQuery(next); }; const runtime = browserRuntime(); runtime.addEventListener?.('popstate', onPop); globalThis.addEventListener('gateship-cohort-page', onPage); return () => { runtime.removeEventListener?.('popstate', onPop); globalThis.removeEventListener('gateship-cohort-page', onPage); }; }, []);
	useEffect(() => { if (!invalidCohortOffset(data)) return; const page = data?.overview.cohortsPage; if (page === undefined) return; const offset = normalizedCohortOffset(page); if (offset === null) return; const next = { ...query, cohortOffset: offset }; browserRuntime().history?.replaceState(null, '', insightUrl(next.window, next.projectId, offset)); setData(null); setQuery(next); }, [data, query]);
	useEffect(() => { const controller = new AbortController(); let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined; const read = (): void => { void fetchOverview(query.window, { ...(query.projectId === undefined ? {} : { projectId: query.projectId }), cohortOffset: query.cohortOffset }, controller.signal).then((value) => { if (!disposed) { setData(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) timer = setTimeout(read, 15_000); }); }; read(); return () => { disposed = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); }; }, [query]);
	const update = (changes: Partial<InsightsQuery>): void => { const next = updatedInsightsQuery(query, changes); browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId, next.cohortOffset)); setQuery(next); };
	return { query, data, error, update };
}

export function OverviewInsightsSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewInsights;
	const labels = insightLabels(catalog, props.locale);
	const { query, data, error, update } = useInsightsState(props.overview ?? null);
	const history = data?.overview ?? null;
	return <SurfaceColumn label={LOCALE_CATALOG[props.locale].shell.routeLabels.overviewInsights} status={props.status}><div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm"><span>{catalog.project}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.projectId ?? ''} onChange={(event) => update({ projectId: (event.currentTarget as unknown as { value: string }).value || undefined })}><option value="">{catalog.allProjects}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="flex flex-col gap-1 text-sm"><span>{catalog.window}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.window} onChange={(event) => update({ window: (event.currentTarget as unknown as { value: string }).value as OverviewWindow })}><option value="7d">{catalog.last7d}</option><option value="30d">{catalog.last30d}</option><option value="all">{catalog.all}</option></select></label></div>{(data === null || invalidCohortOffset(data)) && error === null ? <p role="status">{catalog.loading}</p> : null}{error !== null ? <p role="alert">{catalog.error}: {error}</p> : null}{history === null || invalidCohortOffset(data) ? null : history.totalRuns === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <InsightsData catalog={catalog} labels={labels} history={history} />}</SurfaceColumn>;
}

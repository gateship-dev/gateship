import React, { useEffect, useState } from 'react';
import { fetchOverview, type HistoricalOverviewView, type OverviewWindow, type ProjectOperationalOverviewView } from '../client.ts';
import type { AppProps } from '../app-props.ts';
import { Card, CardPanel, CardTitle } from '../components/ui/card.tsx';
import { CardGrid } from '../components/ui/card-layout.tsx';
import { Stat } from '../components/ui/stat.tsx';
import { LOCALE_CATALOG, type OverviewInsightsCatalog } from '../locale.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ControlCenterNavigation } from './overview-screen.tsx';

function formatDuration(ms: number | null): string {
	if (ms === null || !Number.isFinite(ms)) return '—';
	const minutes = Math.round(ms / 60_000);
	return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCost(value: number | null): string { return value === null ? '—' : `$${value.toFixed(2)}`; }
function formatTokens(value: number | null): string { return value === null ? '—' : value.toLocaleString('en-US'); }
function formatRevision(value: string | null): string { return value === null ? 'unknown' : value.length <= 12 ? value : `${value.slice(0, 8)}…`; }
function metric(value: { count: number; denominator: number }): string { return `${value.count}/${value.denominator}`; }
function labeledMetrics(items: Array<[string, { count: number; denominator: number }]>): React.ReactElement {
	return <div className="flex flex-col gap-1">{items.map(([label, value]) => <span key={label}><span className="text-muted-foreground">{label}: </span>{metric(value)}</span>)}</div>;
}

interface BrowserRuntime { location?: { search: string }; history?: { pushState: (data: null, unused: string, url: string) => void }; addEventListener?: (type: 'popstate', listener: () => void) => void; removeEventListener?: (type: 'popstate', listener: () => void) => void }
function browserRuntime(): BrowserRuntime { return globalThis as unknown as BrowserRuntime; }
function queryFromUrl(): { window: OverviewWindow; projectId?: string } {
	const params = new URLSearchParams(browserRuntime().location?.search ?? '');
	const rawWindow = params.get('window');
	return { window: rawWindow === '30d' || rawWindow === 'all' ? rawWindow : '7d', projectId: params.get('projectId') ?? undefined };
}
function insightUrl(window: OverviewWindow, projectId?: string): string {
	const params = new URLSearchParams({ window });
	if (projectId !== undefined) params.set('projectId', projectId);
	return `/overview/insights?${params}`;
}

function MetricSection({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
	return <Card><CardPanel><CardTitle>{title}</CardTitle><div className="mt-4">{children}</div></CardPanel></Card>;
}
function MetricList({ items }: { items: Array<[string, React.ReactNode]> }): React.ReactElement {
	return <dl className="grid gap-3 text-sm sm:grid-cols-2">{items.map(([label, value]) => <div className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-0" key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-mono tabular-nums">{value}</dd></div>)}</dl>;
}

function OutcomeTrend({ history, catalog }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const max = Math.max(1, ...history.daily.map((day) => day.totalRuns));
	return <section aria-labelledby="insights-outcomes" className="flex flex-col gap-3"><h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground" id="insights-outcomes">{catalog.outcomes}</h2><div className="flex min-h-40 items-end gap-1 border-b border-l p-3" aria-hidden="true">{history.daily.map((day) => <div className="flex min-w-0 flex-1 flex-col justify-end gap-1" key={day.date} title={`${day.date}: ${day.totalRuns}`}><div className="bg-emerald-500" style={{ height: `${(day.runsByOutcome.shipped / max) * 100}%`, minHeight: day.runsByOutcome.shipped > 0 ? '2px' : 0 }} /><div className="bg-red-500" style={{ height: `${(day.runsByOutcome.failed / max) * 100}%`, minHeight: day.runsByOutcome.failed > 0 ? '2px' : 0 }} /><div className="bg-muted-foreground" style={{ height: `${((day.runsByOutcome.cancelled + day.runsByOutcome.incomplete) / max) * 100}%`, minHeight: day.runsByOutcome.cancelled + day.runsByOutcome.incomplete > 0 ? '2px' : 0 }} /></div>)}</div><div className="scroll-container overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.exactValues}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.date, catalog.runs, catalog.shipped, catalog.failed, catalog.cancelled, catalog.incomplete].map((label) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{history.daily.map((day) => <tr key={day.date}><td className="px-3 py-2 font-mono text-xs">{day.date}</td><td className="px-3 py-2 font-mono">{day.totalRuns}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.shipped}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.failed}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.cancelled}</td><td className="px-3 py-2 font-mono">{day.runsByOutcome.incomplete}</td></tr>)}</tbody></table></div></section>;
}

function InsightsData({ history, catalog }: { history: HistoricalOverviewView; catalog: OverviewInsightsCatalog }): React.ReactElement {
	const cohortMetric = (cohort: HistoricalOverviewView['cohorts'][number]): React.ReactElement => <div className="overflow-x-auto rounded-lg border"><table className="w-full text-sm"><caption className="sr-only">{catalog.cohorts}</caption><thead className="border-b bg-muted/40 text-left text-muted-foreground"><tr>{[catalog.workflowRevision, catalog.specVersion, catalog.sample, catalog.outcomeCounts, catalog.corrections, catalog.cycleQuestions, catalog.reconciliations, catalog.attentionRequests, catalog.cohortOperatorInterventions, catalog.cohortProviderHolds].map((label) => <th className="whitespace-nowrap px-3 py-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody><tr><td className="px-3 py-2 font-mono text-xs">{formatRevision(cohort.workflowRevision)}</td><td className="px-3 py-2">{cohort.specVersion}</td><td className="px-3 py-2 font-mono">{cohort.sampleSize}{cohort.evidenceSufficient ? '' : ` (${catalog.cohortEvidenceInsufficient})`}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.shipped, cohort.outcomes.shipped], [catalog.failed, cohort.outcomes.failed], [catalog.cancelled, cohort.outcomes.cancelled]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.verification, cohort.corrections.verification], [catalog.review, cohort.corrections.review], [catalog.fullVerify, cohort.corrections.fullVerify], [catalog.ci, cohort.corrections.ci]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.executor, cohort.cycleQuestions.executor], [catalog.review, cohort.cycleQuestions.review], [catalog.fullVerify, cohort.cycleQuestions.fullVerify]])}</td><td className="px-3 py-2 font-mono">{labeledMetrics([[catalog.unchanged, cohort.reconciliations.unchanged], [catalog.adapted, cohort.reconciliations.adapted], [catalog.contractChangeRequired, cohort.reconciliations['contract-change-required']]])}</td><td className="px-3 py-2 font-mono">{metric(cohort.attentionRequests)}</td><td className="px-3 py-2 font-mono">{metric(cohort.operatorInterventions)}</td><td className="px-3 py-2 font-mono">{metric(cohort.providerHolds)}</td></tr></tbody></table></div>;
	return <>
		<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight><Stat label={catalog.runs} value={history.totalRuns} /><Stat label={catalog.shipped} value={history.runsByOutcome.shipped} /><Stat label={catalog.dispatchToMerge} value={formatDuration(history.medianDispatchToMergeMs)} /><Stat label={catalog.costCoverage} value={`${history.runsWithKnownCost}/${history.totalRuns}`} /></CardGrid>
		<MetricSection title={catalog.delivery}><OutcomeTrend catalog={catalog} history={history} /></MetricSection>
		<MetricSection title={catalog.autonomy}><MetricList items={[[catalog.dispatchToMerge, formatDuration(history.medianDispatchToMergeMs)], [catalog.reviewRounds, history.fixRounds], [catalog.operatorInterventions, history.operatorInterventions], [catalog.resolvedQuestions, history.resolvedCycleQuestions], [catalog.providerHolds, history.providerHolds], [catalog.ciCorrections, history.ciCorrections]]} /></MetricSection>
		<MetricSection title={catalog.providers}><MetricList items={[[catalog.reviewRounds, history.firstReviewPasses], [catalog.configurations, history.configurations.length]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.noComparison}</p>{history.configurations.length === 0 ? null : <ul className="mt-3 flex flex-wrap gap-2 text-xs">{history.configurations.map((configuration) => <li className="rounded-md border px-2 py-1 font-mono" key={JSON.stringify(configuration)}>{configuration.provider} / {configuration.role}{configuration.model === undefined ? '' : ` / ${configuration.model}`}</li>)}</ul>}</MetricSection>
		<MetricSection title={catalog.economy}><MetricList items={[[catalog.knownCost, formatCost(history.knownCostUsd)], [catalog.apiEquivalent, formatCost(history.knownCostUsd)], [catalog.inputTokens, formatTokens(history.reportedTokens.inputTokens)], [catalog.outputTokens, formatTokens(history.reportedTokens.outputTokens)]]} /><p className="mt-4 text-muted-foreground text-xs">{catalog.subscriptionSeparate}</p></MetricSection>
		<MetricSection title={catalog.cohorts}>{history.cohorts.length === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <div className="flex flex-col gap-3">{history.cohorts.map((cohort) => <div key={`${cohort.workflowRevision ?? 'unknown'}:${cohort.specVersion}`}>{cohortMetric(cohort)}</div>)}<p className="text-muted-foreground text-xs">{catalog.cohortLegend}</p></div>}</MetricSection>
	</>;
}

export function OverviewInsightsSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overviewInsights;
	const [query, setQuery] = useState(queryFromUrl);
	const [data, setData] = useState<ProjectOperationalOverviewView | null>(props.overview ?? null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => { const onPop = (): void => setQuery(queryFromUrl()); const runtime = browserRuntime(); runtime.addEventListener?.('popstate', onPop); return () => runtime.removeEventListener?.('popstate', onPop); }, []);
	useEffect(() => { const controller = new AbortController(); let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined; const read = (): void => { void fetchOverview(query.window, query.projectId === undefined ? {} : { projectId: query.projectId }, controller.signal).then((value) => { if (!disposed) { setData(value); setError(null); } }).catch((reason: unknown) => { if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason)); }).finally(() => { if (!disposed) timer = setTimeout(read, 15_000); }); }; read(); return () => { disposed = true; controller.abort(); if (timer !== undefined) clearTimeout(timer); }; }, [query]);
	const update = (changes: Partial<typeof query>): void => { const next = { ...query, ...changes }; browserRuntime().history?.pushState(null, '', insightUrl(next.window, next.projectId)); setQuery(next); };
	const history = data?.overview ?? null;
	return <SurfaceColumn label={catalog.title} status={props.status}><ControlCenterNavigation current="insights" locale={props.locale} /><div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold">{catalog.title}</h1><p className="text-muted-foreground text-sm">{catalog.description}</p></div><div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm"><span>{catalog.project}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.projectId ?? ''} onChange={(event) => update({ projectId: (event.currentTarget as unknown as { value: string }).value || undefined })}><option value="">{catalog.allProjects}</option>{props.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="flex flex-col gap-1 text-sm"><span>{catalog.window}</span><select className="min-h-10 rounded-lg border bg-background px-3" value={query.window} onChange={(event) => update({ window: (event.currentTarget as unknown as { value: string }).value as OverviewWindow })}><option value="7d">{catalog.last7d}</option><option value="30d">{catalog.last30d}</option><option value="all">{catalog.all}</option></select></label></div>{data === null && error === null ? <p role="status">{catalog.loading}</p> : null}{error !== null ? <p role="alert">{catalog.error}: {error}</p> : null}{history === null ? <p className="text-muted-foreground text-sm">{data === null ? '' : catalog.noData}</p> : history.totalRuns === 0 ? <p className="text-muted-foreground text-sm">{catalog.noData}</p> : <InsightsData catalog={catalog} history={history} />}</SurfaceColumn>;
}

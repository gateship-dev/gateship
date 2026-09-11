import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import type { AppProps } from './app-props.ts';
import { emptyDiagnostics, emptyModelSettings, emptyNotificationChannels, emptySelfUpdate, type OverviewRunsPageView, type ProjectOperationalOverviewView, type QueueOverviewView } from './client.ts';
import { Button } from './components/ui/button.tsx';
import type { Locale } from './locale.ts';
import type { OperatorRoute } from './routes.ts';
import type { RunView } from './run-view.ts';

type Theme = 'light' | 'dark';
type Motion = 'full' | 'reduced';
type Scenario = 'usual' | 'empty' | 'loading' | 'error' | 'attention' | 'unavailable' | 'long' | 'refreshing' | 'dense' | 'sidebar-expanded' | 'sidebar-collapsed' | 'tooltip-open' | 'selector-open';
type Viewport = '390' | '768' | '1440';
const CENTRAL_ROUTES = ['/overview', '/overview/runs', '/overview/queues', '/overview/insights'] as const;
const PROJECT = { id: 'harness-project', name: 'Gateship fixture', root: '/fixture/gateship', stateDir: '/fixture/state', readiness: 'ready' as const, repository: 'fixture/gateship', current: true };
const SECOND_PROJECT = { ...PROJECT, id: 'harness-project-beta', name: 'Gateship fixture beta', repository: 'fixture/gateship-beta', current: false };
const LONG_PROJECT = { ...PROJECT, name: 'Gateship fixture with an intentionally long project name for real Central wrapping coverage' };
const FIXED_NOW = '2026-09-10T12:00:00.000Z';
const RUN: RunView = { id: 'fixture-run', issueId: 'GSHIP-855', state: 'waiting-user', summary: 'Deterministic fixture run', error: null, updatedAt: '2026-09-10T12:00:00.000Z', cost: { totalCostUsd: 0.42, breakdown: [], roles: [] }, roundOrigins: { executor: 1, decision: 0, indeterminate: 0 }, providerWait: null, pullRequest: null, executorHandoff: null };
const OVERVIEW: ProjectOperationalOverviewView = { window: '30d', summary: { totalProjects: 1, readyProjects: 1, unavailableProjects: 0, nonTerminalRuns: 1, backlog: { idea: 1, specified: 1, planned: 2 } }, projects: [{ project: PROJECT, root: { state: 'available' }, backlog: { state: 'available', counts: { idea: 1, specified: 1, planned: 2 } }, database: { state: 'available', path: '/fixture/state/gateship.db' }, overview: { overview: null }, activeRun: { id: RUN.id, issueId: RUN.issueId, state: RUN.state, createdAt: RUN.updatedAt, updatedAt: RUN.updatedAt, providerId: 'codex' }, latestRun: null, latestRunOutcome: null, recentRuns: [] }], overview: { window: '30d', totalRuns: 2, runsWithKnownCost: 2, knownCostUsd: 0.84, runsByOutcome: { shipped: 1, failed: 0, cancelled: 0, incomplete: 1 }, activeRuns: 1, terminalRuns: 1, terminalWallTimeMs: 240000, terminalWallTimeRuns: 1, shippedWithoutIntervention: 1, dispatchToMergeMs: 180000, dispatchToMergeRuns: 1, medianDispatchToMergeMs: 180000, firstReviewPasses: 1, firstReviewPassKnownRuns: 1, ciCorrections: 0, fixRounds: 1, attentionRequests: 1, operatorInterventions: 1, providerHolds: 0, resolvedCycleQuestions: 0, reportedTokens: { inputTokens: 100, outputTokens: 50, cacheCreationInputTokens: null, cacheReadInputTokens: null, thinkingTokens: null }, daily: [], configurations: [], cohorts: [], cohortsPage: { limit: 20, offset: 0, returned: 0, total: 0 } } };
const EMPTY_RUNS: OverviewRunsPageView = { runs: [], page: { limit: 20, offset: 0, returned: 0, total: 0 }, errors: [] };
const QUEUES: QueueOverviewView = { queues: [{ project: PROJECT, readiness: 'ready', chainEnabled: true, pause: null, currentRun: null, currentIssue: { id: 'GSHIP-855', title: 'Central: transformar o harness existente em cenários das telas reais' }, plannedIssues: [{ id: 'GSHIP-861', title: 'Regression fixture' }], nextIssue: null, lastDelivery: { state: 'available', run: null } }], errors: [] };
const ATTENTION_QUEUES: QueueOverviewView = { queues: [{ ...QUEUES.queues[0]!, chainEnabled: false, pause: { reason: 'previous-run-not-done', createdAt: FIXED_NOW }, currentRun: { id: RUN.id, issueId: RUN.issueId, state: RUN.state, createdAt: RUN.updatedAt, updatedAt: RUN.updatedAt, providerId: 'codex' } }], errors: [] };
const UNAVAILABLE_QUEUES: QueueOverviewView = { queues: [], errors: [{ projectId: PROJECT.id, projectName: PROJECT.name, code: 'project-unavailable', message: 'fixture unavailable' }] };
const LONG_RUN: RunView = { ...RUN, issueId: 'GSHIP-855-LONG-ISSUE-TITLE-FOR-CENTRAL-WRAPPING-COVERAGE', summary: 'A deliberately long run summary rendered by the real Central runs surface to exercise wrapping and overflow behavior at every supported viewport.' };
const LONG_QUEUES: QueueOverviewView = { queues: [{ ...QUEUES.queues[0]!, project: LONG_PROJECT, currentIssue: { id: LONG_RUN.issueId, title: 'A deliberately long issue title rendered by the real Central queues surface for wrapping coverage' }, plannedIssues: [{ id: 'GSHIP-861', title: 'A deliberately long planned issue title for queue wrapping coverage' }] }], errors: [] };
const FRAME_WIDTHS = ['390', '768', '1440'] as const;
const SCENARIOS = ['usual', 'empty', 'loading', 'error', 'attention', 'unavailable', 'long', 'refreshing', 'dense', 'sidebar-expanded', 'sidebar-collapsed', 'tooltip-open', 'selector-open'] as const satisfies readonly Scenario[];
let harnessScenario: Scenario = 'usual';
let responseRevision = 0;
let clockInstalled = false;

function isScenario(value: string | null): value is Scenario {
	return value !== null && (SCENARIOS as readonly string[]).includes(value);
}

function isLocale(value: string | null): value is Locale {
	return value === 'pt-BR' || value === 'en-US';
}

function isTheme(value: string | null): value is Theme {
	return value === 'light' || value === 'dark';
}

function isMotion(value: string | null): value is Motion {
	return value === 'full' || value === 'reduced';
}

function isCentralRoute(value: string | null): value is typeof CENTRAL_ROUTES[number] {
	return value !== null && (CENTRAL_ROUTES as readonly string[]).includes(value);
}

const DENSE_EVALUATION: NonNullable<RunView['evaluation']> = {
	specProfile: { version: 'v2', fingerprint: 'fixture', counts: { acceptance: 8, boundaries: 4, verify: 3, evidence: 2 } }, corrections: { verification: 1, review: 1, fullVerify: 0, ci: 0, total: 2 }, cycleQuestions: { executor: 0, review: 0, fullVerify: 0, total: 0 }, reconciliations: { unchanged: 1, adapted: 0, 'contract-change-required': 0, total: 1 }, workflowRevision: 'fixture-v2', provider: 'codex', outcome: 'shipped', wallTimeMs: 120000, phaseDurations: { queued: { durationMs: 1000, entries: 1 }, working: { durationMs: 40000, entries: 1 }, verify: { durationMs: 20000, entries: 1 }, review: { durationMs: 30000, entries: 1 }, 'full-verify': { durationMs: 10000, entries: 1 }, shipping: { durationMs: 19000, entries: 1 }, 'waiting-provider': { durationMs: null, entries: 0 }, 'waiting-user': { durationMs: null, entries: 0 } }, unassignedDuration: { durationMs: 0, entries: 0 }, durationReconciliation: { classifiedMs: 120000, unassignedMs: 0, totalMs: 120000, toleranceMs: 1000, reconciles: true }, attentionRequests: 0, operatorInterventions: 0, providerHolds: 0, resolvedCycleQuestions: 0, roles: [],
};
const DENSE_ROWS: OverviewRunsPageView['runs'] = Array.from({ length: 45 }, (_, index) => { const project = index % 2 === 0 ? PROJECT : SECOND_PROJECT; const states = ['done', 'failed', 'waiting-user'] as const; const state = states[index % states.length]!; const updatedAt = index % 5 === 0 ? '2026-08-01T12:00:00.000Z' : index % 2 === 0 ? FIXED_NOW : '2026-09-06T12:00:00.000Z'; return { id: `fixture-run-${index + 1}`, issueId: `GSHIP-${900 + index}`, state, createdAt: updatedAt, updatedAt, providerId: index % 2 === 0 ? 'codex' as const : 'claude' as const, projectId: project.id, projectName: project.name, repository: project.repository, runId: `fixture-run-${index + 1}`, roles: [], evaluation: DENSE_EVALUATION, cost: RUN.cost, coverage: { verified: true, reviewed: true, fullVerification: true }, pullRequest: null, ci: null, merge: state === 'done' ? { status: 'merged' as const } : null }; });
const USUAL_RUNS: OverviewRunsPageView = { runs: [{ ...DENSE_ROWS[0]!, issueId: 'GSHIP-855', runId: 'fixture-run' }], page: { limit: 20, offset: 0, returned: 1, total: 1 }, errors: [] };
const DENSE_COHORT: ProjectOperationalOverviewView['overview']['cohorts'][number] = { workflowRevision: 'fixture-v2', specVersion: 'v2', latestTerminalRunAt: FIXED_NOW, sampleSize: 2, evidenceSufficient: true, outcomes: { shipped: { count: 2, denominator: 2 }, failed: { count: 0, denominator: 2 }, cancelled: { count: 0, denominator: 2 } }, corrections: { verification: { count: 0, denominator: 2 }, review: { count: 0, denominator: 2 }, fullVerify: { count: 0, denominator: 2 }, ci: { count: 0, denominator: 2 } }, cycleQuestions: { executor: { count: 0, denominator: 2 }, review: { count: 0, denominator: 2 }, fullVerify: { count: 0, denominator: 2 } }, reconciliations: { unchanged: { count: 2, denominator: 2 }, adapted: { count: 0, denominator: 2 }, 'contract-change-required': { count: 0, denominator: 2 } }, attentionRequests: { count: 0, denominator: 2 }, operatorInterventions: { count: 0, denominator: 2 }, providerHolds: { count: 0, denominator: 2 } };

function denseRuns(url: string): OverviewRunsPageView {
	const params = new URL(url, 'http://harness.invalid').searchParams;
	const filtered = filterDenseRuns(DENSE_ROWS, params);
	const sorted = sortDenseRuns(filtered, params);
	const offset = Math.max(0, Number(params.get('offset') ?? 0)); const limit = Math.max(1, Number(params.get('limit') ?? 20)); responseRevision += 1;
	return { runs: sorted.slice(offset, offset + limit).map((run) => ({ ...run, issueId: harnessScenario === 'refreshing' ? `${run.issueId}-r${responseRevision}` : run.issueId })), page: { limit, offset, returned: Math.max(0, Math.min(limit, sorted.length - offset)), total: sorted.length }, errors: [] };
}

function filterDenseRuns(rows: OverviewRunsPageView['runs'], params: URLSearchParams): OverviewRunsPageView['runs'] {
	const projectId = params.get('projectId');
	const state = params.get('state');
	const providerId = params.get('providerId');
	const period = params.get('period') ?? 'all';
	const search = (params.get('search') ?? '').toLocaleLowerCase();
	const cutoff = period === '7d' ? Date.parse('2026-09-03T00:00:00.000Z') : period === '30d' ? Date.parse('2026-08-11T00:00:00.000Z') : Number.NEGATIVE_INFINITY;
	return rows.filter((run) => (projectId === null || run.projectId === projectId) && (state === null || run.state === state) && (providerId === null || run.providerId === providerId) && Date.parse(run.updatedAt) >= cutoff && (search === '' || [run.issueId, run.runId, run.projectName].some((value) => value.toLocaleLowerCase().includes(search))));
}

function sortDenseRuns(rows: OverviewRunsPageView['runs'], params: URLSearchParams): OverviewRunsPageView['runs'] {
	const sortBy = params.get('sortBy');
	if (sortBy === null) return rows;
	const direction = params.get('sortDirection') === 'asc' ? 1 : -1;
	const value = (run: OverviewRunsPageView['runs'][number]): string => {
		switch (sortBy) {
			case 'projectName': return run.projectName;
			case 'issueId': return run.issueId;
			case 'state': return run.state;
			case 'providerId': return run.providerId;
			case 'createdAt': return run.createdAt;
			default: return run.updatedAt;
		}
	};
	return [...rows].sort((left, right) => value(left).localeCompare(value(right)) * direction);
}

function denseOverview(): NonNullable<ProjectOperationalOverviewView['overview']> {
	return { ...OVERVIEW.overview!, totalRuns: 45, cohorts: Array.from({ length: 25 }, () => DENSE_COHORT), cohortsPage: { limit: 20, offset: 0, returned: 20, total: 25 } };
}

function longRuns(): OverviewRunsPageView { return { runs: [{ ...DENSE_ROWS[0]!, issueId: LONG_RUN.issueId, projectId: LONG_PROJECT.id, projectName: LONG_PROJECT.name, repository: LONG_PROJECT.repository, runId: LONG_RUN.id }], page: { limit: 20, offset: 0, returned: 1, total: 1 }, errors: [] }; }
function longOverview(): ProjectOperationalOverviewView { return { ...OVERVIEW, projects: [{ ...OVERVIEW.projects[0]!, project: LONG_PROJECT, activeRun: { ...OVERVIEW.projects[0]!.activeRun!, issueId: LONG_RUN.issueId } }] }; }

function installClock(): () => void {
	const runtime = globalThis as unknown as { Date: DateConstructor & { __gateshipHarness?: boolean } };
	if (clockInstalled) return () => undefined;
	const OriginalDate = runtime.Date;
	class HarnessDate extends OriginalDate {
		constructor(...args: Array<string | number | Date>) { super(args.length === 0 ? FIXED_NOW : args[0] ?? FIXED_NOW); }
		static override now(): number { return OriginalDate.parse(FIXED_NOW); }
	}
	runtime.Date = HarnessDate as unknown as DateConstructor;
	clockInstalled = true;
	return () => { runtime.Date = OriginalDate; clockInstalled = false; };
}

function installTransport(): void {
	const runtime = globalThis as unknown as { window?: { fetch: (input: unknown, init?: unknown) => Promise<Response> } };
	if (runtime.window === undefined || runtime.window.fetch.name === 'gateshipHarnessFetch') return;
	const memory = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } } });
	const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
	runtime.window.fetch = async function gateshipHarnessFetch(input: unknown, init?: unknown): Promise<Response> { return harnessResponse(String(input), (init as { method?: string } | undefined)?.method, json); };
}

function harnessResponse(url: string, method: string | undefined, json: (body: unknown) => Response): Response | Promise<Response> {
	if (method !== undefined && method !== 'GET') return json({ message: 'Harness transport is read-only.' });
	if (url.includes('/api/overview/runs')) return runsResponse(url, json);
	if (url.includes('/api/overview/queues')) return queueResponse(json);
	if (url.includes('/api/overview')) return overviewResponse(json);
	return new Response(JSON.stringify({ message: 'Harness fixture route not found.' }), { status: 404, headers: { 'content-type': 'application/json' } });
}

function runsResponse(url: string, json: (body: unknown) => Response): Response {
	if (harnessScenario === 'dense' || harnessScenario === 'refreshing') return json(denseRuns(url));
	if (harnessScenario === 'long') return json(longRuns());
	return json(harnessScenario === 'empty' ? EMPTY_RUNS : USUAL_RUNS);
}

function overviewResponse(json: (body: unknown) => Response): Response {
	if (harnessScenario === 'dense' || harnessScenario === 'refreshing') return json({ overview: denseOverview() });
	return json({ overview: harnessScenario === 'long' ? longOverview() : OVERVIEW });
}

function queueResponse(json: (body: unknown) => Response): Response | Promise<Response> {
	if (harnessScenario === 'loading') return new Promise<Response>(() => undefined);
	if (harnessScenario === 'error') return new Response(JSON.stringify({ message: 'fixture queue failure' }), { status: 500, headers: { 'content-type': 'application/json' } });
	if (harnessScenario === 'empty') return json({ queues: [], errors: [] });
	if (harnessScenario === 'unavailable') return json(UNAVAILABLE_QUEUES);
	return json(harnessScenario === 'attention' ? ATTENTION_QUEUES : harnessScenario === 'long' ? LONG_QUEUES : QUEUES);
}
const noop = (): void => undefined;
const asyncNoop = async (): Promise<void> => undefined;
const projectStatus = { state: 'ready' as const, name: PROJECT.name, repository: PROJECT.repository, remoteUrl: 'https://example.invalid/fixture', sourceRef: 'origin/main' as const };

function initialScenario(interaction: string | null, requested: string | null): Scenario {
	return interaction !== null && isScenario(interaction) ? interaction : isScenario(requested) ? requested : 'usual';
}

type HarnessBrowser = { document: { querySelector: (selector: string) => { dispatchEvent: (event: unknown) => void; getAttribute?: (name: string) => string | null; focus?: () => void; blur?: () => void; click?: () => void } | null; dispatchEvent: (event: unknown) => void }; KeyboardEvent: new (type: string, init: { bubbles: boolean; key: string }) => unknown; MouseEvent: new (type: string, init: { bubbles: boolean }) => unknown; setTimeout: (callback: () => void, delay: number) => unknown };

function syncSidebarScenario(browser: HarnessBrowser, scenario: Scenario): void {
	const toggle = browser.document.querySelector('[data-slot="sidebar-toggle"]');
	const expanded = toggle?.getAttribute?.('aria-expanded') === 'true';
	const shouldCollapse = scenario === 'sidebar-collapsed' || scenario === 'tooltip-open';
	if (shouldCollapse && expanded) toggle?.dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
	if (!shouldCollapse && !expanded) toggle?.dispatchEvent(new browser.MouseEvent('click', { bubbles: true }));
}

function syncSelectorScenario(browser: HarnessBrowser, scenario: Scenario): void {
	if (scenario !== 'selector-open') return;
	const selector = browser.document.querySelector('[data-slot="project-switcher"]');
	const open = selector?.getAttribute?.('aria-expanded') === 'true';
	if (!open && selector !== null) browser.setTimeout(() => selector.click?.(), 0);
}

function syncTooltipScenario(browser: HarnessBrowser, scenario: Scenario): void {
	const target = browser.document.querySelector('[data-slot="global-navigation"] a[aria-label]');
	if (scenario !== 'tooltip-open') {
		target?.blur?.();
		target?.dispatchEvent(new browser.MouseEvent('mouseout', { bubbles: true }));
		return;
	}
	target?.focus?.();
	if (target !== null) browser.setTimeout(() => target.dispatchEvent(new browser.MouseEvent('mouseover', { bubbles: true })), 50);
}

function syncInteractionScenario(scenario: Scenario, previousScenario: { current: Scenario | null }): void {
	const browser = globalThis as unknown as HarnessBrowser;
	if (previousScenario.current === scenario) return;
	syncSidebarScenario(browser, scenario);
	syncSelectorScenario(browser, scenario);
	syncTooltipScenario(browser, scenario);
	previousScenario.current = scenario;
}

function fixtureProps(locale: Locale, route: OperatorRoute, scenario: Scenario): Omit<AppProps, 'diagnostics'> {
	const fixtureScenario = scenarioFixture(route === '/overview/insights' && scenario === 'dense' ? 'long' : scenario);
	const empty = fixtureScenario === 'empty';
	const scenarioRun = fixtureRun(fixtureScenario);
	const longText = 'Fixture objective';
	return { route, surfaceRoute: route, locale, project: fixtureScenario === 'long' ? { ...projectStatus, name: LONG_PROJECT.name, repository: LONG_PROJECT.repository } : projectStatus, projects: empty ? [] : [fixtureScenario === 'long' ? LONG_PROJECT : PROJECT], selectedProjectId: PROJECT.id, backlog: [], ideas: [], drafts: [], proposals: [], resolvedProposals: [], resolvedProposalsOmittedCount: 0, events: [], workspaceNotices: [], providers: [], brief: { objective: longText, decisions: [], constraints: [], openItems: [] }, operatorProfile: { name: 'Fixture operator', timezone: 'UTC' }, suggestedTimezone: 'UTC', modelSettings: emptyModelSettings(), modelSettingsSource: 'provider-default', agentDefaults: { provider: 'codex', modelSettings: emptyModelSettings() }, chainRuns: { enabled: true, pause: null }, executorHandoff: { enabled: false }, selectedProvider: 'codex', providerSource: 'provider-default', notificationPermission: 'default', notificationChannels: emptyNotificationChannels(), selfUpdate: emptySelfUpdate(), runs: empty ? [] : [scenarioRun], selectedIssueId: null, version: 'harness', staleService: null, gitIdentity: null, status: null, pending: false, projectOnboardingPending: null, claudeCredentialError: null, overview: empty ? null : fixtureScenario === 'long' ? longOverview() : OVERVIEW, overviewLoading: fixtureScenario === 'loading', overviewError: fixtureScenario === 'error' ? 'fixture transport error' : null, operationalFailures: {}, operationalLoaded: {}, operationalPending: {}, ...(fixtureScenario === 'loading' ? { operationalBoundary: { state: 'loading' as const } } : {}), ...(fixtureScenario === 'error' ? { operationalRefreshFailure: { detail: 'fixture refresh error', onRetry: noop } } : {}), onSelectIssue: noop, onSelectLocale: noop, onCreateIssue: noop, onSpecifyIssue: noop, onReviewIssue: noop, onApproveIssue: noop, onAbandonIssue: noop, onDismissProposal: noop, onPromoteProposal: noop, onStartDiagnostic: noop, onCancelDiagnostic: noop, onDismissDiagnosticFinding: noop, onPromoteDiagnosticFinding: noop, onSaveDiagnosticSchedule: noop, onStart: noop, onResume: noop, onAbandon: noop, onCancel: noop, onShip: noop, onConnectCodex: noop, onConnectClaudeCredential: async () => false, onDismissClaudeCredentialError: noop, onDisconnectClaudeCredential: noop, onEnableNotifications: noop, onSendNotificationTest: noop, onSaveResendSettings: noop, onRemoveResendCredential: noop, onSelectProvider: noop, onResetProvider: noop, onSaveBrief: noop, onSaveModelSettings: noop, onResetModelSettings: noop, onSaveAgentDefaults: noop, onSaveOperatorProfile: noop, onSetChainRuns: noop, onSetExecutorHandoff: noop, onSetSelfUpdate: noop, onImportProject: noop, onCreateProject: noop, onRegisterProject: noop, onUnregisterProject: noop, onLoadPreviousRunEvents: asyncNoop };
}

function scenarioFixture(scenario: Scenario): Scenario {
	return scenario === 'sidebar-expanded' || scenario === 'sidebar-collapsed' || scenario === 'tooltip-open' || scenario === 'selector-open' ? 'usual' : scenario;
}

function fixtureRun(scenario: Scenario): RunView {
	return scenario === 'usual' ? { ...RUN, state: 'done' as const, summary: 'Completed deterministic fixture' } : scenario === 'long' ? LONG_RUN : RUN;
}

export function Harness(): React.ReactElement {
	installTransport();
	const runtime = globalThis as unknown as { window?: { location: { search: string } } };
	const frame = runtime.window === undefined ? null : new URLSearchParams(runtime.window.location.search).get('frame');
	const query = runtime.window === undefined ? new URLSearchParams() : new URLSearchParams(runtime.window.location.search);
	const interaction = query.get('interaction');
	const requestedScenario = query.get('scenario');
	const requestedLocale = query.get('locale');
	const requestedTheme = query.get('theme');
	const requestedMotion = query.get('motion');
	const requestedRoute = query.get('route');
	if (interaction === 'sidebar-collapsed' || interaction === 'tooltip-open') globalThis.localStorage?.setItem('gship-sidebar', 'closed');
	if (interaction === 'sidebar-expanded' || interaction === 'selector-open') globalThis.localStorage?.setItem('gship-sidebar', 'open');
	const [route, setRoute] = useState<OperatorRoute>(isCentralRoute(requestedRoute) ? requestedRoute : '/overview'); const [locale, setLocale] = useState<Locale>(isLocale(requestedLocale) ? requestedLocale : 'pt-BR'); const [theme, setTheme] = useState<Theme>(isTheme(requestedTheme) ? requestedTheme : 'light'); const [motion, setMotion] = useState<Motion>(isMotion(requestedMotion) ? requestedMotion : 'full'); const [scenario, setScenario] = useState<Scenario>(initialScenario(interaction, requestedScenario)); const viewport: Viewport = frame === '390' || frame === '768' || frame === '1440' ? frame : '1440';
	harnessScenario = scenario;
	const props = useMemo(() => fixtureProps(locale, route, scenario), [locale, route, scenario]);
	const previousScenario = useRef<Scenario | null>(null);
	useEffect(() => { syncInteractionScenario(scenario, previousScenario); }, [scenario]);
	useEffect(() => { const browser = globalThis as unknown as { window?: { dispatchEvent: (event: unknown) => void } }; browser.window?.dispatchEvent(new Event('popstate')); }, [scenario]);
	useEffect(() => { const document = (globalThis as unknown as { document: { documentElement: { lang: string; classList: { toggle: (name: string, force: boolean) => void } } } }).document; document.documentElement.lang = locale; document.documentElement.classList.toggle('dark', theme === 'dark'); }, [locale, theme]);
	useEffect(() => { const browser = globalThis as unknown as { document: { documentElement: { classList: { toggle: (name: string, force: boolean) => void } } }; window?: { history?: { replaceState: (state: null, title: string, url: string) => void }; location?: { search: string } } }; browser.document.documentElement.classList.toggle('gship-harness-reduced-motion', motion === 'reduced'); const params = new URLSearchParams(browser.window?.location?.search ?? ''); params.set('route', route); params.set('scenario', scenario); params.set('locale', locale); params.set('theme', theme); params.set('motion', motion); browser.window?.history?.replaceState(null, '', `?${params}`); }, [locale, motion, route, scenario, theme]);
	if (frame === null) return <ViewportPicker />;
	return <div className="min-h-screen bg-background text-foreground" data-harness="gateship-ui" data-fixture-catalog="central-real-routes-v2" data-locale={locale} data-theme={theme} data-motion={motion} data-scenario={scenario} data-viewport={viewport}><nav className="sticky top-0 z-10 flex flex-wrap gap-2 border-b bg-background/95 p-3" aria-label="Harness controls" data-fixture="controls" data-fixture-id="central-controls-v2"><strong className="mr-auto">Gateship UI harness</strong>{(['/overview', '/overview/runs', '/overview/queues', '/overview/insights'] as const).map((value) => <Button key={value} size="sm" variant={route === value ? 'default' : 'outline'} aria-pressed={route === value} onClick={() => setRoute(value)}>{value.replace('/overview', 'Central') || 'Central'}</Button>)}{(['usual', 'empty', 'loading', 'error', 'attention', 'unavailable', 'long', 'refreshing', 'dense', 'sidebar-expanded', 'sidebar-collapsed', 'tooltip-open', 'selector-open'] as const).map((value) => <Button key={value} size="sm" variant={scenario === value ? 'default' : 'outline'} onClick={() => setScenario(value)}>{value}</Button>)}{(['en-US', 'pt-BR'] as const).map((value) => <Button key={value} size="sm" variant={locale === value ? 'default' : 'outline'} onClick={() => setLocale(value)}>{value}</Button>)}{(['light', 'dark'] as const).map((value) => <Button key={value} size="sm" variant={theme === value ? 'default' : 'outline'} onClick={() => setTheme(value)}>{value}</Button>)}{(['full', 'reduced'] as const).map((value) => <Button key={value} size="sm" variant={motion === value ? 'default' : 'outline'} onClick={() => setMotion(value)}>{value}</Button>)}</nav><section className="border-b p-4" data-fixture-catalog="visible-catalog"><h2 className="font-semibold">Fixture catalog</h2><p className="text-sm text-muted-foreground">Examples for extending the real Central surfaces:</p><ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2"><li><code>central.overview</code>: usual, empty, loading, error</li><li><code>central.runs</code>: dense table, filters, pagination</li><li><code>central.queues</code>: attention, empty, unavailable, error, loading</li><li><code>central.insights</code>: long text, refreshing cohorts</li><li><code>central.shell</code>: sidebar-expanded, sidebar-collapsed, tooltip-open, selector-open</li><li><code>effects</code>: full, reduced</li></ul></section><div className="min-h-[calc(100vh-5rem)]"><App diagnostics={emptyDiagnostics()} {...props} /></div></div>;
}
function ViewportPicker(): React.ReactElement {
	const [viewport, setViewport] = useState<Viewport>('1440');
	return <div className="min-h-screen bg-background text-foreground" data-harness="gateship-ui-viewport-picker"><div className="flex flex-wrap items-center gap-2 border-b p-3 text-sm"><strong className="mr-auto">Gateship UI harness</strong>{FRAME_WIDTHS.map((value) => <Button key={value} size="sm" variant={viewport === value ? 'default' : 'outline'} aria-pressed={viewport === value} onClick={() => setViewport(value)}>{value} px</Button>)}</div><iframe className="block h-[1200px] border-0" width={viewport} src={`/harness.html?frame=${viewport}`} title={`Gateship UI harness at ${viewport}px`} /></div>;
}
const documentRuntime = globalThis as unknown as { document?: { getElementById: (id: string) => HTMLElement | null } };
if (documentRuntime.document !== undefined) {
	const restoreClock = installClock();
	const root = documentRuntime.document.getElementById('harness-root');
	if (root !== null) {
		createRoot(root).render(<Harness />);
		const runtimeWindow = globalThis as unknown as { window?: { addEventListener: (event: string, listener: () => void) => void } };
		runtimeWindow.window?.addEventListener('pagehide', restoreClock);
	}
}

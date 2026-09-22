// webui/src/App.tsx
//
// The application entry point stays deliberately narrow. Route surfaces are
// implemented under screens so this module remains the stable public boundary.

import React, { useEffect } from 'react';
import type { AppProps } from './app-props.ts';
import { AppShell } from './app-shell.tsx';
import { InitialOperationalFailure, InitialOperationalLoading, OperationalRefreshFailure } from './initial-loading.tsx';
import { LOCALE_CATALOG } from './locale.ts';
import { routeSelection } from './routes.ts';
import { RouteScreen } from './screens/route-screen.tsx';
import { SurfaceColumn } from './screens/surface-column.tsx';
import { GlobalSettingsSurface } from './screens/global-settings-screen.tsx';
import { NonCurrentProjectSurface } from './screens/non-current-project-screen.tsx';
import { OnboardingSurface } from './screens/onboarding-screen.tsx';
import { OverviewSurface } from './screens/overview-screen.tsx';
import { OverviewRunsSurface } from './screens/overview-runs-screen.tsx';
import { OverviewQueuesSurface } from './screens/overview-queues-screen.tsx';
import { OverviewInsightsSurface } from './screens/overview-insights-screen.tsx';
import { ProjectsManagementSurface } from './screens/projects-management-screen.tsx';
import { RunsSurface } from './screens/runs-screen.tsx';
import { SettingsSurface } from './screens/settings-screen.tsx';
import {
	destinationHrefs,
	destinationIndex,
	panelRuntime,
	type PanelKeyEvent,
	ShellControls,
	ShellSidebar,
	ShellTabBar,
	notificationItems,
	shellSurfaceTitle,
	useSidebarOpen,
	useStoredOpen,
} from './screens/shell.tsx';
import { WorkSurface } from './screens/work-screen.tsx';
import { KEYBOARD_SHORTCUTS, matchesShortcut } from './keyboard-shortcuts.ts';

export { projectIdOf, routeOf, runIdOf } from './routes.ts';
export type { AppProps } from './app-props.ts';
export type { OperatorRoute } from './routes.ts';

/* A key pressed inside a field belongs to the field: on a Mac Alt+arrow moves the caret by word and Alt with a letter or a digit writes a character. */
function isTextEntry(target: PanelKeyEvent['target']): boolean {
	if (target === undefined || target === null) return false;
	if (target.isContentEditable === true) return true;
	const tag = (target.tagName ?? '').toLowerCase();
	return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function handleProjectShortcut(
	event: PanelKeyEvent,
	projects: AppProps['projects'],
	runtime = panelRuntime(),
	navigate?: (destination: string) => void,
): boolean {
	const index = KEYBOARD_SHORTCUTS.projects.findIndex((shortcut) => matchesShortcut(event, shortcut));
	if (index < 0 || isTextEntry(event.target)) return false;
	const project = projects[index];
	if (project === undefined) return false;
	event.preventDefault();
	const destination = `/projects/${encodeURIComponent(project.id)}`;
	if (navigate === undefined) runtime.location?.assign(destination);
	else navigate(destination);
	return true;
}

/** Alt with an arrow walks the destinations, wrapping at the ends; from a page that is not one, down opens the first and up the last. */
export function handleDestinationShortcut(
	event: PanelKeyEvent,
	hrefs: readonly string[],
	currentIndex: number,
	runtime = panelRuntime(),
	navigate?: (destination: string) => void,
): boolean {
	const forward = matchesShortcut(event, KEYBOARD_SHORTCUTS.nextDestination);
	if (!forward && !matchesShortcut(event, KEYBOARD_SHORTCUTS.previousDestination)) return false;
	if (isTextEntry(event.target) || hrefs.length === 0) return false;
	event.preventDefault();
	const step = forward ? 1 : -1;
	const index = currentIndex < 0 ? (forward ? 0 : hrefs.length - 1) : (currentIndex + step + hrefs.length) % hrefs.length;
	const destination = hrefs[index]!;
	if (navigate === undefined) runtime.location?.assign(destination);
	else navigate(destination);
	return true;
}

export function handleOverviewShortcut(event: PanelKeyEvent, runtime = panelRuntime(), navigate?: (destination: string) => void, selectAllProjects?: () => void): boolean {
	if (!matchesShortcut(event, KEYBOARD_SHORTCUTS.overview) || isTextEntry(event.target)) return false;
	event.preventDefault();
	/* Same action as the switcher's first choice: every project in view. */
	if (selectAllProjects !== undefined) selectAllProjects();
	else if (navigate === undefined) runtime.location?.assign('/overview');
	else navigate('/overview');
	return true;
}

export function App(props: AppProps): React.ReactElement {
	const currentProject = props.projects.find((project) => project.current) ?? null;
	const selection = routeSelection(
		props.surfaceRoute ?? props.route,
		currentProject?.id ?? null,
		props.selectedProjectId ?? null,
	);
	const selectedProject = props.projects.find((project) => project.id === selection.projectId) ?? null;
	const run = selection.runId === undefined
		? props.runs[0] ?? null
		: props.runs.find((candidate) => candidate.id === selection.runId) ?? null;
	const localeCatalog = LOCALE_CATALOG[props.locale];
	const notifications = notificationItems(
		selectedProject ?? (selection.projectId === null ? currentProject : null),
		props.chainRuns,
		run,
		props.workspaceNotices,
		props.staleService,
		props.gitIdentity,
		props.events,
		localeCatalog.shell.notifications,
	);
	const selectedProjectId = props.selectedProjectId ?? null;
	const [sidebarOpen, toggleSidebar] = useSidebarOpen();
	const [inspectorOpen, toggleInspector] = useStoredOpen('gship-inspector');
	useEffect(() => {
		const runtime = panelRuntime();
		const onKeyDown = (event: PanelKeyEvent): void => {
			if (handleOverviewShortcut(event, runtime, props.onNavigate, props.onSelectAllProjects)) {
				return;
			}
			if (handleDestinationShortcut(event, destinationHrefs(selection, props.projects), destinationIndex(selection), runtime, props.onNavigate)) {
				return;
			}
			handleProjectShortcut(event, props.projects, runtime, props.onNavigate);
		};
		runtime.addEventListener?.('keydown', onKeyDown);
		return () => runtime.removeEventListener?.('keydown', onKeyDown);
	}, [props.projects, props.onSelectAllProjects, selection, toggleSidebar]);
	return (
		<AppShell
			controls={<ShellControls catalog={localeCatalog.shell} inspectorOpen={inspectorOpen} locale={props.locale} notifications={notifications} onSelectLocale={props.onSelectLocale} onToggleInspector={toggleInspector} onToggleSidebar={toggleSidebar} showInspectorToggle={false} sidebarOpen={sidebarOpen} title={shellSurfaceTitle(selection, localeCatalog.shell)} />}
			sidebar={<ShellSidebar chainRuns={props.chainRuns} gitIdentity={props.gitIdentity} locale={props.locale} onSelectAllProjects={props.onSelectAllProjects} open={sidebarOpen} overview={props.overview} projects={props.projects} runInspectorCatalog={localeCatalog.runInspector} route={props.route} run={run} selectedProjectId={selectedProjectId} staleService={props.staleService} version={props.version} workspaceNotices={props.workspaceNotices} />}
			skipLabel={localeCatalog.shell.skipLinkLabel}
			tabBar={<ShellTabBar locale={props.locale} overview={props.overview} projects={props.projects} route={props.route} selectedProjectId={selectedProjectId} />}
		>
			{props.operationalBoundary?.state === 'loading' ? <InitialOperationalLoading locale={props.locale} /> : null}
			{props.operationalBoundary?.state === 'failure' ? <InitialOperationalFailure detail={props.operationalBoundary.detail} locale={props.locale} onRetry={props.operationalBoundary.onRetry} /> : null}
			{props.operationalRefreshFailure === undefined ? null : <OperationalRefreshFailure detail={props.operationalRefreshFailure.detail} locale={props.locale} onRetry={props.operationalRefreshFailure.onRetry} />}
			{props.operationalBoundary === undefined ? <RouteScreen
				currentProjectReady={props.project.state === 'ready'}
				screens={{
					overview: () => <OverviewSurface {...props} />,
					overviewRuns: () => <OverviewRunsSurface props={props} />,
					overviewQueues: () => <OverviewQueuesSurface props={props} />,
					overviewInsights: () => <OverviewInsightsSurface props={props} />,
					projects: () => <ProjectsManagementSurface {...props} />,
					globalSettings: () => <GlobalSettingsSurface {...props} />,
					notFound: () => (
						<SurfaceColumn label={localeCatalog.projects.notFoundTitle} status={props.status}>
							<h2 className="font-semibold text-xl">{localeCatalog.projects.notFoundTitle}</h2>
							<p className="text-muted-foreground text-sm">{localeCatalog.projects.notFoundDescription}</p>
						</SurfaceColumn>
					),
					nonCurrent: (project, surface) => <NonCurrentProjectSurface props={props} selectedProject={project} surface={surface} />,
					onboarding: (project) => <OnboardingSurface catalog={localeCatalog.onboarding} project={props.project} settingsHref={`/projects/${encodeURIComponent(project.id)}/settings`} status={props.status} />,
					runs: () => <RunsSurface {...props} />,
					work: () => <WorkSurface {...props} />,
					settings: () => <SettingsSurface {...props} />,
				}}
				selectedProject={selectedProject}
				selection={selection}
			/> : null}
		</AppShell>
	);
}

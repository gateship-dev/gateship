import type { ShellCatalog } from './locale.ts';

/** The URL owns the surface and project scope; overview may retain navigation context. */
export type OperatorRoute = '/overview' | '/overview/runs' | '/overview/queues' | '/projects' | `/projects/${string}` | '/' | '/runs' | '/work' | '/settings';

export type ProjectSurface = 'runs' | 'work' | 'settings';

export interface RouteSelection {
	projectId: string | null;
	runId?: string;
	surface: ProjectSurface | 'overview' | 'overview-runs' | 'overview-queues' | 'projects' | 'global-settings';
}

export const PROJECT_SURFACES: readonly {
	suffix: string;
	label: keyof ShellCatalog['routeLabels'];
	surface: ProjectSurface;
}[] = [
	{ suffix: '/runs', label: 'runs', surface: 'runs' },
	{ suffix: '/work', label: 'work', surface: 'work' },
	{ suffix: '/settings', label: 'settings', surface: 'settings' },
];

export function routeOf(pathname: string): OperatorRoute {
	const normalized = pathname.replace(/\/+$/, '');
	const path = normalized === '' ? '/' : normalized;
	if (path === '/overview' || path === '/overview/runs' || path === '/overview/queues') return path;
	if (path === '/projects') return path;
	if (path === '/' || path === '/runs' || path === '/work' || path === '/settings') return path;
	if (/^\/projects\/[^/]+(?:\/runs(?:\/[^/]+)?|\/work|\/settings)?$/.test(path)) {
		return path as `/projects/${string}`;
	}
	return '/overview';
}

function overviewSelection(route: OperatorRoute, selectedProjectId: string | null): RouteSelection | null {
	if (route === '/overview') return { projectId: selectedProjectId, surface: 'overview' };
	if (route === '/overview/runs') return { projectId: selectedProjectId, surface: 'overview-runs' };
	if (route === '/overview/queues') return { projectId: selectedProjectId, surface: 'overview-queues' };
	return null;
}

export function routeSelection(route: OperatorRoute, currentId: string | null, selectedProjectId: string | null = null): RouteSelection {
	const overview = overviewSelection(route, selectedProjectId);
	if (overview !== null) return overview;
	if (route === '/projects') return { projectId: null, surface: 'projects' };
	const legacy = route === '/' ? 'runs' : route.slice(1);
	if (route === '/settings') return { projectId: null, surface: 'global-settings' };
	if (route === '/' || route === '/runs' || route === '/work') {
		return { projectId: currentId, surface: legacy as ProjectSurface };
	}
	const match = /^\/projects\/([^/]+)(?:\/(runs)(?:\/([^/]+))?|\/(work|settings))?$/.exec(route);
	if (match === null) return { projectId: null, surface: 'overview' };
	let projectId = match[1] ?? '';
	try { projectId = decodeURIComponent(projectId); } catch { /* unmatched id stays unavailable */ }
	let runId: string | undefined;
	if (match[3] !== undefined) {
		try { runId = decodeURIComponent(match[3]); } catch { runId = match[3]; }
	}
	return { projectId, ...(runId === undefined ? {} : { runId }), surface: (match[2] ?? match[4] ?? 'runs') as ProjectSurface };
}

export function projectIdOf(pathname: string): string | null {
	return routeSelection(routeOf(pathname), null).projectId;
}

export function runIdOf(pathname: string): string | null {
	const route = routeOf(pathname);
	const match = /^\/projects\/[^/]+\/runs\/([^/]+)$/.exec(route);
	if (match === null) return null;
	try { return decodeURIComponent(match[1]!); } catch { return match[1] ?? null; }
}

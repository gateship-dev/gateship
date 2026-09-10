import type React from 'react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ShellControls, ShellSidebar, notificationItems } from './screens/shell.tsx';
import { LOCALE_CATALOG, type Locale } from './locale.ts';
import { shortcutLabel, type PresentationPlatform } from './keyboard-shortcuts.ts';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardPanel, CardTitle } from './components/ui/card.tsx';
import { CardGrid, CardStack } from './components/ui/card-layout.tsx';
import { AttentionCard } from './components/ui/attention-card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Button } from './components/ui/button.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Stat } from './components/ui/stat.tsx';

type Theme = 'light' | 'dark';
type Width = 'centered' | 'wide';
type Viewport = '390' | '768' | '1440';

const PROJECT = { id: 'harness-project', name: 'Gateship', root: '/workspace/gateship', stateDir: '/state', readiness: 'ready' as const, repository: 'gateship-dev/gateship', current: true };
const RUN = { id: 'harness-run', issueId: 'GSHIP-827', state: 'waiting-user', createdAt: '2026-09-09T12:00:00.000Z', updatedAt: '2026-09-09T12:05:00.000Z', providerId: 'codex' };
const PLATFORMS: readonly PresentationPlatform[] = ['macOS', 'Windows', 'Linux', 'unknown'];
const VIEWPORT_WIDTH_CLASS: Record<Viewport, string> = { '390': 'w-[390px]', '768': 'w-[768px]', '1440': 'w-[1440px]' };

function ViewportHarness(): React.ReactElement {
	const [viewport, setViewport] = useState<Viewport>('1440');
	return <div className="min-h-screen bg-background p-3 text-foreground" data-harness="gateship-ui-viewport-picker">
		<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 pb-3 text-sm" data-fixture="viewport-controls" data-fixture-id="viewport-controls-v1">
			<strong className="mr-auto type-eyebrow">Gateship UI harness</strong>
			<span className="type-eyebrow text-muted-foreground">Viewport</span>
			{(['390', '768', '1440'] as const).map((value) => <Button key={value} size="sm" variant={viewport === value ? 'default' : 'outline'} aria-pressed={viewport === value} onClick={() => setViewport(value)}>{value} px</Button>)}
		</div>
		<iframe className={`mx-auto block h-[1200px] max-w-full border border-border ${VIEWPORT_WIDTH_CLASS[viewport]}`} src={`/harness.html?frame=${viewport}`} title={`Gateship UI harness at ${viewport}px`} />
	</div>;
}

export function Harness(): React.ReactElement {
	const runtimeWindow = globalThis as unknown as { window?: { location: { search: string } } };
	const frame = runtimeWindow.window === undefined ? null : new URLSearchParams(runtimeWindow.window.location.search).get('frame');
	const [locale, setLocale] = useState<Locale>('en-US');
	const [theme, setTheme] = useState<Theme>('light');
	const [width, setWidth] = useState<Width>('centered');
	const [viewport, setViewport] = useState<Viewport>(frame === '390' || frame === '768' || frame === '1440' ? frame : '1440');
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const catalog = LOCALE_CATALOG[locale];
	const notifications = notificationItems(PROJECT, { enabled: false, pause: null }, RUN as never, [], null, null, [], catalog.shell.notifications);
	if (runtimeWindow.window !== undefined && frame === null) return <ViewportHarness />;

	useEffect(() => {
		const root = document as unknown as { documentElement: { classList: { toggle: (name: string, force: boolean) => void }; lang: string } };
		root.documentElement.classList.toggle('dark', theme === 'dark');
		root.documentElement.classList.toggle('gship-wide', width === 'wide');
		root.documentElement.lang = locale;
	}, [locale, theme, width]);

	return <div className="min-h-screen bg-background text-foreground" data-harness="gateship-ui" data-locale={locale} data-theme={theme} data-width={width} data-viewport={viewport}>
		<div className="sticky top-0 z-10 border-b border-border bg-background/95 p-3 backdrop-blur">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-sm" data-fixture="matrix-controls" data-fixture-id="matrix-controls-v1">
				<strong className="mr-auto type-eyebrow">Gateship UI harness</strong>
				<span className="type-eyebrow text-muted-foreground">Theme</span>
				{(['light', 'dark'] as const).map((value) => <Button key={value} size="sm" variant={theme === value ? 'default' : 'outline'} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</Button>)}
				<span className="type-eyebrow text-muted-foreground">Locale</span>
				{(['en-US', 'pt-BR'] as const).map((value) => <Button key={value} size="sm" variant={locale === value ? 'default' : 'outline'} aria-pressed={locale === value} onClick={() => setLocale(value)}>{value}</Button>)}
				<span className="type-eyebrow text-muted-foreground">Width</span>
				{(['centered', 'wide'] as const).map((value) => <Button key={value} size="sm" variant={width === value ? 'default' : 'outline'} aria-pressed={width === value} onClick={() => setWidth(value)}>{value}</Button>)}
				<span className="type-eyebrow text-muted-foreground">Frame</span>
				{(['390', '768', '1440'] as const).map((value) => <Button key={value} size="sm" variant={viewport === value ? 'default' : 'outline'} aria-pressed={viewport === value} onClick={() => setViewport(value)}>{value} px</Button>)}
				<span className="type-eyebrow text-muted-foreground">Sidebar</span>
				{([true, false] as const).map((value) => <Button key={String(value)} size="sm" variant={sidebarOpen === value ? 'default' : 'outline'} aria-pressed={sidebarOpen === value} onClick={() => setSidebarOpen(value)}>{value ? 'expanded' : 'collapsed'}</Button>)}
			</div>
		</div>
		<div className={`mx-auto max-w-full ${VIEWPORT_WIDTH_CLASS[viewport]}`}>
			<div className="flex min-h-[calc(100vh-5rem)] flex-col bg-sidebar lg:flex-row" data-fixture="shell" data-fixture-id="shell-v1" data-scroll-contract="external-canvas-no-gutter internal-scroll-stable">
				<ShellSidebar chainRuns={{ enabled: false, pause: null }} gitIdentity={null} locale={locale} open={sidebarOpen} projects={[PROJECT]} route="/projects/harness-project/runs" run={null} runInspectorCatalog={catalog.runInspector} selectedProjectId={PROJECT.id} staleService={null} version="0.0.0-harness" workspaceNotices={[]} />
				<main className="min-w-0 flex-1 bg-background p-3 lg:p-6">
					<ShellControls catalog={catalog.shell} inspectorOpen={false} locale={locale} notifications={notifications} onSelectLocale={setLocale} onToggleInspector={() => {}} onToggleSidebar={() => setSidebarOpen((open) => !open)} showInspectorToggle={false} sidebarOpen={sidebarOpen} title={catalog.shell.routeLabels.runs} />
					<div className="mx-auto mt-6 w-full max-w-(--content-measure) gship-harness-content">
						<header className="mb-6" data-fixture="header" data-fixture-id="header-v1"><p className="type-eyebrow text-muted-foreground">Shared component inventory</p><h1 className="type-page-title mt-2">{locale === 'pt-BR' ? 'Componentes reais da shell' : 'Real shell components'}</h1><p className="mt-2 max-w-prose text-muted-foreground">{locale === 'pt-BR' ? 'Estados estáveis para inspeção manual.' : 'Stable states for manual inspection.'}</p></header>
					<CardStack>
						<div data-fixture="stats" data-fixture-id="stats-v1"><CardGrid className="grid-cols-2 xl:grid-cols-4"><Stat label="Runs" value="08" hint="deterministic" /><Stat label="Latency" value="240 ms" hint="fixed sample" /><Stat label="Review" value="ready" hint="read only" /><Stat label="Output" value="12 KB" hint="long form" /></CardGrid></div>
						<Card data-fixture="controls-and-badges" data-fixture-id="controls-v1"><CardHeader><CardTitle>Controls and status</CardTitle><CardDescription>Buttons, badges, inputs and stable keyboard labels.</CardDescription><CardAction><Badge variant="info">fixture</Badge></CardAction></CardHeader><CardPanel className="gap-5"><div className="flex flex-wrap gap-2">{(['default', 'secondary', 'outline', 'ghost', 'attention', 'destructive'] as const).map((variant) => <Button key={variant} variant={variant}>{variant}</Button>)}</div><div className="flex flex-wrap gap-2">{(['default', 'info', 'success', 'warning', 'error', 'merged', 'attention', 'outline'] as const).map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}</div><label className="grid gap-1 text-sm">Repository<input aria-label="Repository" defaultValue="gateship-dev/gateship" className="rounded-lg border border-input bg-background px-3 py-2" /></label><div className="flex flex-wrap gap-2">{PLATFORMS.map((platform) => <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-xs" data-platform={platform} key={platform}>{platform}: {shortcutLabel('overview', undefined, platform)} · {shortcutLabel('project', 0, platform)}</kbd>)}</div></CardPanel><CardFooter><Button variant="outline">Cancel</Button><Button>Apply fixture</Button></CardFooter></Card>
						<div className="grid gap-6 xl:grid-cols-2"><Card data-fixture="typography" data-fixture-id="typography-v1"><CardHeader><CardTitle>Typography card</CardTitle></CardHeader><CardPanel><p className="type-body text-lg">A concise operational summary with a readable measure.</p><p className="type-data">run/harness-run · 00:04 · $0.00</p><p className="type-eyebrow text-muted-foreground">Output metadata</p></CardPanel></Card><AttentionCard data-fixture="operator-attention" data-fixture-id="attention-v1" title={locale === 'pt-BR' ? 'A ação do operador é necessária' : 'Operator action is needed'}><p className="text-sm">GSHIP-827 {locale === 'pt-BR' ? 'aguarda confirmação.' : 'is waiting for confirmation.'}</p><Button variant="attention" size="sm">Review run</Button></AttentionCard></div>
						<div className="grid gap-6 xl:grid-cols-2"><Card data-fixture="empty-states" data-fixture-id="empty-v1"><CardHeader><CardTitle>Empty states</CardTitle></CardHeader><CardPanel><EmptyState compact>No pending proposals.</EmptyState><EmptyState compact action={<Button size="sm">Create issue</Button>}>No runs in this window.</EmptyState></CardPanel></Card><Card data-fixture="notifications" data-fixture-id="notifications-v1"><CardHeader><CardTitle>Notification center</CardTitle></CardHeader><CardPanel><p className="text-sm text-muted-foreground">The real shell notification trigger is in the header.</p><p className="type-data text-xs">{notifications.length} actionable fixture</p></CardPanel></Card></div>
						<Card data-fixture="long-outputs" data-fixture-id="long-output-v1"><CardHeader><CardTitle>Long outputs</CardTitle></CardHeader><CardPanel><pre className="scroll-container scroll-fade max-h-72 overflow-auto rounded-lg border border-border bg-code p-4 font-mono text-xs leading-5 text-code-foreground">{Array.from({ length: 18 }, (_, index) => `2026-09-09T12:0${index % 10}:00.000Z  step-${String(index + 1).padStart(2, '0')}  deterministic output line for visual inspection`).join('\n')}</pre></CardPanel></Card>
					</CardStack>
					</div>
				</main>
			</div>
		</div>
	</div>;
}

if (typeof document !== 'undefined') {
	const root = (document as unknown as { getElementById: (id: string) => HTMLElement | null }).getElementById('harness-root');
	if (root !== null) createRoot(root).render(<Harness />);
}

// webui/src/screens/shell.tsx

import React from 'react';
import type { AppProps } from '../app-props.ts';
import { ShellContentFrame } from '../app-shell.tsx';
import type { ChainPauseReason, ChainRunsView, RegisteredProjectView } from '../client.ts';
import { GateshipMark, GateshipWordmark } from '../components/gateship-logo.tsx';
import { Button, buttonVariants } from '../components/ui/button.tsx';
import { cn } from '../lib/cn.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import type { RunInspectorCatalog, ShellCatalog } from '../locale.ts';
import { routeSelection } from '../routes.ts';
import type { OperatorRoute } from '../routes.ts';
import { attentionOf } from '../run-view.ts';
import type { OperatorAttention, RunView } from '../run-view.ts';
import { Menu } from '@base-ui/react/menu';
import { HintTooltip, TooltipGroup } from '../components/ui/tooltip.tsx';
import { Popover } from '@base-ui/react/popover';
import { Activity01Icon, Alert02Icon, Queue01Icon, ArrowExpand01Icon, ArrowShrink01Icon, ChartAnalysisIcon, FolderManagementIcon, Globe02Icon, Grid2X2Icon, ListViewIcon, Moon02Icon, Notification02Icon, Settings01Icon, Sun02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useId, useState } from 'react';
import { KEYBOARD_SHORTCUTS, PROJECT_SHORTCUT_COUNT, presentationPlatform, projectShortcutAria, shortcutLabel } from '../keyboard-shortcuts.ts';

const SHELL_ICON_SIZE = 16;
const SHELL_ICON_CLASS = 'size-4';
const SHELL_ICON_STROKE_WIDTH = 2.25;

function ShellIcon({
	className,
	icon,
	'aria-hidden': ariaHidden,
}: {
	className?: string;
	icon: Parameters<typeof HugeiconsIcon>[0]['icon'];
	'aria-hidden'?: 'true' | 'false';
}): React.ReactElement {
	return <HugeiconsIcon aria-hidden={ariaHidden} className={cn(SHELL_ICON_CLASS, 'shrink-0', className)} icon={icon} size={SHELL_ICON_SIZE} strokeWidth={SHELL_ICON_STROKE_WIDTH} />;
}

export const NAV_LINK_CLASS =
	'flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sidebar-foreground text-sm outline-none lg:h-9 lg:min-h-0 lg:py-0 ' +
	'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ' +
	'focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
	'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium ' +
	'aria-[current=page]:text-sidebar-accent-foreground';

/* Collapsed, the sidebar is an icon rail. Every tile keeps the expanded row's
 * height (36px, the switcher 48px) and is centred on x=44, the axis the
 * expanded icons already sit on, so collapsing moves no icon in either
 * direction. The rail is 76px wide because the sidebar's right inset is half
 * its left one (see ShellSidebar). */
const RAIL_NAV_ITEM_CLASS =
	'mx-auto flex h-9 w-8 items-center justify-center rounded-md text-sidebar-foreground outline-none ' +
	'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ' +
	'focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
	'aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground';

export interface NotificationItem { id: string; title: string; detail: string; severity: string; actionable: boolean; href?: string }

const ACTIONABLE_RUN_STATES = ['waiting-user', 'ready-to-ship', 'failed', 'interrupted'] as const;

function globalNotificationItems(staleService: AppProps['staleService'], gitIdentity: AppProps['gitIdentity'], catalog: ShellCatalog['notifications']): NotificationItem[] {
	return [
		...(staleService === null ? [] : [{ id: 'stale-service', title: catalog.staleService, detail: `${staleService.detail} boot ${staleService.bootSha}; origin/main ${staleService.currentSha}`, severity: catalog.severity.action, actionable: true }]),
		...(gitIdentity === null ? [] : [{ id: 'git-identity', title: catalog.gitIdentity, detail: gitIdentity.detail, severity: catalog.severity.action, actionable: true, href: '/settings' }]),
	];
}

function runNotification(run: RunView, events: AppProps['events'], projectHref: string, catalog: ShellCatalog['notifications']): NotificationItem | null {
	const shipFailure = events.findLast((event) => event.runId === run.id && event.kind === 'run.ship-failed');
	const shipBlocked = shipFailure !== undefined;
	if ((run.state === 'ready-to-ship' && !shipBlocked) || !(ACTIONABLE_RUN_STATES as readonly string[]).includes(run.state)) return null;
	return {
		id: `run-${run.id}`,
		title: shipBlocked ? catalog.shipBlocked : catalog.run[run.state as (typeof ACTIONABLE_RUN_STATES)[number]],
		detail: shipBlocked && typeof shipFailure.payload.error === 'string' ? shipFailure.payload.error : shipBlocked ? catalog.shipBlockedDetail : run.error ?? run.summary ?? run.issueId,
		severity: catalog.severity.action,
		actionable: true,
		href: `${projectHref}/runs/${encodeURIComponent(run.id)}`,
	};
}

function queuePauseDetail(pause: NonNullable<ChainRunsView['pause']>, fallback: string): string {
	return pause.issue === undefined ? fallback : `${pause.issue.id}: ${pause.issue.title}`;
}

function queueRunHref(pause: NonNullable<ChainRunsView['pause']>, projectHref: string): string | undefined {
	return pause.run === undefined ? undefined : `${projectHref}/runs/${encodeURIComponent(pause.run.id)}`;
}

function queueNotificationItems(pause: ChainRunsView['pause'], projectHref: string, catalog: ShellCatalog['notifications']): NotificationItem[] {
	if (pause?.reason === 'chain-start-failed') return [{ id: 'queue-start-failed', title: catalog.queueStartFailed, detail: queuePauseDetail(pause, catalog.queueStartFailedDetail), severity: catalog.severity.action, actionable: true, href: queueRunHref(pause, projectHref) }];
	if (pause?.reason === 'no-admissible-issue') return [{ id: 'queue-complete', title: catalog.queueComplete, detail: catalog.queueCompleteDetail, severity: catalog.severity.advisory, actionable: false }];
	if (pause?.reason === 'previous-run-not-done') return [{ id: 'queue-previous-not-done', title: catalog.queueStopped, detail: queuePauseDetail(pause, catalog.queuePreviousDetail), severity: catalog.severity.action, actionable: true, href: queueRunHref(pause, projectHref) }];
	if (pause?.reason === 'run-active') return [{ id: 'queue-active', title: catalog.queueStopped, detail: queuePauseDetail(pause, catalog.queueActiveDetail), severity: catalog.severity.advisory, actionable: false, href: queueRunHref(pause, projectHref) }];
	return [];
}

export function notificationItems(
	selected: RegisteredProjectView | null,
	chainRuns: ChainRunsView,
	run: RunView | null,
	workspaceNotices: AppProps['workspaceNotices'],
	staleService: AppProps['staleService'],
	gitIdentity: AppProps['gitIdentity'],
	events: AppProps['events'],
	catalog: ShellCatalog['notifications'],
): NotificationItem[] {
	const projectOperational = selected !== null && (selected.current || selected.readiness === 'ready');
	const projectHref = selected === null ? null : `/projects/${encodeURIComponent(selected.id)}`;
	const items = globalNotificationItems(staleService, gitIdentity, catalog);
	if (!projectOperational || projectHref === null) return items;
	const runItem = run === null ? null : runNotification(run, events, projectHref, catalog);
	if (runItem !== null) items.push(runItem);
	if (run?.providerWait !== null && run?.providerWait !== undefined) items.push({ id: `provider-${run.id}`, title: catalog.providerWait, detail: run.providerWait.message, severity: catalog.severity.advisory, actionable: false, href: `${projectHref}/runs/${encodeURIComponent(run.id)}` });
	items.push(...queueNotificationItems(visibleQueuePause(chainRuns), projectHref, catalog));
	for (const [index, notice] of workspaceNotices.entries()) items.push({ id: `workspace-${index}`, title: catalog.workspace, detail: notice.detail, severity: catalog.severity.action, actionable: true, href: notice.runId === null ? undefined : `${projectHref}/runs/${encodeURIComponent(notice.runId)}` });
	return items;
}

export function NotificationsPopover({ items, catalog }: { items: readonly NotificationItem[]; catalog: ShellCatalog['notifications'] }): React.ReactElement {
	const actionableCount = items.filter((item) => item.actionable).length;
	const announcement = items.length === 0 ? catalog.empty : items.map((item) => `${item.title}: ${item.detail}`).join(' ');
	return <Popover.Root>
		<span aria-atomic="true" aria-live="polite" className="sr-only" data-slot="notifications-live">{announcement}</span>
		<Popover.Trigger aria-label={catalog.label} className={cn(buttonVariants({ size: 'icon', variant: 'outline' }), 'relative')} data-slot="notifications-trigger">
			<ShellIcon icon={Notification02Icon} />
			{actionableCount === 0 ? null : <span aria-label={catalog.count(actionableCount)} className="absolute -top-1 -right-1 min-w-4 rounded-full bg-attention px-1 font-mono text-[10px] leading-4 text-attention-foreground">{actionableCount}</span>}
		</Popover.Trigger>
		<Popover.Portal><Popover.Positioner align="end" className="z-50" sideOffset={8}><Popover.Popup aria-label={catalog.label} className="w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg/5 outline-none">
			<div className="flex items-center gap-2 px-2 py-1.5"><HugeiconsIcon className="size-4" icon={Alert02Icon} size={16} strokeWidth={2.25} /><strong className="text-sm">{catalog.label}</strong><span className="ml-auto font-mono text-xs text-muted-foreground">{catalog.count(actionableCount)}</span></div>
			{items.length === 0 ? <p className="px-2 py-5 text-center text-sm text-muted-foreground">{catalog.empty}</p> : <ul className="mt-1 flex max-h-[min(28rem,70vh)] flex-col gap-1 overflow-y-auto">{items.map((item) => <li key={item.id} className="rounded-lg border border-border/60 p-2.5 text-sm"><div className="flex items-start justify-between gap-2"><strong>{item.href === undefined ? item.title : <a className="underline decoration-border underline-offset-2 hover:decoration-foreground" href={item.href}>{item.title}</a>}</strong><span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.severity}</span></div><p className="mt-1 break-words text-xs text-muted-foreground">{item.detail}</p></li>)}</ul>}
		</Popover.Popup></Popover.Positioner></Popover.Portal>
	</Popover.Root>;
}

/** One line per reason the queue is not advancing on its own (GSHIP-638). */
export const CHAIN_PAUSE_LABELS: Readonly<Record<ChainPauseReason, string>> = {
	'chain-disabled': 'the switch is off.',
	'previous-run-not-done': 'the previous run did not finish in done.',
	'no-admissible-issue': 'there is no eligible work left in the backlog.',
	'run-active': 'a run is still active.',
	'chain-start-failed': 'the attempt to start the next run failed.',
};

/**
 * A visible queue outcome only exists while the switch is on. `setChainRuns` writes
 * the setting alone and emits no event (GSHIP-638), so a pause recorded
 * before the operator turned the switch off -- `no-admissible-issue`,
 * `previous-run-not-done`, any reason -- would otherwise survive the turn-off
 * and keep reading "Needs you" with a warning callout on every surface,
 * with nothing to clear it until some future run reaches a terminal state and
 * records a fresh `chain-disabled` pause, which may never happen (GSHIP-650
 * review). `chain-disabled` itself never escalates either, on or off: chaining
 * is off by default (GSHIP-638), so it is the steady state of a default
 * install, not a stopped queue.
 */
export function visibleQueuePause(chainRuns: ChainRunsView): ChainRunsView['pause'] {
	if (!chainRuns.enabled) return null;
	const { pause } = chainRuns;
	return pause === null || pause.reason === 'chain-disabled' ? null : pause;
}

/**
 * The queue outcome, named where the operator already looks for run status --
 * not a secondary line inside the chaining switch's own
 * settings panel, next to the toggle that turned it on. A pause whose read
 * could not resolve the issue that stopped it is still shown by its reason
 * alone: never a fabricated link. `pause` is already filtered to reasons that
 * represent a visible outcome -- see `visibleQueuePause`.
 */
export function humanVersionOf(version: string): string {
	const buildMetadata = version.indexOf('+');
	return buildMetadata === -1 ? version : version.slice(0, buildMetadata);
}


/**
 * The nav glyphs, from Hugeicons' free set (operator decision, 2026-08-25:
 * hugeicons is the product's icon source), muted beside their labels and
 * held to one 16px slot so rows lane-align.
 */
export const NAV_GLYPHS = {
	overview: Grid2X2Icon,
	runs: Activity01Icon,
	work: ListViewIcon,
	settings: Settings01Icon,
	globalSettings: Globe02Icon,
	overviewQueues: Queue01Icon,
	overviewInsights: ChartAnalysisIcon,
} as const;

export function NavGlyph({ name }: { name: keyof typeof NAV_GLYPHS }): React.ReactElement {
	return (
		<HugeiconsIcon
			className="size-4 shrink-0 opacity-70"
			icon={NAV_GLYPHS[name]}
			size={16}
			strokeWidth={2.25}
		/>
	);
}

/*
 * The project switcher (operator decision, 2026-08-31, two-line
 * team-switcher anatomy): the trigger scopes projects only -- the overview
 * is a standing nav item, not a sibling scope -- and the status rides the
 * second line as text, never as a chip beside the name. The acid dot on
 * "Needs you" keeps the sidebar's one acid signal.
 */
export const SWITCHER_ITEM_CLASS =
	'flex w-full cursor-default select-none items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none ' +
	'data-highlighted:bg-accent data-highlighted:text-accent-foreground ' +
	'aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground';

function ProjectShortcut({ index, allProjects = false }: { index: number | undefined; allProjects?: boolean }): React.ReactElement {
	const platform = presentationPlatform();
	if (allProjects) {
		return <span className="flex w-10 shrink-0 justify-center"><kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground" data-slot="shortcut-all-projects">{shortcutLabel('overview', undefined, platform)}</kbd></span>;
	}
	return (
		<span className="flex w-10 shrink-0 justify-center">
			{index === undefined ? null : <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground" data-slot="shortcut-project">{shortcutLabel('project', index, platform)}</kbd>}
		</span>
	);
}

/* The project's state is a dot. Expanded it sits beside the state's name;
 * on the rail it is the dot alone, and the tile's tooltip and its described-by
 * text still carry the name, so colour is never the only channel. Acid is the
 * operator's turn, blue is work advancing, grey is idle. */
const STATE_DOT_CLASS: Record<OperatorAttention, string> = {
	'Needs you': 'bg-attention',
	Working: 'bg-info',
	Idle: 'bg-muted-foreground/40',
};

function StateDot({ attention, className }: { attention: OperatorAttention; className?: string }): React.ReactElement {
	return <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT_CLASS[attention], className)} data-slot="project-state-dot" data-state={attention} />;
}

/* The leading slot of the switcher is the shortcut that selects what it shows.
 * The chip is centred on the icon axis: it is wider than a 16px glyph, so it
 * overhangs its slot by 6px on each side. */
function SwitcherKey({ label }: { label: string | null }): React.ReactElement {
	if (label === null) return <ShellIcon aria-hidden="true" className="opacity-70" icon={FolderManagementIcon} />;
	return <span className="-mx-1.5 flex w-7 shrink-0 justify-center"><kbd className="rounded border border-border bg-muted px-1 font-mono text-xs leading-4 text-muted-foreground" data-slot="switcher-key">{label}</kbd></span>;
}

interface ShellStatus { attention: OperatorAttention; label: string; acid: boolean }

interface ProjectSwitcherProps {
	projects: AppProps['projects'];
	selection: ReturnType<typeof routeSelection>;
	status: ShellStatus | null;
	catalog: ShellCatalog;
	/** Clears the persisted project filter; the link itself still routes. */
	onSelectAllProjects?: (() => void) | undefined;
}

function ProjectSwitcherTrigger({
	selected,
	status,
	catalog,
	keyLabel,
	open,
}: Pick<ProjectSwitcherProps, 'status' | 'catalog'> & {
	selected: AppProps['projects'][number] | null;
	keyLabel: string | null;
	open: boolean;
}): React.ReactElement {
	const state = selected === null ? null : status;
	if (!open) {
		return (
			<>
				<SwitcherKey label={keyLabel} />
				{state === null ? null : <StateDot attention={state.attention} className="absolute top-1 right-1" />}
			</>
		);
	}
	return (
		<>
			<SwitcherKey label={keyLabel} />
			<span className="grid min-w-0 flex-1 leading-tight">
				<span className="overflow-hidden text-ellipsis whitespace-nowrap font-medium text-sm">
					{selected?.name ?? catalog.allProjectsLabel}
				</span>
				{state === null ? null : (
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<StateDot attention={state.attention} />
						<span className="overflow-hidden text-ellipsis whitespace-nowrap">{state.label}</span>
					</span>
				)}
			</span>
			<span><ShellIcon className="opacity-70" icon={UnfoldMoreIcon} /></span>
		</>
	);
}

function ProjectSwitcherMenu({
	projects,
	selection,
	catalog,
	onSelectAllProjects,
}: Pick<ProjectSwitcherProps, 'projects' | 'selection' | 'catalog' | 'onSelectAllProjects'>): React.ReactElement {
	return (
		<Menu.Portal>
			<Menu.Positioner align="start" className="z-50" sideOffset={6}>
				<Menu.Popup className="relative min-w-(--anchor-width) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding p-1 text-popover-foreground shadow-lg/5 motion-safe:duration-100 motion-reduce:animate-none motion-reduce:transition-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
					<div className="type-eyebrow px-2 pt-1.5 pb-1 text-muted-foreground">
						{catalog.projectNavigationLabel}
					</div>
					<Menu.Item
						aria-current={selection.projectId === null ? 'page' : undefined}
						aria-keyshortcuts={KEYBOARD_SHORTCUTS.overview.aria}
						className={SWITCHER_ITEM_CLASS}
						data-slot="project-switcher-all"
						onClick={(event) => {
							if (onSelectAllProjects === undefined) return;
							event.preventDefault();
							onSelectAllProjects();
						}}
						render={<a href="/overview" />}
					>
						<ProjectShortcut allProjects index={undefined} />
						<span className="min-w-0 flex-1">{catalog.allProjectsLabel}</span>
					</Menu.Item>
					{projects.map((project, index) => (
						<Menu.Item
							aria-keyshortcuts={index < PROJECT_SHORTCUT_COUNT ? projectShortcutAria(index) : undefined}
							aria-current={project.id === selection.projectId ? 'page' : undefined}
							className={SWITCHER_ITEM_CLASS}
							key={project.id}
							render={<a href={`/projects/${encodeURIComponent(project.id)}`} />}
						>
							<ProjectShortcut index={index < PROJECT_SHORTCUT_COUNT ? index : undefined} />
							<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
								{project.name}
							</span>
						</Menu.Item>
					))}
					{selection.projectId === null ? null : (
						<Menu.Item
							aria-current={selection.surface === 'settings' ? 'page' : undefined}
							className={cn(SWITCHER_ITEM_CLASS, 'mt-1')}
							data-slot="project-switcher-settings"
							render={<a href={`/projects/${encodeURIComponent(selection.projectId)}/settings`} />}
						>
							<HugeiconsIcon className="size-4 shrink-0 opacity-70" icon={Settings01Icon} size={16} strokeWidth={2.25} />
							<span className="min-w-0 flex-1">{catalog.projectSettingsLabel}</span>
						</Menu.Item>
					)}
					<Menu.Item
						className={cn(SWITCHER_ITEM_CLASS, selection.projectId === null && 'mt-1')}
						render={<a href="/projects" />}
					>
						<HugeiconsIcon className="size-4 shrink-0 opacity-70" icon={FolderManagementIcon} size={16} strokeWidth={2.25} />
						<span className="min-w-0 flex-1">{catalog.manageProjectsLabel}</span>
					</Menu.Item>
				</Menu.Popup>
			</Menu.Positioner>
		</Menu.Portal>
	);
}

function ProjectSwitcherRegistry({
	projects,
	selection,
	catalog,
}: Pick<ProjectSwitcherProps, 'projects' | 'selection' | 'catalog'>): React.ReactElement {
	return (
		<div aria-label={catalog.projectNavigationLabel} className="sr-only">
			<ul>
				{projects.map((project, index) => (
					<li key={project.id}>
						<a aria-current={project.id === selection.projectId ? 'page' : undefined} aria-keyshortcuts={index < PROJECT_SHORTCUT_COUNT ? projectShortcutAria(index) : undefined} href={`/projects/${encodeURIComponent(project.id)}`}><ProjectShortcut index={index < PROJECT_SHORTCUT_COUNT ? index : undefined} />{project.name}</a>
					</li>
				))}
				<li><a href="/projects">{catalog.manageProjectsLabel}</a></li>
			</ul>
		</div>
	);
}

/* Every project in view owns the first digit; a registered project owns its
 * own; a project past the digits has no key to show. */
function switcherKey(selected: AppProps['projects'][number] | null, projects: AppProps['projects']): { label: string | null; aria: string | undefined } {
	const platform = presentationPlatform();
	if (selected === null) return { label: shortcutLabel('overview', undefined, platform), aria: KEYBOARD_SHORTCUTS.overview.aria };
	const index = projects.indexOf(selected);
	if (index >= PROJECT_SHORTCUT_COUNT) return { label: null, aria: undefined };
	return { label: shortcutLabel('project', index, platform), aria: projectShortcutAria(index) };
}

export function ProjectSwitcher({
	projects,
	selection,
	status,
	catalog,
	onSelectAllProjects,
	open = true,
}: ProjectSwitcherProps & { open?: boolean }): React.ReactElement {
	const selected = projects.find((project) => project.id === selection.projectId) ?? null;
	const selectedName = selected?.name ?? catalog.allProjectsLabel;
	const [menuOpen, setMenuOpen] = useState(false);
	const statusId = useId();
	const key = switcherKey(selected, projects);
	/*
	 * GSHIP-874: Tooltip.Trigger and Menu.Trigger share one DOM node here, so
	 * both write the same `data-popup-open` attribute onto it -- a hover-only
	 * tooltip and an open menu are indistinguishable from that attribute
	 * alone. `disabled={menuOpen}` covers the direction that matters (the
	 * tooltip never shows, so it never sets the attribute, once the menu is
	 * open); the reverse -- the tooltip open while the menu stays closed,
	 * which still carries `data-popup-open` from the hover alone -- is the
	 * deliberate baseline, the same hover highlight any other trigger gets,
	 * never a sign the menu opened. A diagnosis reading a DOM dump or
	 * screenshot for "is the menu open" must not read this shared attribute
	 * on its own as that answer.
	 */
	return (
		<>
			<Menu.Root onOpenChange={setMenuOpen}>
				{/* The hint only names the tile on the rail; expanded, the name,
				 * the state and the key are already on screen. */}
				<HintTooltip detail={selected === null ? undefined : status?.label} disabled={open || menuOpen} label={selectedName} shortcut={key.label ?? undefined}>
					<Menu.Trigger
						aria-describedby={status === null ? undefined : statusId}
						aria-keyshortcuts={key.aria}
						aria-label={open ? undefined : selectedName}
						className={cn(open ? cn(NAV_LINK_CLASS, 'w-full text-left lg:h-12') : cn(RAIL_NAV_ITEM_CLASS, 'h-12'), 'relative data-[popup-open]:bg-sidebar-accent')}
						data-slot="project-switcher"
					>
						<ProjectSwitcherTrigger catalog={catalog} keyLabel={key.label} open={open} selected={selected} status={status} />
					</Menu.Trigger>
				</HintTooltip>
				<ProjectSwitcherMenu catalog={catalog} onSelectAllProjects={onSelectAllProjects} projects={projects} selection={selection} />
			</Menu.Root>
			{status === null ? null : <span className="sr-only" id={statusId}>{status.label}</span>}
		{/* The registry as plain links (sr-only): a portal never reaches the
		 * static render, so without this nav the closed menu would drop
		 * every registry link from the no-JS document and from keyboard
		 * reach before hydration. */}
		<ProjectSwitcherRegistry catalog={catalog} projects={projects} selection={selection} />
		</>
	);
}

/* One stable list of destinations. The project switcher above it is a filter,
 * not a second tree: with a project selected, Runs and Queue open that
 * project's own surfaces; with every project in view they open the control
 * center aggregates. Now and Insights are always global. No label appears
 * twice and no item changes position when the filter changes. */
function navigationItems(selection: ReturnType<typeof routeSelection>, catalog: ShellCatalog): readonly { id: string; href: string; label: string; glyph: keyof typeof NAV_GLYPHS; active: boolean }[] {
	const project = selection.projectId === null ? null : `/projects/${encodeURIComponent(selection.projectId)}`;
	return [
		{ id: 'now', href: '/overview', label: catalog.routeLabels.now, glyph: 'overview', active: selection.surface === 'overview' },
		{ id: 'runs', href: project === null ? '/overview/runs' : `${project}/runs`, label: catalog.routeLabels.overviewRuns, glyph: 'runs', active: selection.surface === 'overview-runs' || selection.surface === 'runs' },
		{ id: 'queue', href: project === null ? '/overview/queues' : `${project}/work`, label: catalog.routeLabels.queue, glyph: 'overviewQueues', active: selection.surface === 'overview-queues' || selection.surface === 'work' },
		{ id: 'insights', href: '/overview/insights', label: catalog.routeLabels.overviewInsights, glyph: 'overviewInsights', active: selection.surface === 'overview-insights' },
	];
}

export function ShellNavigation({
	catalog,
	projects,
	selection,
	status,
	open,
	onSelectAllProjects,
}: {
	catalog: ShellCatalog;
	projects: AppProps['projects'];
	selection: ReturnType<typeof routeSelection>;
	status: ShellStatus | null;
	open: boolean;
	onSelectAllProjects?: () => void;
}): React.ReactElement {
	const itemClass = open ? NAV_LINK_CLASS : RAIL_NAV_ITEM_CLASS;
	return (
		<TooltipGroup>
		<nav aria-label={catalog.operatorNavigationLabel} className="lg:flex lg:flex-1 lg:flex-col">
			<div data-slot="project-switcher-item">
				<ProjectSwitcher catalog={catalog} onSelectAllProjects={onSelectAllProjects} open={open} projects={projects} selection={selection} status={status} />
			</div>
			<ul className="mt-2 flex flex-wrap gap-1 lg:mt-4 lg:flex-col lg:flex-nowrap lg:gap-0.5" data-slot="global-navigation">
				{navigationItems(selection, catalog).map((item) => (
					<li className="shrink-0" key={item.id}>
						<HintTooltip disabled={open} label={item.label}>
							<a aria-current={item.active ? 'page' : undefined} aria-label={open ? undefined : item.label} className={itemClass} data-sidebar-id={item.href} href={item.href}>
								<NavGlyph name={item.glyph} />{open ? <span>{item.label}</span> : null}
							</a>
						</HintTooltip>
					</li>
				))}
			</ul>
			<ul className="mt-1 flex flex-wrap gap-1 lg:mt-auto lg:flex-col lg:flex-nowrap" data-slot="settings-navigation">
				<li className="shrink-0">
					<HintTooltip disabled={open} label={catalog.routeLabels.globalSettings}>
						<a aria-current={selection.surface === 'global-settings' ? 'page' : undefined} aria-label={open ? undefined : catalog.routeLabels.globalSettings} className={itemClass} data-sidebar-id="/settings" href="/settings">
							<NavGlyph name="globalSettings" />{open ? <span>{catalog.routeLabels.globalSettings}</span> : null}
						</a>
					</HintTooltip>
				</li>
			</ul>
		</nav>
		</TooltipGroup>
	);
}

export function nextControlCenterDisclosureState(expanded: boolean, desktopViewport: boolean): boolean {
	return desktopViewport ? true : !expanded;
}

/*
 * The root tsconfig checks this file without the DOM lib (browser types are
 * scoped to webui's own config), so the browser surface this screen touches
 * is named here, the same idiom notifications.ts uses.
 */
export interface PanelRuntime {
	localStorage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
	addEventListener?: (type: 'keydown', listener: (event: PanelKeyEvent) => void) => void;
	removeEventListener?: (type: 'keydown', listener: (event: PanelKeyEvent) => void) => void;
	location?: { assign: (url: string) => void };
	matchMedia?: (query: string) => { matches: boolean; addEventListener?: (type: 'change', listener: () => void) => void; removeEventListener?: (type: 'change', listener: () => void) => void };
	document?: { documentElement: { classList: { toggle: (name: string, force: boolean) => void } } };
}

export interface PanelKeyEvent {
	key: string;
	code?: string;
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
	preventDefault: () => void;
}

export function panelRuntime(): PanelRuntime {
	return globalThis as unknown as PanelRuntime;
}

/**
 * Collapse state for the two side panels, persisted per browser. Reading is
 * guarded so static rendering (tests) sees the expanded default; writing
 * happens only on a real toggle, in a real browser.
 */
export function useStoredOpen(key: string): [boolean, () => void] {
	const [open, setOpen] = useState(() => panelRuntime().localStorage?.getItem(key) !== 'closed');
	const toggle = useCallback(() => {
		setOpen((previous) => {
			panelRuntime().localStorage?.setItem(key, previous ? 'closed' : 'open');
			return !previous;
		});
	}, [key]);
	return [open, toggle];
}

/**
 * The shell's persistent preferences, one row at the top right of the
 * content area (operator decision, 2026-08-25, replacing the segmented
 * pills at the sidebar's foot): language, theme and content measure, each a
 * single outline button whose face names the state it switches TO. Theme
 * and measure store an explicit choice that main.tsx re-applies at boot.
 */
export function ShellControls({
	locale,
	onSelectLocale,
	catalog,
	title,
	sidebarOpen,
	onToggleSidebar,
	inspectorOpen,
	onToggleInspector,
	showInspectorToggle,
	notifications,
}: Pick<AppProps, 'locale' | 'onSelectLocale'> & {
	catalog: ShellCatalog;
	title: string;
	sidebarOpen: boolean;
	onToggleSidebar: () => void;
	inspectorOpen: boolean;
	onToggleInspector: () => void;
	showInspectorToggle: boolean;
	notifications: readonly NotificationItem[];
}): React.ReactElement {
	const [dark, setDark] = useState(() => {
		const runtime = panelRuntime();
		const stored = runtime.localStorage?.getItem('gship-theme') ?? null;
		if (stored !== null) return stored === 'dark';
		return runtime.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
	});
	const [wide, setWide] = useState(
		() => panelRuntime().localStorage?.getItem('gship-width') === 'wide',
	);
	const toggleTheme = (): void => {
		const next = !dark;
		const runtime = panelRuntime();
		runtime.localStorage?.setItem('gship-theme', next ? 'dark' : 'light');
		runtime.document?.documentElement.classList.toggle('dark', next);
		setDark(next);
	};
	const toggleWidth = (): void => {
		const next = !wide;
		const runtime = panelRuntime();
		runtime.localStorage?.setItem('gship-width', next ? 'wide' : 'centered');
		runtime.document?.documentElement.classList.toggle('gship-wide', next);
		setWide(next);
	};
	const targetLocale = locale === 'en-US' ? 'pt-BR' : 'en-US';
	const inspectorToggle = (): React.ReactElement | null => showInspectorToggle ? (
		<Button
			aria-label={inspectorOpen ? catalog.inspectorToggle.collapse : catalog.inspectorToggle.expand}
			onClick={onToggleInspector}
			size="icon"
			type="button"
			variant="outline"
		>
			<PanelToggleGlyph side="right" />
		</Button>
	) : null;
	return (
		<div className="w-full shrink-0 border-b border-border px-4 py-3 lg:px-6">
			<ShellContentFrame className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2" data-slot="shell-controls-layout">
				<div className="flex min-w-0 justify-start">
					{/* The sidebar toggle lives in the content area, not the sidebar. */}
					<Button
						aria-label={sidebarOpen ? catalog.sidebarToggle.collapse : catalog.sidebarToggle.expand}
						aria-expanded={sidebarOpen}
						data-slot="sidebar-toggle"
						onClick={onToggleSidebar}
						size="icon"
						type="button"
						variant="outline"
					>
						<PanelToggleGlyph side="left" />
					</Button>
				</div>
				<div className="min-w-0 px-2 text-center type-editorial-title text-sm sm:text-base" data-slot="shell-surface-title" title={title}>
					<span className="block overflow-hidden text-ellipsis whitespace-nowrap">{title}</span>
				</div>
				<div className="flex min-w-0 items-center justify-end gap-2">
					<NotificationsPopover catalog={catalog.notifications} items={notifications} />
						<Button
							aria-label={targetLocale === 'pt-BR' ? 'Português (Brasil)' : 'English (US)'}
							id="gateship-locale"
							onClick={() => onSelectLocale(targetLocale)}
							size="icon"
							type="button"
							variant="outline"
						>
							<span className="font-mono text-xs">{targetLocale === 'pt-BR' ? 'PT' : 'EN'}</span>
						</Button>
						<Button
							aria-label={dark ? catalog.themeToggle.light : catalog.themeToggle.dark}
							onClick={toggleTheme}
							size="icon"
							type="button"
							variant="outline"
						>
							<ShellIcon icon={dark ? Sun02Icon : Moon02Icon} />
						</Button>
						<Button
							aria-label={wide ? catalog.widthToggle.compact : catalog.widthToggle.wide}
							className="hidden 2xl:inline-flex"
							onClick={toggleWidth}
							size="icon"
							type="button"
							variant="outline"
						>
							<ShellIcon icon={wide ? ArrowShrink01Icon : ArrowExpand01Icon} />
						</Button>
					{inspectorToggle()}
				</div>
			</ShellContentFrame>
		</div>
	);
}

export function shellSurfaceTitle(
	selection: ReturnType<typeof routeSelection>,
	catalog: ShellCatalog,
): string {
	if (selection.surface === 'overview') return catalog.routeLabels.overview;
	if (selection.surface === 'overview-runs') return catalog.routeLabels.overviewRuns;
	if (selection.surface === 'overview-queues') return catalog.routeLabels.overviewQueues;
	if (selection.surface === 'overview-insights') return catalog.routeLabels.overviewInsights;
	if (selection.surface === 'projects') return catalog.routeLabels.projects;
	if (selection.surface === 'global-settings') return catalog.routeLabels.globalSettings;
	return catalog.routeLabels[selection.surface];
}

/** A panel silhouette with its visible side fully filled in currentColor. */
export function PanelToggleGlyph({ side }: { side: 'left' | 'right' }): React.ReactElement {
	return (
		<svg aria-hidden="true" className={SHELL_ICON_CLASS} data-side={side} data-slot="panel-toggle-glyph" fill="none" viewBox="0 0 24 24">
			<rect height="18" rx="2.25" stroke="currentColor" strokeWidth={SHELL_ICON_STROKE_WIDTH} width="18" x="3" y="3" />
			<rect fill="currentColor" height="18" rx="1.5" width="5.25" x={side === 'left' ? '3' : '15.75'} y="3" />
		</svg>
	);
}

/**
 * Run state, preserved workspaces and the callouts all describe the selected
 * project, whose own scoped snapshot is what this document loaded
 * (GSHIP-707). A queue pause is the one exception: run chaining is the boot
 * runtime's switch, so it is only ever stated for the current project.
 */
export function shellAttention(
	selected: RegisteredProjectView | null,
	chainRuns: ChainRunsView,
	run: RunView | null,
	workspaceNotices: AppProps['workspaceNotices'],
): { operational: boolean; queuePause: ChainRunsView['pause']; attention: OperatorAttention } {
	const operational = selected !== null && (selected.current || selected.readiness === 'ready');
	const queuePause = selected?.current === true ? visibleQueuePause(chainRuns) : null;
	const stoppedQueue = queuePause !== null && queuePause.reason !== 'no-admissible-issue';
	return {
		operational,
		queuePause,
		attention: attentionOf(operational ? run : null, operational ? workspaceNotices : [], stoppedQueue),
	};
}

function shellStatus(
	selected: RegisteredProjectView | null,
	run: RunView | null,
	catalog: RunInspectorCatalog,
	): ShellStatus | null {
	if (selected === null || (!selected.current && selected.readiness !== 'ready')) return null;
	const attention = attentionOf(run, false);
	const normalAttention = attention === 'Working' ? 'Working' : 'Idle';
	return { attention: normalAttention, label: catalog.attentionLabels[normalAttention], acid: false };
}

export function ShellSidebar({
	locale,
	route,
	selectedProjectId,
	projects,
	run,
	runInspectorCatalog,
	version,
	open,
	onSelectAllProjects,
}: Pick<AppProps, 'chainRuns' | 'gitIdentity' | 'locale' | 'onSelectAllProjects' | 'projects' | 'staleService' | 'workspaceNotices'> & {
	runInspectorCatalog: RunInspectorCatalog;
	route: OperatorRoute;
	selectedProjectId: string | null;
	run: RunView | null;
	version: string;
	open: boolean;
}): React.ReactElement {
	// The header answers one question -- is Gateship waiting on the operator --
	// so it carries the human state alone. The run's own state stays on the
	// card. A stopped chain queue (GSHIP-650) answers it too, the same way a
	// preserved workspace already does -- but only while the switch is on and
	// something else stopped it, never for the switch simply being off.
	const catalog = LOCALE_CATALOG[locale].shell;
	const currentId = projects.find((project) => project.current)?.id ?? null;
	const selection = routeSelection(route, currentId, selectedProjectId);
	const humanVersion = humanVersionOf(version);
	const status = shellStatus(projects.find((project) => project.id === selection.projectId) ?? null, run, runInspectorCatalog);
	/* The outer shell shares the global --sidebar canvas with html and body;
	 * the content panel provides the deliberate surface contrast. The right
	 * inset is half the left one on purpose: the panel adds its own 12px
	 * margin, so a row's fill sits 24px from the viewport edge on one side and
	 * 24px from the panel border on the other. Collapsed, the same list becomes
	 * an icon rail on the same axis. */
	return (
		<header className={cn('scroll-container scroll-container-stable scroll-fade flex shrink-0 flex-col gap-2 px-3 pt-3 lg:h-full lg:overflow-y-auto lg:p-6 lg:pt-8', 'lg:gap-4 lg:pr-3', open ? 'lg:w-64' : 'lg:w-19')} data-slot="sidebar" data-state={open ? 'expanded' : 'collapsed'}>
			<h1 className="flex items-center gap-2 lg:hidden">
				<span aria-hidden="true"><GateshipMark className="size-6" portal /></span>
				<GateshipWordmark className="block aspect-[10187/2750] h-5 w-auto" />
			</h1>
			<ShellNavigation
				catalog={catalog}
				projects={projects}
				selection={selection}
				status={status}
				open={open}
				onSelectAllProjects={onSelectAllProjects}
			/>
							<div className="hidden items-center gap-2 px-2.5 lg:mt-auto lg:flex" data-slot="sidebar-signature">
				<GateshipMark className="size-5" portal />
				{!open ? null : <span className="flex items-center gap-2">
					<GateshipWordmark className="block h-4 w-auto shrink-0 text-foreground" />
					{version === '' ? null : <span className="font-mono text-xs text-sidebar-foreground/50">v{humanVersion}</span>}
				</span>}
			</div>
		</header>
	);
}

/**
 * The one onboarding write project management offers: an absolute path to a checkout
 * the operator already has. No file picker, no clone and no new repository --
 * the service reads local Git metadata and refuses anything not ready.
 */

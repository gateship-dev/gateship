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
import { PROJECT_SURFACES as SURFACES, routeSelection } from '../routes.ts';
import type { OperatorRoute } from '../routes.ts';
import { attentionOf } from '../run-view.ts';
import type { OperatorAttention, RunView } from '../run-view.ts';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { Tooltip } from '@base-ui/react/tooltip';
import { Activity01Icon, Alert02Icon, ArrowExpand01Icon, ArrowShrink01Icon, FolderManagementIcon, Globe02Icon, Grid2X2Icon, ListViewIcon, Moon02Icon, Notification02Icon, Settings01Icon, Sun02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useCallback, useId, useState } from 'react';
import { KEYBOARD_SHORTCUTS, presentationPlatform, projectShortcutAria, shortcutLabel } from '../keyboard-shortcuts.ts';

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
	'flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sidebar-foreground text-sm outline-none lg:min-h-0 ' +
	'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ' +
	'focus-visible:ring-2 focus-visible:ring-sidebar-ring ' +
	'aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium ' +
	'aria-[current=page]:text-sidebar-accent-foreground';

const RAIL_NAV_ITEM_CLASS =
	'flex size-10 min-h-0 items-center justify-center rounded-md p-0 text-sidebar-foreground outline-none ' +
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

function SidebarTooltip({ children, content, disabled = false }: { children: React.ReactElement; content: React.ReactNode; disabled?: boolean }): React.ReactElement {
	return (
		<Tooltip.Root disabled={disabled}>
			<Tooltip.Trigger render={children} />
			<Tooltip.Portal>
				<Tooltip.Positioner className="z-50" side="right" sideOffset={8}>
					<Tooltip.Popup className="max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-lg/5">{content}</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
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

function ProjectShortcut({ index }: { index: number | undefined }): React.ReactElement {
	const platform = presentationPlatform();
	return (
		<span className="flex w-10 shrink-0 justify-center">
			{index === undefined ? null : <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground" data-slot="shortcut-project">{shortcutLabel('project', index, platform)}</kbd>}
		</span>
	);
}

function ProjectStateIcon({ attention }: { attention: OperatorAttention }): React.ReactElement {
	return <ShellIcon aria-hidden="true" className="opacity-70" icon={attention === 'Working' ? Activity01Icon : Moon02Icon} />;
}

function ProjectStatusIcon({ status }: { status: ShellStatus | null }): React.ReactElement {
	return status === null ? <ShellIcon aria-hidden="true" className="opacity-70" icon={FolderManagementIcon} /> : <ProjectStateIcon attention={status.attention} />;
}

export function projectSwitcherTooltipText(catalog: ShellCatalog, name: string, shortcut: string | null, status: ShellStatus | null): string {
	const action = catalog.projectNavigationLabel === 'Projetos' ? 'acessar projeto' : 'open project';
	return [name, shortcut === null ? null : `${shortcut}: ${action}`, status?.label ?? null].filter((part): part is string => part !== null).join(' · ');
}

function OverviewShortcut(): React.ReactElement {
	return <NavGlyph name="overview" />;
}

interface ShellStatus { attention: OperatorAttention; label: string; acid: boolean }

interface ProjectSwitcherProps {
	projects: AppProps['projects'];
	selection: ReturnType<typeof routeSelection>;
	status: ShellStatus | null;
	catalog: ShellCatalog;
}

function ProjectSwitcherTrigger({
	selected,
	status,
	catalog,
	open,
}: Pick<ProjectSwitcherProps, 'status' | 'catalog'> & {
	selected: AppProps['projects'][number] | null;
	open: boolean;
}): React.ReactElement {
	return (
		<>
			{selected === null
				? <span data-slot="project-switcher-placeholder"><ShellIcon className="opacity-70" icon={FolderManagementIcon} /></span>
				: <ProjectStatusIcon status={status} />}
			<span className={cn('grid min-w-0 flex-1 leading-tight', !open && 'opacity-0')}>
				<span className={cn('overflow-hidden text-ellipsis whitespace-nowrap font-medium text-sm', selected === null && 'text-muted-foreground')}>
					{selected?.name ?? catalog.switcherPlaceholder}
				</span>
				{selected === null || status === null ? null : (
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						{status.acid ? <span className="size-1.5 shrink-0 rounded-full bg-attention" /> : null}
						<span className="overflow-hidden text-ellipsis whitespace-nowrap">{status.label}</span>
					</span>
				)}
			</span>
			<span className={cn(!open && 'opacity-0')}><ShellIcon className="opacity-70" icon={UnfoldMoreIcon} /></span>
			{status?.acid ? <span aria-hidden="true" className="absolute top-1 right-1 size-1.5 rounded-full bg-attention" data-slot="sidebar-attention" /> : null}
		</>
	);
}

function ProjectSwitcherMenu({
	projects,
	selection,
	catalog,
}: Pick<ProjectSwitcherProps, 'projects' | 'selection' | 'catalog'>): React.ReactElement {
	return (
		<Menu.Portal>
			<Menu.Positioner align="start" className="z-50" sideOffset={6}>
				<Menu.Popup className="relative min-w-(--anchor-width) origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding p-1 text-popover-foreground shadow-lg/5 duration-100 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
					<div className="type-eyebrow px-2 pt-1.5 pb-1 text-muted-foreground">
						{catalog.projectNavigationLabel}
					</div>
					{projects.map((project, index) => (
						<Menu.Item
							aria-keyshortcuts={index < 9 ? projectShortcutAria(index) : undefined}
							aria-current={project.id === selection.projectId ? 'page' : undefined}
							className={SWITCHER_ITEM_CLASS}
							key={project.id}
							render={<a href={`/projects/${encodeURIComponent(project.id)}`} />}
						>
							<ProjectShortcut index={index < 9 ? index : undefined} />
							<span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
								{project.name}
							</span>
						</Menu.Item>
					))}
					<Menu.Item
						className={cn(SWITCHER_ITEM_CLASS, 'mt-1')}
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
						<a aria-current={project.id === selection.projectId ? 'page' : undefined} aria-keyshortcuts={index < 9 ? projectShortcutAria(index) : undefined} href={`/projects/${encodeURIComponent(project.id)}`}><ProjectShortcut index={index < 9 ? index : undefined} />{project.name}</a>
					</li>
				))}
				<li><a href="/projects">{catalog.manageProjectsLabel}</a></li>
			</ul>
		</div>
	);
}

export function ProjectSwitcher({
	projects,
	selection,
	status,
	catalog,
	compact = false,
}: ProjectSwitcherProps & {
	compact?: boolean;
}): React.ReactElement {
	const selected = projects.find((project) => project.id === selection.projectId) ?? null;
	const selectedIndex = selected === null ? undefined : projects.indexOf(selected);
	const selectedShortcut = selectedIndex === undefined || selectedIndex > 8 ? undefined : selectedIndex;
	const selectedName = selected?.name ?? catalog.switcherPlaceholder;
	const [menuOpen, setMenuOpen] = useState(false);
	const statusId = useId();
	const shortcut = selectedShortcut === undefined ? null : shortcutLabel('project', selectedShortcut, presentationPlatform());
	const tooltipContent = projectSwitcherTooltipText(catalog, selectedName, shortcut, status);
	return (
		<>
			<Tooltip.Root disabled={menuOpen}>
				<Menu.Root onOpenChange={setMenuOpen}>
					<Tooltip.Trigger render={<Menu.Trigger
					aria-label={compact ? selectedName : undefined}
					aria-describedby={status === null ? undefined : statusId}
					aria-keyshortcuts={selectedShortcut === undefined ? undefined : projectShortcutAria(selectedShortcut)}
					className={cn(NAV_LINK_CLASS, 'relative data-[popup-open]:bg-sidebar-accent')}
					data-slot="project-switcher"
					/>}>
					<ProjectSwitcherTrigger catalog={catalog} open={!compact} selected={selected} status={status} />
					</Tooltip.Trigger>
				<ProjectSwitcherMenu catalog={catalog} projects={projects} selection={selection} />
				</Menu.Root>
				{status === null ? null : <span className="sr-only" id={statusId}>{status.label}</span>}
				<Tooltip.Portal><Tooltip.Positioner className="z-50" side="right" sideOffset={8}><Tooltip.Popup className="max-w-64 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-lg/5">{tooltipContent}</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
			</Tooltip.Root>
		{/* The registry as plain links (sr-only): a portal never reaches the
		 * static render, so without this nav the closed menu would drop
		 * every registry link from the no-JS document and from keyboard
		 * reach before hydration. */}
		<ProjectSwitcherRegistry catalog={catalog} projects={projects} selection={selection} />
		</>
	);
}

export function ShellNavigation({
	catalog,
	projects,
	selection,
	status,
	open,
}: {
	catalog: ShellCatalog;
	projects: AppProps['projects'];
	selection: ReturnType<typeof routeSelection>;
	status: ShellStatus | null;
	open: boolean;
}): React.ReactElement {
	/* Overview is global. The project switcher begins its own contextual group;
	 * project surfaces are a semantic child list, visually nested on desktop. */
	return (
		<nav aria-label={catalog.operatorNavigationLabel} className="lg:flex lg:flex-1 lg:flex-col">
			<ul className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap lg:gap-0.5" data-slot="global-navigation">
				<li className="shrink-0">
					<SidebarTooltip content={<>{catalog.routeLabels.overview} · <span className="font-mono">{shortcutLabel('overview', undefined, presentationPlatform())}</span></>}>
					<a
						aria-label={open ? undefined : catalog.routeLabels.overview}
						aria-current={selection.surface === 'overview' || selection.surface === 'overview-runs' || selection.surface === 'overview-queues' || selection.surface === 'overview-insights' ? 'page' : undefined}
						aria-keyshortcuts={KEYBOARD_SHORTCUTS.overview.aria}
						className={cn(
							open ? NAV_LINK_CLASS : RAIL_NAV_ITEM_CLASS,
							(selection.surface === 'overview' || selection.surface === 'overview-runs' || selection.surface === 'overview-queues' || selection.surface === 'overview-insights') && 'bg-sidebar-accent text-sidebar-accent-foreground',
						)}
						href="/overview"
					>
						<OverviewShortcut />{open ? <span>{catalog.routeLabels.overview}</span> : null}
					</a>
					</SidebarTooltip>
				</li>
			</ul>
			<div className="mt-3 lg:mt-5 lg:flex lg:flex-1 lg:flex-col" data-slot="project-navigation">
				<ul className="flex flex-wrap gap-1 lg:flex lg:flex-1 lg:flex-col lg:flex-nowrap lg:gap-0.5">
				<li className="w-full min-w-0" data-slot="project-switcher-item">
					<ProjectSwitcher
						catalog={catalog}
						projects={projects}
						selection={selection}
						status={status}
						compact={!open}
					/>
					{selection.projectId === null ? null : (
						<ul className="flex flex-wrap gap-1 lg:mt-1 lg:flex-col lg:flex-nowrap lg:gap-0.5 lg:pl-2" data-slot="project-surface-navigation">
							{SURFACES.map((surface) => (
								<li className="shrink-0" key={surface.surface}>
									<SidebarTooltip content={catalog.routeLabels[surface.label]}>
									<a
										aria-label={open ? undefined : catalog.routeLabels[surface.label]}
										aria-current={surface.surface === selection.surface ? 'page' : undefined}
										className={cn(
											open ? NAV_LINK_CLASS : RAIL_NAV_ITEM_CLASS,
											surface.surface === selection.surface && 'bg-sidebar-accent text-sidebar-accent-foreground',
										)}
										href={`/projects/${encodeURIComponent(selection.projectId ?? '')}${surface.suffix}`}
									>
										<NavGlyph name={surface.surface} />{open ? <span>{catalog.routeLabels[surface.label]}</span> : null}
									</a>
									</SidebarTooltip>
								</li>
							))}
						</ul>
					)}
				</li>
				<li className={cn('shrink-0', open ? 'lg:mt-auto' : 'lg:mt-auto')}>
					<SidebarTooltip content={catalog.routeLabels.globalSettings}>
					<a
						aria-label={open ? undefined : catalog.routeLabels.globalSettings}
						aria-current={selection.surface === 'global-settings' ? 'page' : undefined}
						className={cn(
							open ? NAV_LINK_CLASS : RAIL_NAV_ITEM_CLASS,
							selection.surface === 'global-settings' && 'bg-sidebar-accent text-sidebar-accent-foreground',
						)}
						href="/settings"
					>
						<NavGlyph name="globalSettings" />{open ? <span>{catalog.routeLabels.globalSettings}</span> : null}
					</a>
					</SidebarTooltip>
				</li>
				</ul>
			</div>
		</nav>
	);
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
	matchMedia?: (query: string) => { matches: boolean };
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
}: Pick<AppProps, 'chainRuns' | 'gitIdentity' | 'locale' | 'projects' | 'staleService' | 'workspaceNotices'> & {
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
	/* The shell chrome deepens its own --sidebar one step (operator decision,
	 * 2026-08-25): the body canvas keeps the global token, so the sidebar
	 * separates from the content by fill, not only by its hairline border.
	 * @theme inline makes bg-sidebar read the var in cascade, so the
	 * element-level override is all it takes. */
	return (
		<header className={cn('scroll-container scroll-fade flex shrink-0 flex-col gap-2 px-3 pt-3 lg:h-full lg:overflow-y-auto lg:p-6 lg:pt-8', open ? 'lg:w-64 lg:gap-4' : 'lg:w-18 lg:gap-4')}>
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
			/>
			<div className="hidden items-center gap-2 px-3 lg:mt-auto lg:flex" data-slot="sidebar-signature">
				<GateshipMark className="size-5" portal />
				<span className={cn('flex items-center gap-2', !open && 'opacity-0')}>
					<GateshipWordmark className="block h-4 w-auto shrink-0 text-foreground" />
					{version === '' ? null : <span className="font-mono text-[10px] text-sidebar-foreground/50">v{humanVersion}</span>}
				</span>
			</div>
		</header>
	);
}

/**
 * The one onboarding write project management offers: an absolute path to a checkout
 * the operator already has. No file picker, no clone and no new repository --
 * the service reads local Git metadata and refuses anything not ready.
 */

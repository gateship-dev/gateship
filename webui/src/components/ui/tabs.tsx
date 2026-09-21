// webui/src/components/ui/tabs.tsx
//
// Gateship's tabs use the Base UI primitive. The list is
// a muted well, and the active tab is marked by a sliding indicator -- a
// background-colored pill that animates between tabs via Base UI's
// --active-tab-* variables -- instead of per-tab selected styles.
//
// TabsCount is the count chip a tab carries; it is acid when
// the queue waits on the operator), panels that stay mounted (find-in-page
// and static rendering keep seeing the whole surface), and the panel's
// stack layout, which every surface on this screen relies on.

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import React, { useEffect, useRef } from 'react';
import {
	segmentedControlItemLayoutClassName,
	segmentedControlItemSizeClassNames,
} from '../../lib/segmented-control.ts';
import { cn } from '../../lib/cn.ts';
import { Count } from './count.tsx';

export function Tabs({
	className,
	...props
}: Omit<TabsPrimitive.Root.Props, 'className'> & { className?: string }): React.ReactElement {
	return (
		<TabsPrimitive.Root
			className={cn('flex flex-col gap-6', className)}
			data-slot="tabs"
			{...props}
		/>
	);
}

/* A tab opened by its address, or by the back button, can sit past the edge of a narrow list: bring it in, without moving the page. */
function revealActiveTab(node: unknown): void {
	const scroller = node as { scrollLeft: number; clientWidth: number; querySelector: (selector: string) => { offsetLeft: number; offsetWidth: number } | null } | null;
	const active = scroller?.querySelector('[data-slot="tabs-tab"][aria-selected="true"]');
	if (scroller === null || scroller === undefined || active === null || active === undefined) return;
	const hidden = active.offsetLeft < scroller.scrollLeft || active.offsetLeft + active.offsetWidth > scroller.scrollLeft + scroller.clientWidth;
	if (hidden) scroller.scrollLeft = active.offsetLeft - (scroller.clientWidth - active.offsetWidth) / 2;
}

export function TabsList({
	className,
	children,
	...props
}: Omit<TabsPrimitive.List.Props, 'className'> & { className?: string }): React.ReactElement {
	const scroller = useRef<HTMLDivElement>(null);
	/* After every render, not once: the selected tab changes without this list remounting. */
	useEffect(() => revealActiveTab(scroller.current));
	return (
		<div
			className="relative w-fit max-w-full"
			data-slot="tabs-scroll-frame"
		>
			<div className="scroll-container scroll-fade-x max-w-full overflow-x-auto rounded-lg" data-slot="tabs-scroll" ref={scroller}>
				<TabsPrimitive.List
					className={cn(
						'relative z-0 flex w-max items-center justify-start gap-x-1 rounded-lg bg-muted p-1 text-muted-foreground/72',
						className,
					)}
					data-slot="tabs-list"
					{...props}
				>
					{children}
					<TabsPrimitive.Indicator
						className={
							'absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) ' +
							'-z-1 rounded-md bg-background shadow-sm/5 transition-[width,translate] duration-200 ease-in-out motion-reduce:transition-none dark:bg-input'
						}
						data-slot="tab-indicator"
					/>
				</TabsPrimitive.List>
			</div>
		</div>
	);
}

export function TabsTab({
	className,
	...props
}: Omit<TabsPrimitive.Tab.Props, 'className'> & { className?: string }): React.ReactElement {
	return (
		<TabsPrimitive.Tab
			className={cn(
				/* One size at every width: a tab is not a field, so nothing asks for 16px on a phone, and five of them at 16px need 603px. */
				'relative flex shrink-0 grow cursor-pointer items-center justify-center whitespace-nowrap rounded-md border border-transparent font-medium text-sm outline-none pointer-coarse:min-h-11 ' +
					'transition-[color,background-color,box-shadow] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ' +
					'data-active:text-foreground data-disabled:pointer-events-none data-disabled:opacity-64',
				segmentedControlItemLayoutClassName,
				segmentedControlItemSizeClassNames.default,
				className,
			)}
			data-slot="tabs-tab"
			{...props}
		/>
	);
}

/** The count a tab carries; `attention` says it counts something waiting on the operator. */
export function TabsCount({ attention = false, children }: { attention?: boolean; children: React.ReactNode }): React.ReactElement {
	return <Count tone={attention ? 'warning' : 'neutral'}>{children}</Count>;
}

export function TabsPanel({
	className,
	...props
}: Omit<TabsPrimitive.Panel.Props, 'className'> & { className?: string }): React.ReactElement {
	return (
		<TabsPrimitive.Panel
			className={cn('flex flex-1 flex-col gap-6 outline-none', className)}
			data-slot="tabs-content"
			keepMounted
			{...props}
		/>
	);
}

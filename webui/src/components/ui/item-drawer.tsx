// webui/src/components/ui/item-drawer.tsx
//
// Where one item of a table opens. Not inside its row: an expanded row breaks
// the 40px rhythm, cannot hold a form at a reading width, and, under columns
// that stay put while the rest scroll, does not lay out at all. The list stays
// whole, the row stays marked, and the item opens beside it.
//
// Above `xl` the drawer is a card, the one every screen already uses: the
// second column of the layout, at the inspector width the shell reserves,
// inside the table's own ring. It is exactly as tall as the table, so the two
// end on one line: its panel scrolls what does not fit and its actions are the
// band that closes it. Between `md`
// and `xl` it is a drawer proper, over the right edge, and below `md` it is the
// whole screen: there its body scrolls and its actions are its bottom edge. It
// is never modal: the list stays live, so the operator can walk it with the
// arrow keys while the drawer follows.
//
// Over the page it is rendered at the end of the body, not where it is
// written: the content column masks its own edges for the scroll fade, and a
// fixed element painted inside a masked ancestor is cut at that ancestor's
// edge, which put the drawer's head under the app bar.

import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn.ts';
import { useQueryParam } from '../../lib/use-query-param.ts';
import { Button } from './button.tsx';
import { Card, CardAction, CardFooter, CardHeader, CardPanel, CardTitle } from './card.tsx';

const copy = {
	'en-US': { close: 'Close' },
	'pt-BR': { close: 'Fechar' },
} as const;

type DrawerLocale = keyof typeof copy;

/** The table and its drawer side by side above `xl`; the drawer alone decides where it sits below. */
export function DrawerLayout({ open, className, children, ...props }: React.ComponentProps<'div'> & { open: boolean }): React.ReactElement {
	/* Open beside the table, the two share one ring: the double edge is the block's, and the drawer is part of the block, not a second one. The table sets the height; the drawer fills it. */
	// oxlint-disable-next-line shadcn/no-arbitrary-values -- the second column is the inspector width the shell declares, and only exists while the drawer is open
	return <div className={cn('relative', open && 'xl:card-ring-group xl:grid xl:grid-cols-[minmax(0,1fr)_var(--inspector-column-width)] xl:items-start xl:gap-6', className)} data-open={open ? '' : undefined} data-slot="drawer-layout" {...props}>{children}</div>;
}

/* Tailwind's `xl`, the width at which the drawer is a column beside the table instead of a layer over it. */
const XL_QUERY = '(min-width: 80rem)';
type MediaRuntime = { matchMedia?: (query: string) => { matches: boolean; addEventListener?: (type: 'change', listener: () => void) => void; removeEventListener?: (type: 'change', listener: () => void) => void }; document?: { body: Element } };

function useAtLeastXl(): boolean {
	const subscribe = (onChange: () => void): (() => void) => {
		const media = (globalThis as unknown as MediaRuntime).matchMedia?.(XL_QUERY);
		media?.addEventListener?.('change', onChange);
		return () => media?.removeEventListener?.('change', onChange);
	};
	const read = (): boolean => (globalThis as unknown as MediaRuntime).matchMedia?.(XL_QUERY).matches ?? true;
	return useSyncExternalStore(subscribe, read, read);
}

type FocusTarget = { focus: (options?: { preventScroll?: boolean }) => void; isConnected?: boolean };
type FocusRuntime = { document?: { activeElement: FocusTarget | null }; addEventListener?: (type: 'keydown', listener: (event: { key: string; defaultPrevented: boolean }) => void) => void; removeEventListener?: (type: 'keydown', listener: (event: { key: string; defaultPrevented: boolean }) => void) => void };

/**
 * The drawer: the item's name on top, what it holds in the middle, what can
 * be done to it at the foot. Escape closes it; opening moves focus in, and
 * closing gives it back to wherever it came from, the row that opened it.
 */
export function ItemDrawer({ open, onClose, title, label, locale = 'en-US', footer, children, className }: {
	open: boolean;
	onClose: () => void;
	title: React.ReactNode;
	/** The accessible name when the title is not plain text. */
	label?: string;
	locale?: DrawerLocale;
	footer?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}): React.ReactElement | null {
	const panel = useRef<HTMLDivElement>(null);
	const opener = useRef<FocusTarget | null>(null);
	useEffect(() => {
		if (!open) return;
		const runtime = globalThis as unknown as FocusRuntime;
		opener.current = runtime.document?.activeElement ?? null;
		(panel.current as unknown as FocusTarget | null)?.focus({ preventScroll: true });
		const onKey = (event: { key: string; defaultPrevented: boolean }): void => { if (event.key === 'Escape' && !event.defaultPrevented) onClose(); };
		runtime.addEventListener?.('keydown', onKey);
		return () => {
			runtime.removeEventListener?.('keydown', onKey);
			const back = opener.current;
			if (back !== null && back.isConnected !== false) back.focus({ preventScroll: true });
		};
	}, [open, onClose]);
	const beside = useAtLeastXl();
	if (!open) return null;
	const name = label ?? (typeof title === 'string' ? title : undefined);
	const close = (
		<Button aria-label={copy[locale].close} className="-my-1 -mr-2" size="icon" type="button" variant="ghost" onClick={onClose}>
			<HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} size={16} strokeWidth={2.25} />
		</Button>
	);
	const foot = footer === undefined || footer === null ? null : footer;
	const body = (globalThis as unknown as MediaRuntime).document?.body;
	if (beside || body === undefined) {
		return (
			/* As tall as the table beside it and never taller, so the two blocks end on one line: it adds nothing to the row's height (h-0) and fills the row the table sets (min-h-full).
			 * Its panel scrolls what does not fit, and the actions stay the band that closes the card. */
			<Card aria-label={name} className={cn('h-0 min-h-full outline-none *:data-[slot=card]:min-h-0', className)} data-slot="item-drawer" ref={panel} role="dialog" tabIndex={-1}>
				{/* One line, the height of the table's control row beside it, so the rule under the two heads is one line too. The full name is on hover, and on the row that is open.
				 * No description, so one grid row; and 1px more at the foot, because the panel under it steps 1px up into the head where the table's rule sits under its row. */}
				<CardHeader className="grid-rows-1 pb-3.25" data-slot="item-drawer-head">
					<CardTitle className="min-w-0 truncate" title={name}>{title}</CardTitle>
					<CardAction className="row-span-1">{close}</CardAction>
				</CardHeader>
				<CardPanel className="min-h-0 gap-0 p-0">
					<div className="scroll-container min-h-0 flex-1 overflow-y-auto p-4" data-slot="item-drawer-body">{children}</div>
					{foot === null ? null : <CardFooter className="m-0" data-slot="item-drawer-foot">{foot}</CardFooter>}
				</CardPanel>
			</Card>
		);
	}
	return createPortal(
		<aside aria-label={name} className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card outline-none md:w-96 md:border-l md:shadow-lg/10', className)} data-slot="item-drawer" ref={panel} role="dialog" tabIndex={-1}>
			<div className="flex items-start gap-2 border-b px-4 py-3" data-slot="item-drawer-head">
				<h2 className="type-editorial-title min-w-0 flex-1 break-words text-base">{title}</h2>
				{close}
			</div>
			{/* The body takes whatever the item does not use and scrolls alone, so the actions are the drawer's bottom edge, never in the middle with blank panel under them. */}
			<div className="scroll-container min-h-0 flex-1 overflow-y-auto p-4" data-slot="item-drawer-body">{children}</div>
			{foot === null ? null : <CardFooter className="m-0" data-slot="item-drawer-foot">{foot}</CardFooter>}
		</aside>,
		body as unknown as Element,
	);
}

type KeyRuntime = { addEventListener?: (type: 'keydown', listener: (event: SteppingEvent) => void) => void; removeEventListener?: (type: 'keydown', listener: (event: SteppingEvent) => void) => void };
type SteppingEvent = { key: string; defaultPrevented: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean; target?: { tagName?: string; isContentEditable?: boolean } | null; preventDefault: () => void };

const typing = (target: SteppingEvent['target']): boolean => target?.isContentEditable === true || ['input', 'textarea', 'select'].includes((target?.tagName ?? '').toLowerCase());

/** The item after `id` in `ids`, wrapping at neither end: past the last there is none. */
export function neighbour(ids: readonly string[], id: string | null, step: 1 | -1): string | null {
	if (id === null) return null;
	const index = ids.indexOf(id);
	if (index < 0) return null;
	return ids[index + step] ?? null;
}

/**
 * While an item is open, the arrow keys walk the rows and the drawer follows.
 * Plain arrows only: with Alt they walk the sidebar, and inside a field they
 * belong to the field.
 */
export function useDrawerStepping(ids: readonly string[], active: string | null, onStep: (id: string) => void): void {
	useEffect(() => {
		if (active === null) return;
		const runtime = globalThis as unknown as KeyRuntime;
		const onKey = (event: SteppingEvent): void => {
			if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || typing(event.target)) return;
			if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
			const next = neighbour(ids, active, event.key === 'ArrowDown' ? 1 : -1);
			if (next === null) return;
			event.preventDefault();
			onStep(next);
		};
		runtime.addEventListener?.('keydown', onKey);
		return () => runtime.removeEventListener?.('keydown', onKey);
	}, [ids, active, onStep]);
}

/** Where the drawer goes once the open item leaves the list: the row after it, else the one before, else closed. */
export function successorOf(ids: readonly string[], id: string): string | null {
	return neighbour(ids, id, 1) ?? neighbour(ids, id, -1);
}

/** The item a table has open: named in the address under `param`, walked with the arrow keys over `ids`, the rows on the page. */
export function useOpenItem(param: string, ids: readonly string[], initial?: string): [string | null, (next: string | null) => void] {
	const [open, setOpen] = useQueryParam(param, initial ?? null);
	useDrawerStepping(ids, open, setOpen);
	return [open, setOpen];
}

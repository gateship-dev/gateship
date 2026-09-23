// webui/src/components/ui/item-drawer.tsx
//
// Where one item of a table opens. Not inside its row: an expanded row breaks
// the 40px rhythm, cannot hold a form at a reading width, and, under columns
// that stay put while the rest scroll, does not lay out at all. The list stays
// whole, the row stays marked, and the item opens beside it.
//
// Above `xl` the drawer pushes: it is the second column of the layout, the
// inspector column the shell already reserves, and the table narrows to make
// room. Between `md` and `xl` it overlays the right edge, and below `md` it is
// the whole screen. It is never modal: the list stays live, so the operator
// can walk it with the arrow keys while the drawer follows.
//
// Below `xl` it is rendered at the end of the body, not where it is written:
// the content column masks its own edges for the scroll fade, and a fixed
// element painted inside a masked ancestor is cut at that ancestor's edge,
// which put the drawer's head under the app bar. Without a document (a static
// render) it stays where it is written.

import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn.ts';
import { useQueryParam } from '../../lib/use-query-param.ts';
import { Button } from './button.tsx';
import { CardFooter } from './card.tsx';

const copy = {
	'en-US': { close: 'Close' },
	'pt-BR': { close: 'Fechar' },
} as const;

type DrawerLocale = keyof typeof copy;

/** The table and its drawer side by side above `xl`; the drawer alone decides where it sits below. */
export function DrawerLayout({ open, className, children, ...props }: React.ComponentProps<'div'> & { open: boolean }): React.ReactElement {
	/* Open beside the table, the two share one ring: the double edge is the block's, and the drawer is part of the block, not a second one. */
	// oxlint-disable-next-line shadcn/no-arbitrary-values -- the second column is the inspector width the shell declares, and only exists while the drawer is open
	return <div className={cn('relative', open && 'xl:card-ring-group xl:grid xl:grid-cols-[minmax(0,1fr)_var(--inspector-column-width)] xl:items-stretch xl:gap-6', className)} data-open={open ? '' : undefined} data-slot="drawer-layout" {...props}>{children}</div>;
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
	const panel = useRef<HTMLElement>(null);
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
	const panelElement = (
		<aside
			aria-label={label ?? (typeof title === 'string' ? title : undefined)}
			className={cn(
				'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card outline-none md:w-96 md:border-l md:shadow-lg/10',
				/* In the layout's column it is as tall as the table beside it, so the two blocks end on one line; the page scrolls it, and its foot holds the bottom of the window. */
				'xl:static xl:z-auto xl:w-auto xl:rounded-2xl xl:border xl:shadow-none',
				className,
			)}
			data-slot="item-drawer"
			ref={panel}
			role="dialog"
			tabIndex={-1}
		>
			{/* Above xl the page scrolls the drawer, so the name holds the top of the window as the actions hold its bottom: whatever is in view, the item is named and can be acted on.
			 * It rests on the column's fade the way the card's footer does at the other end: the column pads 24px and fades 16px, so the head steps 8px up into the padding and nothing readable shows above it. */}
			<div className="flex items-start gap-2 border-b bg-card px-4 py-3 xl:sticky xl:-top-2 xl:z-10 xl:rounded-t-[calc(var(--radius-2xl)-1px)]" data-slot="item-drawer-head">
				<h2 className="type-editorial-title min-w-0 flex-1 break-words text-sm">{title}</h2>
				<Button aria-label={copy[locale].close} className="-my-1 -mr-2" size="icon" type="button" variant="ghost" onClick={onClose}>
					<HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} size={16} strokeWidth={2.25} />
				</Button>
			</div>
			{/* The body is a card's panel, and the actions close it with the card's own footer: the same band, the same stickiness at the bottom of whatever scrolls it. Below xl that is the body itself, which pads 16px, so the footer keeps to its edge instead of stepping under it. */}
			<div className="scroll-container min-h-0 flex-1 overflow-y-auto px-4 py-4 xl:overflow-visible" data-slot="item-drawer-body">
				{children}
				{footer === undefined || footer === null ? null : <CardFooter className="lg:bottom-0" data-slot="item-drawer-foot" sticky>{footer}</CardFooter>}
			</div>
		</aside>
	);
	const body = (globalThis as unknown as MediaRuntime).document?.body;
	return beside || body === undefined ? panelElement : createPortal(panelElement, body as unknown as Element);
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

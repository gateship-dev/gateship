// webui/src/components/ui/collapsible.tsx
//
// What opens inside a card: a native <details>, so its content stays mounted
// and find-in-page sees it. `bare` is the same disclosure for a row of a list:
// no frame of its own, the row's own height. At page level the disclosure is a
// card (CardDisclosure); inside a card it is always this one.

import type React from 'react';
import { useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { DisclosureChevron, OWNS_CHEVRON } from './disclosure-chevron.tsx';

type CollapsibleProps = Omit<React.ComponentProps<'details'>, 'open'> & { defaultOpen?: boolean; bare?: boolean };

export function Collapsible({ className, defaultOpen = false, bare = false, onToggle, ...props }: CollapsibleProps): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	return <details className={cn(OWNS_CHEVRON, bare ? undefined : 'rounded-lg border', className)} data-bare={bare ? '' : undefined} data-slot="collapsible" open={open} onToggle={(event) => { setOpen((event.currentTarget as unknown as { open: boolean }).open); onToggle?.(event); }} {...props} />;
}

const TRIGGER = 'flex cursor-pointer list-none items-center gap-2 text-sm outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden';

export function CollapsibleTrigger({ className, children, bare = false, ...props }: React.ComponentProps<'summary'> & { bare?: boolean }): React.ReactElement {
	return <summary className={cn(TRIGGER, /* A row wraps when it has to, and keeps 4px of air either way. */
		bare ? 'min-h-8 flex-wrap gap-y-1 rounded-sm py-1' : 'min-h-11 rounded-lg px-3 sm:min-h-10', className)} data-slot="collapsible-trigger" {...props}><DisclosureChevron dense={bare} />{children}</summary>;
}

export function CollapsibleContent({ className, bare = false, ...props }: React.ComponentProps<'div'> & { bare?: boolean }): React.ReactElement {
	return <div className={cn(bare ? undefined : 'border-t', className)} data-slot="collapsible-content" {...props} />;
}

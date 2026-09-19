import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { useState } from 'react';
import { cn } from '../../lib/cn.ts';

type CollapsibleProps = Omit<React.ComponentProps<'details'>, 'open'> & { defaultOpen?: boolean };

export function Collapsible({ className, defaultOpen = false, onToggle, ...props }: CollapsibleProps): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	return <details className={cn('group rounded-lg border', className)} data-slot="collapsible" open={open} onToggle={(event) => { setOpen((event.currentTarget as unknown as { open: boolean }).open); onToggle?.(event); }} {...props} />;
}

/* The chevron is the trigger's own: every disclosure opens with the same affordance. */
export function CollapsibleTrigger({ className, children, ...props }: React.ComponentProps<'summary'>): React.ReactElement {
	return <summary className={cn('flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-3 text-sm outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring sm:min-h-10 [&::-webkit-details-marker]:hidden', className)} data-slot="collapsible-trigger" {...props}><HugeiconsIcon aria-hidden="true" className="shrink-0 text-muted-foreground group-open:rotate-90 motion-safe:transition-transform" icon={ArrowRight01Icon} size={16} strokeWidth={2.25} />{children}</summary>;
}

export function CollapsibleContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('border-t', className)} data-slot="collapsible-content" {...props} />;
}

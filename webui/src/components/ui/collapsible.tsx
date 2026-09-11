import type React from 'react';
import { useState } from 'react';
import { cn } from '../../lib/cn.ts';

type CollapsibleProps = Omit<React.ComponentProps<'details'>, 'open'> & { defaultOpen?: boolean };

export function Collapsible({ className, defaultOpen = false, onToggle, ...props }: CollapsibleProps): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	return <details className={cn('group rounded-lg border', className)} data-slot="collapsible" open={open} onToggle={(event) => { setOpen((event.currentTarget as unknown as { open: boolean }).open); onToggle?.(event); }} {...props} />;
}

export function CollapsibleTrigger({ className, ...props }: React.ComponentProps<'summary'>): React.ReactElement {
	return <summary className={cn('flex min-h-11 cursor-pointer list-none items-center outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden', className)} data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('border-t', className)} data-slot="collapsible-content" {...props} />;
}

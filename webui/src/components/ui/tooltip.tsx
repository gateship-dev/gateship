// webui/src/components/ui/tooltip.tsx
//
// The one hint tooltip. It names a control whose label is not on screen (an
// icon-only tile) and, when there is one, shows its shortcut as a key chip. It
// never repeats a label that is already visible, and it never carries
// information the operator cannot reach another way.
//
// The surface is the high-contrast bubble, not the bordered popover card: a
// tooltip is a label, and it has to read as one at a glance against either
// canvas. Dark is not light inverted here either -- a white bubble on the dark
// chrome glares, so dark lifts a raised neutral off the canvas with a hairline
// instead (the --tooltip tokens in index.css carry both).

import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type React from 'react';
import { cn } from '../../lib/cn.ts';
import { KeyChip } from './key-chip.tsx';

/** Hover intent, then instant between neighbours: the convention of every
 * desktop toolbar. One provider per group of adjacent triggers. */
export function TooltipGroup({ children }: { children: React.ReactNode }): React.ReactElement {
	return <TooltipPrimitive.Provider closeDelay={0} delay={400} timeout={300}>{children}</TooltipPrimitive.Provider>;
}

export function HintTooltip({
	label,
	detail,
	shortcut,
	side = 'right',
	disabled = false,
	children,
}: {
	label: string;
	/** A short secondary fact, such as a state name. */
	detail?: string | undefined;
	shortcut?: string | undefined;
	side?: 'top' | 'right' | 'bottom' | 'left';
	disabled?: boolean;
	children: React.ReactElement;
}): React.ReactElement {
	return (
		<TooltipPrimitive.Root disabled={disabled}>
			<TooltipPrimitive.Trigger render={children} />
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Positioner className="z-50" side={side} sideOffset={8}>
					<TooltipPrimitive.Popup
						className={cn(
							'flex max-w-64 origin-(--transform-origin) items-center gap-2 rounded-md border border-tooltip-border bg-tooltip px-2 py-1 text-tooltip-foreground text-xs shadow-md/10',
							'transition-[opacity,scale] duration-100 data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 motion-reduce:transition-none',
						)}
						data-slot="tooltip"
					>
						<span className="font-medium">{label}</span>
						{detail === undefined ? null : <span className="opacity-70">{detail}</span>}
						{shortcut === undefined ? null : <KeyChip data-slot="tooltip-shortcut" surface="tooltip">{shortcut}</KeyChip>}
					</TooltipPrimitive.Popup>
				</TooltipPrimitive.Positioner>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}

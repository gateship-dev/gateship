// webui/src/components/ui/toggle.tsx
//
// shadcn's toggle (base-nova style, registry fetched 2026-09-19) on the
// Base UI Toggle primitive, with the kit's relative imports and its focus
// ring (neutral --ring at 3px, as Input and Select).

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

export const toggleVariants = cva(
	'group/toggle inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg font-medium text-sm outline-none transition-colors ' +
		'hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 ' +
		'disabled:pointer-events-none disabled:opacity-64 aria-pressed:bg-muted aria-pressed:text-foreground data-pressed:bg-muted data-pressed:text-foreground ' +
		"[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
	{
		variants: {
			variant: {
				default: 'bg-transparent text-muted-foreground',
				outline: 'border border-input bg-transparent text-muted-foreground hover:bg-muted',
			},
			size: {
				default: 'h-8 min-w-8 px-2.5',
				sm: 'h-7 min-w-7 px-2 text-xs',
				lg: 'h-9 min-w-9 px-2.5',
			},
		},
		defaultVariants: { variant: 'default', size: 'default' },
	},
);

export function Toggle({ className, variant = 'default', size = 'default', ...props }: Omit<TogglePrimitive.Props, 'className'> & { className?: string } & VariantProps<typeof toggleVariants>): React.ReactElement {
	return <TogglePrimitive className={cn(toggleVariants({ variant, size, className }))} data-slot="toggle" {...props} />;
}

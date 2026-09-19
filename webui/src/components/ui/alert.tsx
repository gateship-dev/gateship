// webui/src/components/ui/alert.tsx
//
// shadcn's alert (base-nova style, registry fetched 2026-09-19) with the
// kit's relative imports. A leading icon, when given, sits in its own column
// beside the title and description; an action docks top-right.

import { cva, type VariantProps } from 'class-variance-authority';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

const alertVariants = cva(
	"group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default: 'bg-card text-card-foreground',
				destructive: 'bg-card text-destructive-foreground *:data-[slot=alert-description]:text-destructive-foreground/90 *:[svg]:text-current',
				warning: 'bg-card text-warning-foreground *:data-[slot=alert-description]:text-warning-foreground/90 *:[svg]:text-current',
			},
		},
		defaultVariants: { variant: 'default' },
	},
);

export function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>): React.ReactElement {
	return <div className={cn(alertVariants({ variant }), className)} data-slot="alert" data-variant={variant ?? 'default'} role="alert" {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground', className)} data-slot="alert-title" {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('text-balance text-muted-foreground text-sm md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4', className)} data-slot="alert-description" {...props} />;
}

export function AlertAction({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('absolute top-2 right-2', className)} data-slot="alert-action" {...props} />;
}

// webui/src/components/ui/badge.tsx
//
// The state or the class of the thing beside it: readiness, severity, outcome,
// a channel that is configured. One or two words, first letter capital, in a
// wash of its own semantic hue (8%, 16% on dark), never a solid and never an
// icon, because the hue already says it. A badge is static: what can be
// clicked is a link or a button, what can be toggled is a ToggleGroup.
//
// It is not the only short label in the kit. The life cycle of a run is a
// StatusDot, a fixed attribute of an entity is a Tag, an id is a Reference and
// a number beside a label is a Count.

import type React from 'react';
import { cn } from '../../lib/cn.ts';
import { sentenceCase } from './label-text.ts';

export type BadgeVariant = 'neutral' | 'info' | 'merged' | 'success' | 'warning' | 'error';

const SHAPE =
	'relative inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent font-medium outline-none ' +
	'h-5.5 min-w-5.5 px-[calc(--spacing(1)-1px)] text-sm sm:h-4.5 sm:min-w-4.5 sm:text-xs';

const VARIANT: Readonly<Record<BadgeVariant, string>> = {
	error: 'bg-destructive/8 text-destructive-foreground dark:bg-destructive/16',
	info: 'bg-info/8 text-info-foreground dark:bg-info/16',
	merged: 'bg-merged/8 text-merged-foreground dark:bg-merged/16',
	neutral: 'bg-secondary text-secondary-foreground',
	success: 'bg-success/8 text-success-foreground dark:bg-success/16',
	warning: 'bg-warning/8 text-warning-foreground dark:bg-warning/16',
};

export function Badge({
	children,
	variant = 'neutral',
}: {
	children: React.ReactNode;
	variant?: BadgeVariant;
}): React.ReactElement {
	return (
		<span className={cn(SHAPE, VARIANT[variant])} data-slot="badge" data-variant={variant}>
			{sentenceCase(children)}
		</span>
	);
}

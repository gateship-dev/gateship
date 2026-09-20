// webui/src/components/ui/stat.tsx
//
// One operational number: the value in the data voice (mono, tabular), the
// label over it as a mono eyebrow. Statistics never carry color, with one
// exception: `tone="attention"` says work is waiting on the operator, in the
// warning family. The brand's acid is for the mark alone (design-system.md,
// Foundations). The pulse honours reduced motion.
// A figure that has a list behind it takes `href` and becomes the way there.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

const SURFACE =
	'card-ring relative rounded-2xl border bg-card not-dark:bg-clip-padding p-4 text-card-foreground ' +
	'before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] ' +
	'before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

/* The same surface, washed in the warning family: same ring, same bevel, so the row of figures keeps one outline. */
const ATTENTION = `${SURFACE} border-warning/40 bg-warning/8 dark:bg-warning/16`;

const LINK = 'block outline-none hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors';

export function Stat({
	label,
	value,
	hint,
	href,
	tone = 'default',
	className,
	children,
	...props
}: Omit<React.ComponentProps<'div'>, 'children'> & {
	label: React.ReactNode;
	value: React.ReactNode;
	hint?: React.ReactNode;
	href?: string;
	tone?: 'default' | 'attention';
	children?: React.ReactNode;
}): React.ReactElement {
	const attention = tone === 'attention';
	const body = (
		<>
			{/* Label first, value under it (dashboard-01's section cards): the
			 * eye scans labels across a row, then drops to the number it wants. */}
			<p className={cn('type-eyebrow flex items-center gap-2', attention ? 'text-warning-foreground' : 'text-muted-foreground')}>
				{attention ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning motion-safe:animate-pulse" /> : null}
				{label}
			</p>
			<p className="type-data mt-2 text-2xl">{value}</p>
			{hint === undefined ? null : <p className="mt-1 text-muted-foreground text-xs">{hint}</p>}
			{/* A group of related numbers under the one that leads them. */}
			{children === undefined ? null : <div className="mt-4 border-t pt-4" data-slot="stat-detail">{children}</div>}
		</>
	);
	const classes = cn(attention ? ATTENTION : SURFACE, href === undefined ? undefined : LINK, className);
	if (href !== undefined) return <a className={classes} data-slot="stat" data-tone={tone} href={href}>{body}</a>;
	return <div className={classes} data-slot="stat" data-tone={tone} {...props}>{body}</div>;
}

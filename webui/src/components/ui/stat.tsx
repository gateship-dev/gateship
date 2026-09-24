// webui/src/components/ui/stat.tsx
//
// One operational number: the value in the data voice (mono, tabular), the
// label over it as a mono eyebrow. Statistics never carry color, with one
// exception: `tone="attention"` says work is waiting on the operator, in the
// warning family. The brand's acid is for the mark alone (design-system.md,
// Foundations). The pulse honours reduced motion.
// A figure that has a list behind it takes `href` and becomes the way there,
// and says so at rest with an arrow: a touch screen has no hover to ask.

import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

const SURFACE =
	'card-ring relative rounded-2xl border bg-card not-dark:bg-clip-padding p-4 text-card-foreground ' +
	'before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] ' +
	'before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

/* The same surface, washed in the warning family: same ring, same bevel, so the row of figures keeps one outline. */
const ATTENTION = `${SURFACE} border-warning/40 bg-warning/8 dark:bg-warning/16`;

const LINK = 'block outline-none hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors';
/* A lone figure sits on the foot of its card, so the figures of one row share a line however their labels wrap. */
const ANCHORED = 'flex flex-col';

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
	const anchored = hint === undefined && children === undefined;
	const head = (
		<>
			{/* Label first, value under it (dashboard-01's section cards): the
			 * eye scans labels across a row, then drops to the number it wants. */}
			<p className={cn('type-eyebrow flex items-center gap-2', href === undefined ? undefined : 'pr-6', attention ? 'text-warning-foreground' : 'text-muted-foreground')}>
				{attention ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning motion-safe:animate-pulse" /> : null}
				{label}
			</p>
			<p className={cn('type-data text-2xl', anchored ? 'mt-auto pt-2' : 'mt-2')}>{value}</p>
			{hint === undefined ? null : <p className="mt-1 text-muted-foreground text-xs">{hint}</p>}
		</>
	);
	const body = (
		<>
			{href === undefined ? null : <HugeiconsIcon aria-hidden="true" className="absolute top-4 right-4 size-3.5 text-muted-foreground group-hover/stat:text-foreground motion-safe:transition-colors" data-slot="stat-arrow" icon={ArrowUpRight01Icon} size={14} strokeWidth={2.25} />}
			{/* A group of related numbers goes under the one that leads them, and beside it once the card is wide
			 * enough for both: a card as wide as the page with its figures stacked is mostly air. */}
			{children === undefined ? head : (
				<div className="@container">
					<div className="flex flex-col gap-4 @xl:flex-row @xl:gap-8">
						<div className="@xl:w-48 @xl:shrink-0" data-slot="stat-head">{head}</div>
						<div className="min-w-0 border-t pt-4 @xl:flex-1 @xl:border-t-0 @xl:border-l @xl:pt-0 @xl:pl-8" data-slot="stat-detail">{children}</div>
					</div>
				</div>
			)}
		</>
	);
	const classes = cn(attention ? ATTENTION : SURFACE, href === undefined ? undefined : LINK, anchored ? ANCHORED : undefined, className);
	/* `group/stat` stays outside cn: tailwind-merge drops a named group when the caller passes a plain one. */
	if (href !== undefined) return <a className={`group/stat ${classes}`} data-slot="stat" data-tone={tone} href={href}>{body}</a>;
	return <div className={classes} data-slot="stat" data-tone={tone} {...props}>{body}</div>;
}

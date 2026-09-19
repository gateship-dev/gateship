// webui/src/components/ui/stat.tsx
//
// One operational number: the value in the data voice (mono, tabular), the
// label over it as a mono eyebrow. Statistics never carry color, with one
// exception: `tone="attention"` is the only acid surface in the product. Acid
// marks exactly one thing, work waiting on the operator (design-system.md
// section 1), so nothing else may use the attention family as a surface.
// Its border uses the -ui ramp so it holds 3:1 on the light canvas, and the
// pulse honours reduced motion.
// A figure that has a list behind it takes `href` and becomes the way there.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

const SURFACE =
	'card-ring relative rounded-2xl border bg-card not-dark:bg-clip-padding p-4 text-card-foreground ' +
	'before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] ' +
	'before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

const ATTENTION =
	'relative rounded-2xl border border-attention-ui bg-attention-surface p-4 ' +
	'shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_2px_3px_rgba(0,0,0,0.05),0_6px_28px_rgba(200,255,0,0.09)] ' +
	'dark:shadow-[0_2px_3px_rgba(0,0,0,0.3),0_6px_28px_rgba(200,255,0,0.09)]';

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
			<p className={cn('type-eyebrow flex items-center gap-2', attention ? 'text-foreground' : 'text-muted-foreground')}>
				{attention ? <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-attention-ui motion-safe:animate-pulse" /> : null}
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

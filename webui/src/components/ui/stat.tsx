// webui/src/components/ui/stat.tsx
//
// One operational number: the value in the data voice (mono, tabular), the
// label under it in quiet sans. Statistics never carry color; state and
// attention have their own surfaces (design-system.md sections 1 and 3).
// The surface is a plain card inside the shared card ring. Its border and
// bevel carry the surface definition without another shadow.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

export function Stat({
	label,
	value,
	hint,
	className,
	...props
}: React.ComponentProps<'div'> & {
	label: React.ReactNode;
	value: React.ReactNode;
	hint?: React.ReactNode;
}): React.ReactElement {
	return (
		<div
			className={cn(
				'card-ring relative rounded-2xl border bg-card not-dark:bg-clip-padding p-4 text-card-foreground ' +
					'before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] ' +
					'before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
				className,
			)}
			data-slot="stat"
			{...props}
		>
			{/* Label first, value under it (dashboard-01's section cards): the
			 * eye scans labels across a row, then drops to the number it wants. */}
			<p className="type-eyebrow text-muted-foreground">{label}</p>
			<p className="type-data mt-1.5 text-2xl">{value}</p>
			{hint === undefined ? null : <p className="mt-1.5 text-muted-foreground text-xs">{hint}</p>}
		</div>
	);
}

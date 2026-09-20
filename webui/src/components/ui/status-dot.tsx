// webui/src/components/ui/status-dot.tsx
//
// The life cycle of a run, the one state the whole product is about, as a dot
// and its name. A dot reads down a dense column faster than a row of washes,
// so lists of runs use it; every other state is a Badge. The dot moves only
// while the run does, and honours reduced motion. The label is always there:
// colour is never the only signal.

import type React from 'react';
import { cn } from '../../lib/cn.ts';
import { sentenceCase } from './label-text.ts';

export type StatusTone = 'neutral' | 'info' | 'merged' | 'success' | 'warning' | 'error';

const DOT: Readonly<Record<StatusTone, string>> = {
	error: 'bg-destructive',
	info: 'bg-info',
	merged: 'bg-merged',
	neutral: 'border border-muted-foreground/70',
	success: 'bg-success',
	warning: 'bg-warning',
};

export function StatusDot({
	tone,
	children,
	active = false,
	className,
}: {
	tone: StatusTone;
	/** The name of the state. Without it the dot is decorative and the caller names the state beside it. */
	children?: React.ReactNode;
	/** The thing is moving right now: the dot pulses until it stops. */
	active?: boolean;
	className?: string;
}): React.ReactElement {
	return (
		<span className={cn('inline-flex w-fit items-center gap-2 whitespace-nowrap text-sm sm:text-xs', className)} data-slot="status-dot" data-tone={tone}>
			<span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[tone], active && 'motion-safe:animate-pulse')} />
			{children === undefined ? null : <span className="font-medium">{sentenceCase(children)}</span>}
		</span>
	);
}

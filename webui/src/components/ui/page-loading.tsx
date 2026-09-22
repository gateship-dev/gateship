// webui/src/components/ui/page-loading.tsx
//
// A page that has nothing to show yet shows the mark, its stair building
// itself block by block from the bottom over and over, and says what it waits
// for. A skeleton is for a block inside a
// page that is already there (a panel, the rows of a table); a page does not
// wear the shape of content it does not have. Under reduced motion the mark
// stands still: the status text is the feedback.

import type React from 'react';
import { cn } from '../../lib/cn.ts';
import { GateshipMark } from '../gateship-logo.tsx';

export function LoadingMark({ className }: { className?: string }): React.ReactElement {
	return <span aria-hidden="true" className={cn('loading-mark block text-foreground', className)} data-slot="loading-mark"><GateshipMark className="size-14" steps /></span>;
}

export function PageLoading({ label, className, ...props }: React.ComponentProps<'div'> & { /** What is being loaded, for whoever cannot see the mark. */ label: string }): React.ReactElement {
	return (
		<div aria-busy="true" aria-label={label} className={cn('flex min-h-48 flex-1 flex-col items-center justify-center gap-4', className)} data-slot="page-loading" role="status" {...props}>
			<LoadingMark />
			<span className="sr-only">{label}</span>
		</div>
	);
}

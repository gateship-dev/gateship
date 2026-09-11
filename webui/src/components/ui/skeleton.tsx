import type React from 'react';
import { cn } from '../../lib/cn.ts';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} data-slot="skeleton" {...props} />;
}

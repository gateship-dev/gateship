import type React from 'react';
import { cn } from '../../lib/cn.ts';

export function Item({ className, ...props }: React.ComponentProps<'li'>): React.ReactElement {
	return <li className={cn('flex min-w-0 flex-wrap items-center gap-3 px-4 py-3', className)} data-slot="item" {...props} />;
}

export function ItemGroup({ className, ...props }: React.ComponentProps<'ul'>): React.ReactElement {
	return <ul className={cn('divide-y divide-border rounded-lg border', className)} data-slot="item-group" {...props} />;
}

export function ItemContent({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('min-w-0 flex-1', className)} data-slot="item-content" {...props} />;
}

export function ItemActions({ className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('ml-auto flex shrink-0 flex-wrap items-center gap-2', className)} data-slot="item-actions" {...props} />;
}

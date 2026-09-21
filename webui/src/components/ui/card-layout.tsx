// Shared composition roles for groups of cards.  Spacing between sibling
// surfaces belongs here, never to the cards themselves.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

type Container = 'div' | 'ul';
type LayoutProps = {
	as?: Container;
	className?: string;
	children: React.ReactNode;
};

export function CardStack({ as: Tag = 'div', className, children }: LayoutProps): React.ReactElement {
	return <Tag className={cn('flex flex-col gap-6', className)} data-slot="card-stack">{children}</Tag>;
}

export function CardGrid({
	as: Tag = 'div',
	className,
	children,
	compact = false,
	equalHeight = false,
}: LayoutProps & { compact?: boolean; equalHeight?: boolean }): React.ReactElement {
	/* The columns answer to the room the grid has, not to the window: beside an open sidebar a 1024px window leaves it 680px. */
	return (
		<div className="@container" data-slot="card-grid-frame">
		<Tag
			className={cn(
				'card-ring-group grid',
				equalHeight && 'auto-rows-fr',
				compact ? 'gap-4' : 'gap-6',
				className,
			)}
			data-density={compact ? 'compact' : 'standard'}
			data-slot="card-grid"
		>
			{children}
		</Tag>
		</div>
	);
}

/** Two independent card columns which collapse to the normal single column. */
export function CardSplit({ className, children }: Omit<LayoutProps, 'as'>): React.ReactElement {
	return (
		<div
			className={cn('grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]', className)}
			data-slot="card-split"
		>
			{children}
		</div>
	);
}

/** Form rhythm: 12px between fields and 4px within a field. */
export function FormStack({ className, children, ...props }: React.ComponentProps<'form'>): React.ReactElement {
	return <form className={cn('flex flex-col gap-3', className)} data-slot="form-stack" {...props}>{children}</form>;
}

/* A field is as wide as what is typed in it, not as the card that holds it: a name or a choice in 448px, prose in a reading measure. */
const FIELD_MEASURE = { field: 'max-w-md', prose: 'max-w-3xl', full: '' } as const;

export function FormField({ className, children, measure = 'field', ...props }: React.ComponentProps<'label'> & { /** `prose` for a textarea that holds paragraphs, `full` for a field a grid already sizes. */ measure?: keyof typeof FIELD_MEASURE }): React.ReactElement {
	/* A field reads at the body size everywhere: the label, the help under it, the control's own text. */
	return <label className={cn('flex min-w-0 flex-col gap-1 text-sm', FIELD_MEASURE[measure], className)} data-measure={measure} data-slot="form-field" {...props}>{children}</label>;
}

/** A box and what it says, side by side: a checkbox that waits for the form's save, or a switch that acts at once. The box comes first in the markup. */
export function CheckField({ className, children, ...props }: React.ComponentProps<'label'>): React.ReactElement {
	return <label className={cn('flex items-start gap-2 text-sm', className)} data-slot="check-field" {...props}>{children}</label>;
}

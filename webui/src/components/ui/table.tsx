// webui/src/components/ui/table.tsx
//
// Gateship's table is a scroll container wrapping the real
// <table>, rows separated by the border token, hover and selection tinted
// by mixing the surface with 2-4% of ink. The "card" variant's selectors
// stay inert; every table on this screen renders the default variant.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

export function Table({
	className,
	...props
}: React.ComponentProps<'table'>): React.ReactElement {
	return (
		<div className="scroll-container relative w-full overflow-x-auto" data-slot="table-container" data-variant="default">
			<table
				className={cn(
					'w-full caption-bottom in-data-[variant=card]:border-separate in-data-[variant=card]:border-spacing-0 text-sm',
					className,
				)}
				data-slot="table"
				{...props}
			/>
		</div>
	);
}

export function TableHeader({
	className,
	...props
}: React.ComponentProps<'thead'>): React.ReactElement {
	return <thead className={cn('[&_tr]:border-b', className)} data-slot="table-header" {...props} />;
}

export function TableBody({
	className,
	...props
}: React.ComponentProps<'tbody'>): React.ReactElement {
	return (
		<tbody
			className={cn('relative [&_tr:last-child]:border-0', className)}
			data-slot="table-body"
			{...props}
		/>
	);
}

export function TableRow({
	className,
	active = false,
	...props
}: React.ComponentProps<'tr'> & { /** The row whose item is open beside the table: it wears the selected tint and says it is current. */ active?: boolean }): React.ReactElement {
	return (
		<tr
			aria-current={active ? 'true' : undefined}
			className={cn(
				'relative border-b hover:bg-[color-mix(in_srgb,var(--background),var(--color-black)_2%)] ' +
					'data-[state=selected]:bg-[color-mix(in_srgb,var(--background),var(--color-black)_4%)] data-[active]:bg-[color-mix(in_srgb,var(--background),var(--color-black)_4%)] ' +
					'dark:data-[state=selected]:bg-[color-mix(in_srgb,var(--background),var(--color-white)_4%)] dark:data-[active]:bg-[color-mix(in_srgb,var(--background),var(--color-white)_4%)] ' +
					'dark:hover:bg-[color-mix(in_srgb,var(--background),var(--color-white)_2%)]',
				className,
			)}
			data-active={active ? '' : undefined}
			data-slot="table-row"
			{...props}
		/>
	);
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.ReactElement {
	return (
		<th
			className={cn(
				/* A head is the eyebrow of its column: the caps mono every section label wears, so a column's name is never read as one of its values. */
				/* Between columns 12px; at the table's two edges 16px, the inset a Stat uses, so stacked blocks share a text edge. */
				'type-eyebrow h-10 whitespace-nowrap px-3 text-left align-middle text-muted-foreground leading-none first:pl-4 last:pr-4',
				className,
			)}
			data-slot="table-head"
			{...props}
		/>
	);
}

export function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.ReactElement {
	return (
		<td
			className={cn(
				/* The row is 40px by declaration, not by padding arithmetic: a cell's height is its minimum, so a two-line cell still grows.
				 * A cell that holds a 24px control gives up its own padding, or the control plus the row's border makes the row 41px. */
				'h-10 whitespace-nowrap bg-clip-padding px-3 py-2 align-middle leading-none first:pl-4 last:pr-4 has-[>button]:py-0',
				className,
			)}
			data-slot="table-cell"
			{...props}
		/>
	);
}

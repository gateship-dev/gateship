// webui/src/components/ui/data-table.tsx
//
// shadcn's data table recipe (docs read 2026-09-19: TanStack Table v9 with
// `useTable` and explicit `tableFeatures`, Base UI) composed from the kit:
// Table, Button, Input, Select, DropdownMenu, Skeleton and Empty. Consumers
// own columns, data and state; this file owns the chrome that every table
// shares: sortable headers with a column menu, the view-options menu, the
// pagination footer and the loading, empty and updating states.
//
// Column pinning and resizing are deliberately absent: a table that needs
// them is a table too wide for its screen. A column sizes itself through
// `meta.className` (a width utility, `text-right` for figures) and nothing
// else.

import {
	columnFilteringFeature,
	columnVisibilityFeature,
	createFilteredRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	FlexRender,
	globalFilteringFeature,
	rowPaginationFeature,
	rowSortingFeature,
	tableFeatures,
	useTable,
	type Column,
	type ColumnDef,
	type RowData,
	type ReactTable,
	type TableOptions,
} from '@tanstack/react-table';
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowLeftDoubleIcon, ArrowRight01Icon, ArrowRightDoubleIcon, ArrowUp01Icon, Settings02Icon, UnfoldMoreIcon, ViewOffIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from './button.tsx';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu.tsx';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './empty.tsx';
import { Input } from './input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.tsx';
import { Skeleton } from './skeleton.tsx';
import { Table as GateshipTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.tsx';

/** Shared features are deliberately explicit. Consumers still own columns and data. */
export const gateshipTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnVisibilityFeature,
	filteredRowModel: createFilteredRowModel(),
	globalFilteringFeature,
	paginatedRowModel: createPaginatedRowModel(),
	rowPaginationFeature,
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
});

export type GateshipTableFeatures = typeof gateshipTableFeatures;
export type GateshipTableOptions<TData extends RowData> = TableOptions<GateshipTableFeatures, TData>;
export type GateshipColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<GateshipTableFeatures, TData, TValue>;
export type GateshipTable<TData extends RowData> = ReactTable<GateshipTableFeatures, TData>;
/** What a column may say about its own cells: classes for header and cells alike, and the label its menus use. */
export interface GateshipColumnMeta { className?: string; label?: string }

export function useGateshipTable<TData extends RowData>(options: GateshipTableOptions<TData>): GateshipTable<TData> {
	return useTable(options);
}

export type TableLocale = 'en-US' | 'pt-BR';
const copy = {
	'en-US': {
		filterPlaceholder: 'Filter rows…',
		noResults: 'No results.',
		noResultsDetail: 'Nothing matches the current filters.',
		loading: 'Loading…',
		updating: 'Updating…',
		view: 'View',
		toggleColumns: 'Toggle columns',
		reset: 'Reset columns',
		ascending: 'Ascending',
		descending: 'Descending',
		hide: 'Hide column',
		rowsPerPage: 'Rows per page',
		first: 'First page',
		previous: 'Previous page',
		next: 'Next page',
		last: 'Last page',
		page: (current: number, count: number) => `Page ${current} of ${count}`,
		range: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
		sortState: { ascending: 'sorted ascending', descending: 'sorted descending', none: 'not sorted' },
	},
	'pt-BR': {
		filterPlaceholder: 'Filtrar linhas…',
		noResults: 'Nenhum resultado.',
		noResultsDetail: 'Nada corresponde aos filtros atuais.',
		loading: 'Carregando…',
		updating: 'Atualizando…',
		view: 'Colunas',
		toggleColumns: 'Mostrar colunas',
		reset: 'Restaurar colunas',
		ascending: 'Crescente',
		descending: 'Decrescente',
		hide: 'Ocultar coluna',
		rowsPerPage: 'Linhas por página',
		first: 'Primeira página',
		previous: 'Página anterior',
		next: 'Próxima página',
		last: 'Última página',
		page: (current: number, count: number) => `Página ${current} de ${count}`,
		range: (from: number, to: number, total: number) => `${from}–${to} de ${total}`,
		sortState: { ascending: 'ordem crescente', descending: 'ordem decrescente', none: 'sem ordenação' },
	},
} as const;

type TableControlProps<TData extends RowData> = { table: GateshipTable<TData>; locale?: TableLocale; className?: string };
type GateshipColumn<TData extends RowData> = Column<GateshipTableFeatures, TData>;

function metaOf<TData extends RowData>(column: GateshipColumn<TData>): GateshipColumnMeta {
	return (column.columnDef.meta ?? {}) as GateshipColumnMeta;
}

function columnLabel<TData extends RowData>(column: GateshipColumn<TData>): string {
	const header = column.columnDef.header;
	return metaOf(column).label ?? (typeof header === 'string' || typeof header === 'number' ? String(header) : column.id);
}

export function DataTableToolbar({ children, className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('flex flex-wrap items-center gap-2', className)} data-slot="data-table-toolbar" {...props}>{children}</div>;
}

/** The text filter: a column's own filter when `columnId` is given, the table's global filter otherwise. */
export function DataTableFilter<TData extends RowData>({
	table,
	columnId,
	locale = 'en-US',
	label,
	placeholder,
	className,
}: TableControlProps<TData> & { columnId?: string; label?: string; placeholder?: string }): React.ReactElement {
	const text = copy[locale];
	const column = columnId === undefined ? undefined : table.getColumn(columnId);
	const value = String(column?.getFilterValue() ?? table.state.globalFilter ?? '');
	return (
		<Input
			aria-label={label ?? placeholder ?? text.filterPlaceholder}
			className={cn('w-full max-w-sm', className)}
			data-slot="data-table-filter"
			placeholder={placeholder ?? text.filterPlaceholder}
			type="search"
			value={value}
			onChange={(event) => {
				const next = (event.currentTarget as unknown as { value: string }).value;
				if (column) column.setFilterValue(next);
				else table.setGlobalFilter(next);
			}}
		/>
	);
}

/**
 * A column's header: plain text when the column neither sorts nor hides,
 * otherwise a ghost button showing the sort state that opens the column's
 * menu (ascending, descending, hide).
 */
export function DataTableColumnHeader<TData extends RowData>({
	column,
	title,
	locale = 'en-US',
	className,
}: { column: GateshipColumn<TData>; title: string; locale?: TableLocale; className?: string }): React.ReactElement {
	const text = copy[locale];
	if (!column.getCanSort() && !column.getCanHide()) return <span className={className}>{title}</span>;
	const sorted = column.getIsSorted();
	const icon = sorted === 'asc' ? ArrowUp01Icon : sorted === 'desc' ? ArrowDown01Icon : UnfoldMoreIcon;
	const state = sorted === 'asc' ? text.sortState.ascending : sorted === 'desc' ? text.sortState.descending : text.sortState.none;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button aria-label={`${title}, ${state}`} className={cn('-ml-2.5 h-7 gap-1 px-2 font-medium text-muted-foreground data-popup-open:bg-accent', className)} size="sm" type="button" variant="ghost" />}
			>
				{title}
				<HugeiconsIcon aria-hidden="true" className="size-3.5 opacity-70" icon={icon} size={14} strokeWidth={2.5} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-40">
				{column.getCanSort() ? (
					<>
						<DropdownMenuItem onClick={() => column.toggleSorting(false)}><HugeiconsIcon icon={ArrowUp01Icon} size={16} strokeWidth={2.25} />{text.ascending}</DropdownMenuItem>
						<DropdownMenuItem onClick={() => column.toggleSorting(true)}><HugeiconsIcon icon={ArrowDown01Icon} size={16} strokeWidth={2.25} />{text.descending}</DropdownMenuItem>
					</>
				) : null}
				{column.getCanSort() && column.getCanHide() ? <DropdownMenuSeparator /> : null}
				{column.getCanHide() ? <DropdownMenuItem onClick={() => column.toggleVisibility(false)}><HugeiconsIcon icon={ViewOffIcon} size={16} strokeWidth={2.25} />{text.hide}</DropdownMenuItem> : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** The view-options menu: one checkbox per hideable column, and a reset. */
export function DataTableViewOptions<TData extends RowData>({ table, locale = 'en-US', className }: TableControlProps<TData>): React.ReactElement {
	const text = copy[locale];
	const columns = table.getAllLeafColumns().filter((column) => column.getCanHide());
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button className={cn('ml-auto', className)} size="sm" type="button" variant="outline" />}>
				<HugeiconsIcon aria-hidden="true" icon={Settings02Icon} size={16} strokeWidth={2.25} />
				{text.view}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44" data-slot="data-table-view-options">
				{/* Base UI's GroupLabel must live inside a Group. */}
				<DropdownMenuGroup>
					<DropdownMenuLabel>{text.toggleColumns}</DropdownMenuLabel>
					{columns.map((column) => (
						<DropdownMenuCheckboxItem checked={column.getIsVisible()} closeOnClick={false} key={column.id} onCheckedChange={(checked) => column.toggleVisibility(checked)}>
							{columnLabel(column)}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => table.resetColumnVisibility(true)}>{text.reset}</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * The footer: the range on the left, page size, page and the four page
 * buttons on the right. With `offset`, `total` and the two callbacks the
 * footer drives server-side pages; without them it pages the table itself.
 */
export function DataTablePagination<TData extends RowData>({
	table,
	locale = 'en-US',
	className,
	offset,
	total: totalOverride,
	onOffsetChange,
	onPageSizeChange,
}: TableControlProps<TData> & { offset?: number; total?: number; onOffsetChange?: (offset: number) => void; onPageSizeChange?: (limit: number) => void }): React.ReactElement {
	const text = copy[locale];
	const { pageSize, pageIndex } = table.state.pagination;
	const manual = offset !== undefined && onOffsetChange !== undefined && onPageSizeChange !== undefined;
	const total = totalOverride ?? table.getRowCount();
	const currentOffset = manual ? offset : pageIndex * pageSize;
	const returned = table.getRowModel().rows.length;
	const from = total === 0 ? 0 : currentOffset + 1;
	const to = Math.min(total, currentOffset + returned);
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const current = Math.min(pageCount, Math.floor(currentOffset / pageSize) + 1);
	const goTo = (next: number): void => {
		if (manual) onOffsetChange(next * pageSize);
		else table.setPageIndex(next);
	};
	const nav = (label: string, icon: typeof ArrowLeft01Icon, target: number, disabled: boolean, className?: string): React.ReactElement => (
		<Button aria-label={label} className={cn('size-8', className)} disabled={disabled} size="icon" type="button" variant="outline" onClick={() => goTo(target)}>
			<HugeiconsIcon aria-hidden="true" icon={icon} size={16} strokeWidth={2.25} />
		</Button>
	);
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-2 text-sm', className)} data-slot="data-table-pagination">
			<span aria-live="polite" className="font-mono text-muted-foreground text-xs tabular-nums">{text.range(from, to, total)}</span>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<label className="flex items-center gap-2 text-muted-foreground">
					<span className="hidden sm:inline">{text.rowsPerPage}</span>
					<Select
						items={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
						value={String(pageSize)}
						onValueChange={(value) => manual ? onPageSizeChange(Number(value)) : table.setPageSize(Number(value))}
					>
						<SelectTrigger aria-label={text.rowsPerPage} className="h-8 min-h-8 w-18 min-w-0 font-mono tabular-nums sm:min-h-8"><SelectValue /></SelectTrigger>
						<SelectContent>{PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
					</Select>
				</label>
				<span className="font-mono text-muted-foreground text-xs tabular-nums">{text.page(current, pageCount)}</span>
				<div className="flex items-center gap-1">
					{nav(text.first, ArrowLeftDoubleIcon, 0, current <= 1, 'hidden lg:inline-flex')}
					{nav(text.previous, ArrowLeft01Icon, current - 2, current <= 1)}
					{nav(text.next, ArrowRight01Icon, current, current >= pageCount)}
					{nav(text.last, ArrowRightDoubleIcon, pageCount - 1, current >= pageCount, 'hidden lg:inline-flex')}
				</div>
			</div>
		</div>
	);
}

export type DataTableStatus = 'ready' | 'loading' | 'updating' | 'error';

/**
 * The table itself inside its bordered frame. A string header becomes a
 * DataTableColumnHeader on its own, so a column that sorts or hides gets
 * its menu without the screen composing one. `loading` (no rows yet) draws
 * skeleton rows; `updating` keeps the rows and dims them; an empty result
 * renders `emptyState` in one full-width cell. Errors belong to the caller,
 * as an Alert above the table.
 */
export function DataTable<TData extends RowData>({
	table,
	locale = 'en-US',
	status = 'ready',
	emptyState,
	emptyDetail,
	emptyAction,
	skeletonRows = 5,
	rowClassName,
	className,
}: TableControlProps<TData> & {
	status?: DataTableStatus;
	emptyState?: React.ReactNode;
	emptyDetail?: React.ReactNode;
	emptyAction?: React.ReactNode;
	skeletonRows?: number;
	/** Extra classes for one row, from its data: how a screen marks the rows that wait on the operator. */
	rowClassName?: (row: TData) => string | undefined;
}): React.ReactElement {
	const text = copy[locale];
	const rows = table.getRowModel().rows;
	const columns = table.getVisibleLeafColumns();
	const busy = status === 'loading' || status === 'updating';
	return (
		<div aria-busy={busy} className={cn('overflow-hidden rounded-lg border', className)} data-slot="data-table" data-status={status}>
			{busy ? <span className="sr-only" role="status">{status === 'loading' ? text.loading : text.updating}</span> : null}
			<GateshipTable>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => (
								<TableHead aria-sort={header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined} className={metaOf(header.column).className} key={header.id}>
									{header.isPlaceholder ? null : typeof header.column.columnDef.header === 'string'
										? <DataTableColumnHeader column={header.column} locale={locale} title={header.column.columnDef.header} />
										: <FlexRender header={header} />}
								</TableHead>
							))}
						</TableRow>
					))}
				</TableHeader>
				<TableBody className={cn('transition-opacity', status === 'updating' && 'opacity-60')}>
					{status === 'loading' && rows.length === 0
						? Array.from({ length: skeletonRows }, (_, index) => (
							<TableRow key={`skeleton-${index}`}>
								{columns.map((column) => <TableCell className={metaOf(column).className} key={column.id}><Skeleton className="h-4 w-full max-w-32" /></TableCell>)}
							</TableRow>
						))
						: rows.map((row) => (
							<TableRow className={rowClassName?.(row.original)} key={row.id}>
								{row.getVisibleCells().map((cell) => <TableCell className={metaOf(cell.column).className} key={cell.id}><FlexRender cell={cell} /></TableCell>)}
							</TableRow>
						))}
					{rows.length === 0 && status !== 'loading' ? (
						<TableRow>
							<TableCell className="h-32 text-center" colSpan={columns.length}>
								<Empty className="p-2" role="status">
									<EmptyHeader>
										<EmptyTitle>{emptyState ?? text.noResults}</EmptyTitle>
										<EmptyDescription>{emptyDetail ?? text.noResultsDetail}</EmptyDescription>
									</EmptyHeader>
									{emptyAction}
								</Empty>
							</TableCell>
						</TableRow>
					) : null}
				</TableBody>
			</GateshipTable>
		</div>
	);
}

function ariaSort(sorted: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
	return sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
}

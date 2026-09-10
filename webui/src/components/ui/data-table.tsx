import {
	columnFilteringFeature,
	columnPinningFeature,
	columnResizingFeature,
	columnSizingFeature,
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
import type React from 'react';
import { Button } from './button.tsx';
import { FormField } from './card-layout.tsx';
import { Input } from './input.tsx';
import { SelectField } from './select.tsx';
import { Table as GateshipTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.tsx';
import { cn } from '../../lib/cn.ts';

/** Shared features are deliberately explicit. Consumers still own columns and data. */
export const gateshipTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnPinningFeature,
	columnResizingFeature,
	columnSizingFeature,
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

export function useGateshipTable<TData extends RowData>(options: GateshipTableOptions<TData>): GateshipTable<TData> {
	return useTable(options);
}

export type TableLocale = 'en-US' | 'pt-BR';
const copy = {
	'en-US': {
		columns: 'Columns',
		filter: 'Filter',
		filterPlaceholder: 'Filter rows…',
		noResults: 'No results.',
		loading: 'Loading…',
		updating: 'Updating…',
		error: 'Unable to load this table.',
		reset: 'Reset',
		pageSize: 'Rows per page',
		previous: 'Previous page',
		next: 'Next page',
		page: 'Page',
	},
	'pt-BR': {
		columns: 'Colunas',
		filter: 'Filtrar',
		filterPlaceholder: 'Filtrar linhas…',
		noResults: 'Nenhum resultado.',
		loading: 'Carregando…',
		updating: 'Atualizando…',
		error: 'Não foi possível carregar esta tabela.',
		reset: 'Restaurar',
		pageSize: 'Linhas por página',
		previous: 'Página anterior',
		next: 'Próxima página',
		page: 'Página',
	},
} as const;

type TableControlProps<TData extends RowData> = { table: GateshipTable<TData>; locale?: TableLocale; className?: string };

export function DataTableToolbar({ children, className }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('flex flex-wrap items-end justify-between gap-3', className)} data-slot="data-table-toolbar">{children}</div>;
}

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
		<FormField className={cn('min-w-56', className)}>
			<span>{label ?? text.filter}</span>
			<Input
				aria-label={label ?? text.filter}
				placeholder={placeholder ?? text.filterPlaceholder}
				value={value}
				onChange={(event) => {
					const next = (event.currentTarget as unknown as { value: string }).value;
					if (column) column.setFilterValue(next);
					else table.setGlobalFilter(next);
				}}
			/>
		</FormField>
	);
}

export function DataTableColumnVisibility<TData extends RowData>({ table, locale = 'en-US', className }: TableControlProps<TData>): React.ReactElement {
	const text = copy[locale];
	const columns = table.getAllLeafColumns().filter((column) => column.getCanHide());
	return (
		<details className={cn('relative', className)} data-slot="data-table-column-visibility">
			<summary className="list-none"><Button type="button" variant="outline">{text.columns}</Button></summary>
			<div className="absolute right-0 z-10 mt-2 min-w-48 rounded-lg border bg-popover p-2 shadow-lg">
				{columns.map((column) => <ColumnVisibilityOption key={column.id} column={column} table={table} />)}
				<Button className="mt-2 w-full" size="sm" type="button" variant="ghost" onClick={() => {
					table.resetColumnVisibility(true);
					table.resetColumnPinning(true);
					table.resetColumnSizing(true);
				}}>{text.reset}</Button>
			</div>
		</details>
	);
}

function ColumnVisibilityOption<TData extends RowData>({ column, table }: { column: Column<GateshipTableFeatures, TData>; table: GateshipTable<TData> }): React.ReactElement {
	const pin = column.getIsPinned();
	return (
		<div className="grid gap-1 rounded px-2 py-1 text-sm hover:bg-accent">
			<label className="flex min-h-9 items-center gap-2">
				<input checked={column.getIsVisible()} type="checkbox" onChange={(event) => column.toggleVisibility((event.currentTarget as unknown as { checked: boolean }).checked)} />
				<span>{String(column.columnDef.header ?? column.id)}</span>
			</label>
			<div className="flex items-center gap-1 pl-6">
				{column.getCanPin() && <>
					<Button aria-label={`Pin ${column.id} to start`} size="sm" type="button" variant={pin === 'start' ? 'secondary' : 'ghost'} onClick={() => column.pin(pin === 'start' ? false : 'start')}>←</Button>
					<Button aria-label={`Pin ${column.id} to end`} size="sm" type="button" variant={pin === 'end' ? 'secondary' : 'ghost'} onClick={() => column.pin(pin === 'end' ? false : 'end')}>→</Button>
				</>}
				<label className="sr-only" htmlFor={`column-size-${column.id}`}>Size for {column.id}</label>
				<input
					aria-label={`Size for ${column.id}`}
					className="h-8 w-16 rounded border bg-background px-1"
					id={`column-size-${column.id}`}
					max={column.columnDef.maxSize}
					min={column.columnDef.minSize ?? 48}
					type="number"
					value={column.getSize()}
					onChange={(event) => table.setColumnSizing((old) => ({ ...old, [column.id]: Number((event.currentTarget as unknown as { value: string }).value) }))}
				/>
				<Button aria-label={`Reset size for ${column.id}`} size="sm" type="button" variant="ghost" onClick={() => column.resetSize()}>↺</Button>
			</div>
		</div>
	);
}

export function DataTablePagination<TData extends RowData>({ table, locale = 'en-US', className }: TableControlProps<TData>): React.ReactElement {
	const text = copy[locale];
	const pagination = table.state.pagination;
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-3 border-t px-2.5 py-3 text-sm text-muted-foreground', className)} data-slot="data-table-pagination">
			<SelectField
				aria-label={text.pageSize}
				items={[10, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))}
				value={String(pagination.pageSize)}
				onValueChange={(value) => table.setPageSize(Number(value))}
			/>
			<span aria-live="polite">{text.page} {pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}</span>
			<div className="flex gap-2">
				<Button aria-label={text.previous} disabled={!table.getCanPreviousPage()} size="sm" type="button" variant="outline" onClick={() => table.previousPage()}>‹</Button>
				<Button aria-label={text.next} disabled={!table.getCanNextPage()} size="sm" type="button" variant="outline" onClick={() => table.nextPage()}>›</Button>
			</div>
		</div>
	);
}

export function DataTable<TData extends RowData>({
	table,
	locale = 'en-US',
	status = 'ready',
	emptyState,
	error,
	className,
}: TableControlProps<TData> & {
	status?: 'ready' | 'loading' | 'updating' | 'error';
	emptyState?: React.ReactNode;
	error?: React.ReactNode;
}): React.ReactElement {
	const text = copy[locale];
	const rows = table.getRowModel().rows;
	const statusMessage = status === 'loading' ? text.loading : status === 'updating' ? text.updating : status === 'error' ? error ?? text.error : undefined;
	return (
		<div className={cn('relative min-w-0', className)} aria-busy={status === 'loading' || status === 'updating'} data-slot="data-table">
			{statusMessage && <div className="mb-2 text-sm text-muted-foreground" role={status === 'error' ? 'alert' : 'status'}>{statusMessage}</div>}
			<GateshipTable>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => <DataTableHeader key={header.id} header={header} />)}</TableRow>)}
				</TableHeader>
				<TableBody>
					{rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} style={{ minWidth: cell.column.columnDef.minSize, width: cell.column.getSize() }}><FlexRender cell={cell} /></TableCell>)}</TableRow>)}
					{rows.length === 0 && status !== 'loading' && status !== 'error' && <TableRow><TableCell className="h-24 text-center" colSpan={table.getVisibleLeafColumns().length}>{emptyState ?? text.noResults}</TableCell></TableRow>}
				</TableBody>
			</GateshipTable>
		</div>
	);
}

function DataTableHeader<TData extends RowData>({ header }: { header: ReturnType<GateshipTable<TData>['getHeaderGroups']>[number]['headers'][number] }): React.ReactElement {
	const column = header.column;
	const sorted = column.getIsSorted();
	const sortLabel = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
	const content = header.isPlaceholder ? null : <FlexRender header={header} />;
	const sortHandler = column.getCanSort() ? column.getToggleSortingHandler() : undefined;
	const pin = column.getIsPinned?.();
	const pinnedStyle = pin ? { position: 'sticky' as const, insetInlineStart: pin === 'start' ? column.getStart('start') : undefined, insetInlineEnd: pin === 'end' ? column.getAfter('end') : undefined, zIndex: 1 } : undefined;
	return (
		<TableHead aria-sort={column.getCanSort() ? sortLabel : undefined} style={{ minWidth: column.columnDef.minSize, width: header.getSize(), ...pinnedStyle }}>
			{sortHandler ? <button className="min-h-9 text-left font-medium focus-visible:outline-2 focus-visible:outline-ring" type="button" aria-label={`Sort ${column.id}`} onClick={sortHandler}>{content}</button> : content}
		</TableHead>
	);
}

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
import React from 'react';
import { Button, buttonVariants } from './button.tsx';
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
type OffsetPagination = { offset: number; total: number; onOffsetChange: (offset: number) => void; onPageSizeChange: (limit: number) => void };

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
		pinStart: 'Pin to start', pinEnd: 'Pin to end', size: 'Size', resetSize: 'Reset size',
		sort: (column: string, direction: string) => `Sort ${column}, ${direction}`,
		directions: { ascending: 'ascending', descending: 'descending', none: 'not sorted' },
		range: (from: number, to: number, total: number) => `${from}–${to} of ${total}`,
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
		pinStart: 'Fixar no início', pinEnd: 'Fixar no fim', size: 'Tamanho', resetSize: 'Restaurar tamanho',
		sort: (column: string, direction: string) => `Ordenar ${column}, ${direction}`,
		directions: { ascending: 'crescente', descending: 'decrescente', none: 'sem ordenação' },
		range: (from: number, to: number, total: number) => `${from}–${to} de ${total}`,
	},
} as const;

type TableControlProps<TData extends RowData> = { table: GateshipTable<TData>; locale?: TableLocale; className?: string };

function columnLabel<TData extends RowData>(column: Column<GateshipTableFeatures, TData>): string {
		const header = column.columnDef.header;
		return typeof header === 'string' || typeof header === 'number' ? String(header) : column.id;
}

function pinnedStyle<TData extends RowData>(column: Column<GateshipTableFeatures, TData>): React.CSSProperties | undefined {
	const pin = column.getIsPinned();
	if (pin === false) return undefined;
	return { position: 'sticky', insetInlineStart: pin === 'start' ? column.getStart('start') : undefined, insetInlineEnd: pin === 'end' ? column.getAfter('end') : undefined, zIndex: 1, backgroundColor: 'var(--background)' };
}

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

export function DataTableColumnVisibility<TData extends RowData>({ table, locale = 'en-US', className, defaultOpen = false, defaultColumnPinning }: TableControlProps<TData> & { defaultOpen?: boolean; defaultColumnPinning?: { start: string[]; end: string[] } }): React.ReactElement {
	const text = copy[locale];
	const columns = table.getAllLeafColumns().filter((column) => column.getCanHide());
	const [open, setOpen] = React.useState(false);
	const resetPinning = defaultColumnPinning ?? (table.options.meta as { defaultColumnPinning?: { start: string[]; end: string[] } } | undefined)?.defaultColumnPinning;
	return (
		<details className={cn('relative', className)} data-slot="data-table-column-visibility" onToggle={(event) => setOpen((event.currentTarget as unknown as { open: boolean }).open)}>
			<summary className={cn(buttonVariants({ variant: 'outline' }), 'list-none')}>{text.columns}</summary>
			<div hidden={!open && !defaultOpen} className="absolute right-0 z-10 mt-2 min-w-48 rounded-lg border bg-popover p-2 shadow-lg">
				{open || defaultOpen ? columns.map((column) => <ColumnVisibilityOption key={column.id} column={column} table={table} locale={locale} />) : null}
				<Button className="mt-2 w-full" size="sm" type="button" variant="ghost" onClick={() => {
					table.resetColumnVisibility(true);
					if (resetPinning === undefined) table.resetColumnPinning(true);
					else table.setColumnPinning(resetPinning);
					table.resetColumnSizing(true);
				}}>{text.reset}</Button>
			</div>
		</details>
	);
}

function ColumnVisibilityOption<TData extends RowData>({ column, table, locale }: { column: Column<GateshipTableFeatures, TData>; table: GateshipTable<TData>; locale: TableLocale }): React.ReactElement {
	const text = copy[locale];
	const pin = column.getIsPinned();
	return (
		<div className="grid gap-1 rounded px-2 py-1 text-sm hover:bg-accent">
			<label className="flex min-h-9 items-center gap-2">
				<input aria-label={`${text.columns}: ${columnLabel(column)}`} checked={column.getIsVisible()} type="checkbox" onChange={(event) => column.toggleVisibility((event.currentTarget as unknown as { checked: boolean }).checked)} />
				<span>{String(column.columnDef.header ?? column.id)}</span>
			</label>
			<div className="flex items-center gap-1 pl-6">
				{column.getCanPin() && <>
					<Button aria-label={`${text.pinStart}: ${columnLabel(column)}`} size="sm" type="button" variant={pin === 'start' ? 'secondary' : 'ghost'} onClick={() => column.pin(pin === 'start' ? false : 'start')}>←</Button>
					<Button aria-label={`${text.pinEnd}: ${columnLabel(column)}`} size="sm" type="button" variant={pin === 'end' ? 'secondary' : 'ghost'} onClick={() => column.pin(pin === 'end' ? false : 'end')}>→</Button>
				</>}
				<label className="sr-only" htmlFor={`column-size-${column.id}`}>{text.size}: {columnLabel(column)}</label>
				<input
					aria-label={`${text.size}: ${columnLabel(column)}`}
					className="h-8 w-16 rounded border bg-background px-1"
					id={`column-size-${column.id}`}
					max={column.columnDef.maxSize}
					min={column.columnDef.minSize ?? 48}
					type="number"
					value={column.getSize()}
					onChange={(event) => table.setColumnSizing((old) => ({ ...old, [column.id]: Number((event.currentTarget as unknown as { value: string }).value) }))}
				/>
				<Button aria-label={`${text.resetSize}: ${columnLabel(column)}`} size="sm" type="button" variant="ghost" onClick={() => column.resetSize()}>↺</Button>
			</div>
		</div>
	);
}

export function DataTablePagination<TData extends RowData>({ table, locale = 'en-US', className, pageLabel, offset, total: totalOverride, onOffsetChange, onPageSizeChange }: TableControlProps<TData> & { pageLabel?: React.ReactNode; offset?: number; total?: number; onOffsetChange?: (offset: number) => void; onPageSizeChange?: (limit: number) => void }): React.ReactElement {
	const text = copy[locale];
	const pagination = table.state.pagination;
	const returned = table.getRowModel().rows.length;
	const offsetPagination = offset === undefined || onOffsetChange === undefined || onPageSizeChange === undefined ? undefined : { offset, total: totalOverride ?? table.getRowCount(), onOffsetChange, onPageSizeChange } satisfies OffsetPagination;
	const total = offsetPagination?.total ?? totalOverride ?? table.getRowCount();
	const currentOffset = offsetPagination?.offset ?? pagination.pageIndex * pagination.pageSize;
	const from = total === 0 ? 0 : currentOffset + 1;
	const to = currentOffset + returned;
	const previous = () => offsetPagination ? offsetPagination.onOffsetChange(Math.max(0, currentOffset - pagination.pageSize)) : table.previousPage();
	const next = () => offsetPagination ? offsetPagination.onOffsetChange(currentOffset + pagination.pageSize) : table.nextPage();
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-3 border-t px-2.5 py-3 text-sm text-muted-foreground', className)} data-slot="data-table-pagination">
			<SelectField
				aria-label={text.pageSize}
				items={[10, 20, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) }))}
				value={String(pagination.pageSize)}
				onValueChange={(value) => offsetPagination ? offsetPagination.onPageSizeChange(Number(value)) : table.setPageSize(Number(value))}
			/>
			{pageLabel ?? <span aria-live="polite">{text.range(from, to, total)}</span>}<span>{text.page} {offsetPagination ? Math.floor(currentOffset / pagination.pageSize) + 1 : pagination.pageIndex + 1} / {Math.max(table.getPageCount(), 1)}</span>
			<div className="flex gap-2">
				<Button aria-label={text.previous} disabled={currentOffset === 0} size="sm" type="button" variant="outline" onClick={previous}>‹</Button>
				<Button aria-label={text.next} disabled={currentOffset + pagination.pageSize >= total} size="sm" type="button" variant="outline" onClick={next}>›</Button>
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
					{table.getHeaderGroups().map((headerGroup) => <TableRow key={headerGroup.id}>{headerGroup.headers.map((header) => <DataTableHeader key={header.id} header={header} locale={locale} />)}</TableRow>)}
				</TableHeader>
				<TableBody>
					{rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} style={{ minWidth: cell.column.columnDef.minSize, width: cell.column.getSize(), ...pinnedStyle(cell.column) }}><FlexRender cell={cell} /></TableCell>)}</TableRow>)}
				</TableBody>
			</GateshipTable>
			{rows.length === 0 && status !== 'loading' && status !== 'error' && <div className="p-6 text-center text-muted-foreground text-sm" role="status">{emptyState ?? text.noResults}</div>}
		</div>
	);
}

function DataTableHeader<TData extends RowData>({ header, locale }: { header: ReturnType<GateshipTable<TData>['getHeaderGroups']>[number]['headers'][number]; locale: TableLocale }): React.ReactElement {
	const column = header.column;
	const sorted = column.getIsSorted();
	const sortLabel = sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
	const content = header.isPlaceholder ? null : <FlexRender header={header} />;
	const sortHandler = column.getCanSort() ? column.getToggleSortingHandler() : undefined;
	const label = typeof column.columnDef.header === 'string' || typeof column.columnDef.header === 'number' ? String(column.columnDef.header) : column.id;
	const direction = sorted === 'asc' ? copy[locale].directions.ascending : sorted === 'desc' ? copy[locale].directions.descending : copy[locale].directions.none;
	return (
		<TableHead aria-sort={column.getCanSort() ? sortLabel : undefined} style={{ minWidth: column.columnDef.minSize, width: header.getSize(), ...pinnedStyle(column) }}>
			{sortHandler ? <button className="min-h-9 text-left font-medium focus-visible:outline-2 focus-visible:ring-2 focus-visible:ring-ring" type="button" title={copy[locale].sort(label, direction)} onClick={sortHandler}>{content}</button> : content}
		</TableHead>
	);
}

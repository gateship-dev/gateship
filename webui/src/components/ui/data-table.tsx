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
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowLeftDoubleIcon, ArrowRight01Icon, ArrowRightDoubleIcon, ArrowUp01Icon, Cancel01Icon, PlusSignCircleIcon, Search01Icon, Settings02Icon, UnfoldMoreIcon, ViewOffIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from './button.tsx';
import { KEY_STEP, KEY_STEP_LARGE, MIN_COLUMN_WIDTH, renderedWidths, useColumnSizing, type ColumnSizingControls } from './column-sizing.ts';
import { Count } from './count.tsx';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu.tsx';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './empty.tsx';
import { Input } from './input.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.tsx';
import { Skeleton } from './skeleton.tsx';
import { Table as GateshipTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.tsx';
import { Tag } from './tag.tsx';

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
/**
 * The kind of value a column holds. It is the one thing a column says about
 * its voice: the kit turns it into a face, a size, an alignment and a figure
 * style, so the same kind of value reads the same way in every table and a
 * screen never writes a font class of its own.
 *
 * `name` is what a human wrote or chose and is the row's subject, so it is the
 * only kind allowed to wrap. `label` is a closed set of states, already
 * carrying its own colour. `code` is machine-issued and read to copy or check,
 * never compared, so it is mono, left and one step down, because mono at the
 * row's size reads larger than the sans beside it. `measure` is compared by
 * magnitude, so it is mono with tabular figures, right aligned and at the
 * row's own size. `moment` stays sans by the operator's decision of
 * 2026-09-19, because a date is read like a word, with tabular figures so a
 * column of them still lines up. `action` is the row's menu and has no text.
 */
export type ColumnKind = 'name' | 'label' | 'code' | 'measure' | 'moment' | 'action';

/* Face, size, figures and wrapping. Colour and weight stay the cell's own business: they say how loud a value is, not what kind of value it is. */
const KIND_CELL: Readonly<Record<ColumnKind, string>> = {
	name: 'whitespace-normal break-words',
	label: 'whitespace-nowrap',
	code: 'font-mono text-xs',
	measure: 'font-mono tabular-nums',
	moment: 'tabular-nums',
	action: '',
};

/* What the head shares with its cells: where the column sits and how wide it is. The head's own face is always the eyebrow. */
const KIND_COLUMN: Readonly<Record<ColumnKind, string>> = {
	name: '',
	label: '',
	code: '',
	measure: 'text-right',
	moment: '',
	action: 'w-10 text-right',
};

/**
 * What a column may say about itself: the kind of value it holds, classes for
 * its cells (a width, a colour), the label its menus use, and the breakpoint
 * it shows from. `hideBelow` drops a secondary column, head and cells alike,
 * under that breakpoint: a narrow screen keeps what the row is about.
 */
export interface GateshipColumnMeta { kind?: ColumnKind; className?: string; label?: string; hideBelow?: 'sm' | 'md'; /** The column the row is about. It takes the width the others do not need; without one, the first column does. */ primary?: boolean }

export function useGateshipTable<TData extends RowData>(options: GateshipTableOptions<TData>): GateshipTable<TData> {
	return useTable(options);
}

export type TableLocale = 'en-US' | 'pt-BR';

/** How long a search field has to be still before the rows follow it. */
const SEARCH_SETTLE_MS = 250;
const copy = {
	'en-US': {
		filterPlaceholder: 'Filter rows…',
		noResults: 'No results.',
		noResultsDetail: 'Nothing matches the current filters.',
		loading: 'Loading…',
		updating: 'Updating…',
		view: 'Columns',
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
		clearFacet: 'Clear',
		clearSearch: 'Clear search',
		resizeColumn: (column: string) => `Resize ${column}`,
		fitWidths: 'Fit to width',
		selectRow: 'Select row',
		selectPage: 'Select every row on this page',
		selectedCount: (count: number) => `${count} selected`,
		clearSelection: 'Clear selection',
		cancel: 'Cancel',
		resetWidths: 'Reset widths',
		clearFilters: 'Clear filters',
		facetChosen: (count: number) => `${count} selected`,
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
		clearFacet: 'Limpar',
		clearSearch: 'Limpar busca',
		resizeColumn: (column: string) => `Redimensionar ${column}`,
		fitWidths: 'Ajustar à largura',
		selectRow: 'Selecionar linha',
		selectPage: 'Selecionar todas as linhas desta página',
		selectedCount: (count: number) => `${count} selecionadas`,
		clearSelection: 'Limpar seleção',
		cancel: 'Cancelar',
		resetWidths: 'Restaurar larguras',
		clearFilters: 'Limpar filtros',
		facetChosen: (count: number) => `${count} selecionados`,
	},
} as const;

type TableControlProps<TData extends RowData> = { table: GateshipTable<TData>; locale?: TableLocale; className?: string };
type GateshipColumn<TData extends RowData> = Column<GateshipTableFeatures, TData>;

function metaOf<TData extends RowData>(column: GateshipColumn<TData>): GateshipColumnMeta {
	return (column.columnDef.meta ?? {}) as GateshipColumnMeta;
}

/* By the table's own width, not the window's: beside an open sidebar a 1024px window leaves the table 672px. */
const HIDE_BELOW = { sm: 'hidden @xl:table-cell', md: 'hidden @3xl:table-cell' } as const;
/** What a column imposes on its head and its cells alike: where it sits, how wide it is, and the breakpoint it shows from. */
function alignClass<TData extends RowData>(column: GateshipColumn<TData>): string | undefined {
	const meta = metaOf(column);
	return cn(meta.kind === undefined ? undefined : KIND_COLUMN[meta.kind], meta.hideBelow === undefined ? undefined : HIDE_BELOW[meta.hideBelow]) || undefined;
}

/** What only the cells wear: the voice of the kind, then whatever the column adds. */
function cellClass<TData extends RowData>(column: GateshipColumn<TData>): string | undefined {
	const meta = metaOf(column);
	return cn(meta.kind === undefined ? undefined : KIND_CELL[meta.kind], meta.className, alignClass(column)) || undefined;
}

function columnLabel<TData extends RowData>(column: GateshipColumn<TData>): string {
	const header = column.columnDef.header;
	return metaOf(column).label ?? (typeof header === 'string' || typeof header === 'number' ? String(header) : column.id);
}

/**
 * One row of a table's head zone: a 32px control with 8px above and below, and
 * the 16px inset the cells keep, so the search box and the first cell's text
 * start on the same line. It only means something inside a DataTable's `head`.
 */
export function DataTableToolbar({ children, className, ...props }: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('flex min-h-12 flex-wrap items-center gap-2 px-4 py-2', className)} data-slot="data-table-toolbar" {...props}>{children}</div>;
}

export interface FacetOption { value: string; label: string; /** How many rows carry this value, when the source knows. */ count?: number }

/**
 * A filter on the values of one column. Its face is the column's name, in the
 * button's own ink: a facet's name is a label, never a hint, so it reads at
 * full contrast whether anything is chosen or not. With nothing chosen it
 * leads with the add glyph, the way every faceted filter says "narrow by
 * this". With values chosen they follow the name as tags, after a hairline,
 * and past two the tags become a count. The popup lists the values, each
 * with its count when the source knows it, and ends with a way to clear.
 *
 * `multiple` is for a source that accepts several values of one column,
 * read as an OR; a source that takes one value gets a single choice.
 */
export function DataTableFacet({ title, options, selected, onChange, multiple = false, locale = 'en-US' }: {
	title: string;
	options: readonly FacetOption[];
	selected: readonly string[];
	onChange: (next: string[]) => void;
	multiple?: boolean;
	locale?: TableLocale;
}): React.ReactElement {
	const text = copy[locale];
	const chosen = options.filter((option) => selected.includes(option.value));
	const face = chosen.length === 0 ? title : `${title}: ${chosen.map((option) => option.label).join(', ')}`;
	const label = (option: FacetOption): React.ReactNode => <><span className="min-w-0 flex-1">{option.label}</span>{option.count === undefined ? null : <span className="font-mono text-muted-foreground text-xs tabular-nums">{option.count}</span>}</>;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button aria-label={face} data-slot="data-table-facet" type="button" variant="outline" />}>
				{chosen.length === 0 ? <HugeiconsIcon aria-hidden="true" icon={PlusSignCircleIcon} size={16} strokeWidth={2.25} /> : null}
				<span>{title}</span>
				{chosen.length === 0 ? null : <>
					<span aria-hidden="true" className="h-4 w-px bg-border" />
					{chosen.length > 2 ? <Tag>{text.facetChosen(chosen.length)}</Tag> : chosen.map((option) => <Tag key={option.value}>{option.label}</Tag>)}
				</>}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-48" data-slot="data-table-facet-options">
				{multiple
					? options.map((option) => (
						<DropdownMenuCheckboxItem checked={selected.includes(option.value)} closeOnClick={false} key={option.value} onCheckedChange={(checked) => onChange(checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))}>{label(option)}</DropdownMenuCheckboxItem>
					))
					: <DropdownMenuRadioGroup value={selected[0] ?? ''} onValueChange={(value) => onChange([String(value)])}>
						{options.map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{label(option)}</DropdownMenuRadioItem>)}
					</DropdownMenuRadioGroup>}
				{chosen.length === 0 ? null : <><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onChange([])}>{text.clearFacet}</DropdownMenuItem></>}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The way out of every filter at once. It exists only while something is
 * applied, and it says how many things that is, so the operator knows what
 * the click will undo before making it. The count wears the button's own ink.
 */
export function DataTableClearFilters({ count, onClear, locale = 'en-US' }: { count: number; onClear: () => void; locale?: TableLocale }): React.ReactElement | null {
	if (count === 0) return null;
	return (
		<Button data-slot="data-table-clear-filters" type="button" variant="ghost" onClick={onClear}>
			{copy[locale].clearFilters}
			<Count form="plain">{count}</Count>
		</Button>
	);
}

/** A line about the table's rows that is not one of them: what a view means, how many were left out. It lives in the notice or the foot zone, on the cells' inset. */
export function DataTableNote({ children, className, ...props }: React.ComponentProps<'p'>): React.ReactElement {
	return <p className={cn('flex flex-wrap items-center gap-2 px-4 py-3 text-muted-foreground text-sm', className)} data-slot="data-table-note" {...props}>{children}</p>;
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
	const [draft, setDraft] = useState(value);
	const apply = (next: string): void => {
		if (column) column.setFilterValue(next);
		else table.setGlobalFilter(next);
	};
	/* What the table filters by can change from outside, a "clear filters" or a link: the field follows it. */
	useEffect(() => { setDraft(value); }, [value]);
	/* Typing is not searching: the rows follow the field once it has been still for 250ms, so a server-backed table asks once per word, not once per key. */
	useEffect(() => {
		if (draft === value) return;
		const timer = setTimeout(() => apply(draft), SEARCH_SETTLE_MS);
		return () => clearTimeout(timer);
	}, [draft]);
	return (
		<Input
			aria-label={label ?? placeholder ?? text.filterPlaceholder}
			className={cn('min-w-40 flex-1 sm:max-w-sm', className)}
			data-slot="data-table-filter"
			leading={<HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2.25} />}
			placeholder={placeholder ?? text.filterPlaceholder}
			trailing={draft === '' ? undefined : (
				<Button aria-label={text.clearSearch} className="size-6 sm:size-6" size="icon" type="button" variant="ghost" onClick={() => { setDraft(''); apply(''); }}>
					<HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} size={14} strokeWidth={2.5} />
				</Button>
			)}
			type="search"
			value={draft}
			onChange={(event) => setDraft((event.currentTarget as unknown as { value: string }).value)}
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
				render={<Button aria-label={column.getCanSort() ? `${title}, ${state}` : title} className={cn('type-eyebrow -mx-2 h-7 gap-1 px-2 text-muted-foreground data-popup-open:bg-accent', className)} size="sm" type="button" variant="ghost" />}
			>
				{title}
				{/* The glyph promises a sort; a column that only hides gets none. */}
				{column.getCanSort() ? <HugeiconsIcon aria-hidden="true" className="size-3.5 opacity-70" icon={icon} size={14} strokeWidth={2.5} /> : null}
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
	const widths = useContext(WidthsContext);
	const columns = table.getAllLeafColumns().filter((column) => column.getCanHide());
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button className={cn('ml-auto', className)} type="button" variant="outline" />}>
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
				{/* Two ways back once widths were dragged: fit keeps the one set last and spreads the rest; reset starts over from the browser's layout. */}
				{widths === null || !widths.resized ? null : <>
					<DropdownMenuItem onClick={widths.fit}>{text.fitWidths}</DropdownMenuItem>
					<DropdownMenuItem onClick={widths.reset}>{text.resetWidths}</DropdownMenuItem>
				</>}
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
}: TableControlProps<TData> & { offset?: number; total?: number; onOffsetChange?: (offset: number) => void; onPageSizeChange?: (limit: number) => void }): React.ReactElement | null {
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
	/* A range that reads "1 to 4 of 4" beside a pager that cannot move is furniture: a table that fits the smallest page has no footer. */
	if (pageCount === 1 && total <= PAGE_SIZES[0]) return null;
	const nav = (label: string, icon: typeof ArrowLeft01Icon, target: number, disabled: boolean, className?: string): React.ReactElement => (
		<Button aria-label={label} className={cn('size-8', className)} disabled={disabled} size="icon" type="button" variant="outline" onClick={() => goTo(target)}>
			<HugeiconsIcon aria-hidden="true" icon={icon} size={16} strokeWidth={2.25} />
		</Button>
	);
	return (
		<div className={cn('flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 text-sm', className)} data-slot="data-table-pagination">
			<span aria-live="polite" className="font-mono text-muted-foreground text-xs tabular-nums">{text.range(from, to, total)}</span>
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				{/* Below sm the foot keeps the range and the pager and lets the page size go: at a phone's text size its select no longer fits its box, and a phone pages rather than resizes. */}
				<label className="hidden items-center gap-2 text-muted-foreground sm:flex">
					<span>{text.rowsPerPage}</span>
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

/* One data row and, while it is open, the detail under it. */
/* A row: what it holds and, when the table opens items, the way to open this one. A click on a control inside the row is that control's, never the row's. */
function DataTableBodyRow<TData extends RowData>({ row, layout, select, activate }: {
	row: ReturnType<GateshipTable<TData>['getRowModel']>['rows'][number]; layout: TableLayout;
	select?: { checked: boolean; label: string; onToggle: (shift: boolean) => void } | undefined;
	activate?: { active: boolean; onActivate: () => void } | undefined;
}): React.ReactElement {
	const onClick = activate === undefined ? undefined : (event: { target: unknown }): void => {
		const target = event.target as { closest?: (selector: string) => unknown } | null;
		if (target?.closest?.('a, button, input, select, textarea, [role=menu], [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]')) return;
		activate.onActivate();
	};
	return (
		<TableRow active={activate?.active === true} className={cn(activate !== undefined && 'cursor-pointer')} data-selected={select?.checked === true ? '' : undefined} onClick={onClick}>
			{select === undefined ? null : <TableCell className={cn('w-10 pr-0', layout.select.className)} style={layout.select.style}><RowCheckbox checked={select.checked} label={select.label} onToggle={select.onToggle} /></TableCell>}
			{row.getVisibleCells().map((cell) => { const place = layout.cell(cell.column.id); return <TableCell className={cn(cellClass(cell.column), place.className)} key={cell.id} style={place.style}><FlexRender cell={cell} /></TableCell>; })}
		</TableRow>
	);
}

/**
 * Search and paging over rows the screen already holds. The table stays in its
 * manual mode, the one every list uses: this slices the rows and hands back the
 * state the toolbar and the pagination read.
 */
export function useClientPage<TData>(rows: readonly TData[], matches: (row: TData, needle: string) => boolean, pageSize = 20): { search: string; setSearch: (value: string) => void; limit: number; offset: number; setOffset: (value: number) => void; setLimit: (value: number) => void; page: TData[]; total: number } {
	const [search, setSearchValue] = useState('');
	const [limit, setLimitValue] = useState(pageSize);
	const [requested, setOffset] = useState(0);
	const needle = search.trim().toLocaleLowerCase();
	const filtered = useMemo(() => needle === '' ? [...rows] : rows.filter((row) => matches(row, needle)), [rows, needle, matches]);
	/* A row settled elsewhere can empty the last page: fall back to the last one that has rows. */
	const offset = requested < filtered.length ? requested : Math.max(0, Math.floor((filtered.length - 1) / limit) * limit);
	return { search, setSearch: (value) => { setSearchValue(value); setOffset(0); }, limit, offset, setOffset, setLimit: (value) => { setLimitValue(value); setOffset(0); }, page: filtered.slice(offset, offset + limit), total: filtered.length };
}

export type DataTableStatus = 'ready' | 'loading' | 'updating' | 'error';

/** Where a cell sits once the operator has set widths: its width, and whether it stays put while the rows scroll sideways. */
interface CellPlace { className?: string; style?: React.CSSProperties }
interface TableLayout { table: CellPlace; head: (id: string) => CellPlace; cell: (id: string) => CellPlace; select: CellPlace }
/** The kit's own leading column: a row's checkbox. */
interface LeadColumns { select: boolean }

const NO_PLACE: CellPlace = {};
const AUTO_LAYOUT: TableLayout = { table: NO_PLACE, head: () => NO_PLACE, cell: () => NO_PLACE, select: NO_PLACE };
/* The one width the kit fixes itself: a row's checkbox, 16px with 12px either side. */
const SELECT_WIDTH = 40;
const leadWidth = (lead: LeadColumns): number => (lead.select ? SELECT_WIDTH : 0);

/* The few DOM members the geometry reads, typed here because the kit also compiles without the DOM library. */
type HeadElement = { dataset: Record<string, string | undefined>; getBoundingClientRect: () => { width: number } };
type ScrollElement = { clientWidth: number; scrollLeft: number; querySelectorAll: (selector: string) => Iterable<HeadElement>; addEventListener: (type: 'scroll', listener: () => void, options?: { passive: boolean }) => void; removeEventListener: (type: 'scroll', listener: () => void) => void };
type SurfaceElement = { querySelector: (selector: string) => ScrollElement | null; querySelectorAll: (selector: string) => Iterable<HeadElement> };
type GeometryBrowser = { getComputedStyle?: (element: HeadElement) => { display: string }; ResizeObserver?: new (callback: () => void) => { observe: (element: ScrollElement) => void; disconnect: () => void } };
const geometryBrowser = (): GeometryBrowser => globalThis as unknown as GeometryBrowser;
const displayed = (head: HeadElement): boolean => geometryBrowser().getComputedStyle?.(head).display !== 'none';

/** The frame's inner width, the columns the container shows right now, and whether rows sit scrolled under the pinned ones. */
function useFrameReading(surface: React.RefObject<HTMLDivElement | null>, columnsKey: string): { frame: number; shown: string[]; scrolled: boolean } {
	const [reading, setReading] = useState<{ frame: number; shown: string[]; scrolled: boolean }>({ frame: 0, shown: [], scrolled: false });
	useEffect(() => {
		const container = (surface.current as unknown as SurfaceElement | null)?.querySelector('[data-slot=table-container]') ?? null;
		const Observer = geometryBrowser().ResizeObserver;
		if (container === null || Observer === undefined) return;
		const read = (): void => {
			const shown = [...container.querySelectorAll('th[data-column-id]')].filter(displayed).map((head) => head.dataset['columnId'] ?? '');
			setReading({ frame: container.clientWidth, shown, scrolled: container.scrollLeft > 0 });
		};
		const observer = new Observer(read);
		observer.observe(container);
		container.addEventListener('scroll', read, { passive: true });
		read();
		return () => { observer.disconnect(); container.removeEventListener('scroll', read); };
	}, [surface, columnsKey]);
	return reading;
}

/* A name wraps, so its own width is a reading measure and not the length of its longest line. */
const NAME_NATURAL_MAX = 320;

type MeasuredTable = { style: { width: string } };

/**
 * The width each showing column needs for its own content, read the moment
 * before the first drag. In the browser's layout the primary column holds the
 * frame's slack as well; measured as laid out, it would carry that slack into
 * the fixed layout and, pinned, cover the rows scrolling under it. So the
 * table is set to its content's width for the instant of the reading, which no
 * paint ever shows, and a name is capped at a reading measure.
 */
function measureHeads(surface: React.RefObject<HTMLDivElement | null>): Record<string, number> {
	const root = surface.current as unknown as SurfaceElement | null;
	const table = (root?.querySelector('table') ?? null) as unknown as MeasuredTable | null;
	const previous = table?.style.width ?? '';
	if (table !== null) table.style.width = 'max-content';
	const widths: Record<string, number> = {};
	for (const head of root?.querySelectorAll('th[data-column-id]') ?? []) {
		if (!displayed(head)) continue;
		/* Up, never to the nearest: a column rounded down by a fraction of a pixel breaks its widest value onto a second line. */
		const width = Math.ceil(head.getBoundingClientRect().width);
		widths[head.dataset['columnId'] ?? ''] = head.dataset['columnKind'] === 'name' ? Math.min(width, NAME_NATURAL_MAX) : width;
	}
	if (table !== null) table.style.width = previous;
	return widths;
}

/**
 * The fixed layout, once the operator has dragged. Every shown column wears
 * its width; the primary one adds the frame's slack. While the widths add up
 * to more than the frame, the columns up to the primary one stay at the start
 * and the action column at the end, with the rows scrolling between them: a
 * checkbox or a menu with no name beside it is no use.
 */
function fixedLayout(sizing: NonNullable<ColumnSizingControls['sizing']>, shown: readonly string[], primary: string | undefined, frame: number, lead: LeadColumns, scrolled: boolean, kinds: Readonly<Record<string, ColumnKind | undefined>>): TableLayout {
	const extra = leadWidth(lead);
	const { widths, total } = renderedWidths(sizing, shown, primary, frame, extra);
	const overflowing = total > frame + 1;
	const primaryIndex = primary === undefined ? -1 : shown.indexOf(primary);
	const starts = new Map<string, number>();
	let offset = extra;
	for (const id of shown.slice(0, primaryIndex + 1)) { starts.set(id, offset); offset += widths[id] ?? 0; }
	const lastStart = primaryIndex >= 0 ? shown[primaryIndex] : undefined;
	const pinned = (id: string): CellPlace => {
		if (!overflowing) return NO_PLACE;
		const start = starts.get(id);
		if (start !== undefined) return { className: cn('sticky left-(--pin-left) z-10 bg-card', id === lastStart && scrolled && 'pin-edge-end'), style: { '--pin-left': `${start}px` } as React.CSSProperties };
		if (kinds[id] === 'action') return { className: 'pin-edge-start sticky right-0 z-10 bg-card' };
		return NO_PLACE;
	};
	const sized = (id: string): CellPlace => { const pin = pinned(id); return { className: cn('w-(--col-w)', pin.className), style: { ...pin.style, '--col-w': `${widths[id] ?? MIN_COLUMN_WIDTH}px` } as React.CSSProperties }; };
	return {
		table: { className: 'table-fixed w-(--table-w)', style: { '--table-w': `${Math.max(total, frame)}px` } as React.CSSProperties },
		head: sized,
		cell: pinned,
		select: overflowing ? { className: 'sticky left-0 z-10 bg-card' } : NO_PLACE,
	};
}

/** Everything the table needs to wear the operator's widths: the drag controls, the layout they produce, and the two ways back for the view menu. */
function useTableWidths<TData extends RowData>(storageKey: string | undefined, surface: React.RefObject<HTMLDivElement | null>, columns: readonly GateshipColumn<TData>[], primaryId: string | undefined, lead: LeadColumns): { sizing: ColumnSizingControls; layout: TableLayout; widths: { resized: boolean; fit: () => void; reset: () => void } } {
	const sizing = useColumnSizing(storageKey);
	const reading = useFrameReading(surface, columns.map((column) => column.id).join(' '));
	const kinds = Object.fromEntries(columns.map((column) => [column.id, metaOf(column).kind]));
	const layout = sizing.sizing === null ? AUTO_LAYOUT : fixedLayout(sizing.sizing, reading.shown, primaryId, reading.frame, lead, reading.scrolled, kinds);
	/* Fit spreads what the frame has left over the columns that can take a width: the menu and the checkbox column keep theirs. */
	const fit = (): void => {
		const current = sizing.sizing;
		if (current === null) return;
		const used = reading.shown.reduce((total, id) => total + (current.current[id] ?? 0), leadWidth(lead));
		sizing.fit(reading.shown.filter((id) => kinds[id] !== 'action'), reading.frame - used);
	};
	return { sizing, layout, widths: { resized: sizing.sizing !== null, fit, reset: sizing.reset } };
}

/* A row's checkbox. The page's own sets `indeterminate`, which only exists as a property of the element. */
function RowCheckbox({ checked, indeterminate = false, label, onToggle }: { checked: boolean; indeterminate?: boolean; label: string; onToggle: (shift: boolean) => void }): React.ReactElement {
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => { const element = box.current as unknown as { indeterminate: boolean } | null; if (element !== null) element.indeterminate = indeterminate; }, [indeterminate]);
	return <input aria-label={label} checked={checked} className="size-4 align-middle" data-slot="row-select" onChange={() => {}} onClick={(event) => onToggle(event.shiftKey)} ref={box} type="checkbox" />;
}

/**
 * The selection after a click on row `index`. The clicked row decides the
 * direction: a row that was off turns on, and with shift every row from the
 * one clicked last (`from`) to this one follows it, whichever way they went.
 */
export function toggleRows(current: ReadonlySet<string>, ids: readonly string[], index: number, from: number | null): ReadonlySet<string> {
	const id = ids[index];
	if (id === undefined) return current;
	const next = new Set(current);
	const on = !current.has(id);
	const range = from === null ? [id] : ids.slice(Math.min(from, index), Math.max(from, index) + 1);
	for (const each of range) if (on) next.add(each); else next.delete(each);
	return next;
}

/** The page's checkbox: every row on, unless every row already was. */
export function togglePageRows(current: ReadonlySet<string>, ids: readonly string[]): ReadonlySet<string> {
	return ids.length > 0 && ids.every((id) => current.has(id)) ? new Set() : new Set(ids);
}

/**
 * Which rows of the page are selected. Selection is the page's: it is dropped
 * whenever the rows on the page change, by a filter, a page turn or rows that
 * left because an action settled them, because a selection the operator
 * cannot see is one they cannot check. Shift extends from the row clicked
 * last, as every list does.
 */
function useRowSelection(ids: readonly string[]): { selected: ReadonlySet<string>; toggle: (index: number, shift: boolean) => void; togglePage: () => void; clear: () => void } {
	const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
	const anchor = useRef<number | null>(null);
	const pageKey = ids.join(' ');
	useEffect(() => { setSelected(new Set()); anchor.current = null; }, [pageKey]);
	const toggle = (index: number, shift: boolean): void => {
		const from = shift ? anchor.current : null;
		setSelected((current) => toggleRows(current, ids, index, from));
		anchor.current = index;
	};
	const togglePage = (): void => setSelected((current) => togglePageRows(current, ids));
	return { selected, toggle, togglePage, clear: () => setSelected(new Set()) };
}

/**
 * The head's first band while rows are selected: how many, what can be done
 * to them, and the way out. It sits in the head zone and pushes nothing over:
 * the controls under it stay live, so the operator can narrow the list while
 * holding a selection. The count is the live region.
 */
function DataTableSelectionBar({ count, actions, onClear, locale }: { count: number; actions: React.ReactNode; onClear: () => void; locale: TableLocale }): React.ReactElement {
	const text = copy[locale];
	return (
		<div className="flex min-h-12 flex-wrap items-center gap-2 px-4 py-2" data-slot="data-table-selection">
			<span aria-live="polite" className="font-medium text-sm tabular-nums">{text.selectedCount(count)}</span>
			{actions}
			<Button className="ml-auto" type="button" variant="ghost" onClick={onClear}>{text.clearSelection}</Button>
		</div>
	);
}

/** What the selection gives the table: a checkbox per row, the page's checkbox, and the head zone with the selection bar on top while anything is chosen. */
function useSelectionWiring(ids: readonly string[], selection: { actions: (ids: readonly string[], clear: () => void) => React.ReactNode } | undefined, head: React.ReactNode, locale: TableLocale): {
	rowSelect: (id: string, index: number) => { checked: boolean; label: string; onToggle: (shift: boolean) => void } | undefined;
	pageSelect: { checked: boolean; indeterminate: boolean; onToggle: () => void } | undefined;
	headZone: React.ReactNode;
} {
	const picking = useRowSelection(ids);
	if (selection === undefined) return { rowSelect: () => undefined, pageSelect: undefined, headZone: head };
	const chosen = ids.filter((id) => picking.selected.has(id));
	return {
		rowSelect: (id, index) => ({ checked: picking.selected.has(id), label: copy[locale].selectRow, onToggle: (shift) => picking.toggle(index, shift) }),
		pageSelect: { checked: ids.length > 0 && chosen.length === ids.length, indeterminate: chosen.length > 0 && chosen.length < ids.length, onToggle: picking.togglePage },
		headZone: chosen.length === 0 ? head : <><DataTableSelectionBar actions={selection.actions(chosen, picking.clear)} count={chosen.length} locale={locale} onClear={picking.clear} />{head}</>,
	};
}

/**
 * One action on every selected row. It asks before it acts, and the question
 * names the count and the verb, so what is about to happen is on the button
 * the operator presses. It never claims the act cannot be undone.
 */
export function DataTableBulkAction({ label, confirm, onRun, locale = 'en-US' }: { label: string; confirm: string; onRun: () => void; locale?: TableLocale }): React.ReactElement {
	const [asking, setAsking] = useState(false);
	if (!asking) return <Button data-slot="data-table-bulk-action" type="button" variant="outline" onClick={() => setAsking(true)}>{label}</Button>;
	return (
		<>
			<Button data-slot="data-table-bulk-confirm" type="button" variant="destructive" onClick={() => { setAsking(false); onRun(); }}>{confirm}</Button>
			<Button type="button" variant="ghost" onClick={() => setAsking(false)}>{copy[locale].cancel}</Button>
		</>
	);
}

/* The view menu reaches the widths through the frame it sits in. */
const WidthsContext = React.createContext<{ resized: boolean; fit: () => void; reset: () => void } | null>(null);

/**
 * The grip on a head's right edge: 8px to catch, a 2px line in the border
 * colour while it is pointed at, held or focused. It is a window splitter, so
 * the keyboard moves it too: arrows by 8px, with shift by 32. A double click
 * returns the column to the width the browser gave it.
 */
function ColumnGrip({ label, width, onStart, onNudge, onRestore }: { label: string; width: number | undefined; onStart: (clientX: number) => void; onNudge: (delta: number) => void; onRestore: () => void }): React.ReactElement {
	return (
		<span
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={MIN_COLUMN_WIDTH}
			aria-valuenow={width}
			className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-2 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-border after:opacity-0 hover:after:opacity-100 focus-visible:after:bg-ring focus-visible:after:opacity-100 active:after:opacity-100"
			data-slot="column-resize-grip"
			role="separator"
			tabIndex={0}
			onDoubleClick={onRestore}
			onKeyDown={(event) => {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
				event.preventDefault();
				const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
				onNudge(event.key === 'ArrowLeft' ? -step : step);
			}}
			onPointerDown={(event) => { event.preventDefault(); onStart(event.clientX); }}
		/>
	);
}


/* The zones a frame stacks around its rows. The head and the notice close with a rule under them, the foot opens with one over it.
 * The notice is a band of the frame itself: an alert's own border and corners inside the table's would be a card inside a card, so they go and the band keeps the alert's tint. */
const ZONE_CLASS = {
	'data-table-head': 'border-b',
	'data-table-notice': 'divide-y border-b [&>[role=alert]]:rounded-none [&>[role=alert]]:border-0 [&>[role=alert]]:px-4 [&>[role=alert]]:py-3',
	'data-table-foot': 'border-t',
} as const;

function DataTableZone({ slot, children }: { slot: keyof typeof ZONE_CLASS; children: React.ReactNode }): React.ReactElement | null {
	if (children === undefined || children === null || children === false) return null;
	return <div className={cn(ZONE_CLASS[slot], 'empty:hidden')} data-slot={slot}>{children}</div>;
}

/* What a screen reader hears while rows arrive or refresh: the table's own state, once. */
function DataTableBusy({ status, locale }: { status: DataTableStatus; locale: TableLocale }): React.ReactElement | null {
	if (status !== 'loading' && status !== 'updating') return null;
	return <span className="sr-only" role="status">{status === 'loading' ? copy[locale].loading : copy[locale].updating}</span>;
}

/* The stand-ins a first load draws: the columns the rows will have, the kit's own leading ones included, with a bar where each value will be. */
function DataTableSkeletonRows<TData extends RowData>({ columns, layout, lead, rows }: { columns: readonly GateshipColumn<TData>[]; layout: TableLayout; lead: LeadColumns; rows: number }): React.ReactElement {
	return (
		<>
			{Array.from({ length: rows }, (_, index) => (
				<TableRow data-state="loading" key={`skeleton-${index}`}>
					{lead.select ? <TableCell className={cn('w-10 pr-0', layout.select.className)} style={layout.select.style} /> : null}
					{columns.map((column) => { const place = layout.cell(column.id); return <TableCell className={cn(cellClass(column), place.className)} key={column.id} style={place.style}><Skeleton className="h-4 w-full max-w-32" /></TableCell>; })}
				</TableRow>
			))}
		</>
	);
}

/* The one row an empty result has: the reason, and the way out when filters caused it. */
function DataTableEmptyRow({ title, detail, action, span }: { title: React.ReactNode; detail: React.ReactNode; action?: React.ReactNode; span: number }): React.ReactElement {
	return (
		<TableRow className="hover:bg-transparent dark:hover:bg-transparent" data-state="empty">
			<TableCell className="h-32 text-center" colSpan={span}>
				<Empty className="p-2" role="status">
					<EmptyHeader>
						<EmptyTitle>{title}</EmptyTitle>
						<EmptyDescription>{detail}</EmptyDescription>
					</EmptyHeader>
					{action}
				</Empty>
			</TableCell>
		</TableRow>
	);
}

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
	activeRowId = null,
	onRowActivate,
	head,
	notice,
	foot,
	storageKey,
	selection,
	className,
}: TableControlProps<TData> & {
	/** Rows that can be acted on together. Given, every row leads with a checkbox, and while any is selected the head opens with the selection bar, whose actions this returns. */
	selection?: { actions: (ids: readonly string[], clear: () => void) => React.ReactNode };
	/** Names the table in this browser's storage. Given, its columns can be dragged to a width, and the widths survive navigation. */
	storageKey?: string;
	/** The rows of controls that act on this table: search, facets, the view menu. One DataTableToolbar per row. */
	head?: React.ReactNode;
	/** One Alert about this table's data, between its controls and its rows. */
	notice?: React.ReactNode;
	/** The pager, a DataTablePagination. It hides itself when the table fits one small page. */
	foot?: React.ReactNode;
	status?: DataTableStatus;
	emptyState?: React.ReactNode;
	emptyDetail?: React.ReactNode;
	emptyAction?: React.ReactNode;
	skeletonRows?: number;
	/** The row whose item is open beside the table, marked as the current one. */
	activeRowId?: string | null;
	/** Given, a click anywhere on a row that is not one of its controls opens that row's item. */
	onRowActivate?: (id: string) => void;
}): React.ReactElement {
	const text = copy[locale];
	const rows = table.getRowModel().rows;
	const lead: LeadColumns = { select: selection !== undefined };
	const span = table.getVisibleLeafColumns().length + Number(lead.select);
	const { rowSelect, pageSelect, headZone } = useSelectionWiring(rows.map((row) => row.id), selection, head, locale);
	const columns = table.getVisibleLeafColumns();
	/* A wide table gives its slack to one column; spread over all of them it reads as holes between the facts. */
	const primaryId = (columns.find((column) => metaOf(column).primary === true) ?? columns[0])?.id;
	const busy = status === 'loading' || status === 'updating';
	const surface = useRef<HTMLDivElement>(null);
	const { sizing, layout, widths } = useTableWidths(storageKey, surface, columns, primaryId, lead);
	return (
		<WidthsContext.Provider value={storageKey === undefined ? null : widths}>
		<div aria-busy={busy} className={cn('card-ring @container rounded-2xl', className)} data-slot="data-table" data-status={status}>
			{/* The ring is the edge every surface shares, so a table carries the same one a card does; the clip lives one level in, or it would cut the ring. */}
			<div className="overflow-hidden rounded-2xl border bg-card" data-slot="data-table-surface" ref={surface}>
			<DataTableBusy locale={locale} status={status} />
			{/* Everything that acts on these rows lives in their frame, on the cells' own 16px inset. A zone with nothing in it takes no room. */}
			<DataTableZone slot="data-table-head">{headZone}</DataTableZone>
			<DataTableZone slot="data-table-notice">{notice}</DataTableZone>
			<GateshipTable className={layout.table.className} style={layout.table.style}>
				<TableHeader>
					<DataTableHeadRow layout={layout} locale={locale} primaryId={primaryId} select={pageSelect} sizing={storageKey === undefined ? undefined : sizing} surface={surface} table={table} />
				</TableHeader>
				<TableBody className={cn('transition-opacity', status === 'updating' && 'opacity-60')}>
					{status === 'loading' && rows.length === 0
						? <DataTableSkeletonRows columns={columns} layout={layout} lead={lead} rows={skeletonRows} />
						: rows.map((row, index) => <DataTableBodyRow activate={onRowActivate === undefined ? undefined : { active: row.id === activeRowId, onActivate: () => onRowActivate(row.id) }} key={row.id} layout={layout} row={row} select={rowSelect(row.id, index)} />)}
					{/* `data-state` tells a data row from a stand-in: anything counting rows reads `tr:not([data-state])`. */}
					{rows.length === 0 && status !== 'loading' ? <DataTableEmptyRow action={emptyAction} detail={emptyDetail ?? text.noResultsDetail} span={span} title={emptyState ?? text.noResults} /> : null}
				</TableBody>
			</GateshipTable>
			<DataTableZone slot="data-table-foot">{foot}</DataTableZone>
			</div>
		</div>
		</WidthsContext.Provider>
	);
}

/* One column's head. In the browser's layout the primary one takes the slack; once widths are set, each wears its own. */
function DataTableHeadCell<TData extends RowData>({ header, locale, primary, layout, sizing, measure }: {
	header: ReturnType<GateshipTable<TData>['getHeaderGroups']>[number]['headers'][number]; locale: TableLocale; primary: boolean; layout: TableLayout;
	sizing: ColumnSizingControls | undefined; measure: () => Record<string, number>;
}): React.ReactElement {
	const column = header.column;
	const place = layout.head(column.id);
	const auto = sizing === undefined || sizing.sizing === null;
	const title = column.columnDef.header;
	return (
		<TableHead aria-sort={column.getCanSort() ? ariaSort(column.getIsSorted()) : undefined} className={cn('relative', alignClass(column), auto && primary && 'w-full', place.className)} data-column-id={column.id} data-column-kind={metaOf(column).kind} style={place.style}>
			{header.isPlaceholder ? null : typeof title === 'string' ? <DataTableColumnHeader column={column} locale={locale} title={title} /> : <FlexRender header={header} />}
			{sizing === undefined || metaOf(column).kind === 'action' ? null : (
				<ColumnGrip label={copy[locale].resizeColumn(columnLabel(column))} width={sizing.sizing?.current[column.id]} onNudge={(delta) => sizing.nudge(column.id, delta, measure)} onRestore={() => sizing.restore(column.id)} onStart={(clientX) => sizing.startDrag(column.id, clientX, measure)} />
			)}
		</TableHead>
	);
}

/* The head row: each column's name, its sort menu, and the grip that sets its width. */
function DataTableHeadRow<TData extends RowData>({ table, locale, primaryId, layout, sizing, surface, select }: {
	table: GateshipTable<TData>; locale: TableLocale; primaryId: string | undefined; layout: TableLayout;
	sizing: ColumnSizingControls | undefined; surface: React.RefObject<HTMLDivElement | null>;
	select?: { checked: boolean; indeterminate: boolean; onToggle: () => void } | undefined;
}): React.ReactElement {
	const text = copy[locale];
	const measure = (): Record<string, number> => measureHeads(surface);
	return (
		<>
			{table.getHeaderGroups().map((headerGroup) => (
				<TableRow key={headerGroup.id}>
					{select === undefined ? null : <TableHead className={cn('w-10 pr-0', layout.select.className)} style={layout.select.style}><RowCheckbox checked={select.checked} indeterminate={select.indeterminate} label={text.selectPage} onToggle={select.onToggle} /></TableHead>}
					{headerGroup.headers.map((header) => <DataTableHeadCell header={header} key={header.id} layout={layout} locale={locale} measure={measure} primary={header.column.id === primaryId} sizing={sizing} />)}
				</TableRow>
			))}
		</>
	);
}

function ariaSort(sorted: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
	return sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
}

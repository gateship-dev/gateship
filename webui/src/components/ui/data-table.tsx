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
import React, { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn.ts';
import { Button } from './button.tsx';
import { Count } from './count.tsx';
import { DisclosureChevron } from './disclosure-chevron.tsx';
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
		expandRow: 'Show details',
		collapseRow: 'Hide details',
		clearFacet: 'Clear',
		clearSearch: 'Clear search',
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
		expandRow: 'Mostrar detalhes',
		collapseRow: 'Ocultar detalhes',
		clearFacet: 'Limpar',
		clearSearch: 'Limpar busca',
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

/* One data row and, while it is open, the detail under it. */
function DataTableBodyRow<TData extends RowData>({ row, open, span, text, renderExpanded, onToggle }: {
	row: ReturnType<GateshipTable<TData>['getRowModel']>['rows'][number]; open: boolean; span: number;
	text: { expandRow: string; collapseRow: string }; renderExpanded?: (row: TData) => React.ReactNode; onToggle: () => void;
}): React.ReactElement {
	return (
		<>
			<TableRow data-expanded={open ? '' : undefined}>
				{renderExpanded === undefined ? null : (
					<TableCell className="w-8 pr-0">
						<Button aria-expanded={open} aria-label={open ? text.collapseRow : text.expandRow} className="size-6 sm:size-6" size="icon" type="button" variant="ghost" onClick={onToggle}>
							<DisclosureChevron dense open={open} />
						</Button>
					</TableCell>
				)}
				{row.getVisibleCells().map((cell) => <TableCell className={cellClass(cell.column)} key={cell.id}><FlexRender cell={cell} /></TableCell>)}
			</TableRow>
			{/* `data-state` keeps the detail out of any count of data rows. */}
			{open && renderExpanded !== undefined ? <TableRow className="hover:bg-transparent dark:hover:bg-transparent" data-state="expanded"><TableCell className="whitespace-normal p-4" colSpan={span}>{renderExpanded(row.original)}</TableCell></TableRow> : null}
		</>
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
	renderExpanded,
	defaultExpanded,
	head,
	notice,
	foot,
	className,
}: TableControlProps<TData> & {
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
	/** What a row opens into. Given, every row leads with a chevron, and the content is built only while its row is open. */
	renderExpanded?: (row: TData) => React.ReactNode;
	/** Row ids open on first render, as `defaultValue` is to an input. */
	defaultExpanded?: readonly string[];
}): React.ReactElement {
	const text = copy[locale];
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpanded));
	const toggle = (id: string): void => setExpanded((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
	const span = table.getVisibleLeafColumns().length + (renderExpanded === undefined ? 0 : 1);
	const rows = table.getRowModel().rows;
	const columns = table.getVisibleLeafColumns();
	/* A wide table gives its slack to one column; spread over all of them it reads as holes between the facts. */
	const primaryId = (columns.find((column) => metaOf(column).primary === true) ?? columns[0])?.id;
	const busy = status === 'loading' || status === 'updating';
	return (
		<div aria-busy={busy} className={cn('card-ring @container rounded-2xl', className)} data-slot="data-table" data-status={status}>
			{/* The ring is the edge every surface shares, so a table carries the same one a card does; the clip lives one level in, or it would cut the ring. */}
			<div className="overflow-hidden rounded-2xl border bg-card" data-slot="data-table-surface">
			{busy ? <span className="sr-only" role="status">{status === 'loading' ? text.loading : text.updating}</span> : null}
			{/* Everything that acts on these rows lives in their frame, on the cells' own 16px inset. A zone with nothing in it takes no room. */}
			<DataTableZone slot="data-table-head">{head}</DataTableZone>
			<DataTableZone slot="data-table-notice">{notice}</DataTableZone>
			<GateshipTable>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{renderExpanded === undefined ? null : <TableHead className="w-8 pr-0"><span className="sr-only">{text.expandRow}</span></TableHead>}
							{headerGroup.headers.map((header) => (
								<TableHead aria-sort={header.column.getCanSort() ? ariaSort(header.column.getIsSorted()) : undefined} className={cn(alignClass(header.column), header.column.id === primaryId && 'w-full')} key={header.id}>
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
							<TableRow data-state="loading" key={`skeleton-${index}`}>
								{renderExpanded === undefined ? null : <TableCell className="w-8 pr-0" />}
								{columns.map((column) => <TableCell className={cellClass(column)} key={column.id}><Skeleton className="h-4 w-full max-w-32" /></TableCell>)}
							</TableRow>
						))
						: rows.map((row) => <DataTableBodyRow key={row.id} open={renderExpanded !== undefined && expanded.has(row.id)} renderExpanded={renderExpanded} row={row} span={span} text={text} onToggle={() => toggle(row.id)} />)}
					{/* `data-state` tells a data row from a stand-in: anything counting rows reads `tr:not([data-state])`. */}
					{rows.length === 0 && status !== 'loading' ? <DataTableEmptyRow action={emptyAction} detail={emptyDetail ?? text.noResultsDetail} span={span} title={emptyState ?? text.noResults} /> : null}
				</TableBody>
			</GateshipTable>
			<DataTableZone slot="data-table-foot">{foot}</DataTableZone>
			</div>
		</div>
	);
}

function ariaSort(sorted: false | 'asc' | 'desc'): 'ascending' | 'descending' | 'none' {
	return sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none';
}

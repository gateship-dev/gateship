// webui/src/design.tsx
//
// The design scratchpad: a development-only page (`design.html`, beside the
// harness) that shows the whole kit at once, the token ladder in both
// themes, the layout rules with their numbers, every harness scenario one
// click away, and the measurable half of the contract (design/measure.ts)
// running live on any of them. It is where a change is looked at before a
// screen is touched, and it ships in no bundle.

import { Alert02Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AlertAction, AlertDescription, AlertTitle } from './components/ui/alert.tsx';
import { AttentionCard } from './components/ui/attention-card.tsx';
import { Badge, type BadgeVariant } from './components/ui/badge.tsx';
import { Button } from './components/ui/button.tsx';
import { Callout, type CalloutTone } from './components/ui/callout.tsx';
import { Card, CardFooter, CardHeader, CardPanel, CardTitle } from './components/ui/card.tsx';
import { CardGrid, CardStack, FormField, FormStack } from './components/ui/card-layout.tsx';
import { DataTable, DataTableFilter, DataTablePagination, DataTableToolbar, DataTableViewOptions, gateshipTableFeatures, useGateshipTable, type DataTableStatus, type GateshipColumnDef } from './components/ui/data-table.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from './components/ui/dropdown-menu.tsx';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from './components/ui/empty.tsx';
import { EmptyState } from './components/ui/empty-state.tsx';
import { Input } from './components/ui/input.tsx';
import { Item, ItemContent, ItemGroup } from './components/ui/item.tsx';
import { Progress } from './components/ui/progress.tsx';
import { SelectField } from './components/ui/select.tsx';
import { Skeleton } from './components/ui/skeleton.tsx';
import { Stat } from './components/ui/stat.tsx';
import { Tabs, TabsCount, TabsList, TabsPanel, TabsTab } from './components/ui/tabs.tsx';
import { Textarea } from './components/ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group.tsx';
import { HintTooltip, TooltipGroup } from './components/ui/tooltip.tsx';
import { attachInspector, type Inspection } from './design/inspect.ts';
import { measureDesign, type DesignReport } from './design/measure.ts';
import { parseComponentSpec, type ComponentSpec } from './design/specs.ts';
import { OFF_GRID_SPACING } from './design/exceptions.ts';
import { findOffGridSpacing, measureUsage } from './design/usage.ts';
import { cn } from './lib/cn.ts';
import './index.css';
import stylesheet from './index.css?raw';

/* The semantic ladder a component may consume. Chart, logo and layout
 * variables are deliberately absent: they are not colours a screen picks. */
const COLOR_TOKENS = [
	'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground', 'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
	'muted', 'muted-foreground', 'accent', 'accent-foreground', 'border', 'input', 'ring', 'destructive', 'destructive-foreground',
	'info', 'info-foreground', 'success', 'success-foreground', 'warning', 'warning-foreground', 'merged', 'merged-foreground',
	'attention', 'attention-foreground', 'attention-ui', 'attention-text', 'attention-surface',
	'sidebar', 'sidebar-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring', 'shell-panel',
	'tooltip', 'tooltip-foreground', 'tooltip-border', 'code', 'code-foreground', 'code-highlight',
] as const;
const TYPE_ROLES = [
	['type-page-title', 'Page title'], ['type-editorial-title', 'Editorial title'], ['type-body', 'Body'], ['type-eyebrow', 'Eyebrow'], ['type-data', 'Data'],
] as const;
const BADGE_VARIANTS: readonly BadgeVariant[] = ['default', 'secondary', 'outline', 'info', 'success', 'warning', 'error', 'merged', 'attention'];
const BUTTON_VARIANTS = ['default', 'outline', 'ghost', 'destructive', 'attention'] as const;
const CALLOUT_TONES: readonly CalloutTone[] = ['neutral', 'success', 'warning', 'destructive'];
const ROUTES = ['/overview', '/overview/runs', '/overview/queues', '/overview/insights'] as const;
const SCENARIOS = ['usual', 'empty', 'loading', 'error', 'attention', 'unavailable', 'long', 'refreshing', 'dense', 'insights-zero', 'insights-null', 'insights-long', 'insights-cohorts', 'sidebar-collapsed', 'tooltip-open', 'selector-open'] as const;
const WIDTHS = ['390', '768', '1440'] as const;
const TEXT_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl'] as const;
const WEIGHTS = [['normal', 'font-normal'], ['medium', 'font-medium'], ['semibold', 'font-semibold']] as const;
const FAMILIES = [['--font-sans', 'font-sans', 'Names, titles, labels and prose'], ['--font-heading', 'font-heading', 'Page and card titles: an alias of sans until a face is bundled'], ['--font-mono', 'font-mono', 'Identifiers, commands, timestamps, durations, costs and counters']] as const;

/* Every kit file as text, so each sheet is read from the component itself. */
const KIT_SOURCES = import.meta.glob('./components/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SPECS: Record<string, ComponentSpec> = Object.fromEntries(Object.entries(KIT_SOURCES).map(([path, source]) => { const spec = parseComponentSpec(path, source, COLOR_TOKENS); return [spec.name, spec]; }));

/* The product's own source (kit and screens, not this page or the harness):
 * what the scratchpad counts to tell an option in use from one that only exists. */
const PRODUCT_SOURCES = import.meta.glob(['./**/*.tsx', '!./design.tsx', '!./design/**', '!./harness.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const USAGE = measureUsage(PRODUCT_SOURCES, COLOR_TOKENS);
/* Tailwind drops the variables of steps nothing uses, so the scale is read from the stylesheet itself. */
const TEXT_SCALE: Record<string, string> = Object.fromEntries([...stylesheet.matchAll(/--text-([a-z0-9]+):\s*([\d.]+rem)/g)].map((match) => [match[1]!, match[2]!]));

/**
 * Uses of one option of one axis. An absent prop is a use of the default, so
 * the default's count is every render of the component minus the explicit ones.
 */
function optionUses(spec: ComponentSpec, axis: string, option: string): number {
	return spec.exports.reduce((sum, name) => {
		const explicit = USAGE.variants[name]?.[axis] ?? {};
		if (USAGE.variants[name] === undefined && USAGE.tags[name] === undefined) return sum;
		const given = Object.values(explicit).reduce((total, count) => total + count, 0);
		const implicit = spec.defaults[axis] === option && name === spec.exports[0] ? Math.max(0, (USAGE.tags[name] ?? 0) - given) : 0;
		return sum + (explicit[option] ?? 0) + implicit;
	}, 0);
}

const OFF_GRID = findOffGridSpacing(PRODUCT_SOURCES);
const RADII = ['sm', 'md', 'lg', 'xl', '2xl', 'full'] as const;

const SECTIONS = [['foundations', 'Foundations'], ['components', 'Components'], ['patterns', 'Patterns'], ['screens', 'Screens'], ['report', 'Report']] as const;

type Row = { id: string; issue: string; state: BadgeVariant; label: string; project: string; duration: string };
const ROWS: Row[] = [
	{ id: 'a1', issue: 'GSHIP-902', state: 'merged', label: 'Merged', project: 'gateship', duration: '21m 13s' },
	{ id: 'b2', issue: 'GSHIP-896', state: 'error', label: 'failed', project: 'gateship', duration: '1m 35s' },
	{ id: 'c3', issue: 'GSHIP-903', state: 'attention', label: 'waiting-user', project: 'reporter', duration: '4m 02s' },
];

/** Hides every option the product does not use, leaving the system as applied. */
const UsedOnlyContext = createContext(false);

/* The count beside an option: how many times the product's source applies it. */
function Used({ count }: { count: number }): React.ReactElement {
	return count === 0
		? <span className="rounded-sm bg-warning/8 px-1 font-mono text-warning-foreground text-xs">unused</span>
		: <span className="font-mono text-muted-foreground text-xs tabular-nums">×{count}</span>;
}

function useVisible<T>(items: readonly T[], count: (item: T) => number): T[] {
	const usedOnly = useContext(UsedOnlyContext);
	return items.filter((item) => !usedOnly || count(item) > 0);
}

interface InspectorState { inspecting: boolean; onHover: (inspection: Inspection | null) => void; onPick: (inspection: Inspection) => void }
const InspectorContext = createContext<InspectorState>({ inspecting: false, onHover: () => {}, onPick: () => {} });

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }): React.ReactElement {
	return <section aria-labelledby={`${id}-title`} className="flex flex-col gap-6" id={id}><h2 className="type-page-title" id={`${id}-title`}>{title}</h2>{children}</section>;
}
function Block({ title, rule, children, className, spec }: { title: string; rule?: string; children: React.ReactNode; className?: string; spec?: readonly string[] }): React.ReactElement {
	return (
		<div className={cn('flex flex-col gap-3', className)} data-design-block={title}>
			<div className="flex flex-col gap-1"><h3 className="font-medium text-sm">{title}</h3>{rule ? <p className="text-muted-foreground text-xs">{rule}</p> : null}</div>
			{children}
			{spec?.map((name) => SPECS[name] ? <SpecSheet key={name} spec={SPECS[name]} /> : null)}
		</div>
	);
}

/* What a component offers, read from its source: what you can ask to change
 * (axes), what each part is called (parts), what it exposes (attributes) and
 * which tokens paint it. Anything not listed is fixed by the contract. */
function SpecSheet({ spec }: { spec: ComponentSpec }): React.ReactElement {
	const rows: [string, React.ReactNode][] = [
		['exports', spec.exports.join(' · ')],
		...Object.entries(spec.axes).map(([axis, options]): [string, React.ReactNode] => [axis, <span className="flex flex-wrap gap-x-3 gap-y-1" key={axis}>{options.map((option) => <span className="inline-flex items-center gap-1" key={option}>{option}{spec.defaults[axis] === option ? <span className="text-muted-foreground">(default)</span> : null}<Used count={optionUses(spec, axis, option)} /></span>)}</span>]),
		['parts', spec.parts.join(' · ')],
		['attributes', spec.attributes.join(' · ')],
		['tokens', spec.tokens.map((token) => `--${token}`).join(' · ')],
		['off-scale', spec.arbitrary.join(' · ')],
	];
	return (
		<details className="rounded-lg border bg-muted/32 text-xs" data-design-chrome="">
			<summary className="cursor-default px-3 py-2 font-mono text-muted-foreground">{spec.name}.tsx{Object.keys(spec.axes).length === 0 ? '' : ` · ${Object.entries(spec.axes).map(([axis, options]) => `${axis}×${options.length}`).join(' · ')}`}</summary>
			<dl className="grid gap-x-4 gap-y-1 border-t px-3 py-2 sm:grid-cols-[6rem_1fr]">{rows.filter(([, value]) => value !== '').map(([label, value]) => <React.Fragment key={label}><dt className="type-eyebrow text-muted-foreground">{label}</dt><dd className="break-words font-mono">{value}</dd></React.Fragment>)}</dl>
		</details>
	);
}

function Typography(): React.ReactElement {
	const steps = useVisible(TEXT_STEPS, (step) => USAGE.text[step] ?? 0);
	const weights = useVisible(WEIGHTS, ([name]) => USAGE.weights[name] ?? 0);
	const offScale = Object.entries(USAGE.text).filter(([size]) => size.startsWith('['));
	const probe = useRef<HTMLDivElement>(null);
	const [facts, setFacts] = useState<Record<string, string>>({});
	useEffect(() => {
		if (probe.current === null) return;
		const next: Record<string, string> = {};
		for (const element of probe.current.querySelectorAll<HTMLElement>('[data-fact]')) { const style = getComputedStyle(element); next[element.dataset.fact ?? ''] = `${Number.parseFloat(style.fontSize)}px / ${style.lineHeight} / ${style.fontWeight}`; }
		for (const [variable] of FAMILIES) next[variable] = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
		setFacts(next);
	}, []);
	return (
		<div className="grid gap-8 lg:grid-cols-[1fr_1fr]" ref={probe}>
			<Block rule="Two families. Saans is the intended sans and is not bundled: the system sans stands in until the asset and its licence land in the repo." title="Families">
				<dl className="grid gap-4">{FAMILIES.map(([variable, className, use]) => <div key={variable}><dt className="font-mono text-muted-foreground text-xs">{variable} · .{className}</dt><dd className={cn('text-xl', className)}>Gateship ships GSHIP-902 0123456789</dd><dd className="text-muted-foreground text-xs">{use}</dd><dd className="mt-1 break-words font-mono text-muted-foreground text-xs">{facts[variable] ?? ''}</dd></div>)}</dl>
			</Block>
			<Block rule="Minor third (1.2) on a 16px base. Most of the product lives in xs and sm; 2xl is the page title. The steps above it are switched off." title="Scale">
				<dl className="grid gap-2">{steps.map((step) => <div className="grid items-baseline gap-3 sm:grid-cols-[4rem_1fr_auto_4rem]" key={step}><dt className="font-mono text-muted-foreground text-xs">text-{step}</dt><dd className="truncate" data-fact={`text-${step}`} style={{ fontSize: TEXT_SCALE[step], lineHeight: 1.35 }}>Quiet until you must act</dd><dd className="font-mono text-muted-foreground text-xs tabular-nums">{facts[`text-${step}`] ?? ''}</dd><dd className="text-right"><Used count={USAGE.text[step] ?? 0} /></dd></div>)}</dl>
				{offScale.length === 0 ? null : <p className="text-warning-foreground text-xs">Off the scale: <span className="font-mono">{offScale.map(([size, count]) => `text-${size} ×${count}`).join(' · ')}</span></p>}
			</Block>
			<Block rule="The ladder is 500, 560, 620. Normal is the body weight (set on the document, so no class applies it), medium marks labels and active items, semibold titles. Bold is switched off." title="Weights">
				<dl className="grid gap-2">{weights.map(([name, className]) => <div className="grid items-baseline gap-3 sm:grid-cols-[6rem_1fr_auto_4rem]" key={name}><dt className="font-mono text-muted-foreground text-xs">{className}</dt><dd className={className} data-fact={className}>Executable backlog</dd><dd className="font-mono text-muted-foreground text-xs tabular-nums">{facts[className]?.split(' / ')[2] ?? ''}</dd><dd className="text-right"><Used count={USAGE.weights[name] ?? 0} /></dd></div>)}</dl>
			</Block>
			<Block rule="A role is a family, a size and a weight decided once. Screens use roles; they do not compose type from utilities." title="Roles"><TypeRoles /></Block>
		</div>
	);
}

function Swatch({ token, count }: { token: string; count?: number }): React.ReactElement {
	const ref = useRef<HTMLSpanElement>(null);
	const [value, setValue] = useState('');
	useEffect(() => { if (ref.current) setValue(getComputedStyle(ref.current).backgroundColor); }, []);
	return (
		<span className="flex items-center gap-2 text-xs" title={value}>
			<span className="size-6 shrink-0 rounded-md border" ref={ref} style={{ backgroundColor: `var(--${token})` }} />
			<span className="min-w-0 truncate font-mono">{token}</span>
			{count === undefined ? null : <Used count={count} />}
		</span>
	);
}

function TokenLadder(): React.ReactElement {
	const tokens = useVisible(COLOR_TOKENS, (token) => USAGE.tokens[token] ?? 0);
	return (
		<div className="grid gap-4 md:grid-cols-2">
			{(['light', 'dark'] as const).map((theme) => (
				<div className={cn('grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border bg-background p-4 text-foreground', theme === 'dark' && 'dark')} key={theme}>
					<p className="type-eyebrow col-span-2 text-muted-foreground">{theme}</p>
					{tokens.map((token) => <Swatch count={theme === 'light' ? USAGE.tokens[token] ?? 0 : undefined} key={token} token={token} />)}
				</div>
			))}
		</div>
	);
}

function TypeRoles(): React.ReactElement {
	const refs = useRef<Record<string, HTMLElement | null>>({});
	const [facts, setFacts] = useState<Record<string, string>>({});
	useEffect(() => {
		const next: Record<string, string> = {};
		for (const [role] of TYPE_ROLES) { const element = refs.current[role]; if (element) { const style = getComputedStyle(element); next[role] = `${style.fontSize} / ${style.fontWeight} / ${style.fontFamily.split(',')[0]}`; } }
		setFacts(next);
	}, []);
	return (
		<dl className="grid gap-3">
			{TYPE_ROLES.map(([role, label]) => (
				<div className="grid items-baseline gap-1 sm:grid-cols-[10rem_1fr_auto]" key={role}>
					<dt className="font-mono text-muted-foreground text-xs">.{role}</dt>
					<dd className={role} ref={(element) => { refs.current[role] = element; }}>{label}: the quiet interface becomes explicit only when you must act.</dd>
					<dd className="font-mono text-muted-foreground text-xs tabular-nums">{facts[role] ?? ''}</dd>
				</div>
			))}
		</dl>
	);
}

/* A histogram of what the source applies, not a list of what is allowed. A
 * step off the 4px grid is flagged: the rule is only as true as this chart. */
function Histogram({ values, unit = 'px', grid }: { values: Record<number, number>; unit?: string; grid?: number }): React.ReactElement {
	const entries = Object.entries(values).map(([value, count]) => [Number(value), count] as const).sort((a, b) => a[0] - b[0]);
	const max = Math.max(1, ...entries.map(([, count]) => count));
	return (
		<div className="flex flex-col gap-1">
			{entries.map(([value, count]) => (
				<div className="grid items-center gap-2 font-mono text-xs tabular-nums sm:grid-cols-[3.5rem_1fr_3rem]" key={value}>
					<span className={cn(grid !== undefined && value % grid !== 0 && 'text-warning-foreground')}>{value}{unit}</span>
					<span className="h-2 rounded-sm bg-primary/70" style={{ width: `${Math.max(2, (count / max) * 100)}%` }} />
					<span className="text-right text-muted-foreground">×{count}</span>
				</div>
			))}
		</div>
	);
}

function Scale(): React.ReactElement {
	const radii = useVisible(RADII, (radius) => USAGE.radii[radius] ?? 0);
	const offGrid = Object.entries(USAGE.spacing).filter(([value]) => Number(value) % 4 !== 0).reduce((sum, [, count]) => sum + count, 0);
	const total = Object.values(USAGE.spacing).reduce((sum, count) => sum + count, 0);
	return (
		<div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
			<Block rule={`Padding, margin and gap as the source applies them across ${USAGE.files} files. Amber is off the 4px grid: ${offGrid} of ${total} uses.`} title="Spacing in use">
				<Histogram grid={4} values={USAGE.spacing} />
			</Block>
			<Block rule="Fixed heights and square sizes in use. Controls should land on 28, 32 or 36; rows on 32 or 40." title="Heights in use">
				<Histogram grid={4} values={USAGE.heights} />
			</Block>
			<Block rule="Controls use the small radius, cards the large one, the shell panel the largest." title="Radii">
				<div className="flex flex-wrap gap-3">{radii.map((radius) => <div className="flex flex-col items-center gap-1 font-mono text-xs" key={radius}><span className="size-12 border bg-card" style={{ borderRadius: radius === 'full' ? '9999px' : `var(--radius-${radius})` }} />rounded-{radius}<Used count={USAGE.radii[radius] ?? 0} /></div>)}</div>
			</Block>
			<Block rule="Sans for names, titles and prose. Mono only for identifiers, commands, timestamps, durations, costs and counters." title="Voices">
				<p className="text-sm">Project <span className="font-mono">gateship</span> shipped <span className="font-mono">GSHIP-902</span> in <span className="font-mono tabular-nums">21m 13s</span> at <span className="font-mono tabular-nums">08:47</span>.</p>
			</Block>
		</div>
	);
}

function TableSample({ status }: { status: DataTableStatus }): React.ReactElement {
	const columns = useMemo<GateshipColumnDef<Row>[]>(() => [
		{ id: 'issue', accessorKey: 'issue', header: 'Issue', enableHiding: false, cell: ({ row }) => <span className="font-medium font-mono">{row.original.issue}</span> },
		{ id: 'state', accessorKey: 'label', header: 'State', cell: ({ row }) => <Badge variant={row.original.state}>{row.original.label}</Badge> },
		{ id: 'project', accessorKey: 'project', header: 'Project' },
		{ id: 'duration', accessorKey: 'duration', header: 'Duration', meta: { className: 'font-mono tabular-nums', align: 'end' } },
	], []);
	const [sorting, setSorting] = useState<{ id: string; desc: boolean }[]>([]);
	const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({});
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 });
	const table = useGateshipTable({
		columns, data: status === 'loading' ? [] : ROWS, features: gateshipTableFeatures, getRowId: (row) => row.id,
		state: { sorting, columnVisibility, pagination, globalFilter: '' },
		onSortingChange: (value) => setSorting(typeof value === 'function' ? value(sorting) : value),
		onColumnVisibilityChange: (value) => setColumnVisibility(typeof value === 'function' ? value(columnVisibility) : value),
		onPaginationChange: (value) => setPagination(typeof value === 'function' ? value(pagination) : value),
	});
	return (
		<div className="flex flex-col gap-3">
			<DataTableToolbar>
				<ToggleGroup defaultValue={['all']} spacing={1} variant="outline"><ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="active">Active</ToggleGroupItem><ToggleGroupItem value="needs-you">Needs you</ToggleGroupItem></ToggleGroup>
				<DataTableFilter className="sm:max-w-64" placeholder="Search" table={table} />
				<DataTableViewOptions table={table} />
			</DataTableToolbar>
			<DataTable emptyState="No runs match." rowClassName={(row) => row.state === 'attention' ? '[&>td:first-child]:shadow-[inset_2px_0_0_var(--color-attention)]' : undefined} status={status} table={table} />
			<DataTablePagination table={table} />
		</div>
	);
}

function Components(): React.ReactElement {
	return (
		<div className="flex flex-col gap-8">
			<Block rule="One constructive primary action per panel. Acid only for the operator's turn. Every size shares the 32px row at sm." spec={['button']} title="Button">
				<div className="flex flex-col gap-3">{(['default', 'sm', 'icon'] as const).map((size) => <div className="flex flex-wrap items-center gap-2" key={size}>{BUTTON_VARIANTS.map((variant) => <Button key={variant} size={size} type="button" variant={variant}>{size === 'icon' ? <HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2.25} /> : variant}</Button>)}<span className="font-mono text-muted-foreground text-xs">{size}</span></div>)}</div>
			</Block>
			<Block rule="Compact, always beside a textual label somewhere on the row. Never the only carrier of state." spec={['badge']} title="Badge">
				<div className="flex flex-wrap gap-2">{BADGE_VARIANTS.map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}</div>
			</Block>
			<Block rule="Input, Select and Textarea share one chrome: hairline border, input tint on dark, neutral 3px ring on focus." spec={['input', 'select', 'textarea', 'card-layout']} title="Fields">
				<FormStack className="max-w-md">
					<FormField><span>Label</span><Input placeholder="Placeholder" /></FormField>
					<FormField><span>Select</span><SelectField items={[{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }]} placeholder="Provider" /></FormField>
					<FormField><span>Textarea</span><Textarea placeholder="Objective" rows={2} /></FormField>
				</FormStack>
			</Block>
			<div className="grid gap-8 md:grid-cols-2">
				<Block rule="Tabs switch panels of one surface; navigation between surfaces is a link." spec={['tabs']} title="Tabs">
					<Tabs defaultValue="queue"><TabsList aria-label="Work"><TabsTab value="queue">Queue <TabsCount>3</TabsCount></TabsTab><TabsTab value="approval">Approval <TabsCount attention>1</TabsCount></TabsTab><TabsTab value="ideas">Ideas</TabsTab></TabsList><TabsPanel value="queue"><p className="pt-3 text-muted-foreground text-sm">Queue panel</p></TabsPanel><TabsPanel value="approval"><p className="pt-3 text-muted-foreground text-sm">Approval panel</p></TabsPanel><TabsPanel value="ideas"><p className="pt-3 text-muted-foreground text-sm">Ideas panel</p></TabsPanel></Tabs>
				</Block>
				<Block rule="A single-select group is a quick view over one list; a filter that changes the list's source is a Select." spec={['toggle-group', 'toggle']} title="Toggle group">
					<ToggleGroup defaultValue={['all']} spacing={1} variant="outline"><ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="active">Active</ToggleGroupItem><ToggleGroupItem value="shipped">Shipped</ToggleGroupItem></ToggleGroup>
				</Block>
				<Block rule="Menus share the popover chrome. A label lives inside a group. Shortcuts are mono and trailing." spec={['dropdown-menu']} title="Dropdown menu">
					<DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="outline" />}>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup><DropdownMenuLabel>Run</DropdownMenuLabel><DropdownMenuItem>Open run<DropdownMenuShortcut>⏎</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem>Copy run ID</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuItem variant="destructive">Cancel run</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
				</Block>
				<Block rule="A hint names an icon-only control; expanded labels get none. 400ms in, instant between neighbours." spec={['tooltip']} title="Tooltip">
					<TooltipGroup><div className="flex gap-2"><HintTooltip label="Search" shortcut="⌘K"><Button aria-label="Search" size="icon" type="button" variant="outline"><HugeiconsIcon icon={Search01Icon} size={16} strokeWidth={2.25} /></Button></HintTooltip><HintTooltip detail="Idle" label="gateship"><Button type="button" variant="ghost">Hover me</Button></HintTooltip></div></TooltipGroup>
				</Block>
			</div>
			<Block rule="An alert says what happened and offers the one action that helps. Warning for partial data, destructive for a failed read." spec={['alert']} title="Alert">
				<div className="grid gap-3 md:grid-cols-3">
					<Alert><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>Default</AlertTitle><AlertDescription>Something to know.</AlertDescription></Alert>
					<Alert variant="warning"><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>Some histories are unavailable</AlertTitle><AlertDescription>reporter: Project runs are unavailable.</AlertDescription></Alert>
					<Alert variant="destructive"><HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={2.25} /><AlertTitle>Runs could not be loaded</AlertTitle><AlertDescription>Gateship returned 503.</AlertDescription><AlertAction><Button size="sm" type="button" variant="outline">Try again</Button></AlertAction></Alert>
				</div>
			</Block>
			<div className="grid gap-8 md:grid-cols-2">
				<Block rule="Empty says where you are and what comes next. EmptyState is the one-sentence form; Empty composes a title, detail and action." spec={['empty', 'empty-state']} title="Empty">
					<div className="rounded-lg border"><Empty><EmptyHeader><EmptyTitle>No runs match.</EmptyTitle><EmptyDescription>Try another view or clear the filters.</EmptyDescription></EmptyHeader><Button size="sm" type="button" variant="outline">Clear filters</Button></Empty></div>
					<div className="rounded-lg border"><EmptyState>No projects are registered yet.</EmptyState></div>
				</Block>
				<Block rule="Skeletons stand in for rows and figures on the first load only; a refresh dims what is already there." spec={['skeleton', 'progress']} title="Skeleton and progress">
					<div className="flex flex-col gap-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-64" /><Skeleton className="h-4 w-32" /></div>
					<Progress label="Recovery budget" value={40} />
				</Block>
			</div>
			<Block rule="Stat is a figure with a mono eyebrow. AttentionCard is the only acid surface and appears only while work waits on you." spec={['stat', 'attention-card', 'callout']} title="Stat, attention, callout">
				<CardGrid className="sm:grid-cols-2 xl:grid-cols-4" compact equalHeight>
					<Stat label="Active runs" value={2} />
					<AttentionCard title="Needs attention"><p className="type-data text-2xl">1</p></AttentionCard>
					{CALLOUT_TONES.slice(0, 2).map((tone) => <Callout key={tone} title={tone} tone={tone}>Callout body in the {tone} tone.</Callout>)}
				</CardGrid>
			</Block>
			<Block rule="24px inset in the header and panel; a footer only when the card has actions." spec={['card', 'item']} title="Card">
				<CardStack>
					<Card><CardHeader><CardTitle>Executable backlog</CardTitle></CardHeader><CardPanel><p className="text-muted-foreground text-sm">0 admissible issues right now.</p></CardPanel><CardFooter><Button size="sm" type="button">Approve next</Button><Button size="sm" type="button" variant="ghost">Later</Button></CardFooter></Card>
					<ItemGroup><Item><ItemContent><p className="text-sm">GSHIP-903 · Runs table on the shadcn recipe</p></ItemContent><Badge variant="info">review</Badge></Item><Item><ItemContent><p className="text-sm">GSHIP-904 · Design scratchpad</p></ItemContent><Badge variant="secondary">queued</Badge></Item></ItemGroup>
				</CardStack>
			</Block>
			<Block rule="Loading draws skeleton rows, updating dims the body, empty renders one full-width cell. Headers are sans; cells choose their voice." spec={['data-table', 'table']} title="Data table">
				<div className="grid gap-6">{(['ready', 'loading', 'updating'] as const).map((status) => <div className="flex flex-col gap-2" key={status}><p className="type-eyebrow text-muted-foreground">{status}</p><TableSample status={status} /></div>)}</div>
			</Block>
		</div>
	);
}

function Patterns(): React.ReactElement {
	const rules = [
		['Grid', 'Padding, margin and gap are multiples of 4px. A size that needs another number is declared as a height (a 40px row is `h-10`, not 10px of padding twice), and an inset that includes a 1px border subtracts it so the edge still lands on the grid.'],
		['Table toolbar', 'Quick views, the search and the columns menu share one 32px row; source filters take the next row; every control is 32px tall.'],
		['Sidebar', 'Rows are 32px on a 4px rhythm; the icon axis sits at x=44 expanded and collapsed; the first row shares the panel controls line (y=41); insets are 24px from the viewport and 24px to the panel.'],
		['State on a row', 'One badge per row. Rows waiting on the operator carry a 2px acid rule on the first cell; the tooltip and sr-only text carry the reason.'],
		['Figures', 'Right-aligned, mono, tabular. Unknown is a dash, never a zero.'],
		['Density', 'Table rows and headers are 40px by declaration, cells 12px inset. Menu items are 32px. Two rows of toolbar at most.'],
		['Fit', 'A default column set fits 948px at 1280 without horizontal scroll; optional columns may exceed it.'],
	] as const;
	const recorded = new Set(OFF_GRID_SPACING.map((entry) => `${entry.file} ${entry.className}`));
	const accidents = OFF_GRID.filter((finding) => !recorded.has(`${finding.file} ${finding.className}`));
	return (
		<div className="flex flex-col gap-8">
			<dl className="grid gap-4 md:grid-cols-2">{rules.map(([title, rule]) => <div className="rounded-lg border p-4" key={title}><dt className="font-medium text-sm">{title}</dt><dd className="mt-1 text-muted-foreground text-sm">{rule}</dd></div>)}</dl>
			<Block rule="A rule is there so the system gets used, not to forbid a choice. A departure is fine when it is written down with its reason; the gate fails on one that is not, and on a reason nothing uses any more." title="Deliberate departures">
				<ul className="grid gap-2">{OFF_GRID_SPACING.map((entry) => <li className="rounded-lg border p-3 text-sm" key={`${entry.file} ${entry.className}`}><p className="font-mono text-xs"><span className="text-muted-foreground">{entry.file}</span> {entry.className}</p><p className="mt-1 text-muted-foreground">{entry.reason}</p></li>)}</ul>
				{accidents.length === 0 ? <p className="text-muted-foreground text-xs">No unrecorded departure from the 4px grid.</p> : <ul className="grid gap-1 font-mono text-warning-foreground text-xs">{accidents.map((finding, index) => <li key={index}>{finding.file} {finding.className} ({finding.px}px)</li>)}</ul>}
			</Block>
		</div>
	);
}

function ReportView({ report }: { report: DesignReport }): React.ReactElement {
	const facts: [string, number | string, boolean][] = [
		['Font sizes', report.fontSizes.join(' '), report.fontSizes.length <= 6],
		['Text colours', report.textColors.length, report.textColors.length <= 8],
		['Radii', report.radii.join(' '), report.radii.length <= 5],
		['Arbitrary classes', report.arbitraryClasses.length, report.arbitraryClasses.length === 0],
		['Low contrast', report.lowContrast.length, report.lowContrast.length === 0],
		['Overflowing boxes', report.overflow.length, report.overflow.length === 0],
		['Uneven toolbars', report.unevenToolbars.length, report.unevenToolbars.length === 0],
		['Page overflow', `${report.pageOverflow}px`, report.pageOverflow === 0],
	];
	return (
		<div className="flex flex-col gap-3">
			<dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{facts.map(([label, value, ok]) => <div className={cn('rounded-lg border p-3', !ok && 'border-warning')} key={label}><dt className="type-eyebrow text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-sm tabular-nums">{value}</dd></div>)}</dl>
			{report.lowContrast.length > 0 ? <details className="text-xs"><summary className="cursor-default">Low contrast</summary><ul className="mt-2 grid gap-1 font-mono">{report.lowContrast.map((finding, index) => <li key={index}>{finding.ratio}:1 · "{finding.text}" · {finding.color} on {finding.background}</li>)}</ul></details> : null}
			{report.arbitraryClasses.length > 0 ? <details className="text-xs"><summary className="cursor-default">Arbitrary classes</summary><ul className="mt-2 grid gap-1 font-mono">{report.arbitraryClasses.map((name) => <li key={name}>{name}</li>)}</ul></details> : null}
			{report.overflow.length > 0 ? <details className="text-xs"><summary className="cursor-default">Overflow</summary><ul className="mt-2 grid gap-1 font-mono">{report.overflow.map((finding, index) => <li key={index}>{finding.slot} "{finding.text}": {finding.scrollWidth} in {finding.clientWidth} · {finding.classes}</li>)}</ul></details> : null}
			{report.unevenToolbars.length > 0 ? <details className="text-xs"><summary className="cursor-default">Toolbars</summary><ul className="mt-2 grid gap-1 font-mono">{report.unevenToolbars.map((finding, index) => <li key={index}>{finding.slot}: {finding.heights.join(', ')}</li>)}</ul></details> : null}
		</div>
	);
}

function Screens(): React.ReactElement {
	const [route, setRoute] = useState<(typeof ROUTES)[number]>('/overview/runs');
	const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>('dense');
	const [width, setWidth] = useState<(typeof WIDTHS)[number]>('1440');
	const [theme, setTheme] = useState<'light' | 'dark'>('light');
	const [locale, setLocale] = useState<'pt-BR' | 'en-US'>('en-US');
	const [report, setReport] = useState<DesignReport | null>(null);
	const frame = useRef<HTMLIFrameElement>(null);
	const [loaded, setLoaded] = useState(0);
	const inspector = useContext(InspectorContext);
	const src = `/harness.html?frame=${width}&route=${route}&scenario=${scenario}&locale=${locale}&theme=${theme}&motion=reduced`;
	/* Same origin, so the inspector reads the real screen inside the frame. */
	useEffect(() => {
		const inner = frame.current?.contentDocument;
		if (!inspector.inspecting || !inner?.body) return;
		return attachInspector(inner, COLOR_TOKENS, inspector.onHover, inspector.onPick);
	}, [inspector.inspecting, inspector.onHover, inspector.onPick, loaded]);
	const measure = (): void => {
		const document = frame.current?.contentDocument;
		if (document) setReport(measureDesign(document.body, document));
	};
	return (
		<div className="flex flex-col gap-4">
			<DataTableToolbar data-design-chrome="">
				<SelectField aria-label="Route" className="w-auto min-w-40" items={ROUTES.map((value) => ({ value, label: value }))} value={route} onValueChange={(value) => setRoute(value as typeof route)} />
				<SelectField aria-label="Scenario" className="w-auto min-w-40" items={SCENARIOS.map((value) => ({ value, label: value }))} value={scenario} onValueChange={(value) => setScenario(value as typeof scenario)} />
				<ToggleGroup aria-label="Width" spacing={1} value={[width]} variant="outline" onValueChange={(value) => { if (value[0]) setWidth(value[0] as typeof width); }}>{WIDTHS.map((value) => <ToggleGroupItem key={value} value={value}>{value}</ToggleGroupItem>)}</ToggleGroup>
				<ToggleGroup aria-label="Theme" spacing={1} value={[theme]} variant="outline" onValueChange={(value) => { if (value[0]) setTheme(value[0] as typeof theme); }}><ToggleGroupItem value="light">light</ToggleGroupItem><ToggleGroupItem value="dark">dark</ToggleGroupItem></ToggleGroup>
				<ToggleGroup aria-label="Locale" spacing={1} value={[locale]} variant="outline" onValueChange={(value) => { if (value[0]) setLocale(value[0] as typeof locale); }}><ToggleGroupItem value="pt-BR">pt-BR</ToggleGroupItem><ToggleGroupItem value="en-US">en-US</ToggleGroupItem></ToggleGroup>
				<Button className="ml-auto" type="button" variant="outline" onClick={measure}>Measure</Button>
				<a className="text-muted-foreground text-xs underline-offset-4 hover:underline" href={src} rel="noreferrer" target="_blank">open</a>
			</DataTableToolbar>
			<div className="overflow-x-auto rounded-lg border bg-background p-3"><iframe className="block h-[900px] bg-background" ref={frame} src={src} style={{ width: `${width}px` }} title="Harness scenario" onLoad={() => setLoaded((count) => count + 1)} /></div>
			{report ? <ReportView report={report} /> : <p className="text-muted-foreground text-sm">Measure runs design/measure.ts on the frame: contrast, overflow, toolbar heights, font sizes, colours, radii and arbitrary classes.</p>}
		</div>
	);
}

function SelfReport(): React.ReactElement {
	const [report, setReport] = useState<DesignReport | null>(null);
	return (
		<div className="flex flex-col gap-3">
			<div><Button type="button" variant="outline" onClick={() => setReport(measureDesign(document.getElementById('design-root') ?? document.body, document))}>Measure this page</Button></div>
			{report ? <ReportView report={report} /> : null}
		</div>
	);
}

function InspectorPanel({ hover, picked }: { hover: Inspection | null; picked: Inspection | null }): React.ReactElement {
	const shown = hover ?? picked;
	return (
		<aside aria-live="polite" className="fixed right-4 bottom-4 z-20 w-96 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground text-xs shadow-lg/5" data-design-chrome="">
			{shown === null ? <p className="text-muted-foreground">Hover a part to name it. Click to copy its reference.</p> : (
				<dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[5rem_1fr]">
					<dt className="type-eyebrow text-muted-foreground">part</dt><dd className="break-words font-mono">{shown.path.join(' › ')}</dd>
					{shown.attributes.length === 0 ? null : <><dt className="type-eyebrow text-muted-foreground">state</dt><dd className="break-words font-mono">{shown.attributes.join(' · ')}</dd></>}
					<dt className="type-eyebrow text-muted-foreground">size</dt><dd className="font-mono tabular-nums">{shown.width}×{shown.height} · radius {shown.radius}</dd>
					<dt className="type-eyebrow text-muted-foreground">type</dt><dd className="font-mono">{shown.font}</dd>
					<dt className="type-eyebrow text-muted-foreground">text</dt><dd className="break-words font-mono">{shown.color}</dd>
					<dt className="type-eyebrow text-muted-foreground">fill</dt><dd className="break-words font-mono">{shown.background}</dd>
				</dl>
			)}
			{picked === null ? null : <p className="mt-2 border-t pt-2 font-mono"><span className="text-muted-foreground">copied </span>{picked.reference}</p>}
		</aside>
	);
}

function Scratchpad(): React.ReactElement {
	const [dark, setDark] = useState(false);
	const [inspecting, setInspecting] = useState(false);
	const [usedOnly, setUsedOnly] = useState(false);
	const [hover, setHover] = useState<Inspection | null>(null);
	const [picked, setPicked] = useState<Inspection | null>(null);
	useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);
	const inspector = useMemo<InspectorState>(() => ({
		inspecting,
		onHover: setHover,
		onPick: (inspection) => { setPicked(inspection); void navigator.clipboard?.writeText(inspection.reference); },
	}), [inspecting]);
	useEffect(() => { if (!inspecting) { setHover(null); return; } return attachInspector(document, COLOR_TOKENS, inspector.onHover, inspector.onPick); }, [inspecting, inspector]);
	return (
		<InspectorContext.Provider value={inspector}>
		<UsedOnlyContext.Provider value={usedOnly}>
		<div className="min-h-screen bg-background text-foreground" data-design="gateship-scratchpad">
			{inspecting ? <InspectorPanel hover={hover} picked={picked} /> : null}
			<header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur" data-design-chrome="">
				<strong className="type-editorial-title mr-auto">Gateship design scratchpad</strong>
				<nav aria-label="Sections" className="flex flex-wrap gap-3 text-sm">{SECTIONS.map(([id, label]) => <a className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={`#${id}`} key={id}>{label}</a>)}</nav>
				<Button aria-pressed={usedOnly} type="button" variant={usedOnly ? 'default' : 'outline'} onClick={() => setUsedOnly((current) => !current)}>Used only</Button>
				<Button aria-pressed={inspecting} type="button" variant={inspecting ? 'default' : 'outline'} onClick={() => setInspecting((current) => !current)}>Inspect</Button>
				<ToggleGroup aria-label="Theme" spacing={1} value={[dark ? 'dark' : 'light']} variant="outline" onValueChange={(value) => { if (value[0]) setDark(value[0] === 'dark'); }}><ToggleGroupItem value="light">light</ToggleGroupItem><ToggleGroupItem value="dark">dark</ToggleGroupItem></ToggleGroup>
			</header>
			<main className="mx-auto flex max-w-(--content-measure) flex-col gap-16 px-6 py-10">
				<Section id="foundations" title="Foundations"><Typography /><TokenLadder /><Scale /></Section>
				<Section id="components" title="Components"><Components /></Section>
				<Section id="patterns" title="Patterns"><Patterns /></Section>
				<Section id="screens" title="Screens"><Screens /></Section>
				<Section id="report" title="Report"><SelfReport /></Section>
			</main>
		</div>
		</UsedOnlyContext.Provider>
		</InspectorContext.Provider>
	);
}

const root = document.getElementById('design-root');
if (root !== null) createRoot(root).render(<Scratchpad />);

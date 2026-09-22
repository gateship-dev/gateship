// test/web/ui-primitives.test.tsx
//
// The four primitives the operator screen is built from, exercised through
// static rendering and no DOM harness (ADR-0067). What is asserted is what the
// operator or a screen reader can observe -- a real disclosure, a progress bar
// that states its position, a badge that carries its family. Layout primitives
// additionally assert their spacing roles, because those roles are their API.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { Badge } from '../../webui/src/components/ui/badge.tsx';
import {
	CardDisclosure,
	CardFooter,
	CardPanel,
	CardSummary,
	CardTitle,
} from '../../webui/src/components/ui/card.tsx';
import { CardGrid, CardSplit, CardStack, CheckField, FormField, FormStack } from '../../webui/src/components/ui/card-layout.tsx';
import { EmptyState } from '../../webui/src/components/ui/empty-state.tsx';
import { Progress } from '../../webui/src/components/ui/progress.tsx';
import { Separator } from '../../webui/src/components/ui/separator.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../webui/src/components/ui/collapsible.tsx';
import { Count } from '../../webui/src/components/ui/count.tsx';
import { Reference } from '../../webui/src/components/ui/reference.tsx';
import { GateshipMark } from '../../webui/src/components/gateship-logo.tsx';
import { PageLoading } from '../../webui/src/components/ui/page-loading.tsx';
import { Stat } from '../../webui/src/components/ui/stat.tsx';
import { OperationalReadPanel } from '../../webui/src/operational-unavailable.tsx';
import { Switch } from '../../webui/src/components/ui/switch.tsx';
import { StatusDot } from '../../webui/src/components/ui/status-dot.tsx';
import { Tag } from '../../webui/src/components/ui/tag.tsx';
import {
	Tabs,
	TabsCount,
	TabsList,
	TabsPanel,
	TabsTab,
} from '../../webui/src/components/ui/tabs.tsx';
import { cn } from '../../webui/src/lib/cn.ts';
import { ContextPanel, SectionCard } from '../../webui/src/screens/operator-controls.tsx';
import {
	DataTable,
	DataTableViewOptions,
	DataTablePagination,
	gateshipTableFeatures,
	useGateshipTable,
	type GateshipColumnDef,
} from '../../webui/src/components/ui/data-table.tsx';

type TableFixtureRow = { id: string; name: string; state: string; execution?: string; providerId?: string };
const TABLE_FIXTURE_COLUMNS: GateshipColumnDef<TableFixtureRow>[] = [
	{ accessorKey: 'name', header: 'Name' },
	{ accessorKey: 'state', header: 'State', meta: { className: 'font-mono', align: 'end' } },
];

function TableFixture({ columns = TABLE_FIXTURE_COLUMNS, data, server = false, loading = false, pageSize = 1, rowCount = 4 }: { columns?: GateshipColumnDef<TableFixtureRow>[]; data: TableFixtureRow[]; server?: boolean; loading?: boolean; pageSize?: number; rowCount?: number }): React.ReactElement {
	const table = useGateshipTable({
		columns,
		data,
		features: gateshipTableFeatures,
		getRowId: (row) => row.id,
		manualFiltering: server,
		manualPagination: server,
		manualSorting: server,
		rowCount: server ? rowCount : undefined,
		state: {
			pagination: { pageIndex: server ? 1 : 0, pageSize },
			...(server ? { globalFilter: 'not applied locally', sorting: [{ desc: true, id: 'name' }] } : {}),
		},
	});
	return <><DataTable table={table} locale="pt-BR" status={loading ? 'loading' : 'ready'} /><DataTablePagination table={table} locale="pt-BR" /></>;
}

function TableControlsFixture(): React.ReactElement {
	const columns: GateshipColumnDef<TableFixtureRow>[] = [{ accessorKey: 'execution', header: 'Execução', enableSorting: false }, { accessorKey: 'providerId', header: 'Provider / modelo' }, ...TABLE_FIXTURE_COLUMNS];
	const table = useGateshipTable({ columns, data: [{ id: 'a', name: 'Nome', state: 'Pronto', execution: 'run-1', providerId: 'Claude Code / modelo' }], features: gateshipTableFeatures, getRowId: (row) => row.id, rowCount: 1, state: { sorting: [], pagination: { pageIndex: 0, pageSize: 1 } } });
	return <><DataTable table={table} locale="pt-BR" /><DataTablePagination table={table} locale="pt-BR" /><DataTableViewOptions table={table} locale="pt-BR" /></>;
}

describe('ui primitives', () => {
	test('data tables keep typed columns composable and expose accessible controls', () => {
		const html = renderToStaticMarkup(<TableFixture data={[{ id: 'a', name: 'Um texto suficientemente longo para testar overflow', state: 'Pronto' }, { id: 'b', name: 'Segundo', state: 'Em fila' }]} />);
		const other = renderToStaticMarkup(<TableFixture columns={[{ accessorKey: 'state', header: 'Estado' }]} data={[{ id: 'a', name: 'Ignorado', state: 'Pronto' }]} />);
		expect(html).toContain('data-slot="data-table"');
		expect(html).toContain('data-slot="table-container"');
		expect(html).toContain('aria-sort="none"');
		expect(html).toContain('Página 1 de 2');
		expect(html).toContain('Próxima página');
		expect(other).toContain('Estado');
	});

	test('data tables announce their initial loading state', () => {
		const html = renderToStaticMarkup(<TableFixture data={[]} loading />);
		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('role="status"');
		expect(html).toContain('Carregando…');
	});

	test('data tables leave row processing to the server and keep header voice apart from cell voice', () => {
		const html = renderToStaticMarkup(<TableFixture data={[{ id: 'a', name: 'Nome', state: 'Pronto' }]} />);
		const server = renderToStaticMarkup(<TableFixture server data={[{ id: 'a', name: 'Resposta do servidor A', state: 'Pronto' }, { id: 'b', name: 'Resposta do servidor B', state: 'Em fila' }]} />);
		// A column's classes reach its cells; its header is the eyebrow of the column and only follows the alignment.
		const stateHead = html.slice(html.lastIndexOf('<th', html.indexOf('State')), html.indexOf('State'));
		expect(stateHead).toContain('type-eyebrow');
		expect(stateHead).toContain('text-right');
		expect(stateHead).not.toContain('font-mono');
		expect(html).toMatch(/<td[^>]*class="[^"]*font-mono[^"]*text-right/);
		// The global filter and the sort are not applied locally: both rows arrive as the server sent them.
		expect(server).toContain('Resposta do servidor A');
		expect(server).toContain('Resposta do servidor B');
		expect(server).toContain('Página 2 de 4');
		const server25 = renderToStaticMarkup(<TableFixture server pageSize={25} rowCount={100} data={[{ id: 'a', name: 'Resposta do servidor A', state: 'Pronto' }]} />);
		expect(server25).toContain('Página 2 de 4');
	});

	test('data table controls name their column and localize sorting and ranges', () => {
		const html = renderToStaticMarkup(<TableControlsFixture />);
		// A sortable header announces its state; one that only hides names itself and promises no sort.
		expect(html).toContain('aria-label="Name, sem ordenação"');
		expect(html).toContain('aria-label="Execução"');
		expect(html).not.toContain('aria-label="Execução, ');
		expect(html).toContain('Provider / modelo');
		expect(html).toContain('>Colunas</button>');
		expect(html).toContain('aria-label="Linhas por página"');
		expect(html).toContain('aria-label="Próxima página"');
		expect(html).toContain('1–1 de 1');
		expect(html).not.toContain(' of ');
	});

	test('card composition owns its standard, compact, split and form rhythm', () => {
		const standard = renderToStaticMarkup(<CardStack><div>one</div><div>two</div></CardStack>);
		const compact = renderToStaticMarkup(<CardGrid as="ul" compact equalHeight><li>one</li></CardGrid>);
		const split = renderToStaticMarkup(<CardSplit><div>left</div><div>right</div></CardSplit>);
		const form = renderToStaticMarkup(<FormStack><FormField htmlFor="name">Name</FormField></FormStack>);
		expect(standard).toContain('data-slot="card-stack"');
		expect(standard).toContain('gap-6');
		expect(compact).toContain('data-density="compact"');
		expect(compact).toContain('gap-4');
		expect(compact).toContain('auto-rows-fr');
		expect(split).toContain('xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
		expect(form).toContain('data-slot="form-stack"');
		expect(form).toContain('gap-3');
		expect(form).toContain('data-slot="form-field"');
		expect(form).toContain('gap-1');
	});
	test('a card disclosure is native, and closed never means absent', () => {
		const html = renderToStaticMarkup(
			<CardDisclosure>
				<CardSummary>
					<CardTitle>Backlog plannable</CardTitle>
				</CardSummary>
				<CardPanel>duas issues</CardPanel>
			</CardDisclosure>,
		);

		expect(html.startsWith('<details')).toBe(true);
		expect(html).toContain('<summary');
		expect(html).toContain('>Backlog plannable</h2>');
		// Collapsed is a rendering state: the body is in the markup either way.
		expect(html).toContain('duas issues');
		expect(html).not.toContain('open=""');
		expect(renderToStaticMarkup(<CardDisclosure open />)).toContain('open=""');
		// One chevron for everything that opens, turned by its own <details> alone: a group, named or not,
		// would also turn the chevron of every disclosure nested inside an open one.
		const owns = '[&amp;[open]&gt;summary&gt;[data-slot=disclosure-chevron]]:rotate-90';
		expect(html).toContain(owns);
		expect(html).toContain('data-slot="disclosure-chevron"');
		expect(html).not.toMatch(/group-open/);
		const nested = renderToStaticMarkup(<Collapsible defaultOpen><CollapsibleTrigger>outer</CollapsibleTrigger><CollapsibleContent><Collapsible><CollapsibleTrigger>inner</CollapsibleTrigger></Collapsible></CollapsibleContent></Collapsible>);
		expect(nested).not.toMatch(/group-open|class="[^"]*\bgroup\b/);
		expect((nested.match(/data-slot="disclosure-chevron"/g) ?? []).length).toBe(2);
		// A row of a list opens the same way, without a frame of its own and with the denser glyph in the same 16px slot.
		const bare = renderToStaticMarkup(<Collapsible bare><CollapsibleTrigger bare>row</CollapsibleTrigger></Collapsible>);
		expect(bare).not.toContain('rounded-lg border');
		expect(bare).toContain('size-3.5');
		expect(bare).toMatch(/class="flex size-4 [^"]*" data-slot="disclosure-chevron"/);
	});

	test('content titles use sans, metric labels use the eyebrow voice, and the footer exists only with actions', () => {
		const title = renderToStaticMarkup(<CardTitle>Run</CardTitle>);
		const stat = renderToStaticMarkup(<Stat label="Needs attention" value={1} />);
		const footer = renderToStaticMarkup(<CardFooter><button type="button">Save</button></CardFooter>);
		const context = renderToStaticMarkup(
			<ContextPanel description="Supporting context" title="Context"><form><CardFooter><button type="submit">Save</button></CardFooter></form></ContextPanel>,
		);
		expect(title).toContain('type-editorial-title');
		expect(stat).toContain('type-eyebrow');
		expect(footer).toContain('data-slot="card-footer"');
		expect(footer).toContain('border-t');
		expect(footer).toContain('bg-muted');
		expect(renderToStaticMarkup(<CardPanel>read only</CardPanel>)).not.toContain('card-footer');
		// A disclosure keeps its description inside, so it closes to one line; a plain section names and describes itself in its header.
		expect(context).not.toContain('data-slot="card-frame-description"');
		const section = renderToStaticMarkup(<SectionCard description="What this section is" title="Section"><p>content</p></SectionCard>);
		const header = section.slice(section.indexOf('data-slot="card-frame-header"'), section.indexOf('data-slot="card"'));
		expect(header).toContain('data-slot="card-frame-description"');
		expect(header).toContain('What this section is');
		// One text inset for every surface: a card pads 16px, as a Stat and a table's edge cells do.
		expect(section).toContain('px-4 py-3');
		expect(section).toMatch(/class="[^"]*\bp-4\b[^"]*" data-slot="card-panel"/);
		expect(section).not.toMatch(/\bp-6\b|px-6/);
		expect(context).toContain('Supporting context');
		expect(context).toContain('<button type="submit">Save</button>');
	});

	test('progress states its position to assistive tech and to the eye', () => {
		const html = renderToStaticMarkup(<Progress label="Fase verify" value={33} />);

		expect(html).toContain('role="progressbar"');
		expect(html).toContain('aria-label="Fase verify"');
		expect(html).toContain('aria-valuenow="33"');
		expect(html).toContain('aria-valuetext="33%"');
		// The visible half: the label, the reading, and a track filled to it.
		expect(html).toContain('Fase verify');
		expect(html).toContain('>33%<');
		expect(html).toContain('width:33%');
	});

	test('a badge carries the family it was told, is neutral by default and starts with a capital', () => {
		// The family, not the tint strength: the alpha is a design value.
		expect(renderToStaticMarkup(<Badge variant="warning">aguardando você</Badge>)).toContain('bg-warning/');
		// Neutral, never the solid black chip: a badge that shouts louder than the thing it describes.
		const idle = renderToStaticMarkup(<Badge>ocioso</Badge>);
		expect(idle).toContain('data-variant="neutral"');
		expect(idle).not.toContain('bg-primary');
		// First letter capital, the rest as written: "Aguardando você", never "Aguardando Você".
		expect(idle).toContain('>Ocioso<');
		expect(renderToStaticMarkup(<Badge variant="warning">aguardando você</Badge>)).toContain('>Aguardando você<');
	});

	test('each short label has one job: a dot for the life of a run, a tag for an attribute, a reference for an id, a count for a number', () => {
		const dot = renderToStaticMarkup(<StatusDot active tone="info">em andamento</StatusDot>);
		expect(dot).toContain('>Em andamento<');
		expect(dot).toContain('motion-safe:animate-pulse');
		expect(renderToStaticMarkup(<StatusDot tone="success">concluída</StatusDot>)).not.toContain('animate-pulse');
		// A tag has no hue: nothing about an attribute changes or asks for anything.
		const tag = renderToStaticMarkup(<Tag>somente leitura</Tag>);
		expect(tag).toContain('>Somente leitura<');
		expect(tag).not.toMatch(/bg-(info|success|warning|destructive|merged)/);
		// An id is read character by character and is a link only when there is somewhere to go.
		expect(renderToStaticMarkup(<Reference>GSHIP-902</Reference>)).toMatch(/^<span [^>]*type-data/);
		expect(renderToStaticMarkup(<Reference href="/projects/p/runs/r">69864f95</Reference>)).toMatch(/^<a [^>]*href="\/projects\/p\/runs\/r"/);
		expect(renderToStaticMarkup(<Count tone="warning">3</Count>)).toContain('tabular-nums');
		// A count declares its weight: beside a current tab or a selected row it must not inherit that row's emphasis.
		expect(renderToStaticMarkup(<Count tone="warning">3</Count>)).toContain('font-normal');
		expect(renderToStaticMarkup(<Count form="plain">3</Count>)).toContain('font-normal');
	});

	test('the attention stat speaks in the warning family, never in the acid of the mark, and a stat with a list behind it is a link', () => {
		const html = renderToStaticMarkup(<Stat label="Requer atenção" tone="attention" value={1} />);
		// The family, not the exact wash. The acid is the mark's alone.
		expect(html).toContain('bg-warning/');
		expect(html).toContain('border-warning/');
		expect(html).not.toMatch(/(bg|text|border)-attention/);
		expect(html).toContain('Requer atenção');
		expect(renderToStaticMarkup(<Stat label="Runs ativas" value={0} />)).not.toContain('attention');
		const link = renderToStaticMarkup(<Stat href="/overview/queues" label="Issues aprovadas" value={2} />);
		expect(link).toMatch(/^<a [^>]*href="\/overview\/queues"/);
		expect(link).toContain('focus-visible:ring-2');
		// A link says so at rest, because a touch screen has no hover to ask; a figure that leads nowhere carries no arrow.
		expect(link).toContain('data-slot="stat-arrow"');
		expect(link).toMatch(/^<a class="group\/stat /);
		expect(html).not.toContain('data-slot="stat-arrow"');
	});

	test('a lone figure sits on the foot of its card, and a figure with detail puts it beside itself once the card is wide', () => {
		const lone = renderToStaticMarkup(<Stat label="Issues aprovadas" value={2} />);
		expect(lone).toMatch(/^<div class="[^"]*flex flex-col/);
		expect(lone).toContain('mt-auto pt-2');
		const led = renderToStaticMarkup(<Stat hint="Enviadas" label="Entrega" value="1/4"><p>Falhas 0</p></Stat>);
		expect(led).not.toContain('mt-auto');
		// By the card's own width, not the window's.
		expect(led).toContain('class="@container"');
		expect(led).toContain('@xl:flex-row');
		expect(led.indexOf('data-slot="stat-head"')).toBeLessThan(led.indexOf('data-slot="stat-detail"'));
		expect(led.slice(led.indexOf('data-slot="stat-detail"'))).toContain('Falhas 0');
	});

	test('tabs keep every label in a named horizontal scroller with reduced motion support', () => {
		const html = renderToStaticMarkup(
			<Tabs defaultValue="queue">
				<TabsList aria-label="Work">
					<TabsTab value="queue">Queue</TabsTab>
					<TabsTab value="approval">Approval</TabsTab>
					<TabsTab value="ideas">Ideas</TabsTab>
					<TabsTab value="suggestions">Suggestions</TabsTab>
				</TabsList>
				<TabsPanel value="queue">Queue panel</TabsPanel>
			</Tabs>,
		);

		expect(html).toContain('data-slot="tabs-scroll"');
		expect(html).toContain('overflow-x-auto');
		expect(html).toContain('scroll-container');
		// The fade at its edges says the row scrolls; no trailing pad pretends to.
		expect(html).toContain('scroll-fade-x');
		expect(html).not.toContain('pr-8');
		// One size at every width: a tab is not a field.
		expect(html).not.toContain('text-base');
		expect(html).toContain('aria-label="Work"');
		for (const label of ['Queue', 'Approval', 'Ideas', 'Suggestions']) {
			expect(html).toContain(`>${label}</button>`);
		}
		expect(html).toContain('whitespace-nowrap');
		expect(html).toContain('pointer-coarse:min-h-11');
		expect(html).toContain('motion-reduce:transition-none');
	});

	test('a field is as wide as what is typed in it, and a boolean that acts at once is a switch in the product ink', () => {
		expect(renderToStaticMarkup(<FormField>name</FormField>)).toContain('max-w-md');
		expect(renderToStaticMarkup(<FormField measure="prose">brief</FormField>)).toContain('max-w-3xl');
		expect(renderToStaticMarkup(<FormField measure="full">in a grid</FormField>)).not.toMatch(/max-w-/);
		expect(renderToStaticMarkup(<CheckField><input type="checkbox" />I confirm</CheckField>)).toMatch(/^<label class="[^"]*flex items-start gap-2/);
		const off = renderToStaticMarkup(<Switch checked={false} />);
		const on = renderToStaticMarkup(<Switch checked disabled />);
		expect(off).toContain('role="switch"');
		expect(off).toContain('aria-checked="false"');
		expect(on).toContain('aria-checked="true"');
		expect(on).toContain('aria-disabled="true"');
		// Ink when on, never the acid of the mark.
		expect(on).toContain('data-checked:bg-primary');
		expect(on).not.toMatch(/attention/);
	});

	test('a page that waits shows the mark drawing its arch; a block that waits inside a page shows a skeleton', () => {
		const page = renderToStaticMarkup(<PageLoading label="Loading queues…" />);
		expect(page).toContain('role="status"');
		expect(page).toContain('aria-busy="true"');
		expect(page).toContain('data-slot="loading-mark"');
		expect(page).toContain('loading-mark');
		expect(page).toContain('viewBox="0 0 2750 2750"');
		// The stair is built as its four steps, bottom to top: the shaft's three blocks, then the arrowhead's five at once.
		expect([...page.matchAll(/data-step="(\d)"/g)].map((match) => match[1])).toEqual(['1', '2', '3', '4', '4', '4', '4', '4']);
		// The static mark keeps its one stair path.
		expect(renderToStaticMarkup(<GateshipMark />)).not.toContain('data-step');
		expect(page).toContain('Loading queues…');
		expect(page).not.toContain('data-slot="skeleton"');
		// The panel is a block inside a page that is already there: it keeps the skeleton, in the frame the panel will have.
		const panel = renderToStaticMarkup(<OperationalReadPanel detail={undefined} loaded={false} locale="en-US" pending resource="Providers">ready</OperationalReadPanel>);
		expect(panel).toContain('data-slot="skeleton"');
		expect(panel).toContain('data-slot="card-frame"');
		expect(panel).not.toContain('data-slot="loading-mark"');
	});

	test('a count says how many, and says nothing when there are none', () => {
		expect(renderToStaticMarkup(<Count>3</Count>)).toContain('>3</span>');
		expect(renderToStaticMarkup(<Count>{0}</Count>)).toBe('');
		expect(renderToStaticMarkup(<Count form="plain">0</Count>)).toBe('');
		expect(renderToStaticMarkup(<TabsCount>{0}</TabsCount>)).toBe('');
		// Unknown is not zero: the dash a screen shows for it stays.
		expect(renderToStaticMarkup(<TabsCount>—</TabsCount>)).toContain('—');
	});

	test('a compact empty state keeps its explanation without reserving a tall region', () => {
		const html = renderToStaticMarkup(<EmptyState compact>No pending proposals.</EmptyState>);

		expect(html).toContain('data-density="compact"');
		expect(html).toContain('No pending proposals.');
		expect(html).not.toContain('min-h-24');
		expect(html).not.toContain('p-6');
	});

	test('the visual separator uses the native horizontal-rule semantic', () => {
		const html = renderToStaticMarkup(<Separator />);

		expect(html.startsWith('<hr')).toBe(true);
		expect(html).not.toContain('role="separator"');
	});

	test('cn keeps the declared order and drops the branches that produced nothing', () => {
		expect(cn('p-6', false, undefined, '', 'flex')).toBe('p-6 flex');
	});
});

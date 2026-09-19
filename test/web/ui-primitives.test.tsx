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
import { CardGrid, CardSplit, CardStack, FormField, FormStack } from '../../webui/src/components/ui/card-layout.tsx';
import { EmptyState } from '../../webui/src/components/ui/empty-state.tsx';
import { Progress } from '../../webui/src/components/ui/progress.tsx';
import { Separator } from '../../webui/src/components/ui/separator.tsx';
import { Stat } from '../../webui/src/components/ui/stat.tsx';
import {
	Tabs,
	TabsList,
	TabsPanel,
	TabsTab,
} from '../../webui/src/components/ui/tabs.tsx';
import { cn } from '../../webui/src/lib/cn.ts';
import { ContextPanel } from '../../webui/src/screens/operator-controls.tsx';
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
		// A column's classes reach its cells; its header keeps the sans voice and only follows the alignment.
		const stateHead = html.slice(html.lastIndexOf('<th', html.indexOf('State')), html.indexOf('State'));
		expect(stateHead).toContain('font-sans');
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
		expect(context).not.toContain('data-slot="card-frame-description"');
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

	test('a badge carries the family it was told, and is neutral by default', () => {
		// The family, not the tint strength: the alpha is a design value.
		expect(renderToStaticMarkup(<Badge variant="warning">waiting-user</Badge>))
			.toContain('bg-warning/');
		expect(renderToStaticMarkup(<Badge>ocioso</Badge>)).toContain('bg-primary');
	});

	test('the attention stat is the acid surface, and a stat with a list behind it is a link', () => {
		const html = renderToStaticMarkup(<Stat label="Requer atenção" tone="attention" value={1} />);
		// The family, not the exact wash: acid marks what waits on the operator.
		expect(html).toContain('bg-attention-surface');
		expect(html).toContain('border-attention-ui');
		expect(html).toContain('Requer atenção');
		expect(renderToStaticMarkup(<Stat label="Runs ativas" value={0} />)).not.toContain('attention');
		const link = renderToStaticMarkup(<Stat href="/overview/queues" label="Issues aprovadas" value={2} />);
		expect(link).toMatch(/^<a [^>]*href="\/overview\/queues"/);
		expect(link).toContain('focus-visible:ring-2');
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
		expect(html).toContain('pr-8');
		expect(html).toContain('aria-label="Work"');
		for (const label of ['Queue', 'Approval', 'Ideas', 'Suggestions']) {
			expect(html).toContain(`>${label}</button>`);
		}
		expect(html).toContain('whitespace-nowrap');
		expect(html).toContain('pointer-coarse:min-h-11');
		expect(html).toContain('motion-reduce:transition-none');
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

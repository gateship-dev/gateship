import { describe, expect, test } from 'bun:test';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { bulkOutcome } from '../../webui/src/app-props.ts';
import { DataTable, DataTableBulkAction, gateshipTableFeatures, toggleRows, togglePageRows, useGateshipTable, type GateshipColumnDef } from '../../webui/src/components/ui/data-table.tsx';

type Row = { id: string; name: string };
const COLUMNS: GateshipColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name', meta: { kind: 'name' } }];
const ROWS: Row[] = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Row ${id}` }));

function Fixture({ selectable }: { selectable: boolean }): React.ReactElement {
	const table = useGateshipTable({ columns: COLUMNS, data: ROWS, features: gateshipTableFeatures, getRowId: (row) => row.id });
	return <DataTable locale="pt-BR" selection={selectable ? { actions: () => null } : undefined} table={table} />;
}

describe('row selection', () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];

	test('a click turns one row on or off; with shift the rows since the last click follow the clicked one', () => {
		const one = toggleRows(new Set(), ids, 1, null);
		expect([...one]).toEqual(['b']);
		// From b, shift-click on d takes c and d with it.
		expect([...toggleRows(one, ids, 3, 1)].sort()).toEqual(['b', 'c', 'd']);
		// Shift-clicking a row that is on turns the whole range off, whichever way the range runs.
		expect([...toggleRows(new Set(['a', 'b', 'c', 'd']), ids, 1, 3)].sort()).toEqual(['a']);
		expect(toggleRows(one, ids, 9, null)).toBe(one);
	});

	test('the page checkbox takes every row, and a second press gives them all back', () => {
		expect([...togglePageRows(new Set(['a']), ids)]).toEqual(ids);
		expect([...togglePageRows(new Set(ids), ids)]).toEqual([]);
		expect([...togglePageRows(new Set(), [])]).toEqual([]);
	});

	test('a table that can act on several rows leads every row with a checkbox, and one that cannot has none', () => {
		const selectable = renderToStaticMarkup(<Fixture selectable />);
		const plain = renderToStaticMarkup(<Fixture selectable={false} />);
		expect((selectable.match(/data-slot="row-select"/g) ?? []).length).toBe(ROWS.length + 1);
		expect(selectable).toContain('aria-label="Selecionar todas as linhas desta página"');
		expect(selectable).toContain('aria-label="Selecionar linha"');
		// Nothing is selected yet, so there is no selection bar.
		expect(selectable).not.toContain('data-slot="data-table-selection"');
		expect(plain).not.toContain('data-slot="row-select"');
	});

	test('a bulk action asks first; the question names the count and the verb', () => {
		const html = renderToStaticMarkup(<DataTableBulkAction confirm="Descartar 3 achados" label="Descartar" locale="pt-BR" onRun={() => {}} />);
		expect(html).toContain('>Descartar</button>');
		expect(html).toContain('data-slot="data-table-bulk-action"');
		expect(html).not.toContain('data-slot="data-table-bulk-confirm"');
	});

	test("each row reports on its own: the ones that settled, and the ones refused with the service's reason", () => {
		const outcome = bulkOutcome(['p1', 'p2', 'p3'], [
			{ status: 'fulfilled', value: 'ok' },
			{ status: 'rejected', reason: new Error('Proposal p2 is already promoted.') },
			{ status: 'rejected', reason: 'offline' },
		]);
		expect(outcome).toEqual({ settled: ['p1'], failed: [{ id: 'p2', reason: 'Proposal p2 is already promoted.' }, { id: 'p3', reason: 'offline' }] });
	});
});

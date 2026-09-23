import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { DrawerLayout, ItemDrawer, neighbour, successorOf } from '../../webui/src/components/ui/item-drawer.tsx';
import { readQueryParam } from '../../webui/src/lib/use-query-param.ts';

describe('item drawer', () => {
	const ids = ['a', 'b', 'c'];

	test('the arrows walk the page and stop at its ends; a dismissed item hands the drawer to the next row, else the previous, else nothing', () => {
		expect(neighbour(ids, 'a', 1)).toBe('b');
		expect(neighbour(ids, 'c', 1)).toBeNull();
		expect(neighbour(ids, 'a', -1)).toBeNull();
		expect(neighbour(ids, 'missing', 1)).toBeNull();
		expect(neighbour(ids, null, 1)).toBeNull();
		expect(successorOf(ids, 'a')).toBe('b');
		expect(successorOf(ids, 'c')).toBe('b');
		expect(successorOf(['only'], 'only')).toBeNull();
	});

	test('the open item is read from the address, and an empty value is no item', () => {
		expect(readQueryParam('finding', { location: { pathname: '/w', search: '?tab=diagnostics&finding=f-1', hash: '' } })).toBe('f-1');
		expect(readQueryParam('finding', { location: { pathname: '/w', search: '?finding=', hash: '' } })).toBeNull();
		expect(readQueryParam('finding', { location: { pathname: '/w', search: '', hash: '' } })).toBeNull();
	});

	test('closed, the drawer is nothing and the layout is one column; open, it is a dialog with the item on top and its actions at the foot', () => {
		const closed = renderToStaticMarkup(<DrawerLayout open={false}><div>table</div><ItemDrawer open={false} title="Rule" onClose={() => {}}>detail</ItemDrawer></DrawerLayout>);
		expect(closed).not.toContain('data-slot="item-drawer"');
		expect(closed).not.toContain('xl:grid');
		const open = renderToStaticMarkup(<DrawerLayout open><div>table</div><ItemDrawer footer={<button type="button">Dismiss</button>} locale="pt-BR" open title="effect-needs-cleanup" onClose={() => {}}>detail</ItemDrawer></DrawerLayout>);
		expect(open).toContain('xl:grid');
		const aside = open.slice(open.indexOf('<aside'), open.indexOf('>', open.indexOf('<aside')));
		expect(aside).toContain('role="dialog"');
		expect(aside).toContain('data-slot="item-drawer"');
		expect(open).toContain('aria-label="effect-needs-cleanup"');
		expect(open).toContain('aria-label="Fechar"');
		// Head, body, foot, in that order: the name, the item, what can be done to it.
		expect(open.indexOf('data-slot="item-drawer-head"')).toBeLessThan(open.indexOf('data-slot="item-drawer-body"'));
		expect(open.indexOf('data-slot="item-drawer-body"')).toBeLessThan(open.indexOf('data-slot="item-drawer-foot"'));
		// Never modal: the list beside it stays live, so nothing claims aria-modal.
		expect(open).not.toContain('aria-modal');
		// Without a foot there is no empty band.
		expect(renderToStaticMarkup(<ItemDrawer open title="x" onClose={() => {}}>d</ItemDrawer>)).not.toContain('data-slot="item-drawer-foot"');
	});
});

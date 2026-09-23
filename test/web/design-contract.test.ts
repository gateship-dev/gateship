import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { OFF_GRID_SPACING, RAW_BUTTONS } from '../../webui/src/design/exceptions.ts';
import { findOffGridSpacing, measureUsage } from '../../webui/src/design/usage.ts';

const ROOT = join(import.meta.dir, '../../webui/src');

/** The product's own source: the kit and the screens, not the scratchpad or the harness. */
function productSources(): Record<string, string> {
	const sources: Record<string, string> = {};
	const visit = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			const name = relative(ROOT, path);
			if (entry.isDirectory()) { if (name !== 'design') visit(path); continue; }
			if (name.endsWith('.tsx') && name !== 'design.tsx' && name !== 'harness.tsx') sources[name] = readFileSync(path, 'utf8');
		}
	};
	visit(ROOT);
	return sources;
}

describe('design contract', () => {
	const sources = productSources();

	test('spacing sits on the 4px grid, or its departure is written down with a reason', () => {
		const found = findOffGridSpacing(sources).map((finding) => `${finding.file} ${finding.className}`).sort();
		const allowed = OFF_GRID_SPACING.map((entry) => `${entry.file} ${entry.className}`).sort();
		// Both directions: an unrecorded departure is an accident, and a recorded
		// one nothing uses any more is a stale excuse.
		expect(found).toEqual(allowed);
		for (const entry of OFF_GRID_SPACING) expect(entry.reason.length).toBeGreaterThan(20);
	});

	test('a screen writes no label of its own: a field is a FormField and a box beside its text is a CheckField', () => {
		const handWritten = (files: Record<string, string>): string[] => Object.entries(files).filter(([name, source]) => name.startsWith('screens/') && /<label\b/.test(source)).map(([name]) => name);
		expect(handWritten(sources)).toEqual([]);
		// The check reads what it claims to: a planted label is found, and the kit, which owns the element, is left alone.
		expect(handWritten({ 'screens/planted.tsx': '<label className="flex flex-col gap-1"><span>Name</span></label>', 'components/ui/card-layout.tsx': '<label data-slot="form-field" />' })).toEqual(['screens/planted.tsx']);
	});

	test('a screen writes no button of its own, or the one it writes is recorded with its reason', () => {
		const handWritten = (files: Record<string, string>): string[] => Object.entries(files).flatMap(([name, source]) => name.startsWith('screens/') ? [...source.matchAll(/<button\b/g)].map(() => name) : []).sort();
		// Both directions, as for spacing: an unrecorded button is an accident, a recorded one that is gone is a stale excuse.
		expect(handWritten(sources)).toEqual(RAW_BUTTONS.map((entry) => entry.file).sort());
		for (const entry of RAW_BUTTONS) expect(entry.reason.length).toBeGreaterThan(20);
		expect(handWritten({ 'screens/planted.tsx': '<button className={PRIMARY}>Save</button>', 'components/ui/button.tsx': '<button />' })).toEqual(['screens/planted.tsx']);
	});

	test('a column declares the kind of value it holds, and never the face that value wears', () => {
		/* Every `meta:` literal a screen writes for a column. The kit turns a kind
		 * into a face, a size, an alignment and a figure style; a class that does
		 * any of that by hand is the same value reading two ways in two tables. */
		const metas = (files: Record<string, string>): { file: string; meta: string }[] => Object.entries(files)
			.filter(([name]) => name.startsWith('screens/'))
			.flatMap(([file, source]) => [...source.matchAll(/meta:\s*\{[^{}]*\}/g)].map((match) => ({ file, meta: match[0] })));
		const VOICE = /font-mono|font-sans|type-data|type-eyebrow|tabular-nums|text-xs|text-right|text-end|text-left/;
		const dressed = (files: Record<string, string>): string[] => metas(files).filter((entry) => VOICE.test(entry.meta)).map((entry) => entry.file).sort();
		const kindless = (files: Record<string, string>): string[] => metas(files).filter((entry) => !entry.meta.includes('kind:')).map((entry) => entry.file).sort();

		expect(dressed(sources)).toEqual([]);
		expect(kindless(sources)).toEqual([]);
		expect(metas(sources).length).toBeGreaterThan(20);
		const planted = {
			'screens/planted.tsx': "{ id: 'cost', header: 'Cost', meta: { className: 'font-mono tabular-nums', align: 'end' } }",
			'screens/planted-kindless.tsx': "{ id: 'cost', header: 'Cost', meta: { hideBelow: 'sm' } }",
			'components/ui/data-table.tsx': "const KIND_CELL = { measure: 'font-mono tabular-nums' }",
		};
		expect(dressed(planted)).toEqual(['screens/planted.tsx']);
		expect(kindless(planted)).toEqual(['screens/planted-kindless.tsx', 'screens/planted.tsx']);
	});

	test('one chip says a shortcut, and the kit owns the element it is made of', () => {
		const handWritten = (files: Record<string, string>): string[] => Object.entries(files).filter(([name, source]) => name !== 'components/ui/key-chip.tsx' && /<kbd\b/.test(source)).map(([name]) => name).sort();
		expect(handWritten(sources)).toEqual([]);
		// A chip written by hand carries its own colour, and a colour of its own is the one thing this chip must not have: a row it sits on changes tint under the pointer and when it is current.
		expect(handWritten({ 'screens/planted.tsx': '<kbd className="rounded border bg-muted px-1 text-muted-foreground">⌥K</kbd>', 'components/ui/key-chip.tsx': '<kbd data-slot="key-chip" />' })).toEqual(['screens/planted.tsx']);
	});

	test('a screen writes no disclosure of its own: what opens is a CardDisclosure at page level and a Collapsible inside a card', () => {
		const handWritten = (files: Record<string, string>): string[] => Object.entries(files).filter(([name, source]) => name.startsWith('screens/') && /<(details|summary)\b/.test(source)).map(([name]) => name);
		expect(handWritten(sources)).toEqual([]);
		expect(handWritten({ 'screens/planted.tsx': '<details className="group/entry"><summary>more</summary></details>', 'components/ui/collapsible.tsx': '<details data-slot="collapsible" />' })).toEqual(['screens/planted.tsx']);
	});

	test('type stays on the scale and the ladder', () => {
		const usage = measureUsage(sources, []);
		expect(Object.keys(usage.text).filter((size) => size.startsWith('[') || size === '3xl' || size === '4xl')).toEqual([]);
		expect(Object.keys(usage.weights).filter((weight) => weight.startsWith('[') || weight === 'bold')).toEqual([]);
	});
});

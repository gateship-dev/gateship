import { describe, expect, test } from 'bun:test';

import { clampWidth, fitWidths, MIN_COLUMN_WIDTH, readSizing, renderedWidths } from '../../webui/src/components/ui/column-sizing.ts';

describe('column sizing', () => {
	test('a dragged width lands on whole pixels and never below a 32px control with its padding', () => {
		expect(clampWidth(120.6)).toBe(121);
		expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
		expect(clampWidth(-40)).toBe(MIN_COLUMN_WIDTH);
	});

	test('the primary column takes the frame\'s slack, and a table wider than its frame is as wide as its columns', () => {
		const sizing = { natural: { issue: 300, run: 80, state: 90 }, current: { issue: 300, run: 160, state: 90 }, dragged: 'run' };
		const roomy = renderedWidths(sizing, ['issue', 'run', 'state'], 'issue', 1000, 32);
		// 300 + 160 + 90 + the 32px expand column is 582: the other 418px go to the primary.
		expect(roomy.widths).toEqual({ issue: 718, run: 160, state: 90 });
		expect(roomy.total).toBe(1000);
		const tight = renderedWidths(sizing, ['issue', 'run', 'state'], 'issue', 400, 0);
		expect(tight.widths).toEqual({ issue: 300, run: 160, state: 90 });
		expect(tight.total).toBe(550);
		// A column shown after the widths were taken still gets one.
		expect(renderedWidths(sizing, ['issue', 'cost'], 'issue', 0).widths['cost']).toBe(120);
	});

	test('fit spreads the leftover over the flexible columns by their weight, and gives space back down to the floor', () => {
		const current = { issue: 300, run: 100, state: 100, actions: 40 };
		expect(fitWidths(current, ['issue', 'state'], 100)).toEqual({ issue: 375, run: 100, state: 125, actions: 40 });
		expect(fitWidths(current, ['issue', 'state'], -400)).toEqual({ issue: MIN_COLUMN_WIDTH, run: 100, state: MIN_COLUMN_WIDTH, actions: 40 });
		expect(fitWidths(current, [], 100)).toEqual(current);
	});

	test('stored widths are read back only when they are widths', () => {
		const stored: Record<string, string> = {};
		const runtime = globalThis as unknown as { localStorage?: unknown };
		const previous = runtime.localStorage;
		runtime.localStorage = { getItem: (key: string) => stored[key] ?? null, setItem: (key: string, value: string) => { stored[key] = value; }, removeItem: (key: string) => { delete stored[key]; } };
		try {
			stored['gship-table:runs:widths'] = JSON.stringify({ natural: { issue: 300 }, current: { issue: 360 }, dragged: 'issue' });
			expect(readSizing('runs')).toEqual({ natural: { issue: 300 }, current: { issue: 360 }, dragged: 'issue' });
			stored['gship-table:runs:widths'] = JSON.stringify({ natural: { issue: 'wide' }, current: {} });
			expect(readSizing('runs')).toBeNull();
			stored['gship-table:runs:widths'] = '{not json';
			expect(readSizing('runs')).toBeNull();
			expect(readSizing('never-stored')).toBeNull();
		} finally {
			runtime.localStorage = previous;
		}
	});
});

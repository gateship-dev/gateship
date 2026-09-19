import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { OFF_GRID_SPACING } from '../../webui/src/design/exceptions.ts';
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

	test('type stays on the scale and the ladder', () => {
		const usage = measureUsage(sources, []);
		expect(Object.keys(usage.text).filter((size) => size.startsWith('[') || size === '3xl' || size === '4xl')).toEqual([]);
		expect(Object.keys(usage.weights).filter((weight) => weight.startsWith('[') || weight === 'bold')).toEqual([]);
	});
});

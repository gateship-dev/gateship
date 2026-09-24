import { expect, test, type Page } from '@playwright/test';

const widths = [390, 768, 1440] as const;
const routes = [
	{ route: '/overview/runs', scenario: 'usual' },
	{ route: '/overview/queues', scenario: 'usual' },
	{ route: '/overview/insights', scenario: 'insights-long' },
] as const;
type BrowserElement = { clientWidth: number; scrollWidth: number; x: number; y: number; width: number; height: number; querySelector: (selector: string) => BrowserElement | null; getBoundingClientRect: () => BrowserElement; getAttribute: (name: string) => string | null };
type BrowserDocument = { documentElement: BrowserElement; body: BrowserElement; activeElement: BrowserElement | null };
type ViewportGeometry = { viewport: number; documentWidth: number; bodyWidth: number };

async function assertResponsiveOverflow(page: Page, width: number, geometry: ViewportGeometry): Promise<void> {
	if (width <= 768) {
		await page.goto(`/harness.html?frame=${width}&route=/overview/queues&scenario=dense&locale=pt-BR&theme=light`);
		await expect(page.locator('[data-harness=gateship-ui]')).toBeVisible();
		expect(await page.evaluate(() => (document as unknown as BrowserDocument).documentElement.scrollWidth)).toBeLessThanOrEqual(width);
		return;
	}
	expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
	expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewport);
}

test.describe('@smoke Central invariants', () => {
	// The harness is served by Vite's dev server, which compiles modules on each worker's first load. Run in parallel on a local container,
	// the nine-load route walk reaches 26 to 30s against the default 30s: a limit on time, not on anything the smoke asserts.
	test.describe.configure({ timeout: 60_000 });
	test('navigates the real routes and keeps the viewport free of external overflow', async ({ page }) => {
		for (const width of widths) {
			await page.setViewportSize({ width, height: 900 });
			for (const { route, scenario } of routes) {
				await page.goto(`/harness.html?frame=${width}&route=${route}&scenario=${scenario}&locale=pt-BR&theme=light`);
				await expect(page.locator('[data-harness=gateship-ui]')).toBeVisible();
				await expect(page.locator('[data-harness=gateship-ui]')).toHaveAttribute('data-scenario', scenario);
			}
			const geometry = await page.evaluate(() => {
				const browserDocument = document as unknown as BrowserDocument;
				return {
				viewport: browserDocument.documentElement.clientWidth,
				documentWidth: browserDocument.documentElement.scrollWidth,
				bodyWidth: browserDocument.body.scrollWidth,
				};
			});
			await assertResponsiveOverflow(page, width, geometry);
		}
	});

	test('the frame check reads what it claims: a loose control and a pager off the text edge are both found', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/harness.html?frame=1440&route=/overview/runs&scenario=dense&locale=en-US&theme=light');
		await expect(page.locator('[data-slot=data-table]')).toBeVisible();
		type Report = { looseTableParts: string[]; misalignedTables: { edges: number[] }[] };
		const measure = (): Promise<Report> => page.evaluate(() => (globalThis as unknown as { gateshipMeasureDesign: () => Report }).gateshipMeasureDesign());
		const clean = await measure();
		expect(clean.looseTableParts).toEqual([]);
		expect(clean.misalignedTables).toEqual([]);
		// Planted: a toolbar written beside the table instead of in it, and the pager pushed 7px off the cells' text, the offset the old layout had.
		await page.evaluate(() => {
			const browser = globalThis as unknown as { document: { querySelector: (selector: string) => { parentElement: { insertBefore: (node: unknown, before: unknown) => void }; style: { paddingLeft: string } } | null; createElement: (tag: string) => { setAttribute: (name: string, value: string) => void; textContent: string } } };
			const table = browser.document.querySelector('[data-slot=data-table]')!;
			const loose = browser.document.createElement('div');
			loose.setAttribute('data-slot', 'data-table-toolbar');
			loose.textContent = 'loose';
			table.parentElement.insertBefore(loose, table);
			browser.document.querySelector('[data-slot=data-table-pagination]')!.style.paddingLeft = '23px';
		});
		const planted = await measure();
		expect(planted.looseTableParts).toEqual(['data-table-toolbar']);
		expect(planted.misalignedTables.length).toBe(1);
	});

	test('on a touch screen the overflow check skips a control\'s hit area and still finds its spilling text', async ({ browser }) => {
		const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
		const page = await context.newPage();
		await page.goto('/harness.html?frame=390&route=/overview/runs&scenario=dense&locale=en-US&theme=light');
		await expect(page.locator('[data-slot=data-table]')).toBeVisible();
		expect(await page.evaluate(() => (globalThis as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia('(pointer: coarse)').matches)).toBe(true);
		const overflow = (): Promise<string[]> => page.evaluate(() => (globalThis as unknown as { gateshipMeasureDesign: () => { overflow: { slot: string }[] } }).gateshipMeasureDesign().overflow.map((finding) => finding.slot));
		// Each row's 24px menu button grows a 44px touch target under a coarse pointer: a hit area, not content.
		expect(await overflow()).toEqual([]);
		// Planted: a label that does not fit the same button.
		await page.evaluate(() => {
			const browser = globalThis as unknown as { document: { querySelector: (selector: string) => { append: (node: unknown) => void } | null; createElement: (tag: string) => { textContent: string } } };
			const label = browser.document.createElement('span');
			label.textContent = 'a label too long';
			browser.document.querySelector('td [data-slot=dropdown-menu-trigger]')!.append(label);
		});
		expect(await overflow()).toContain('dropdown-menu-trigger');
		await context.close();
	});

	test('a column takes the width it is dragged to, stores it, pins the name while the rows scroll, and gives it back', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		// The harness keeps storage in memory for each load, so every run starts from the browser's own layout.
		await page.goto('/harness.html?frame=1440&route=/overview/runs&scenario=dense&locale=en-US&theme=light');
		const width = (id: string): Promise<number> => page.locator(`th[data-column-id="${id}"]`).evaluate((head) => Math.round((head as unknown as { getBoundingClientRect: () => { width: number } }).getBoundingClientRect().width));
		const grip = page.locator('th[data-column-id="run"] [data-slot=column-resize-grip]');
		await expect(grip).toHaveAttribute('role', 'separator');
		const before = await width('run');
		const box = (await grip.boundingBox())!;
		// Drag the Run column 600px wider: past what the frame has, so the rows must scroll inside it.
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + 600, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
		const dragged = await width('run');
		expect(dragged).toBeGreaterThan(before + 500);
		const scroll = await page.locator('[data-slot=data-table] [data-slot=table-container]').evaluate((container) => { const box = container as unknown as { scrollWidth: number; clientWidth: number; scrollLeft: number }; box.scrollLeft = 400; return { overflow: box.scrollWidth > box.clientWidth, scrolled: box.scrollLeft }; });
		expect(scroll.overflow).toBe(true);
		expect(scroll.scrolled).toBeGreaterThan(0);
		// The name of the row stays at the start, the row's menu at the end, while everything between them passes under.
		await expect(page.locator('th[data-column-id="issueId"]')).toHaveClass(/sticky/);
		await expect(page.locator('th[data-column-id="actions"]')).toHaveClass(/sticky/);
		// The page itself never scrolls sideways: only the rows do, inside their frame.
		expect(await page.evaluate(() => { const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document.documentElement; return root.scrollWidth - root.clientWidth; })).toBe(0);
		// The width is this browser's: the drag is written under the table's own key, the one the next visit reads.
		const stored = await page.evaluate(() => JSON.parse((globalThis as unknown as { localStorage: { getItem: (key: string) => string | null } }).localStorage.getItem('gship-table:runs:widths') ?? 'null') as { current: Record<string, number>; dragged: string } | null);
		expect(stored?.dragged).toBe('run');
		expect(stored?.current['run']).toBe(dragged);
		// The keyboard moves the same grip: right by 8, with shift by 32.
		await page.locator('th[data-column-id="run"] [data-slot=column-resize-grip]').focus();
		await page.keyboard.press('ArrowRight');
		expect(await width('run')).toBe(dragged + 8);
		// Escape during a drag puts the width back where the drag found it.
		const again = (await page.locator('th[data-column-id="run"] [data-slot=column-resize-grip]').boundingBox())!;
		await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2);
		await page.mouse.down();
		await page.mouse.move(again.x - 200, again.y + again.height / 2, { steps: 4 });
		await page.keyboard.press('Escape');
		await page.mouse.up();
		expect(await width('run')).toBe(dragged + 8);
		// Reset from the view menu returns the browser's own layout, where nothing scrolls.
		await page.getByRole('button', { name: 'Columns' }).click();
		await page.getByRole('menuitem', { name: 'Reset widths' }).click();
		expect(await width('run')).toBe(before);
		expect(await page.locator('[data-slot=data-table] [data-slot=table-container]').evaluate((container) => { const box = container as unknown as { scrollWidth: number; clientWidth: number }; return box.scrollWidth - box.clientWidth; })).toBeLessThanOrEqual(1);
	});

	test('covers focus, sidebar geometry, menus, sorting, pagination and internal table scrolling', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto('/harness.html?frame=1440&route=/overview/runs&scenario=dense&locale=en-US&theme=dark');
		const toggle = page.locator('[data-slot=sidebar-toggle]');
		await toggle.focus();
		const expanded = await page.locator('[data-sidebar-id]').evaluateAll((nodes) => nodes.map((node) => {
			const element = node as unknown as BrowserElement;
			const icon = element.querySelector('svg')?.getBoundingClientRect();
			const row = element.getBoundingClientRect();
			return [row.y, row.height, icon ? icon.x + icon.width / 2 : 0, icon ? icon.y + icon.height / 2 : 0];
		}));
		await toggle.click();
		expect(await toggle.getAttribute('aria-expanded')).toBe('false');
		expect(await page.evaluate(() => (document as unknown as BrowserDocument).activeElement?.getAttribute('data-slot'))).toBe('sidebar-toggle');
		const collapsed = await page.locator('[data-sidebar-id]').evaluateAll((nodes) => nodes.map((node) => {
			const element = node as unknown as BrowserElement;
			const icon = element.querySelector('svg')?.getBoundingClientRect();
			const row = element.getBoundingClientRect();
			return [row.y, row.height, icon ? icon.x + icon.width / 2 : 0, icon ? icon.y + icon.height / 2 : 0];
		}));
		expect(collapsed).toHaveLength(expanded.length);
		for (let index = 0; index < expanded.length; index += 1) for (let part = 0; part < 4; part += 1) expect(Math.abs(expanded[index]![part]! - collapsed[index]![part]!)).toBeLessThanOrEqual(1);

		await toggle.click();
		const columnMenu = page.locator('[data-slot=data-table-view-options]');
		await page.getByRole('button', { name: 'Columns', exact: true }).click();
		await expect(columnMenu.locator('[role=menuitemcheckbox]').first()).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(columnMenu).toBeHidden();
		// A header opens its column menu; sorting is an item in it.
		await page.locator('[data-slot=data-table] th button').first().click();
		await page.getByRole('menuitem').first().click();
		await expect(page.locator('tbody tr:not([data-state])').first()).toBeVisible();
		await page.getByRole('button', { name: 'Next page' }).click();
		await expect(page.locator('span[aria-live=polite]:not(.sr-only)')).toContainText('21–40');
		const table = page.locator('[data-slot=data-table]').first();
		expect(await table.evaluate((node) => { const element = node as unknown as BrowserElement; return element.scrollWidth >= element.clientWidth; })).toBe(true);

		await page.goto('/harness.html?frame=1440&route=/overview&scenario=tooltip-open&locale=en-US&theme=light');
		await page.getByRole('button', { name: 'tooltip-open', exact: true }).click();
		await page.locator('[data-slot=global-navigation] a[aria-label]').first().hover();
		await expect(page.locator('[data-slot=tooltip]:visible')).toHaveCount(1);
		const switcher = page.locator('[data-slot=project-switcher]');
		await switcher.click();
		await expect(page.locator('[data-slot=tooltip]:visible')).toHaveCount(0);
		await expect(page.getByRole('menu')).toBeVisible();

		// GSHIP-874: Tooltip.Trigger and Menu.Trigger share this one trigger node,
		// so both write the same `data-popup-open` attribute onto it. Close the
		// menu, then hover the trigger with no click: the tooltip alone sets the
		// attribute again, with the menu genuinely closed. A diagnosis reading
		// that shared attribute must never read it, on its own, as "the menu is
		// open" -- this is the deliberate baseline, the same hover highlight any
		// other trigger gets.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toBeHidden();
		await page.mouse.move(0, 0);
		await switcher.hover();
		await expect(switcher).toHaveAttribute('data-popup-open', '');
		await expect(page.getByRole('menu')).toBeHidden();
		await expect(page.locator('[data-slot=tooltip]:visible')).toHaveCount(1);
	});
});

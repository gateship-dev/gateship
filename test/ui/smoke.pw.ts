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
		const columnMenu = page.locator('details[data-slot=data-table-column-visibility]');
		await columnMenu.locator('summary').click();
		await expect(columnMenu.locator('input').first()).toBeVisible();
		await columnMenu.locator('summary').click();
		await expect(columnMenu.locator('input').first()).toBeHidden();
		await page.locator('[data-slot=data-table] th button').first().click();
		await expect(page.locator('tbody tr').first()).toBeVisible();
		await page.getByRole('button', { name: 'Next page' }).click();
		await expect(page.locator('span[aria-live=polite]:not(.sr-only)')).toContainText('21–40');
		const table = page.locator('[data-slot=data-table]').first();
		expect(await table.evaluate((node) => { const element = node as unknown as BrowserElement; return element.scrollWidth >= element.clientWidth; })).toBe(true);

		await page.goto('/harness.html?frame=1440&route=/overview&scenario=tooltip-open&locale=en-US&theme=light');
		await page.getByRole('button', { name: 'tooltip-open', exact: true }).click();
		await page.locator('[data-slot=global-navigation] a[aria-label]').first().hover();
		await expect(page.locator('[data-slot=sidebar-tooltip]:visible')).toHaveCount(1);
		await page.locator('[data-slot=project-switcher]').click();
		await expect(page.locator('[data-slot=sidebar-tooltip]:visible')).toHaveCount(0);
		await expect(page.getByRole('menu')).toBeVisible();
	});
});

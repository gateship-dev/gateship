import { expect, test } from '@playwright/test';

const cases = [
	['overview', '/overview', 'usual'],
	['runs', '/overview/runs', 'dense'],
	['queues', '/overview/queues', 'dense'],
	['insights', '/overview/insights', 'insights-long'],
] as const;

for (const [name, route, scenario] of cases) {
	for (const width of [390, 1440] as const) for (const locale of ['pt-BR', 'en-US'] as const) for (const theme of ['light', 'dark'] as const) {
		test(`@visual ${name} ${width} ${locale} ${theme}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 900 });
			await page.goto(`/harness.html?frame=${width}&route=${route}&scenario=${scenario}&locale=${locale}&theme=${theme}&motion=reduced`);
			await page.evaluate(() => (document as unknown as { fonts: { ready: Promise<unknown> } }).fonts.ready);
			await page.waitForTimeout(250);
			// A baseline of bare HTML compares equal to itself forever. The page
			// must carry the product's stylesheet before its picture means anything.
			const styled = await page.evaluate(() => {
				const browser = globalThis as unknown as { document: { styleSheets: { length: number }; body: object }; getComputedStyle: (node: object) => { fontFamily: string } };
				return { sheets: browser.document.styleSheets.length, font: browser.getComputedStyle(browser.document.body).fontFamily };
			});
			expect(styled.sheets).toBeGreaterThan(0);
			expect(styled.font).toContain('sans-serif');
			// The contract's measurable half, read off the page about to be
			// photographed. A picture only proves the page still looks like itself;
			// these prove it was right to begin with.
			const report = await page.evaluate(() => (globalThis as unknown as { gateshipMeasureDesign: () => { lowContrast: unknown[]; overflow: unknown[]; unevenToolbars: unknown[]; pageOverflow: number; fontSizes: string[]; textColors: string[] } | null }).gateshipMeasureDesign());
			expect(report).not.toBeNull();
			expect(report?.lowContrast, 'text below WCAG AA').toEqual([]);
			expect(report?.overflow, 'content spilling out of its box').toEqual([]);
			expect(report?.unevenToolbars, 'toolbar controls of different heights').toEqual([]);
			expect(report?.pageOverflow, 'horizontal page scroll').toBe(0);
			expect(report?.fontSizes.length, 'distinct font sizes on one screen').toBeLessThanOrEqual(6);
			expect(report?.textColors.length, 'distinct text colours on one screen').toBeLessThanOrEqual(12);
			// The product, not the harness controls above it: at 390px those fill the
			// viewport, and being sticky they would sit over an element screenshot too.
			await page.addStyleTag({ content: '[data-harness=gateship-ui] > :not([data-harness-app]) { display: none !important; }' });
			await expect(page).toHaveScreenshot(`${name}-${width}-${locale}-${theme}.png`);
		});
	}
}

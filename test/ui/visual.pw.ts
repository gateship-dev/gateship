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
			await expect(page).toHaveScreenshot(`${name}-${width}-${locale}-${theme}.png`);
		});
	}
}

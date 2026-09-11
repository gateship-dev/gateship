import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './test/ui',
	testMatch: '**/*.pw.ts',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		['list'],
		['html', { outputFolder: 'test-results/ui-report', open: 'never' }],
		['json', { outputFile: 'test-results/ui-results.json' }],
	],
	outputDir: 'test-results/ui',
	snapshotDir: 'test/ui/__snapshots__',
	snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',
	expect: {
		toHaveScreenshot: {
			animations: 'disabled',
			caret: 'hide',
			maxDiffPixels: 0,
			threshold: 0,
		},
	},
	use: {
		baseURL: 'http://127.0.0.1:4174',
		browserName: 'chromium',
		colorScheme: 'light',
		locale: 'pt-BR',
		timezoneId: 'UTC',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		...devices['Desktop Chrome'],
	},
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	webServer: {
		command: 'bunx vite webui --host 127.0.0.1 --port 4174',
		url: 'http://127.0.0.1:4174/harness.html?frame=390',
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});

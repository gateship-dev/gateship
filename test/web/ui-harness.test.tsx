import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Harness } from '../../webui/src/harness.tsx';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

describe('development UI harness', () => {
	test('renders the real Central routes and deterministic fixture controls', async () => {
		const originalDate = globalThis.Date;
		const html = renderToStaticMarkup(<Harness />);
		expect(globalThis.Date).toBe(originalDate);
		expect(html).toContain('data-harness="gateship-ui-viewport-picker"');
		expect(html).toContain('src="/harness.html?frame=1440"');
		expect(html).not.toContain('style="width:');
		for (const value of ['390 px', '768 px', '1440 px']) expect(html).toContain(value);
		const source = await Bun.file(new URL('../../webui/src/harness.tsx', import.meta.url)).text();
		for (const value of ['visible-catalog', 'refreshing', 'dense', 'unavailable', 'FIXED_NOW', 'Harness fixture route not found.']) expect(source).toContain(value);
	});

	test('exercises the real browser viewport at every supported width', async () => {
		const server = Bun.spawn(['bunx', 'vite', 'webui', '--host', '127.0.0.1', '--port', '4174'], { stdout: 'pipe', stderr: 'pipe' });
		const cliDir = createTestTmpdir('gship-ui-harness-playwright-');
		const statusBefore = new TextDecoder().decode(Bun.spawnSync(['git', 'status', '--short'], { stdout: 'pipe', stderr: 'pipe' }).stdout);
		const cli = async (...args: string[]): Promise<string> => {
			const process = Bun.spawn(['playwright-cli', ...args], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' });
			return await new Response(process.stdout).text();
		};
		try {
			for (let attempt = 0; attempt < 20; attempt++) {
				try { if ((await fetch('http://127.0.0.1:4174/harness.html')).ok) break; } catch { /* server is starting */ }
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			await cli('open', 'http://127.0.0.1:4174/harness.html?frame=390');
			const result = await cli('run-code', `async page => {
				const widths = [390, 768, 1440];
				const observed = [];
				const matrix = [];
				for (const locale of ['pt-BR', 'en-US']) for (const theme of ['light', 'dark']) for (const width of widths) {
					await page.setViewportSize({ width, height: 800 });
					await page.goto('http://127.0.0.1:4174/harness.html?frame=' + width);
					if (locale === 'en-US') await page.getByRole('button', { name: 'en-US', exact: true }).click({ timeout: 1000 });
					if (theme === 'dark') await page.getByRole('button', { name: 'dark', exact: true }).click({ timeout: 1000 });
					matrix.push([locale, theme, width, await page.evaluate(() => [document.documentElement.lang, document.documentElement.classList.contains('dark'), window.innerWidth])]);
					if (locale === 'pt-BR' && theme === 'light') observed.push([page.viewportSize().width, await page.evaluate(() => window.innerWidth), await page.evaluate(() => Date.now())]);
				}
				await page.goto('http://127.0.0.1:4174/harness.html?frame=1440&scenario=long');
				await page.getByRole('button', { name: 'Central/runs' }).click({ timeout: 1000 });
				const long = (await page.locator('body').innerText()).includes('deliberately long');
				await page.goto('http://127.0.0.1:4174/harness.html?frame=1440');
				await page.getByRole('button', { name: 'Central/runs' }).click({ timeout: 1000 });
				await page.locator('tbody tr').first().waitFor({ state: 'visible' });
				const usualRuns = await page.locator('tbody tr').count();
				await page.getByRole('button', { name: 'empty', exact: true }).click({ timeout: 1000 });
				await page.locator('tbody tr').first().waitFor({ state: 'detached' });
				const emptyRuns = await page.locator('tbody tr').count();
				await page.getByRole('button', { name: 'dense', exact: true }).click({ timeout: 1000 });
				await page.locator('tbody tr').first().waitFor({ state: 'visible' });
				const denseRows = await page.locator('tbody tr').count();
				const catalog = await page.locator('[data-fixture-catalog=visible-catalog]').innerText();
				const firstPageIds = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.textContent ?? ''));
				const firstPageLabel = await page.locator('span[aria-live=polite]:not(.sr-only)').innerText();
				await page.getByRole('button', { name: 'Próxima' }).click({ timeout: 1000 });
				await page.waitForFunction(() => document.querySelector('span[aria-live=polite]:not(.sr-only)')?.textContent?.includes('21–40'));
				const secondPageIds = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.textContent ?? ''));
				const secondPageLabel = await page.locator('span[aria-live=polite]:not(.sr-only)').innerText();
				const previousEnabled = await page.getByRole('button', { name: 'Anterior' }).isEnabled();
				await page.getByRole('button', { name: 'Anterior' }).click({ timeout: 1000 });
				await page.waitForFunction(() => document.querySelector('span[aria-live=polite]:not(.sr-only)')?.textContent?.includes('1–20'));
				const returnedPageIds = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.textContent ?? ''));
				await page.goto('http://127.0.0.1:4174/harness.html?frame=1440&route=/overview/runs&scenario=refreshing');
				await page.locator('tbody tr').first().waitFor({ state: 'visible' });
				const refreshed = await page.locator('body').innerText();
				const pagination = firstPageLabel.includes('1–20') && secondPageLabel.includes('21–40') && firstPageIds.join('|') !== secondPageIds.join('|') && firstPageIds.join('|') === returnedPageIds.join('|') && previousEnabled;
				const pending = await page.locator('[data-harness=gateship-ui]').getAttribute('data-scenario') === 'refreshing';
				const sidebarRegression = [];
				for (const locale of ['pt-BR', 'en-US']) for (const theme of ['light', 'dark']) {
					await page.goto('http://127.0.0.1:4174/harness.html?frame=1440&locale=' + locale + '&theme=' + theme);
					const root = page.locator('[data-harness=gateship-ui]');
					const toggle = page.locator('[data-slot=sidebar-toggle]');
					const records = async () => await page.locator('[data-sidebar-id]').evaluateAll(nodes => nodes.map(node => { const row = node.getBoundingClientRect(); const icon = node.querySelector('svg')?.getBoundingClientRect(); return [node.getAttribute('data-sidebar-id'), row.y + window.scrollY, row.height, icon ? icon.x + icon.width / 2 : null, icon ? icon.y + window.scrollY + icon.height / 2 : null, icon?.width ?? null, icon?.height ?? null]; }));
					const expanded = await records();
					await toggle.focus();
					await toggle.click();
					const collapsed = await records();
					const collapsedState = (await toggle.getAttribute('aria-expanded')) === 'false';
					const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-slot'));
					await toggle.click();
					const restored = await records();
					const stable = expanded.length === collapsed.length && expanded.length === restored.length && expanded.every((value, index) => { const compact = collapsed[index]; const after = restored[index]; return value[0] === compact[0] && value[0] === after[0] && value.slice(1).every((part, offset) => typeof part === 'number' && typeof compact[offset + 1] === 'number' && Math.abs(part - compact[offset + 1]) <= 1 && typeof after[offset + 1] === 'number' && Math.abs(part - after[offset + 1]) <= 1); });
					sidebarRegression.push(collapsedState && (await toggle.getAttribute('aria-expanded')) === 'true' && focused === 'sidebar-toggle' && root.isVisible() && stable);
				}
				await page.goto('http://127.0.0.1:4174/harness.html?frame=1440');
				const scenarioStates = [];
				for (const state of ['sidebar-expanded', 'sidebar-collapsed', 'tooltip-open', 'selector-open', 'usual', 'selector-open']) {
					if (state === 'usual' && await page.getByRole('menu').count() > 0) {
						await page.keyboard.press('Escape');
						await page.getByRole('menu').waitFor({ state: 'detached' });
						await page.waitForFunction(() => document.querySelector('[data-slot=project-switcher]')?.getAttribute('aria-expanded') !== 'true');
					}
					await page.getByRole('button', { name: state, exact: true }).click({ timeout: 1000 });
					if (state === 'tooltip-open') { await page.locator('[data-slot=global-navigation] a[aria-label]').first().hover(); await page.locator('[data-slot=sidebar-tooltip]:visible').first().waitFor({ state: 'visible' }); }
					if (state === 'selector-open') { await page.getByRole('menu').waitFor({ state: 'visible' }); await page.getByRole('menuitem').first().focus(); }
					scenarioStates.push([state, await page.locator('[data-slot=sidebar-toggle]').getAttribute('aria-expanded'), await page.locator('[data-slot=sidebar-tooltip]:visible').count(), await page.getByRole('menuitem').count()]);
				}
				const queueStates = {};
				for (const state of ['usual', 'attention', 'empty', 'unavailable', 'error']) {
					await page.goto('http://127.0.0.1:4174/harness.html?frame=1440&scenario=' + state);
					await page.getByRole('button', { name: 'Central/queues' }).click({ timeout: 1000 });
					queueStates[state] = (await page.locator('body').innerText()).length > 0;
				}
				return JSON.stringify({ observed, matrix, usualRuns, emptyRuns, denseRows, catalog, pagination, refreshed: refreshed.includes('-r'), long, pending, sidebarRegression: sidebarRegression.every(Boolean), scenarioStates, collapsed: scenarioStates[1]?.[1], focus: sidebarRegression.every(Boolean) ? 'sidebar-toggle' : null, tooltipOpen: scenarioStates[2]?.[2] === 1, selectorOpen: (scenarioStates[3]?.[3] ?? 0) > 0, queueStates });
			}`);
			const normalized = result.replaceAll('\\', '');
			expect(normalized).toContain('[[390,390,1789041600000],[768,768,1789041600000],[1440,1440,1789041600000]]');
			expect(normalized).toContain('"matrix"');
			expect(normalized).toContain('"en-US","dark",1440');
			expect(normalized).toContain('"denseRows":20');
			expect(normalized).toContain('"usualRuns":1');
			expect(normalized).toContain('"emptyRuns":0');
			expect(normalized).toContain('central.runs');
			expect(normalized).toContain('"pagination":true');
			expect(normalized).toContain('"pending":true');
			expect(normalized).toContain('"refreshed":true');
			expect(normalized).toContain('"long":true');
			expect(normalized).toContain('"sidebarRegression":true');
			expect(normalized).toContain('"scenarioStates":[["sidebar-expanded","true"');
			expect(normalized).toContain('["sidebar-collapsed","false"');
			expect(normalized).toContain('["tooltip-open","false",1');
			expect(normalized).toContain('"focus":"sidebar-toggle"');
			expect(normalized).toContain('"tooltipOpen":true');
			expect(normalized).toContain('"selectorOpen":true');
			expect(normalized).toContain('"queueStates":{"usual":true,"attention":true,"empty":true,"unavailable":true,"error":true}');
		} finally {
			await cli('close');
			server.kill();
			rmSync(cliDir, { recursive: true, force: true });
			const statusAfter = new TextDecoder().decode(Bun.spawnSync(['git', 'status', '--short'], { stdout: 'pipe', stderr: 'pipe' }).stdout);
			expect(statusAfter).toBe(statusBefore);
		}
	}, 60_000);

	test('keeps the harness out of the production HTML input', async () => {
		const distDir = createTestTmpdir('gship-ui-harness-build-');
		const result = Bun.spawnSync(['bun', 'run', 'build:ui', '--', '--outDir', distDir, '--emptyOutDir'], {
			cwd: resolve(import.meta.dir, '../..'),
			env: { ...process.env, NODE_ENV: 'production' },
			stdout: 'pipe',
			stderr: 'pipe',
		});
		try {
			expect(result.exitCode).toBe(0);
			const files: string[] = [];
			const visit = (directory: string): void => {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					const path = join(directory, entry.name);
					if (entry.isDirectory()) visit(path);
					else files.push(path);
				}
			};
			visit(distDir);
			const markers = ['data-harness="gateship-ui"', 'central-real-routes-v2', 'Gateship UI harness', 'harness-project', 'GSHIP-855'];
			for (const file of files) {
				expect(file.endsWith('harness.html')).toBe(false);
				const content = readFileSync(file).toString();
				for (const marker of markers) expect(content).not.toContain(marker);
			}
		} finally {
			rmSync(distDir, { recursive: true, force: true });
		}
	});

	test('restores direct URL fixture settings and sidebar geometry', async () => {
		const server = Bun.spawn(['bunx', 'vite', 'webui', '--host', '127.0.0.1', '--port', '4175'], { stdout: 'pipe', stderr: 'pipe' });
		const cliDir = createTestTmpdir('gship-ui-harness-direct-');
		const cli = async (...args: string[]): Promise<string> => {
			const process = Bun.spawn(['playwright-cli', ...args], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' });
			return await new Response(process.stdout).text();
		};
		try {
			for (let attempt = 0; attempt < 20; attempt++) {
				try { if ((await fetch('http://127.0.0.1:4175/harness.html')).ok) break; } catch { /* server is starting */ }
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			await cli('open', 'http://127.0.0.1:4175/harness.html?frame=1440&scenario=dense&locale=en-US&theme=dark');
			const result = await cli('run-code', "async page => { const direct = async () => [await page.locator('[data-harness=gateship-ui]').getAttribute('data-scenario'), await page.locator('[data-harness=gateship-ui]').getAttribute('data-locale'), await page.locator('[data-harness=gateship-ui]').getAttribute('data-theme'), await page.evaluate(() => [document.documentElement.lang, document.documentElement.classList.contains('dark')])]; const directScenarios = []; for (const scenario of ['empty', 'dense', 'error']) { await page.goto(`http://127.0.0.1:4175/harness.html?frame=1440&scenario=${scenario}&locale=en-US&theme=dark`); await page.waitForTimeout(100); directScenarios.push(await direct()); } await page.goto('http://127.0.0.1:4175/harness.html?frame=1440&scenario=dense&locale=en-US&theme=dark'); await page.waitForTimeout(100); const restored = await direct(); const records = async () => await page.locator('[data-sidebar-id]').evaluateAll(nodes => nodes.map(node => { const row = node.getBoundingClientRect(); const icon = node.querySelector('svg')?.getBoundingClientRect(); return [node.getAttribute('data-sidebar-id'), row.y + window.scrollY, row.height, icon ? icon.x + icon.width / 2 : null, icon ? icon.y + window.scrollY + icon.height / 2 : null, icon?.width ?? null, icon?.height ?? null]; })); const before = await records(); const toggle = page.locator('[data-slot=sidebar-toggle]'); await toggle.focus(); await toggle.click(); await page.waitForTimeout(75); const collapsed = await records(); await toggle.click(); await page.waitForTimeout(250); const after = await records(); const sidebarRegression = before.length === collapsed.length && before.length === after.length && before.every((value, index) => { const compact = collapsed[index]; const restoredValue = after[index]; return value[0] === compact[0] && value[0] === restoredValue[0] && value.slice(1, 3).every((part, offset) => typeof part === 'number' && typeof compact[offset + 1] === 'number' && Math.abs(part - compact[offset + 1]) <= 1) && value.slice(4).every((part, offset) => typeof part === 'number' && typeof compact[offset + 4] === 'number' && Math.abs(part - compact[offset + 4]) <= 1) && value.slice(1).every((part, offset) => typeof part === 'number' && typeof restoredValue[offset + 1] === 'number' && Math.abs(part - restoredValue[offset + 1]) <= 1); }); return JSON.stringify({ directScenarios, restored, sidebarRegression }); }");
			const normalized = result.replaceAll('\\', '');
		expect(normalized).toContain('"directScenarios":[["empty","en-US","dark",["en-US",true]],["dense","en-US","dark",["en-US",true]],["error","en-US","dark",["en-US",true]]]');
		expect(normalized).toContain('"restored":["dense","en-US","dark",["en-US",true]]');
			expect(normalized).toContain('"sidebarRegression":true');
		} finally {
			await cli('close');
			server.kill();
			rmSync(cliDir, { recursive: true, force: true });
		}
	});

	test('applies dense run filters before pagination', async () => {
		const server = Bun.spawn(['bunx', 'vite', 'webui', '--host', '127.0.0.1', '--port', '4177'], { stdout: 'pipe', stderr: 'pipe' });
		const cliDir = createTestTmpdir('gship-ui-harness-filters-');
		const cli = async (...args: string[]): Promise<string> => { const process = Bun.spawn(['playwright-cli', ...args], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' }); return await new Response(process.stdout).text(); };
		try {
			for (let attempt = 0; attempt < 20; attempt++) { try { if ((await fetch('http://127.0.0.1:4177/harness.html')).ok) break; } catch { /* server is starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
			await cli('open', 'http://127.0.0.1:4177/harness.html?frame=1440&scenario=dense');
			const result = await cli('run-code', "async page => { await page.getByRole('button', { name: 'Central/runs' }).click(); await page.waitForTimeout(150); const read = async () => { await page.waitForTimeout(500); return [await page.locator('tbody tr').count(), await page.locator('span[aria-live=polite]:not(.sr-only)').innerText(), await page.evaluate(() => window.location.search)]; }; const usual = await read(); await page.getByRole('textbox').fill('GSHIP-906'); await page.getByLabel('Estado').selectOption('done'); await page.getByLabel('Provider').selectOption('codex'); await page.getByLabel('Período').selectOption('7d'); const filtered = await read(); await page.goto('http://127.0.0.1:4177/harness.html?frame=1440&scenario=dense&projectId=missing'); await page.getByRole('button', { name: 'Central/runs' }).click(); const projectFiltered = await read(); return JSON.stringify({ usual, filtered, projectFiltered }); }");
			const normalized = result.replaceAll('\\', '');
			expect(normalized).toContain('"filtered":[1');
			expect(normalized).toContain('search=GSHIP-906');
			expect(normalized).toContain('state=done');
			expect(normalized).toContain('providerId=codex');
			expect(normalized).toContain('period=7d');
			expect(normalized).toContain('"projectFiltered":[0');
		} finally { await cli('close'); server.kill(); rmSync(cliDir, { recursive: true, force: true }); }
	});

	test('exercises reduced motion in real Central controls', async () => {
		const server = Bun.spawn(['bunx', 'vite', 'webui', '--host', '127.0.0.1', '--port', '4178'], { stdout: 'pipe', stderr: 'pipe' });
		const cliDir = createTestTmpdir('gship-ui-harness-motion-');
		const cli = async (...args: string[]): Promise<string> => { const process = Bun.spawn(['playwright-cli', ...args], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' }); return await new Response(process.stdout).text(); };
		try {
			for (let attempt = 0; attempt < 20; attempt++) { try { if ((await fetch('http://127.0.0.1:4178/harness.html')).ok) break; } catch { /* server is starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
			await cli('open', 'about:blank');
			const result = await cli('run-code', "async page => { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('http://127.0.0.1:4178/harness.html?frame=1440&scenario=attention&motion=reduced'); await page.waitForTimeout(150); const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches); const motion = await page.locator('[data-harness=gateship-ui]').getAttribute('data-motion'); const toggle = page.locator('[data-slot=sidebar-toggle]'); await toggle.click(); await page.waitForTimeout(50); const sidebar = await page.locator('[data-slot=sidebar]').evaluate(node => getComputedStyle(node).transitionDuration); await page.locator('[data-slot=project-switcher]').click(); await page.waitForTimeout(100); const popup = await page.locator('[role=menu]:visible').evaluate(node => [getComputedStyle(node).animationName, getComputedStyle(node).transitionDuration]); const pulse = await page.locator('[data-slot=sidebar-attention]').count() === 0 ? 'none' : await page.locator('[data-slot=sidebar-attention]').evaluate(node => getComputedStyle(node).animationName); return JSON.stringify({ reduced, motion, sidebar, popup, pulse }); }");
			const normalized = result.replaceAll('\\', '');
			expect(normalized).toContain('"reduced":true');
			expect(normalized).toContain('"motion":"reduced"');
			expect(normalized).toContain('"sidebar":"0s"');
			expect(normalized).toContain('"popup":["none","0s"]');
			expect(normalized).toContain('"pulse":"none"');
		} finally { await cli('close'); server.kill(); rmSync(cliDir, { recursive: true, force: true }); }
	});

	test('restores Central route and motion settings from the URL', async () => {
		const server = Bun.spawn(['bunx', 'vite', 'webui', '--host', '127.0.0.1', '--port', '4179'], { stdout: 'pipe', stderr: 'pipe' });
		const cliDir = createTestTmpdir('gship-ui-harness-route-');
		const cli = async (...args: string[]): Promise<string> => { const process = Bun.spawn(['playwright-cli', ...args], { cwd: cliDir, stdout: 'pipe', stderr: 'pipe' }); return await new Response(process.stdout).text(); };
		try {
			for (let attempt = 0; attempt < 20; attempt++) { try { if ((await fetch('http://127.0.0.1:4179/harness.html')).ok) break; } catch { /* server is starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
			await cli('open', 'http://127.0.0.1:4179/harness.html?frame=1440&route=/overview/runs&scenario=dense&locale=en-US&theme=dark&motion=reduced');
			const result = await cli('run-code', "async page => { const state = async () => [await page.locator('[data-harness=gateship-ui]').getAttribute('data-motion'), await page.locator('[data-harness=gateship-ui]').getAttribute('data-scenario'), await page.evaluate(() => document.documentElement.lang), await page.locator('[data-harness=gateship-ui] > nav button[aria-pressed=true]').innerText(), await page.evaluate(() => window.location.search)]; const direct = []; for (const route of ['/overview', '/overview/runs', '/overview/queues', '/overview/insights']) { await page.goto(`http://127.0.0.1:4179/harness.html?frame=1440&route=${route}&scenario=dense&locale=en-US&theme=dark&motion=reduced`); await page.waitForTimeout(100); direct.push(await state()); } await page.getByRole('button', { name: 'Central/queues' }).click(); await page.waitForTimeout(100); const changed = await state(); await page.reload(); await page.waitForTimeout(100); const reloaded = await state(); await page.getByRole('button', { name: 'reduced', exact: true }).click(); await page.waitForTimeout(100); const reduced = await page.locator('[data-slot=sidebar]').evaluate(node => getComputedStyle(node).transitionDuration); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: 'full', exact: true }).click(); await page.waitForTimeout(100); const emulatedFull = await page.locator('[data-slot=sidebar]').evaluate(node => getComputedStyle(node).transitionDuration); return JSON.stringify({ direct, changed, reloaded, reduced, emulatedFull }); }");
			const normalized = result.replaceAll('\\', '');
			expect(normalized).toContain('"direct"');
			expect(normalized).toContain('"changed"');
			expect(normalized).toContain('route=%2Foverview%2Fqueues');
			expect(normalized).toContain('"reloaded"');
			expect(normalized).toContain('"reduced":"0s"');
			expect(normalized).toContain('"emulatedFull":"0s"');
		} finally { await cli('close'); server.kill(); rmSync(cliDir, { recursive: true, force: true }); }
	}, 60_000);
});

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Harness } from '../../webui/src/harness.tsx';

describe('development UI harness', () => {
	test('renders stable real-component fixtures and the complete matrix controls', () => {
		const html = renderToStaticMarkup(<Harness />);
		for (const fixture of ['matrix-controls-v1', 'shell-v1', 'header-v1', 'stats-v1', 'controls-v1', 'typography-v1', 'attention-v1', 'empty-v1', 'notifications-v1', 'long-output-v1']) expect(html).toContain(`data-fixture-id="${fixture}"`);
		for (const value of ['light', 'dark', 'en-US', 'pt-BR', 'centered', 'wide', 'desktop', '390 px', '⌘B', 'Ctrl+B', 'Alt+1', 'Mod+B']) expect(html).toContain(value);
	});

	test('keeps the harness out of the production HTML input', async () => {
		const source = await Bun.file(new URL('../../webui/vite.config.ts', import.meta.url)).text();
		expect(source).toContain("input: 'index.html'");
		expect(source).toContain('development-only HTML entry');
	});
});

import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Stable, unhashed output names. The compiled binary embeds the bundle through
 * static `import ... with { type: 'file' }` specifiers (src/commands/
 * web-assets.ts), and a static specifier cannot name a content hash. Cache
 * busting is not needed for a bundle that ships inside the process serving it.
 */
export default defineConfig({
	plugins: [tailwindcss()],
	resolve: {
		alias: { '@': path.resolve(import.meta.dirname, '.') },
	},
	build: {
		rollupOptions: {
			// The internal harness is a development-only HTML entry. Keeping the
			// production input explicit prevents Vite's multi-page discovery from
			// shipping it or its chunk.
			input: 'index.html',
			output: {
				entryFileNames: 'app.js',
				chunkFileNames: 'app.js',
				assetFileNames: 'app.[ext]',
			},
		},
	},
});

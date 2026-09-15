import { describe, expect, test } from 'bun:test';

import { readProjectVerificationManifest } from '../../src/runtime/project-verification.ts';

describe('project verification manifest', () => {
	test('preserves prepare presence so absent fallback and explicit empty differ', () => {
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['bun test'],
		}))).toEqual({ version: 1, verify: ['bun test'] });
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			prepare: [],
			verify: ['bun test'],
		}))).toEqual({ version: 1, prepare: [], verify: ['bun test'] });
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			prepare: ['npm ci', 'python3 -m venv .venv'],
			verify: ['npm test'],
		}))).toEqual({
			version: 1,
			prepare: ['npm ci', 'python3 -m venv .venv'],
			verify: ['npm test'],
		});
	});

	test('rejects malformed preparation without weakening verification', () => {
		for (const prepare of [null, 'npm ci', [42], [''], ['   ']]) {
			expect(() => readProjectVerificationManifest(JSON.stringify({
				version: 1,
				prepare,
				verify: ['npm test'],
			}))).toThrow('project verification manifest has invalid preparation commands');
		}
	});

	// GSHIP-900: `lint` follows the same optional, list-of-commands contract as `prepare`.
	test('preserves lint presence so absent fallback and explicit empty differ', () => {
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['bun test'],
		}))).toEqual({ version: 1, verify: ['bun test'] });
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['bun test'],
			lint: [],
		}))).toEqual({ version: 1, verify: ['bun test'], lint: [] });
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['npm test'],
			lint: ['bun run lint'],
		}))).toEqual({
			version: 1,
			verify: ['npm test'],
			lint: ['bun run lint'],
		});
	});

	test('rejects malformed lint commands without weakening verification', () => {
		for (const lint of [null, 'bun run lint', [42], [''], ['   ']]) {
			expect(() => readProjectVerificationManifest(JSON.stringify({
				version: 1,
				verify: ['npm test'],
				lint,
			}))).toThrow('project verification manifest has invalid lint commands');
		}
	});

	test('accepts one optional project diagnostic command and rejects extra configuration', () => {
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['bun test'],
			diagnostic: { command: 'bun run diagnose' },
		}))).toMatchObject({ diagnostic: { command: 'bun run diagnose' } });
		for (const diagnostic of [null, {}, { command: '' }, { command: '  ' }, { command: 42 }, { command: 'bun test', extra: true }]) {
			expect(() => readProjectVerificationManifest(JSON.stringify({
				version: 1, verify: ['bun test'], diagnostic,
			}))).toThrow('project verification manifest has invalid diagnostic command');
		}
	});

	// GSHIP-872: the manifest is the only place a project opts into review
	// evidence, so it stays project-owned and confined to the worktree.
	test('accepts relative review evidence report paths and rejects paths that could escape the worktree', () => {
		expect(readProjectVerificationManifest(JSON.stringify({
			version: 1,
			verify: ['bun test'],
			reviewEvidencePaths: ['test-results/ui-results.json', 'test-results/ui'],
		}))).toMatchObject({ reviewEvidencePaths: ['test-results/ui-results.json', 'test-results/ui'] });

		for (const reviewEvidencePaths of [
			null,
			'test-results',
			[],
			[42],
			[''],
			['   '],
			['/etc/passwd'],
			['~/secrets'],
			['C:\\secrets'],
			['../outside-worktree'],
			['test-results/../../outside'],
			['test-results/ui-results.json', 'test-results/ui-results.json'],
		]) {
			expect(() => readProjectVerificationManifest(JSON.stringify({
				version: 1, verify: ['bun test'], reviewEvidencePaths,
			}))).toThrow('project verification manifest has invalid review evidence paths');
		}
	});
});

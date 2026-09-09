import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const versions = JSON.parse(readFileSync(resolve(root, 'provider-cli-versions.json'), 'utf8')) as Record<string, string>;
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const renovate = JSON.parse(readFileSync(resolve(root, 'renovate.json'), 'utf8')) as Record<string, unknown>;
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>;
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const recognizedRenovateConfigs = [
	'renovate.json',
	'renovate.json5',
	'.renovaterc',
	'.renovaterc.json',
	'.renovaterc.json5',
	'.github/renovate.json',
	'.github/renovate.json5',
	'.gitlab/renovate.json',
	'.gitlab/renovate.json5',
];

describe('provider CLI updates (GSHIP-843)', () => {
	test('keeps exact CLI pins in one machine-readable source', () => {
		expect(versions).toEqual({ claudeCode: '2.1.263', codexCli: '0.153.4' });
		expect(dockerfile).toContain('COPY provider-cli-versions.json /tmp/provider-cli-versions.json');
		expect(dockerfile).not.toMatch(/install\.sh \| bash -s \d/);
		expect(dockerfile).not.toMatch(/@openai\/codex@\d/);
	});

	test('uses official recurring Renovate sources and one non-automatic PR', () => {
		const managers = renovate.customManagers as Array<Record<string, unknown>>;
		expect(managers).toEqual(expect.arrayContaining([
			expect.objectContaining({ depNameTemplate: 'anthropics/claude-code', datasourceTemplate: 'github-releases' }),
			expect.objectContaining({ depNameTemplate: '@openai/codex', datasourceTemplate: 'npm' }),
		]));
		const providerRule = (renovate.packageRules as Array<Record<string, unknown>>).find((rule) => rule.groupSlug === 'provider-cli-versions');
		expect(providerRule).toMatchObject({
			matchDatasources: ['github-releases', 'npm'],
			matchPackageNames: ['anthropics/claude-code', '@openai/codex'],
			schedule: ['every day'],
			prConcurrentLimit: 1,
			prHourlyLimit: 1,
			automerge: false,
			groupName: 'provider CLI versions',
			groupSlug: 'provider-cli-versions',
		});
		expect(renovate.schedule).toBeUndefined();
		expect(renovate.prConcurrentLimit).toBeUndefined();
		expect(renovate.prHourlyLimit).toBeUndefined();
		expect(renovate.automerge).toBeUndefined();
	});

	test('keeps exactly one recognized Renovate configuration', () => {
		const presentConfigs = recognizedRenovateConfigs
			.filter((path) => existsSync(resolve(root, path)));
		if (Object.hasOwn(packageJson, 'renovate')) presentConfigs.push('package.json#renovate');
		expect(presentConfigs).toEqual(['renovate.json']);
	});

	test('keeps provider pins fixed to complete versions', () => {
		expect(versions.claudeCode).not.toBe('latest');
		expect(versions.codexCli).not.toBe('latest');
	});

	test('documents native versus container installation and effective version checks', () => {
		expect(readme).toContain('A instalação nativa mantém as CLIs fora da imagem');
		expect(readme).toContain('docker compose exec gateship claude --version');
		expect(readme).toContain('docker compose exec gateship codex --version');
		expect(readme).toContain('provider-cli-versions.json');
	});
});

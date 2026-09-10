import { describe, expect, test } from 'bun:test';
import { collectDoctorChecks, doctorJson, doctorSucceeded, type DoctorCheck } from '../../src/commands/doctor.ts';

function options(platform: string, arch: string, containerBuild: boolean) {
	return {
		platform,
		arch,
	containerBuild,
		commandCheck: (id: string, _command: string[], name: string): DoctorCheck => ({ id, name, ok: true, detail: `${name}: disponível`, actionable: true }),
		volumeCheck: async (): Promise<DoctorCheck> => ({ id: 'volume', name: 'volume', ok: true, detail: 'gravável', actionable: true }),
		connectivityCheck: (): DoctorCheck => ({ id: 'conectividade-local', name: 'conectividade-local', ok: true, detail: 'responde', actionable: true }),
	};
}

describe('gship doctor', () => {
	test('does not include command output or credential-shaped fields', async () => {
		const output = JSON.stringify(await collectDoctorChecks(options('linux', 'x64', false)));
		expect(output).not.toContain('token');
		expect(output).not.toContain('password');
		expect(output).not.toContain('secret');
	});

	test('accepts supported native macOS and Linux architectures without requiring a container', async () => {
		const supportedCases: Array<[string, string]> = [['darwin', 'arm64'], ['linux', 'x64']];
		for (const [platform, arch] of supportedCases) {
			const checks = await collectDoctorChecks(options(platform, arch, false));
			expect(checks.find((check) => check.id === 'arquitetura')?.ok).toBe(true);
			expect(checks.find((check) => check.id === 'container')).toMatchObject({ ok: true, actionable: false });
			expect(doctorSucceeded(checks)).toBe(true);
		}
	});

	test('keeps strict Linux architecture and volume validation inside the container', async () => {
		const valid = await collectDoctorChecks(options('linux', 'arm64', true));
		expect(valid.find((check) => check.id === 'arquitetura')?.ok).toBe(true);
		expect(valid.find((check) => check.id === 'volume')?.ok).toBe(true);
		expect(doctorSucceeded(valid)).toBe(true);

		const incompatible = await collectDoctorChecks(options('darwin', 'arm64', true));
		expect(incompatible.find((check) => check.id === 'arquitetura')?.ok).toBe(false);
		expect(doctorSucceeded(incompatible)).toBe(false);
	});

	test('uses unique identifiers and labels for availability and authentication checks', async () => {
		const checks = await collectDoctorChecks(options('linux', 'x64', true));
		expect(new Set(checks.map((check) => check.id)).size).toBe(checks.length);
		expect(new Set(checks.map((check) => check.name)).size).toBe(checks.length);
		expect(checks.map((check) => check.id)).toEqual(expect.arrayContaining([
		'gh-disponibilidade', 'gh-autenticacao', 'claude-disponibilidade', 'claude-autenticacao', 'codex-disponibilidade', 'codex-autenticacao',
	]));
	});

	test('global result ignores non-actionable checks and fails actionable ones', () => {
		const contextualFailure: DoctorCheck = { id: 'container', name: 'container', ok: false, detail: 'não aplicável', actionable: false };
		const actionableFailure: DoctorCheck = { id: 'arquitetura', name: 'arquitetura', ok: false, detail: 'incompatível', actionable: true };
		expect(doctorSucceeded([contextualFailure])).toBe(true);
		expect(doctorSucceeded([contextualFailure, actionableFailure])).toBe(false);
		expect(JSON.parse(doctorJson([contextualFailure])).ok).toBe(true);
		expect(JSON.parse(doctorJson([contextualFailure, actionableFailure])).ok).toBe(false);
	});
});

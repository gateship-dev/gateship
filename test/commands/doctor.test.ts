import { describe, expect, test } from 'bun:test';
import { collectDoctorChecks } from '../../src/commands/doctor.ts';

describe('gship doctor', () => {
	test('does not include command output or credential-shaped fields', async () => {
		const output = JSON.stringify(await collectDoctorChecks());
		expect(output).not.toContain('token');
		expect(output).not.toContain('password');
		expect(output).not.toContain('secret');
	});
});

import { describe, expect, test } from 'bun:test';
import { inspectProjectOnboarding } from '../../src/runtime/project-onboarding.ts';

describe('project onboarding inspection', () => {
	test('remote repository targets do not inherit local project evidence', () => {
		const snapshot = inspectProjectOnboarding(null, 'acme/product');
		const byKey = Object.fromEntries(snapshot.checks.map((check) => [check.key, check]));
		expect(byKey['github']?.detail).toContain('acme/product');
		expect(byKey['git']?.state).toBe('not-applicable');
		expect(byKey['branch']?.state).toBe('not-applicable');
		expect(byKey['manifest']?.state).toBe('not-applicable');
		expect(byKey['verification']?.state).toBe('not-applicable');
		expect(snapshot.manifestProposal).toBeNull();
	});
});

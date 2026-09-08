import { describe, expect, test } from 'bun:test';
import { fetchProjectOnboarding, PROJECT_ONBOARDING_PATH } from '../../webui/src/client.ts';
import { LOCALE_CATALOG } from '../../webui/src/locale.ts';
import { clearOnboardingStorage, isCurrentOnboardingRequest, isOnboardingProposalConfirmed, onboardingCheckPresentation, onboardingDetailsVisible, onboardingSelectionPressed, onboardingTargetGuidance, onboardingTargetPlaceholder } from '../../webui/src/screens/projects-management-screen.tsx';

describe('guided project onboarding state', () => {
	test('invalidates a persisted confirmation when operation, target or proposal changes', () => {
		const proposal = { commands: ['bun run verify'], exclusions: ['No command will run.'], risks: ['Review risks.'] };
		const confirmation = { operation: 'import' as const, target: 'acme/product', identity: JSON.stringify(proposal) };
		expect(isOnboardingProposalConfirmed(confirmation, 'import', 'acme/product', proposal)).toBe(true);
		expect(isOnboardingProposalConfirmed(confirmation, 'register', 'acme/product', proposal)).toBe(false);
		expect(isOnboardingProposalConfirmed(confirmation, 'import', 'acme/other', proposal)).toBe(false);
		expect(isOnboardingProposalConfirmed(confirmation, 'import', 'acme/product', { ...proposal, commands: ['bun test'] })).toBe(false);
	});

	test('drops an obsolete asynchronous inspection response', () => {
		expect(isCurrentOnboardingRequest('import:acme/product', 'register:/workspace')).toBe(false);
		expect(isCurrentOnboardingRequest('import:acme/product', 'import:acme/product')).toBe(true);
	});

	test('clears the persisted flow when returning to the first step', () => {
		const values = new Map([['gship-onboarding-choice', 'existing'], ['gship-onboarding-operation', 'import'], ['gship-onboarding-target', 'acme/product'], ['gship-onboarding-proposal', 'confirmed']]);
		const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
		clearOnboardingStorage(storage);
		expect(values.size).toBe(0);
	});

	test('keeps not-applicable checks neutral', () => {
		expect(onboardingCheckPresentation('not-applicable')).toEqual({ label: 'not applicable yet', variant: 'secondary' });
	});

	test('normalizes optional onboarding targets before building the request', async () => {
		const urls: string[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: Parameters<typeof globalThis.fetch>[0]) => {
			urls.push(String(input));
			return Promise.resolve(Response.json({ project: {}, checks: [], verificationCommands: [], manifestProposal: null }));
		}) as typeof globalThis.fetch;
		try {
			await fetchProjectOnboarding();
			await fetchProjectOnboarding({});
			await fetchProjectOnboarding({ value: '   ' });
			await fetchProjectOnboarding({ operation: 'import', value: ' acme/product ' });
		} finally {
			globalThis.fetch = originalFetch;
		}
		expect(urls).toEqual([
			PROJECT_ONBOARDING_PATH,
			PROJECT_ONBOARDING_PATH,
			PROJECT_ONBOARDING_PATH,
			`${PROJECT_ONBOARDING_PATH}?operation=import&target=acme%2Fproduct`,
		]);
	});

	test('shows onboarding details only after a project type is selected', () => {
		expect(onboardingDetailsVisible(null)).toBe(false);
		expect(onboardingDetailsVisible('existing')).toBe(true);
		expect(onboardingDetailsVisible('new')).toBe(true);
	});

	test('exposes selected project and operation buttons to assistive technology', () => {
		expect(onboardingSelectionPressed(true)).toBe(true);
		expect(onboardingSelectionPressed(false)).toBe(false);
	});

	test('localizes guidance for local and remote onboarding targets', () => {
		for (const locale of ['en-US', 'pt-BR'] as const) {
			const choice = LOCALE_CATALOG[locale].onboarding.choice;
			expect(onboardingTargetGuidance('register', choice.localTargetGuidance, choice.remoteTargetGuidance)).toBe(choice.localTargetGuidance);
			expect(onboardingTargetGuidance('import', choice.localTargetGuidance, choice.remoteTargetGuidance)).toBe(choice.remoteTargetGuidance);
			expect(onboardingTargetGuidance('create', choice.localTargetGuidance, choice.remoteTargetGuidance)).toBe(choice.remoteTargetGuidance);
			expect(choice.localTargetGuidance).toContain(locale === 'en-US' ? 'current project' : 'projeto atual');
			expect(choice.remoteTargetGuidance).toContain('owner/repo');
	}
	});

	test('uses the target placeholder for the selected operation', () => {
		expect(onboardingTargetPlaceholder('register', '/home/operator/code/project', 'owner/repo')).toBe('/home/operator/code/project');
		expect(onboardingTargetPlaceholder('import', '/home/operator/code/project', 'owner/repo')).toBe('owner/repo');
		expect(onboardingTargetPlaceholder('create', '/home/operator/code/project', 'owner/repo')).toBe('owner/repo');
	});
});

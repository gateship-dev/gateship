import { describe, expect, test } from 'bun:test';

import { EVIDENCE_LIMITS, fingerprintSpec, hasVerification, type ResearchContract, type ResearchReceipt, validateCurrentResearchAtRunStart, validateSpec } from '../../src/issues/spec.ts';

describe('direct issue spec', () => {
	test('fingerprints the normalized executable contract deterministically', () => {
		const base = { scope: ' Outcome ', verify: [' bun test one ', 'bun test two'] };
		const fingerprint = fingerprintSpec(base);
		expect(fingerprintSpec(base)).toBe(fingerprint);
		expect(fingerprintSpec({ scope: 'Outcome', verify: ['bun test one', 'bun test two'] }))
			.toBe(fingerprint);
		expect(fingerprintSpec({ scope: 'Changed', verify: base.verify })).not.toBe(fingerprint);
		expect(fingerprintSpec({ scope: base.scope, verify: ['changed', base.verify[1]!] }))
			.not.toBe(fingerprint);
		expect(fingerprintSpec({ scope: base.scope, verify: [base.verify[0]!, 'changed'] }))
			.not.toBe(fingerprint);
		expect(fingerprintSpec({ scope: 'Outcome' }))
			.toBe(fingerprintSpec({ scope: 'Outcome', verify: [] }));
	});

	test('accepts the minimal scope plus verification contract', () => {
		expect(validateSpec({
			scope: 'A página mostra o estado do run.',
			verify: ['bun test test/web/run-api.test.ts'],
		})).toEqual({ ok: true, errors: [] });
	});

	test('rejects legacy and unknown fields in v2', () => {
		expect(validateSpec({ version: 2, objective: 'O', acceptance: ['A'], verify: ['V'], scope: 'legacy' })).toMatchObject({ ok: false });
		expect(validateSpec({ version: 2, objective: 'O', acceptance: ['A'], verify: ['V'], extra: true })).toMatchObject({ ok: false });
	});

	test('requires an object, an outcome and at least one nonblank command', () => {
		expect(validateSpec(null)).toEqual({
			ok: false,
			errors: ['spec must be a non-null object'],
		});
		expect(validateSpec({ scope: '', verify: ['bun test'] })).toMatchObject({ ok: false });
		expect(validateSpec({ scope: 'Outcome', verify: [] })).toEqual({
			ok: false,
			errors: ['spec requires non-empty verify commands'],
		});
		expect(validateSpec({ scope: 'Outcome', verify: ['  '] })).toMatchObject({ ok: false });
	});

	test('plannability recognizes the direct contract only', () => {
		expect(hasVerification({ scope: 'new', verify: ['bun test'] })).toBe(true);
		expect(hasVerification({ scope: 'missing' })).toBe(false);
		expect(hasVerification(undefined)).toBe(false);
	});

	// GSHIP-629: the spec's executable premise, symmetric to verify.
	describe('evidence', () => {
		test('accepts a spec whose evidence commands and outputs are both non-empty', () => {
			expect(validateSpec({
				scope: 'A spec backed by measurement.',
				verify: ['bun test'],
				evidence: [
					{ command: 'ls src/domain-models | wc -l', output: '3' },
					{ command: 'git log --oneline -1', output: 'abc1234 seed' },
				],
			})).toEqual({ ok: true, errors: [] });
		});

		test('a spec with no evidence field is unaffected -- every already-filed issue lacks it', () => {
			expect(validateSpec({
				scope: 'A spec with no evidence at all.',
				verify: ['bun test'],
			})).toEqual({ ok: true, errors: [] });
		});

		test('rejects more than the maximum number of evidence items', () => {
			const tooMany = Array.from(
				{ length: EVIDENCE_LIMITS.maxItems + 1 },
				(_unused, index) => ({ command: `cmd ${index}`, output: `out ${index}` }),
			);
			const result = validateSpec({ scope: 'Outcome.', verify: ['bun test'], evidence: tooMany });
			expect(result.ok).toBe(false);
			expect(result.errors).toContain(
				`evidence accepts at most ${EVIDENCE_LIMITS.maxItems} items`,
			);
		});

		test('rejects an evidence item with an empty command or output', () => {
			expect(validateSpec({
				scope: 'Outcome.',
				verify: ['bun test'],
				evidence: [{ command: '  ', output: 'observed' }],
			})).toMatchObject({ ok: false });
			expect(validateSpec({
				scope: 'Outcome.',
				verify: ['bun test'],
				evidence: [{ command: 'ls', output: '  ' }],
			})).toMatchObject({ ok: false });
		});

		test('rejects a command or output past the size limit', () => {
			const longCommand = 'x'.repeat(EVIDENCE_LIMITS.command + 1);
			const longOutput = 'y'.repeat(EVIDENCE_LIMITS.output + 1);
			expect(validateSpec({
				scope: 'Outcome.',
				verify: ['bun test'],
				evidence: [{ command: longCommand, output: 'fine' }],
			})).toMatchObject({ ok: false });
			expect(validateSpec({
				scope: 'Outcome.',
				verify: ['bun test'],
				evidence: [{ command: 'fine', output: longOutput }],
			})).toMatchObject({ ok: false });
		});

		test('is part of the approved executable fingerprint', () => {
			const base = { scope: 'Outcome.', verify: ['bun test'] };
			const withEvidence = {
				...base,
				evidence: [{ command: 'ls', output: 'a\nb' }],
			};
			expect(fingerprintSpec(withEvidence)).not.toBe(fingerprintSpec(base));
			expect(fingerprintSpec({
				...withEvidence,
				evidence: [{ command: ' ls ', output: ' a\nb ' }],
			})).toBe(fingerprintSpec(withEvidence));
			expect(fingerprintSpec({
				...withEvidence,
				evidence: [{ command: 'pwd', output: 'a\nb' }],
			})).not.toBe(fingerprintSpec(withEvidence));
			expect(fingerprintSpec({
				...withEvidence,
				evidence: [{ command: 'ls', output: 'changed' }],
			})).not.toBe(fingerprintSpec(withEvidence));
		});
	});

	describe('conditional current research', () => {
		const research: ResearchContract & { receipts: ResearchReceipt[] } = {
			questions: ['Qual versão instalada a API suporta?'],
				sourceClasses: ['official-documentation', 'release-notes'],
				freshness: { mode: 'installed-version', installedVersion: '1.2.3' },
				receipts: [{
				url: 'https://example.invalid/docs', sourceType: 'official-documentation',
				fetchedAt: '2026-09-08T21:00:00.000Z', installedVersion: '1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' },
				contentHash: `sha256:${'a'.repeat(64)}`, claim: 'A API suporta o recurso.', applicability: 'A dependência instalada do projeto.',
			}],
		};
		const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
		const resultFor = (url: string, resolvedRef: ResearchReceipt['resolvedRef'] | undefined) => validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0]!, url, resolvedRef }] } });

		test('accepts a typed optional contract and makes its receipts part of approval', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'] };
			expect(validateSpec(base)).toEqual({ ok: true, errors: [] });
			expect(validateSpec({ ...base, research })).toEqual({ ok: true, errors: [] });
			expect(fingerprintSpec({ ...base, research })).not.toBe(fingerprintSpec(base));
			const reordered = {
				...base,
				research: {
					receipts: [{ ...research.receipts[0], resolvedRef: { value: 'v1.2.3', kind: 'tag' } }],
				freshness: { installedVersion: '1.2.3', mode: 'installed-version' },
				questions: [...research.questions], sourceClasses: [...research.sourceClasses],
				},
			} as typeof base & { research: ResearchContract & { receipts: ResearchReceipt[] } };
			expect(fingerprintSpec({ ...base, research })).toBe(fingerprintSpec(reordered));
			expect(fingerprintSpec({ ...base, research: { ...reordered.research, receipts: [{ ...reordered.research.receipts[0]!, claim: 'Outra afirmação.' }] } })).not.toBe(fingerprintSpec({ ...base, research }));
		});

		test('rejects untrusted or untyped sources and invalid freshness policy', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['blog'] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'target-version' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00Z', installedVersion: '1.2.3' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'installed-version', installedVersion: '1.2.3', targetVersion: '2.0.0' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'installed-version', installedVersion: '1.2.3' } } })).toMatchObject({ ok: true });
		expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'target-version', installedVersion: '1.2.3', targetVersion: '2.0.0' }, receipts: [{ ...research.receipts[0], sourceType: 'release-notes', installedVersion: '1.2.3', targetVersion: '2.0.0' }], sourceClasses: ['release-notes'] } })).toMatchObject({ ok: true });
		expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00Z' } } })).toMatchObject({ ok: true });
		});

		test('requires receipts whenever research is present', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'] };
			expect(validateSpec({ ...base, research: { ...research, receipts: undefined } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, receipts: [] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00Z' }, receipts: undefined } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00Z' }, receipts: [] } })).toMatchObject({ ok: false });
		});

		test('requires resolved current references and verifiable receipt identity', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url: 'x', fetchedAt: 'x', contentHash: 'x' }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], sourceType: 'primary-code', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
		});

		test('binds receipts to declared classes and the installed dependency version', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['primary-code'] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], installedVersion: undefined }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], installedVersion: '9.9.9' }] } })).toMatchObject({ ok: false });
			for (const sourceType of ['release-notes', 'primary-code'] as const) {
				const receipt = { ...research.receipts[0]!, sourceType, installedVersion: '1.2.3' };
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [receipt] } })).toMatchObject({ ok: true });
			}
			expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['release-notes'], receipts: [{ ...research.receipts[0], sourceType: 'release-notes', installedVersion: undefined }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['release-notes'], receipts: [{ ...research.receipts[0], sourceType: 'release-notes', installedVersion: '9.9.9' }] } })).toMatchObject({ ok: false });
		});

		test('requires complete upgrade versions and migration evidence', () => {
			const upgrade = {
				...research,
				sourceClasses: ['official-documentation', 'release-notes'],
				freshness: { mode: 'target-version', installedVersion: '1.2.3', targetVersion: '2.0.0' },
				receipts: [{ ...research.receipts[0], sourceType: 'release-notes', installedVersion: '1.2.3', targetVersion: '2.0.0', claim: 'O guia de migração cobre o upgrade.' }],
			};
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'] };
			expect(validateSpec({ ...base, research: upgrade })).toMatchObject({ ok: true });
			expect(validateSpec({ ...base, research: { ...upgrade, freshness: { mode: 'target-version', targetVersion: '2.0.0' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, freshness: { mode: 'target-version', installedVersion: '1.2.3' } } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, sourceClasses: ['official-documentation'], receipts: [{ ...upgrade.receipts[0], sourceType: 'official-documentation' }] } })).toMatchObject({ ok: true });
			expect(validateSpec({ ...base, research: { ...upgrade, sourceClasses: ['official-documentation'], receipts: [{ ...upgrade.receipts[0], sourceType: 'official-documentation', installedVersion: undefined }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [
				{ ...upgrade.receipts[0], sourceType: 'official-documentation', installedVersion: '9.9.9', targetVersion: undefined },
				{ ...upgrade.receipts[0], sourceType: 'release-notes', installedVersion: '1.2.3', targetVersion: '2.0.0' },
			] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [
				{ ...upgrade.receipts[0], sourceType: 'official-documentation', installedVersion: undefined, targetVersion: undefined },
				{ ...upgrade.receipts[0], sourceType: 'release-notes', installedVersion: '1.2.3', targetVersion: '2.0.0' },
			] } })).toMatchObject({ ok: true });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [{ ...upgrade.receipts[0], sourceType: 'release-notes', installedVersion: '9.9.9', targetVersion: '9.9.9' }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [{ ...upgrade.receipts[0], installedVersion: undefined }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [{ ...upgrade.receipts[0], targetVersion: undefined }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [{ ...upgrade.receipts[0], installedVersion: '9.9.9' }] } })).toMatchObject({ ok: false });
			expect(validateSpec({ ...base, research: { ...upgrade, receipts: [{ ...upgrade.receipts[0], targetVersion: '9.9.9' }] } })).toMatchObject({ ok: false });
		});

		test('rejects moving repository references and accepts tags, releases and commits', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			for (const resolvedRef of ['main', 'MASTER', 'latest', 'current', 'HEAD', 'refs/heads/main', 'refs/remotes/origin/main']) {
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['primary-code'], receipts: [{ ...research.receipts[0], sourceType: 'primary-code', resolvedRef: { kind: 'tag', value: resolvedRef } }] } })).toMatchObject({ ok: false });
			}
			for (const resolvedRef of [{ kind: 'tag', value: 'stable-2026-09' }, { kind: 'release', value: 'release-2026-09' }, { kind: 'commit', value: 'a'.repeat(40) }, { kind: 'commit', value: 'b'.repeat(64) }]) {
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['primary-code'], receipts: [{ ...research.receipts[0], sourceType: 'primary-code', resolvedRef }] } })).toMatchObject({ ok: true });
			}
			for (const resolvedRef of ['banana', 'a'.repeat(39), 'a'.repeat(41)]) {
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['primary-code'], receipts: [{ ...research.receipts[0], sourceType: 'primary-code', resolvedRef: { kind: 'commit', value: resolvedRef } }] } })).toMatchObject({ ok: false });
			}
		});

		test('rejects impossible UTC calendar components and accepts valid resolutions', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			for (const timestamp of ['2026-02-30T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:60:00.000Z']) {
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], fetchedAt: timestamp }] } })).toMatchObject({ ok: false });
			}
			expect(validateSpec({ ...base, research: { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00.000Z' } } })).toMatchObject({ ok: true });
		});

		test('requires current research to resolve at run admission', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			const current: ResearchContract & { receipts: ResearchReceipt[] } = { ...research, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:00Z' } };
			expect(validateCurrentResearchAtRunStart({ ...base, research: current }, '2026-09-08T21:00:01Z', '2026-09-08T21:00:02Z')).toMatchObject({ ok: true });
			expect(validateCurrentResearchAtRunStart({ ...base, research: { ...current, freshness: { mode: 'current', resolvedAt: '2026-09-08T21:00:03Z' } } }, '2026-09-08T21:00:01Z', '2026-09-08T21:00:02Z')).toMatchObject({ ok: false });
			expect(validateCurrentResearchAtRunStart({ ...base, research: current }, '2026-09-08T21:00:00Z', '2026-09-08T21:00:02Z')).toMatchObject({ ok: true });
			expect(validateCurrentResearchAtRunStart({ ...base, research: { ...current, receipts: [{ ...current.receipts[0]!, fetchedAt: '2026-09-08T21:00:03Z' }] } }, '2026-09-08T21:00:01Z', '2026-09-08T21:00:02Z')).toMatchObject({ ok: false });
			expect(validateCurrentResearchAtRunStart({ ...base, research: { ...current, receipts: [{ ...current.receipts[0]!, fetchedAt: '2026-09-08T21:00:02Z' }] } }, '2026-09-08T21:00:01Z', '2026-09-08T21:00:02Z')).toMatchObject({ ok: true });
		});

		test('requires immutable refs for GitHub repository content regardless of source class', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			for (const sourceType of ['official-documentation', 'release-notes']) {
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/main/README.md', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				 expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/tag/v1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/tree/v1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/v1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/raw/v1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/' + 'e'.repeat(40), resolvedRef: { kind: 'commit', value: 'e'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/v1.2.3', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/' + 'f'.repeat(40), resolvedRef: { kind: 'commit', value: 'f'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/' + 'a'.repeat(40) + '/README.md', resolvedRef: { kind: 'commit', value: 'a'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/v1.2.3/README.md', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://gitlab.com/acme/project/tree/' + 'b'.repeat(64) + '/README.md', resolvedRef: { kind: 'commit', value: 'b'.repeat(64) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://gitlab.com/acme/project/tree/v1.2.3/README.md', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/main/README.md', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/' + 'c'.repeat(40) + '/README.md', resolvedRef: { kind: 'commit', value: 'c'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/v1.2.3/README.md', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://raw.githubusercontent.com/acme/project/' + 'b'.repeat(64) + '/README.md', resolvedRef: { kind: 'commit', value: 'b'.repeat(64) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/raw/main/README.md', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/raw/v1.2.3/README.md', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/raw/' + 'b'.repeat(64) + '/README.md', resolvedRef: { kind: 'commit', value: 'b'.repeat(64) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/latest', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
				for (const kind of ['tag', 'release'] as const) {
					expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/download/release%2Fv1/pkg.tgz', resolvedRef: { kind, value: 'release/v1' } }] } })).toMatchObject({ ok: true });
				}
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/download/release%2Fv1/pkg.tgz', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/download/release%2Fv1/pkg.tgz', resolvedRef: { kind: 'tag', value: 'v9.9.9' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/download/latest/pkg.tgz', resolvedRef: { kind: 'tag', value: 'latest' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases/download/release%2Fv1/pkg.tgz', resolvedRef: { kind: 'commit', value: 'a'.repeat(40) } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases', resolvedRef: { kind: 'tag', value: 'main' } }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/releases', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/commit/' + 'a'.repeat(40), resolvedRef: { kind: 'commit', value: 'a'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://gitlab.com/acme/project/blob/' + 'b'.repeat(64) + '/README.md', resolvedRef: { kind: 'commit', value: 'b'.repeat(64) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://gitlab.com/acme/project/tree/main/README.md', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
				expect(validateSpec({ ...base, research: { ...research, sourceClasses: [sourceType], receipts: [{ ...research.receipts[0], sourceType, url: 'https://github.com/acme/project/blob/main/README.md', resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
			}
		});

		test('does not classify ordinary documentation hosts as repositories', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			for (const url of [
				'https://docs.example.com/guides/getting-started',
				'https://docs.example.com/blob/main/README.md',
				'https://docs.example.com/tree/main/guides',
				'https://docs.example.com/raw/main/README.md',
				'https://docs.example.com/releases/latest',
				'https://docs.gitlab.com/ee/user/project/repository/web_editor.html',
			]) {
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url, resolvedRef: undefined }] } })).toMatchObject({ ok: true });
			}
			expect(validateSpec({ ...base, research: { ...research, sourceClasses: ['primary-code'], receipts: [{ ...research.receipts[0], sourceType: 'primary-code', url: 'https://docs.example.com/guides/getting-started', resolvedRef: undefined }] } })).toMatchObject({ ok: false });
		});

		test('pins GitHub archive routes', () => {
			for (const url of ['https://github.com/acme/project/archive/refs/heads/main.zip', 'https://github.com/acme/project/archive/refs/heads/main.tar.gz']) expect(resultFor(url, undefined)).toMatchObject({ ok: false });
			for (const [url, value] of [['https://github.com/acme/project/archive/refs/tags/v1.2.3.zip', 'v1.2.3'], ['https://github.com/acme/project/archive/refs/tags/release%2Fv1.tar.gz', 'release/v1']] as const) {
				expect(resultFor(url, { kind: 'tag', value })).toMatchObject({ ok: true });
				expect(resultFor(url, undefined)).toMatchObject({ ok: false });
			}
			expect(resultFor(`https://github.com/acme/project/archive/${'a'.repeat(40)}.zip`, { kind: 'commit', value: 'a'.repeat(40) })).toMatchObject({ ok: true });
			expect(resultFor('https://github.com/acme/project/commits/main', undefined)).toMatchObject({ ok: false });
			expect(resultFor('https://github.com/acme/project/commits/main', { kind: 'tag', value: 'main' })).toMatchObject({ ok: false });
			expect(resultFor(`https://github.com/acme/project/commits/${'c'.repeat(40)}`, { kind: 'commit', value: 'c'.repeat(40) })).toMatchObject({ ok: true });
			expect(resultFor('https://github.com/acme/project/unknown/content', undefined)).toMatchObject({ ok: false });
			expect(resultFor('https://github.com/acme/project/unknown/content', { kind: 'tag', value: 'v1.2.3' })).toMatchObject({ ok: true });
		});

		test('pins GitLab archive routes', () => {
			expect(resultFor(`https://gitlab.com/group/subgroup/project/-/archive/${'b'.repeat(64)}/project.tar.gz`, { kind: 'commit', value: 'b'.repeat(64) })).toMatchObject({ ok: true });
			for (const url of ['https://gitlab.com/group/project/-/archive/main/project.zip', 'https://gitlab.com/group/subgroup/project/-/archive/latest/project.tar.gz']) expect(resultFor(url, { kind: 'tag', value: 'main' })).toMatchObject({ ok: false });
		});

		test('rejects GitLab moving release permalinks', () => {
			for (const url of ['https://gitlab.com/group/project/-/releases/permalink/latest', 'https://gitlab.com/group/subgroup/project/-/releases/permalink/latest', 'https://gitlab.com/group/project/releases/permalink/latest']) {
				for (const resolvedRef of [undefined, { kind: 'tag', value: 'permalink' }, { kind: 'tag', value: 'v1.2.3' }] as const) expect(resultFor(url, resolvedRef)).toMatchObject({ ok: false });
			}
		});

		test('pins GitLab blob, tree and raw routes', () => {
			for (const route of ['blob', 'tree', 'raw']) {
				const sha = 'c'.repeat(40);
				expect(resultFor(`https://gitlab.com/group/subgroup/project/-/${route}/${sha}/README.md`, { kind: 'commit', value: sha })).toMatchObject({ ok: true });
				expect(resultFor(`https://gitlab.com/group/subgroup/project/-/${route}/main/README.md`, undefined)).toMatchObject({ ok: false });
			}
		});

		test('pins GitLab commit and release routes', () => {
			expect(resultFor(`https://gitlab.com/group/subgroup/project/-/commit/${'d'.repeat(40)}`, { kind: 'commit', value: 'd'.repeat(40) })).toMatchObject({ ok: true });
			expect(resultFor('https://gitlab.com/group/subgroup/project/-/releases/v2.0.0', { kind: 'tag', value: 'v2.0.0' })).toMatchObject({ ok: true });
			expect(resultFor(`https://gitlab.com/group/subgroup/project/commit/${'f'.repeat(40)}`, { kind: 'commit', value: 'f'.repeat(40) })).toMatchObject({ ok: true });
			expect(resultFor('https://gitlab.com/group/subgroup/project/releases/v2.0.0', { kind: 'release', value: 'v2.0.0' })).toMatchObject({ ok: true });
			expect(resultFor('https://gitlab.com/group/subgroup/project/-/commits/main', undefined)).toMatchObject({ ok: false });
			expect(resultFor(`https://gitlab.com/group/subgroup/project/-/commits/${'e'.repeat(40)}`, { kind: 'commit', value: 'e'.repeat(40) })).toMatchObject({ ok: true });
			expect(resultFor('https://gitlab.com/group/subgroup/project/-/unknown/content', undefined)).toMatchObject({ ok: false });
		});

		test('pins repository wikis, GitLab roots and encoded slash tags', () => {
			const base = { version: 2 as const, objective: 'O', acceptance: ['A'], verify: ['V'], research };
			for (const [url, resolvedRef] of [
				['https://github.com/acme/project/wiki/Guide', undefined],
				['https://github.com/acme/project/wiki/Guide', { kind: 'tag', value: 'v1.2.3' }],
				['https://gitlab.com/group/subgroup/project', undefined],
				['https://gitlab.com/group/subgroup/project', { kind: 'tag', value: 'v1.2.3' }],
			] as const) {
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url, resolvedRef }] } })).toMatchObject({ ok: resolvedRef === undefined ? false : true });
			}
			for (const url of ['https://github.com/acme/project/releases/tag/release%2Fv1']) {
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url, resolvedRef: { kind: 'tag', value: 'release/v1' } }] } })).toMatchObject({ ok: true });
			}
			for (const url of [
				'https://github.com/acme/project/blob/' + 'd'.repeat(40) + '/README.md',
				'https://github.com/acme/project/tree/' + 'd'.repeat(40) + '/docs',
				'https://github.com/acme/project/raw/' + 'd'.repeat(40) + '/README.md',
				'https://gitlab.com/group/subgroup/project/-/blob/' + 'd'.repeat(40) + '/README.md',
				'https://gitlab.com/group/subgroup/project/-/tree/' + 'd'.repeat(40) + '/docs',
				'https://gitlab.com/group/subgroup/project/-/raw/' + 'd'.repeat(40) + '/README.md',
			]) {
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url, resolvedRef: { kind: 'commit', value: 'd'.repeat(40) } }] } })).toMatchObject({ ok: true });
				expect(validateSpec({ ...base, research: { ...research, receipts: [{ ...research.receipts[0], url, resolvedRef: { kind: 'tag', value: 'v1.2.3' } }] } })).toMatchObject({ ok: false });
			}
		});

		test('keeps legacy specs valid and fingerprints unchanged when research is absent', () => {
			const legacy = { scope: 'Outcome', verify: ['bun test'] };
			expect(validateSpec(legacy)).toEqual({ ok: true, errors: [] });
			expect(fingerprintSpec(legacy)).toBe(fingerprintSpec({ ...legacy }));
		});
	});
});

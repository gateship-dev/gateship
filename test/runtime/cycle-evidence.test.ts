import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCycleDiagnostic } from '../../src/runtime/cycle-diagnostic.ts';
import { defaultRunGit, GitFullVerifier, GitIssueVerifier } from '../../src/runtime/git-runtime.ts';
import { projectCycleObservations } from '../../src/runtime/run-runtime.ts';
import type { RunEvent } from '../../src/runtime/run-store.ts';
import { verificationVersion } from '../../src/runtime/verification-version.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

function repository(): string {
	const cwd = createTestTmpdir();
	expect(defaultRunGit(cwd, ['init', '-q']).exitCode).toBe(0);
	writeFileSync(join(cwd, '.gitignore'), 'ignored\n');
	writeFileSync(join(cwd, 'a.ts'), 'one');
	writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { verify: 'echo full' } }));
	expect(defaultRunGit(cwd, ['add', '.']).exitCode).toBe(0);
	expect(defaultRunGit(cwd, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial']).exitCode).toBe(0);
	expect(defaultRunGit(cwd, ['update-ref', 'refs/remotes/origin/main', 'HEAD']).exitCode).toBe(0);
	return cwd;
}

function event(seq: number, kind: string, payload: Record<string, unknown>): RunEvent {
	return { seq, runId: 'run', kind, payload, fromState: null, toState: 'working', eventClass: 'decision', createdAt: '2026-09-14T00:00:00Z' };
}

describe('cycle evidence provenance', () => {
	test('identifies tracked, new, deleted, executable and symlink content without mutating the index', () => {
		const cwd = repository();
		const original = verificationVersion(cwd, defaultRunGit);
		expect(original).toStartWith('worktree-sha256:');
		writeFileSync(join(cwd, 'ignored'), 'not part of source identity');
		expect(verificationVersion(cwd, defaultRunGit)).toBe(original);
		writeFileSync(join(cwd, 'a.ts'), 'two');
		expect(verificationVersion(cwd, defaultRunGit)).not.toBe(original);
		writeFileSync(join(cwd, 'a.ts'), 'one');
		writeFileSync(join(cwd, 'new.ts'), 'new');
		const withNew = verificationVersion(cwd, defaultRunGit);
		expect(withNew).not.toBe(original);
		writeFileSync(join(cwd, 'new.ts'), 'changed');
		expect(verificationVersion(cwd, defaultRunGit)).not.toBe(withNew);
		unlinkSync(join(cwd, 'new.ts'));
		chmodSync(join(cwd, 'a.ts'), 0o755);
		expect(verificationVersion(cwd, defaultRunGit)).not.toBe(original);
		chmodSync(join(cwd, 'a.ts'), 0o644);
		unlinkSync(join(cwd, 'a.ts'));
		expect(verificationVersion(cwd, defaultRunGit)).not.toBe(original);
		symlinkSync('missing-target', join(cwd, 'a.ts'));
		expect(verificationVersion(cwd, defaultRunGit)).not.toBe(original);
		expect(defaultRunGit(cwd, ['diff', '--cached', '--name-only']).stdout).toBe('');
	});

	test('capture failures and unsupported entries remain unknown', () => {
		const cwd = repository();
		expect(verificationVersion(cwd, () => ({ exitCode: 1, stdout: '', stderr: 'error' }))).toBeNull();
		unlinkSync(join(cwd, 'a.ts'));
		mkdirSync(join(cwd, 'a.ts'));
		expect(verificationVersion(cwd, defaultRunGit)).toBeNull();
	});

	for (const full of [false, true]) {
		test(`${full ? 'full' : 'focused'} verifier records actual content and leaves command-time mutation unknown`, async () => {
			const cwd = repository();
			writeFileSync(join(cwd, 'a.ts'), 'changed');
			const events: RunEvent[] = [event(1, 'run.created', { workflowRevision: 'fixed-workflow' })];
			let mutate = false;
			const options = {
				loadIssue: () => JSON.stringify({ spec: { scope: 'test', verify: ['echo focused'] } }),
				runCommand: async () => {
					if (mutate) writeFileSync(join(cwd, 'a.ts'), 'mutated during command');
					return { exitCode: 0, stdout: '', stderr: '' };
				},
			};
			const verifier = full ? new GitFullVerifier(options) : new GitIssueVerifier(options);
			const input = { cwd, runId: 'run', issueId: 'GSHIP-887', sessionId: 'session', resume: false,
				signal: new AbortController().signal,
				emit: (kind: string, payload: Record<string, unknown> = {}) => events.push(event(events.length + 1, kind, payload)),
			};
			const firstVersion = verificationVersion(cwd, defaultRunGit);
			expect((await verifier.verify(input)).ok).toBe(true);
			writeFileSync(join(cwd, 'new.ts'), 'another version');
			expect((await verifier.verify(input)).ok).toBe(true);
			mutate = true;
			expect((await verifier.verify(input)).ok).toBe(true);
			const observations = projectCycleObservations('run', events);
			expect(observations).toHaveLength(3);
			expect(observations[0]?.verifiedVersion).toBe(firstVersion ?? undefined);
			expect(observations[1]?.verifiedVersion).not.toBe(firstVersion ?? undefined);
			expect(observations[2]?.verifiedVersion).toBe('unknown');
		});
	}

	test('legacy and provider observations never inherit workflowRevision or claimed provider versions', () => {
		const observations = projectCycleObservations('run', [
			event(1, 'run.created', { workflowRevision: 'fixed-workflow' }),
			event(2, 'verify.command.completed', { exitCode: 0 }),
			event(3, 'provider.tool-observation', { tool: 'Read', action: 'result', result: 'read', verifiedVersion: 'invented' }),
		]);
		expect(observations.map((item) => item.verifiedVersion)).toEqual(['unknown', 'unknown']);
	});

	test('accepts schema-required nulls, canonicalizes and rejects forged references or metadata', () => {
		const available = projectCycleObservations('run', [event(1, 'verify.command.completed', { exitCode: 0, verifiedVersion: 'code' })]);
		const reference = { ...available[0], tool: null, action: null, toolUseId: null, isError: null };
		const diagnosis = (item: unknown) => ({ kind: 'correction', hypothesis: 'bounded defect', action: 'fix', expectedObservation: 'test', evidence: [item] });
		expect(normalizeCycleDiagnostic(diagnosis(reference), available)).toMatchObject({ kind: 'correction', evidence: available });
		for (const override of [{ id: 'fake' }, { runId: 'other' }, { attempt: 5 }, { verifiedVersion: 'fake' }, { result: 'fake' }, { exitCode: 1 }, { exitCode: null }, { isError: true }, { tool: 'Read', action: 'result' }]) {
			expect(normalizeCycleDiagnostic(diagnosis({ ...reference, ...override }), available).kind).toBe('insufficient-evidence');
		}
	});
});

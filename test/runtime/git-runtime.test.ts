import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fingerprintSpec } from '../../src/issues/spec.ts';
import {
	createGitRuntimePreflight,
	defaultRunGit,
	type GitCommandRunner,
	GitEvidenceChecker,
	GitFullVerifier,
	GitIssueVerifier,
	GitLintVerifier,
	runVerificationCommand,
	VERIFICATION_COMMAND_TIMEOUT_MS,
} from '../../src/runtime/git-runtime.ts';
import { readProjectVerificationManifest } from '../../src/runtime/project-verification.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

function gitRunner(values: { branch?: string; status?: string; diffExit?: number }): GitCommandRunner {
	return (_cwd, args) => {
		if (args[0] === 'branch') {
			return { exitCode: 0, stdout: `${values.branch ?? 'codex/work'}\n`, stderr: '' };
		}
		if (args[0] === 'status') {
			return { exitCode: 0, stdout: values.status ?? '', stderr: '' };
		}
		return { exitCode: values.diffExit ?? 0, stdout: '', stderr: 'bad diff' };
	};
}

const verificationInput = {
	runId: 'run-1',
	issueId: 'CAM-1',
	sessionId: 'session-1',
	resume: false,
	cwd: '/project',
	signal: new AbortController().signal,
	emit: () => {},
};

function issueWithVerification(commands: string[]): string {
	return JSON.stringify({ spec: { scope: 'Expected outcome.', verify: commands } });
}

function focusedGitRunner(packageJson: string, manifest?: string): GitCommandRunner {
	return (_cwd, args) => {
		const path = args.at(-1);
		switch (args[0]) {
		case 'diff': return { exitCode: 0, stdout: '', stderr: '' };
			case 'status': return { exitCode: 0, stdout: ' M src/a.ts\n', stderr: '' };
			case 'fetch': return { exitCode: 0, stdout: '', stderr: '' };
			case 'rev-parse': return { exitCode: 0, stdout: 'base-sha\n', stderr: '' };
			case 'merge-base': return { exitCode: 0, stdout: 'base-sha\n', stderr: '' };
			case 'ls-tree': return { exitCode: 0, stdout: path === 'package.json' || (path === '.gateship/project.json' && manifest !== undefined) ? `${path}\n` : '', stderr: '' };
			case 'show': return { exitCode: 0, stdout: args[1] === 'base-sha:package.json' ? packageJson : manifest ?? '', stderr: '' };
			default: return { exitCode: 1, stdout: '', stderr: 'unexpected Git call' };
		}
	};
}

function aliasPreflightRunner(withHook: boolean): GitCommandRunner {
	return focusedGitRunner(JSON.stringify({ scripts: {
		verify: 'bun run check:all', 'check:all': 'bun test', ...(withHook ? { preverify: 'echo hook' } : {}),
	} }), JSON.stringify({ version: 1, verify: ['bun run verify'] }));
}

function fullVerifyGitRunner(): GitCommandRunner {
	return (_cwd, args) => args[0] === 'merge-base'
		? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
		: args[0] === 'ls-tree'
			? { exitCode: 0, stdout: '', stderr: '' }
			: { exitCode: 1, stdout: '', stderr: 'unexpected Git call' };
}

describe('git runtime boundary', () => {
	test('requires a real issue and source ref without constraining the host checkout', () => {
		const spec = { scope: 'Approved outcome.', verify: ['bun test'] };
		const valid = createGitRuntimePreflight('/project', {
			runGit: gitRunner({ branch: 'main', status: '?? operator-notes.txt' }),
			issueExists: () => true,
			loadIssue: () => JSON.stringify({
				spec,
				approval: { fingerprint: fingerprintSpec(spec), approvedAt: '2026-08-16T00:00:00Z' },
			}),
		});
		expect(() => valid('CAM-1')).not.toThrow();

		const missingIssue = createGitRuntimePreflight('/project', {
			runGit: gitRunner({}),
			issueExists: () => false,
		});
		expect(() => missingIssue('CAM-404')).toThrow('issue not found on origin/main');

		const missingSource = createGitRuntimePreflight('/project', {
			runGit: (_cwd, args) => args[0] === 'fetch'
				? { exitCode: 0, stdout: '', stderr: '' }
				: { exitCode: 1, stdout: '', stderr: 'missing origin/main' },
			issueExists: () => true,
		});
		expect(() => missingSource('CAM-1')).toThrow('cannot resolve origin/main');

		const unapproved = createGitRuntimePreflight('/project', {
			runGit: gitRunner({}), issueExists: () => true,
			loadIssue: () => JSON.stringify({ spec }),
		});
		expect(() => unapproved('CAM-2')).toThrow('CAM-2 has no approval');

		const stale = createGitRuntimePreflight('/project', {
			runGit: gitRunner({}), issueExists: () => true,
			loadIssue: () => JSON.stringify({ spec: { ...spec, scope: 'Changed.' }, approval: {
				fingerprint: fingerprintSpec(spec), approvedAt: '2026-08-16T00:00:00Z',
			} }),
		});
		expect(() => stale('CAM-3')).toThrow('CAM-3 has stale approval');
	});

	test('does not reject alias overlap when the full verify script has hooks', () => {
		const spec = { scope: 'Approved outcome.', verify: ['bun run check:all'] };
		const dir = createTestTmpdir('gship-preflight-alias-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }));
		let withHook = true;
		const input = () => JSON.stringify({ spec, approval: { fingerprint: fingerprintSpec(spec) } });
		let options = { runGit: aliasPreflightRunner(withHook), issueExists: () => true, loadIssue: input };
		expect(() => createGitRuntimePreflight(dir, options)('CAM-4')).not.toThrow();
		withHook = false;
		options = { ...options, runGit: aliasPreflightRunner(withHook) };
		expect(() => createGitRuntimePreflight(dir, options)('CAM-4')).toThrow('focused verification command');
		const externalSpec = { scope: 'Approved outcome.', verify: ['check:all'] };
		expect(() => createGitRuntimePreflight('/project', {
			...options,
			loadIssue: () => JSON.stringify({ spec: externalSpec, approval: { fingerprint: fingerprintSpec(externalSpec) } }),
		})('CAM-5')).not.toThrow();
	});

	test('verifies diff integrity and requires an actual working-tree change', async () => {
		const valid = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => issueWithVerification(['true']),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
		});
		expect(await valid.verify(verificationInput)).toEqual({ ok: true });

		const unchanged = new GitIssueVerifier({ runGit: gitRunner({ status: '' }) });
		expect(await unchanged.verify(verificationInput)).toMatchObject({
			ok: false,
			detail: 'executor completed without a working-tree change',
		});

		const invalidDiff = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts', diffExit: 1 }),
		});
		expect(await invalidDiff.verify(verificationInput)).toMatchObject({
			ok: false,
			detail: expect.stringContaining('git diff check failed'),
		});
	});

	test('runs every verify command in order and emits command lifecycle events', async () => {
		const commands: string[] = [];
		const timeouts: Array<number | undefined> = [];
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => issueWithVerification(['bun test one', 'test -f output.txt']),
			runCommand: async ({ command, timeoutMs }) => {
				commands.push(command);
				timeouts.push(timeoutMs);
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});

		const result = await verifier.verify({
			...verificationInput,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true });
		expect(commands).toEqual(['bun test one', 'test -f output.txt']);
		expect(timeouts).toEqual([undefined, undefined]);
		expect(events.map((event) => event.kind)).toEqual([
			'verify.started',
			'verify.command.started',
			'verify.command.completed',
			'verify.command.started',
			'verify.command.completed',
		]);
	});

	// GSHIP-872: `verify.command.completed` names only the declared evidence
	// files that actually changed content hash during that one command -- a
	// file already present and unchanged is never attributed to the command
	// that happened to run next, which is what lets a reviewer tell a report a
	// command produced from one a prior attempt (or the executor) left behind.
	test('names only the review evidence file each verify command actually changed', async () => {
		const dir = createTestTmpdir('gship-verify-provenance-');
		mkdirSync(join(dir, '.gateship'), { recursive: true });
		writeFileSync(join(dir, '.gateship', 'project.json'), JSON.stringify({
			version: 1, verify: ['echo one', 'echo two'], reviewEvidencePaths: ['report.json'],
		}));
		// Present before either command runs: must never be attributed to one.
		writeFileSync(join(dir, 'report.json'), 'stale from a prior attempt');

		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => issueWithVerification(['echo one', 'echo two']),
			runCommand: async ({ command }) => {
				if (command === 'echo two') writeFileSync(join(dir, 'report.json'), 'produced by echo two');
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});

		const result = await verifier.verify({
			...verificationInput,
			cwd: dir,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true });
		const completions = events.filter((event) => event.kind === 'verify.command.completed');
		expect(completions).toHaveLength(2);
		expect(completions[0]?.payload?.['command']).toBe('echo one');
		expect(completions[0]?.payload?.['artifacts']).toBeUndefined();
		expect(completions[1]?.payload?.['command']).toBe('echo two');
		expect(completions[1]?.payload?.['artifacts']).toEqual([
			{ path: 'report.json', sizeBytes: 'produced by echo two'.length, sha256: expect.any(String) },
		]);
	});

	test('skips a focused command when the project harness proves it is the full verify alias', async () => {
		const dir = createTestTmpdir('gship-focused-equivalent-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }));
		const commands: string[] = [];
		const events: string[] = [];
		const verifier = new GitIssueVerifier({
			runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } })),
			loadIssue: () => issueWithVerification(['bun run check:all', 'bun run verify']),
			runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir, emit: (kind) => events.push(kind) }))
			.toEqual({ ok: true, skipped: true });
		expect(commands).toEqual([]);
		expect(events).toEqual(['verify.skipped-equivalent', 'verify.skipped-equivalent', 'verify.skipped']);
	});

	test('keeps distinct focused commands when another command is equivalent', async () => {
		const dir = createTestTmpdir('gship-focused-mixed-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }));
		const commands: string[] = [];
		const verifier = new GitIssueVerifier({
			runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } })),
			loadIssue: () => issueWithVerification(['bun test test/unit.ts', 'bun run check:all']),
			runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		expect(commands).toEqual(['bun test test/unit.ts']);
	});

	test('keeps alias equivalence unknown when verify has lifecycle hooks', async () => {
		const commands: string[] = [];
		for (const hook of ['preverify', 'postverify']) {
			const dir = createTestTmpdir(`gship-focused-${hook}-`);
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
				verify: 'bun run check:all', 'check:all': 'bun test', [hook]: 'echo hook',
			} }));
			const verifier = new GitIssueVerifier({
				runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test', [hook]: 'echo hook' } })),
				loadIssue: () => issueWithVerification(['bun run check:all']),
				runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
			});
			expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		}
		expect(commands).toEqual(['bun run check:all', 'bun run check:all']);
	});

	test('preserves alias equivalence when only the terminal script has lifecycle hooks', async () => {
		const commands: string[] = [];
		for (const hook of ['precheck:all', 'postcheck:all']) {
			const dir = createTestTmpdir(`gship-focused-terminal-${hook}-`);
			const packageJson = JSON.stringify({ scripts: {
				verify: 'bun run check:all', 'check:all': 'bun test', [hook]: 'echo hook',
			} });
			writeFileSync(join(dir, 'package.json'), packageJson);
			const verifier = new GitIssueVerifier({
				runGit: focusedGitRunner(packageJson),
				loadIssue: () => issueWithVerification(['bun run check:all']),
				runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
			});
			expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true, skipped: true });
		}
		expect(commands).toEqual([]);
	});

	test('keeps focused aliases executable when the working tree changes the script chain or hooks', async () => {
		const commands: string[] = [];
		for (const workingTree of [
			{ verify: 'bun run other', 'check:all': 'bun test', other: 'bun test' },
			{ verify: 'bun run check:all', 'check:all': 'bun test', preverify: 'echo changed' },
		]) {
			const dir = createTestTmpdir('gship-focused-working-tree-drift-');
			const basePackage = JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } });
			writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: workingTree }));
			const verifier = new GitIssueVerifier({
				runGit: focusedGitRunner(basePackage),
				loadIssue: () => issueWithVerification(['bun run check:all']),
				runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
			});
			expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		}
		expect(commands).toEqual(['bun run check:all', 'bun run check:all']);
	});

	test('does not equate distinct scripts with identical bodies', async () => {
		const dir = createTestTmpdir('gship-focused-identical-bodies-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: {
			verify: 'bun test "$npm_lifecycle_event"', 'check:all': 'bun test "$npm_lifecycle_event"',
		} }));
		const commands: string[] = [];
		const verifier = new GitIssueVerifier({
			runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun test "$npm_lifecycle_event"', 'check:all': 'bun test "$npm_lifecycle_event"' } })),
			loadIssue: () => issueWithVerification(['bun run check:all']),
			runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		expect(commands).toEqual(['bun run check:all']);
	});

	test('keeps an external command executable when verify aliases to it by name', async () => {
		const dir = createTestTmpdir('gship-focused-external-command-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }));
		const commands: string[] = [];
		const verifier = new GitIssueVerifier({
			runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } })),
			loadIssue: () => issueWithVerification(['check:all']),
			runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		expect(commands).toEqual(['check:all']);
	});

	test('does not infer full verify identity when the base manifest is invalid', async () => {
		const dir = createTestTmpdir('gship-focused-invalid-manifest-');
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }));
		const commands: string[] = [];
		const verifier = new GitIssueVerifier({
			runGit: focusedGitRunner(JSON.stringify({ scripts: { verify: 'bun run check:all', 'check:all': 'bun test' } }), '{invalid'),
			loadIssue: () => issueWithVerification(['bun run check:all']),
			runCommand: async ({ command }) => { commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; },
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		expect(commands).toEqual(['bun run check:all']);
	});

	test('fails closed when the issue has no verification commands', async () => {
		const missing = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => JSON.stringify({ spec: { scope: 'no verify' } }),
		});
		expect(await missing.verify(verificationInput)).toMatchObject({
			ok: false,
			detail: 'issue has no verification commands',
		});
	});

	test('caps command diagnostics on a failed verification command', async () => {
		const failed = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => issueWithVerification(['false']),
			runCommand: async () => ({ exitCode: 7, stdout: 'x'.repeat(3_000), stderr: '' }),
		});
		const failedResult = await failed.verify(verificationInput);
		expect(failedResult.ok).toBe(false);
		expect(failedResult.detail).toEndWith('x'.repeat(2_000));
		expect(failedResult.detail?.length).toBeLessThan(2_100);
	});

	test('cancels and awaits a real verify subprocess group', async () => {
		const controller = new AbortController();
		const verifier = new GitIssueVerifier({
			runGit: gitRunner({ status: ' M src/a.ts' }),
			loadIssue: () => issueWithVerification([
				"trap 'exit 0' TERM; while :; do sleep 0.1; done",
			]),
			terminationGraceMs: 50,
		});
		const pending = verifier.verify({
			...verificationInput,
			cwd: process.cwd(),
			signal: controller.signal,
		});
		await Bun.sleep(30);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});

	test('the shared verification runner times out and terminates its subprocess group', async () => {
		const result = await runVerificationCommand({
			cwd: process.cwd(),
			command: "trap 'exit 0' TERM; while :; do sleep 0.1; done",
			signal: new AbortController().signal,
			timeoutMs: 20,
		}, 50);
		expect(result).toMatchObject({ exitCode: 124, timedOut: true });
		expect(result.stderr).toContain('timed out after 20ms');
	});

	test('passes only the allowlisted environment to a real verification subprocess', async () => {
		const keys = ['COLORTERM', 'GSHIP_WEB_DIR', 'GATESHIP_HOME', 'RESEND_API_KEY', 'GH_TOKEN', 'ARBITRARY_SENTINEL'];
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		Object.assign(process.env, {
			COLORTERM: 'allowed-terminal',
			GSHIP_WEB_DIR: 'forbidden-web-dir',
			GATESHIP_HOME: 'forbidden-gateship-home',
			RESEND_API_KEY: 'forbidden-resend-key',
			GH_TOKEN: 'forbidden-gh-token',
			ARBITRARY_SENTINEL: 'forbidden-arbitrary',
		});
		try {
			const result = await runVerificationCommand({
				cwd: process.cwd(),
				command: 'printf "%s|%s|%s|%s|%s|%s\\n" "$COLORTERM" "$GSHIP_WEB_DIR" "$GATESHIP_HOME" "$RESEND_API_KEY" "$GH_TOKEN" "$ARBITRARY_SENTINEL"',
				signal: new AbortController().signal,
			});
			expect(result).toMatchObject({ exitCode: 0, stdout: 'allowed-terminal|||||\n' });
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});
});

// GSHIP-629: the spec's executable premise. Checked by GitEvidenceChecker in
// the run's own workspace, after workspace.prepare and before the executor
// ever runs (run-runtime.ts) -- never by the preflight above, which runs
// before that workspace exists (the very first test in this file already
// covers a spec with no evidence field starting normally, unaffected).
describe('GitEvidenceChecker', () => {
	function issueWithEvidence(evidence: Array<{ command: string; output: string }>): string {
		const spec = { scope: 'Outcome backed by evidence.', verify: ['bun test'], evidence };
		return JSON.stringify({ spec });
	}

	test('a spec without evidence passes without running any command', async () => {
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => JSON.stringify({ spec: { scope: 'x', verify: ['bun test'] } }),
			runCommand: async () => {
				throw new Error('must not run any command when the spec has no evidence');
			},
		});
		expect(await checker.check(verificationInput)).toEqual({ ok: true });
	});

	test('matching evidence passes, running each command in the input cwd', async () => {
		const commands: string[] = [];
		const cwds: string[] = [];
		const timeouts: Array<number | undefined> = [];
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([{ command: 'echo hi', output: 'hi' }]),
			runCommand: async ({ cwd, command, timeoutMs }) => {
				commands.push(command);
				cwds.push(cwd);
				timeouts.push(timeoutMs);
				return { exitCode: 0, stdout: 'hi\n', stderr: '' };
			},
		});

		expect(await checker.check(verificationInput)).toEqual({ ok: true });
		expect(commands).toEqual(['echo hi']);
		expect(cwds).toEqual([verificationInput.cwd]);
		expect(timeouts).toEqual([VERIFICATION_COMMAND_TIMEOUT_MS]);
	});

	test('diverging evidence fails, showing the command and both outputs', async () => {
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([{ command: 'wc -l file.txt', output: '3 file.txt' }]),
			runCommand: async () => ({ exitCode: 0, stdout: '5 file.txt\n', stderr: '' }),
		});

		const result = await checker.check(verificationInput);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain('wc -l file.txt');
		expect(result.detail).toContain('3 file.txt');
		expect(result.detail).toContain('5 file.txt');
	});

	test('an evidence command that fails to run is treated as divergence', async () => {
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([{ command: 'nonexistent-tool', output: 'irrelevant' }]),
			runCommand: async () => ({ exitCode: 127, stdout: '', stderr: 'command not found' }),
		});

		const result = await checker.check(verificationInput);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain('evidence diverged');
	});

	// A command run against a repository that moved can print far more than the
	// 600 chars recorded at specify time; the refusal detail must not embed an
	// unbounded amount of it, same as the legacy verify diagnostic.
	test('caps the observed output shown in the divergence detail', async () => {
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([{ command: 'cat huge-file', output: 'short recorded output' }]),
			runCommand: async () => ({ exitCode: 0, stdout: 'x'.repeat(3_000), stderr: '' }),
		});

		const result = await checker.check(verificationInput);
		expect(result.ok).toBe(false);
		expect(result.detail).toContain('short recorded output');
		expect(result.detail).toContain('x'.repeat(2_000));
		expect(result.detail).not.toContain('x'.repeat(2_001));
		expect(result.detail?.length).toBeLessThan(2_200);
	});

	// GSHIP-629 (review): the checker runs in the workspace the run already
	// has -- it must never cut a worktree of its own, additional or otherwise.
	test('never registers a git worktree of its own', async () => {
		const repo = createTestTmpdir('gship-evidence-check-');
		defaultRunGit(repo, ['init', '-q']);
		const before = defaultRunGit(repo, ['worktree', 'list']).stdout;

		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([{ command: 'echo hi', output: 'hi' }]),
			runCommand: async () => ({ exitCode: 0, stdout: 'hi\n', stderr: '' }),
		});
		await checker.check({ ...verificationInput, cwd: repo });

		expect(defaultRunGit(repo, ['worktree', 'list']).stdout).toBe(before);
	});

	// GSHIP-629 (review): an evidence command runs through the same
	// cancellable, timeout-bound path GitIssueVerifier already uses, so a
	// command that hangs is terminated by the run's own abort instead of
	// blocking the service.
	test('a hanging evidence command is terminated by the run signal instead of hanging the process', async () => {
		const controller = new AbortController();
		const checker = new GitEvidenceChecker({
			loadIssueFromWorkspace: () => issueWithEvidence([
				{ command: "trap 'exit 0' TERM; while :; do sleep 0.1; done", output: 'never observed' },
			]),
			terminationGraceMs: 50,
		});
		const pending = checker.check({
			...verificationInput,
			cwd: process.cwd(),
			signal: controller.signal,
		});
		await Bun.sleep(30);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});

// GSHIP-649: the project's own full verification manifest, read straight from
// the run's own workspace `package.json` -- never a hardcoded command of its
// own -- and run through the same cancellable, timeout-bound path
// GitIssueVerifier and GitEvidenceChecker already use.
describe('GitFullVerifier', () => {
	function writePackageJson(dir: string, content: string): void {
		writeFileSync(join(dir, 'package.json'), content);
	}

	function neverRunCommand(): never {
		throw new Error('must not run any command when the project declares no verify script');
	}

	test('skips without running any command when package.json is missing', async () => {
		const dir = createTestTmpdir('gship-full-verify-no-file-');
		const verifier = new GitFullVerifier({ runGit: fullVerifyGitRunner(), runCommand: () => neverRunCommand() });
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true, skipped: true });
	});

	test('skips without running any command when package.json is invalid JSON', async () => {
		const dir = createTestTmpdir('gship-full-verify-bad-json-');
		writePackageJson(dir, '{ not valid json');
		const verifier = new GitFullVerifier({ runGit: fullVerifyGitRunner(), runCommand: () => neverRunCommand() });
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true, skipped: true });
	});

	test('skips without running any command when package.json declares no verify script', async () => {
		const cases: Array<[string, unknown]> = [
			['no scripts field at all', { name: 'x' }],
			['scripts present but no verify key', { scripts: { test: 'bun test' } }],
			['verify present but not a string', { scripts: { verify: ['bun', 'run', 'check:all'] } }],
			['scripts is not an object', { scripts: 'bun run check:all' }],
		];
		for (const [label, content] of cases) {
			const dir = createTestTmpdir('gship-full-verify-skip-');
			writePackageJson(dir, JSON.stringify(content));
			const verifier = new GitFullVerifier({
				runGit: fullVerifyGitRunner(),
				runCommand: () => { throw new Error(`must not run any command: ${label}`); },
			});
			expect(await verifier.verify({ ...verificationInput, cwd: dir }))
				.toEqual({ ok: true, skipped: true });
		}
	});

	test('runs bun run verify and emits command lifecycle events when a script is declared', async () => {
		const dir = createTestTmpdir('gship-full-verify-clean-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const commands: Array<{ cwd: string; command: string; timeoutMs: number | undefined }> = [];
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: fullVerifyGitRunner(),
			runCommand: async ({ cwd, command, timeoutMs }) => {
				commands.push({ cwd, command, timeoutMs });
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});

		const result = await verifier.verify({
			...verificationInput,
			cwd: dir,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true });
		// The command is always `bun run verify`, never the script's own content
		// (`bun run check:all` above): the slice never hardcodes or inlines what
		// the project declared, it only asks bun to resolve the script by name.
		expect(commands).toEqual([{ cwd: dir, command: 'bun run verify', timeoutMs: undefined }]);
		expect(events).toEqual([
			{ kind: 'full-verify.command.started', payload: { commandIndex: 1, origin: 'package.json' } },
			{ kind: 'full-verify.command.completed', payload: { commandIndex: 1, command: 'bun run verify', exitCode: 0, origin: 'package.json', verifiedVersion: 'unknown' } },
		]);
	});

	test('reads the versioned manifest and rejects invalid contracts', () => {
		expect(readProjectVerificationManifest(JSON.stringify({ version: 1, verify: ['bun test', 'python -m pytest'] })))
			.toEqual({ version: 1, verify: ['bun test', 'python -m pytest'] });
		for (const value of [
			{ version: 2, verify: ['bun test'] },
			{ version: 1, verify: [] },
			{ version: 1, verify: ['   '] },
			{ version: 1, verify: ['bun test', 42] },
		]) {
			expect(() => readProjectVerificationManifest(JSON.stringify(value))).toThrow();
		}
	});

	test('uses the immutable merge-base manifest and ignores worktree edits', async () => {
		const commands: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: args[0] === 'ls-tree'
					? { exitCode: 0, stdout: '.gateship/project.json\n', stderr: '' }
					: args[0] === 'show' && args[1] === 'base-sha:.gateship/project.json'
				? { exitCode: 0, stdout: JSON.stringify({ version: 1, verify: ['bun test', 'python -m pytest'] }), stderr: '' }
				: { exitCode: 0, stdout: '', stderr: '' },
			runCommand: async ({ command }) => {
				commands.push(command);
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});
		expect(await verifier.verify({ ...verificationInput, cwd: '/edited-worktree' })).toEqual({ ok: true });
		expect(commands).toEqual(['bun test', 'python -m pytest']);
	});

	test('passes the same allowlisted environment to a real manifest full-verify subprocess', async () => {
		const keys = ['COLORTERM', 'GSHIP_WEB_DIR', 'GATESHIP_HOME', 'RESEND_API_KEY', 'GH_TOKEN', 'ARBITRARY_SENTINEL'];
		const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
		Object.assign(process.env, {
			COLORTERM: 'allowed-terminal',
			GSHIP_WEB_DIR: 'forbidden-web-dir',
			GATESHIP_HOME: 'forbidden-gateship-home',
			RESEND_API_KEY: 'forbidden-resend-key',
			GH_TOKEN: 'forbidden-gh-token',
			ARBITRARY_SENTINEL: 'forbidden-arbitrary',
		});
		try {
			const verifier = new GitFullVerifier({
				runGit: (_cwd, args) => args[0] === 'merge-base'
					? { exitCode: 0, stdout: 'base-sha\\n', stderr: '' }
					: args[0] === 'ls-tree'
						? { exitCode: 0, stdout: '.gateship/project.json\\n', stderr: '' }
						: { exitCode: 0, stdout: JSON.stringify({ version: 1, verify: [
							'test "$COLORTERM" = allowed-terminal && test -z "$GSHIP_WEB_DIR" && test -z "$GATESHIP_HOME" && test -z "$RESEND_API_KEY" && test -z "$GH_TOKEN" && test -z "$ARBITRARY_SENTINEL"',
						] }), stderr: '' },
			});
			expect(await verifier.verify({ ...verificationInput, cwd: process.cwd() })).toEqual({ ok: true });
		} finally {
			for (const key of keys) {
				if (previous[key] === undefined) delete process.env[key];
				else process.env[key] = previous[key];
			}
		}
	});

	test('preserves the worktree package.json fallback when the base has no manifest', async () => {
		const dir = createTestTmpdir('gship-full-verify-worktree-fallback-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const commands: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: args[0] === 'ls-tree'
					? { exitCode: 0, stdout: '', stderr: '' }
					: { exitCode: 1, stdout: '', stderr: 'unexpected Git call' },
			runCommand: async ({ command }) => {
				commands.push(command);
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});
		expect(await verifier.verify({ ...verificationInput, cwd: dir })).toEqual({ ok: true });
		expect(commands).toEqual(['bun run verify']);
	});

	test('fails closed when Git cannot prove the manifest is absent', async () => {
		const dir = createTestTmpdir('gship-full-verify-git-error-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const verifier = new GitFullVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: { exitCode: 1, stdout: '', stderr: 'cannot inspect tree' },
			runCommand: async () => { throw new Error('fallback must not run'); },
		});
		expect(verifier.verify({ ...verificationInput, cwd: dir })).rejects.toThrow('cannot inspect');
	});

	test('fails with a prefixed detail carrying the command output when the exit code is not zero', async () => {
		const dir = createTestTmpdir('gship-full-verify-failed-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const events: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: fullVerifyGitRunner(),
			runCommand: async () => ({
				exitCode: 1,
				stdout: 'stale bundle\n',
				stderr: 'error: dist/ out of date\n',
			}),
		});

		const result = await verifier.verify({
			...verificationInput,
			cwd: dir,
			emit: (kind) => events.push(kind),
		});

		expect(result.ok).toBe(false);
		expect(result.detail).toStartWith('full verification failed:');
		expect(result.detail).toContain('stale bundle');
		expect(result.detail).toContain('error: dist/ out of date');
		// The command still ran to completion and reported its exit code, even
		// though the overall result is a failure.
		expect(events).toEqual(['full-verify.command.started', 'full-verify.command.completed']);
	});

	test('caps command diagnostics on a failed full verification, same as the issue verifier', async () => {
		const dir = createTestTmpdir('gship-full-verify-capped-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const verifier = new GitFullVerifier({
			runGit: fullVerifyGitRunner(),
			runCommand: async () => ({ exitCode: 1, stdout: 'x'.repeat(3_000), stderr: '' }),
		});

		const result = await verifier.verify({ ...verificationInput, cwd: dir });
		expect(result.ok).toBe(false);
		expect(result.detail).toEndWith('x'.repeat(2_000));
		expect(result.detail?.length).toBeLessThan(2_100);
	});

	test('cancels and awaits a real full-verify subprocess group', async () => {
		const dir = createTestTmpdir('gship-full-verify-cancel-');
		writePackageJson(dir, JSON.stringify({
			scripts: { verify: "trap 'exit 0' TERM; while :; do sleep 0.1; done" },
		}));
		const controller = new AbortController();
		const verifier = new GitFullVerifier({ runGit: fullVerifyGitRunner(), terminationGraceMs: 50 });
		const pending = verifier.verify({
			...verificationInput,
			cwd: dir,
			signal: controller.signal,
		});
		await Bun.sleep(30);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});

// GSHIP-893: the mutation sensor, a step of `GitFullVerifier.verify` that
// runs only once a `mutationSelector` is configured and the project's own
// verify already passed.
describe('GitFullVerifier mutation sensor (GSHIP-893)', () => {
	function writePackageJson(dir: string, content: string): void {
		writeFileSync(join(dir, 'package.json'), content);
	}

	type FixtureMutationType = 'condition-inverted' | 'return-altered' | 'off-by-one' | 'side-effect-removed';
	function candidate(overrides: Partial<{ file: string; line: number; type: FixtureMutationType; patch: string }> = {}) {
		return { file: 'src/a.ts', line: 10, type: 'condition-inverted' as FixtureMutationType, patch: 'fixture-patch', ...overrides };
	}

	type FakeGitResult = { exitCode: number; stdout: string; stderr: string };

	/** `worktree add`'s response is the only one an override can replace; `remove`/`prune` always succeed, and any other subcommand is unhandled (`null`), same as an unrecognized top-level command. */
	function fakeWorktreeResponse(args: string[], worktreeAdd?: FakeGitResult): FakeGitResult | null {
		if (args[1] === 'add') return worktreeAdd ?? { exitCode: 0, stdout: '', stderr: '' };
		if (args[1] === 'remove' || args[1] === 'prune') return { exitCode: 0, stdout: '', stderr: '' };
		return null;
	}

	/**
	 * `git apply --numstat -z`/`--summary` are the read-only checks
	 * `rejectedMutationPatch` (git-runtime.ts) runs before ever applying a
	 * candidate's patch; a bare `apply <file>` (no flag) is the actual
	 * application, used both for the reproduced working diff and, once the
	 * checks above pass, the mutation patch itself. Defaults describe a
	 * clean, single-file edit to `src/a.ts` -- the default `candidate()`'s own
	 * `file` below -- so a test that never overrides these still exercises the
	 * real validation path instead of skipping it.
	 */
	function fakeApplyResponse(args: string[], overrides: { apply?: FakeGitResult; numstat?: FakeGitResult; summary?: FakeGitResult }): FakeGitResult {
		if (args.includes('--numstat')) return overrides.numstat ?? { exitCode: 0, stdout: '1\t1\tsrc/a.ts\0', stderr: '' };
		if (args.includes('--summary')) return overrides.summary ?? { exitCode: 0, stdout: '', stderr: '' };
		return overrides.apply ?? { exitCode: 0, stdout: '', stderr: '' };
	}

	/**
	 * Handles every Git call the sensor makes against a clean `dir` with a
	 * declared `bun run verify` script and no manifest: `rev-parse`/`diff`/
	 * `status` for the scratch worktree, `worktree add`/`remove`/`prune` for
	 * its lifecycle, and `apply` (bare, `--numstat` and `--summary`) for both
	 * the reproduced working diff and the mutation patch itself. `calls`
	 * records every invocation so a test can assert the real `dir` is never
	 * written to.
	 */
	function mutationGitRunner(calls: { cwd: string; args: string[] }[], overrides: {
		worktreeAdd?: FakeGitResult;
		apply?: FakeGitResult;
		numstat?: FakeGitResult;
		summary?: FakeGitResult;
	} = {}): GitCommandRunner {
		const responses: Record<string, FakeGitResult> = {
			'merge-base': { exitCode: 0, stdout: 'base-sha\n', stderr: '' },
			'ls-tree': { exitCode: 0, stdout: '', stderr: '' },
			'rev-parse': { exitCode: 0, stdout: 'head-sha\n', stderr: '' },
			diff: { exitCode: 0, stdout: '', stderr: '' },
			status: { exitCode: 0, stdout: '', stderr: '' },
		};
		return (cwd, args) => {
			calls.push({ cwd, args });
			const command = args[0] ?? '';
			if (command === 'worktree') {
				return fakeWorktreeResponse(args, overrides.worktreeAdd) ?? { exitCode: 1, stdout: '', stderr: `unexpected Git call: ${args.join(' ')}` };
			}
			if (command === 'apply') return fakeApplyResponse(args, overrides);
			return responses[command] ?? { exitCode: 1, stdout: '', stderr: `unexpected Git call: ${args.join(' ')}` };
		};
	}

	function verifierInput(dir: string, extra: Record<string, unknown> = {}) {
		return { ...verificationInput, cwd: dir, approvedContract: issueWithVerification(['bun test src/a.test.ts']), ...extra };
	}

	test('records a killed mutant and stays ok when the issue verify commands catch it', async () => {
		const dir = createTestTmpdir('gship-mutation-killed-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const calls: { cwd: string; args: string[] }[] = [];
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner(calls),
			runCommand: async ({ cwd }) => cwd === dir
				? { exitCode: 0, stdout: '', stderr: '' } // the project's own full verify
				: { exitCode: 1, stdout: 'test failed on the mutant', stderr: '' }, // the issue verify, in the scratch worktree
			mutationSelector: { select: async () => ({ candidates: [candidate()] }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result).toEqual({ ok: true });
		const sensorEvent = events.find((event) => event.kind === 'run.mutation-sensor');
		expect(sensorEvent?.payload).toMatchObject({
			file: 'src/a.ts', line: 10, type: 'condition-inverted', command: 'bun test src/a.test.ts', outcome: 'killed',
		});
		expect(typeof sensorEvent?.payload?.['durationMs']).toBe('number');
		// The real worktree is only ever read from, never written to: `git apply`
		// -- the only write-shaped call the sensor makes -- always runs against
		// the scratch path, never against `dir`.
		expect(calls.filter((call) => call.args[0] === 'apply').every((call) => call.cwd !== dir)).toBe(true);
	});

	test('records a surviving mutant and fails the full verification', async () => {
		const dir = createTestTmpdir('gship-mutation-survived-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }), // clean everywhere: the mutant is never caught
			mutationSelector: { select: async () => ({ candidates: [candidate({ type: 'return-altered' })] }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result.ok).toBe(false);
		expect(result.detail).toContain('mutation sensor');
		expect(result.detail).toContain('src/a.ts:10');
		expect(events.find((event) => event.kind === 'run.mutation-sensor')?.payload).toMatchObject({
			file: 'src/a.ts', line: 10, type: 'return-altered', outcome: 'survived',
		});
	});

	test('a diff with no executable target emits run.mutation-sensor-skipped, distinguishable from omission', async () => {
		const dir = createTestTmpdir('gship-mutation-no-target-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
			mutationSelector: { select: async () => ({ candidates: [], skippedReason: 'the diff only touches test files' }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result).toEqual({ ok: true });
		expect(events).toEqual([
			{ kind: 'full-verify.command.started', payload: { commandIndex: 1, origin: 'package.json' } },
			{ kind: 'full-verify.command.completed', payload: { commandIndex: 1, command: 'bun run verify', exitCode: 0, origin: 'package.json', verifiedVersion: 'unknown' } },
			{ kind: 'run.mutation-sensor-skipped', payload: { reason: 'the diff only touches test files' } },
		]);
	});

	test('a worktree the sensor cannot create is inconclusive, and the run carries on with an event', async () => {
		const dir = createTestTmpdir('gship-mutation-worktree-failure-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		let issueVerifyRan = false;
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([], { worktreeAdd: { exitCode: 1, stdout: '', stderr: 'no space left on device' } }),
			runCommand: async ({ cwd }) => {
				if (cwd !== dir) issueVerifyRan = true;
				return { exitCode: 0, stdout: '', stderr: '' };
			},
			mutationSelector: { select: async () => ({ candidates: [candidate()] }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result).toEqual({ ok: true });
		expect(issueVerifyRan).toBe(false);
		const sensorEvent = events.find((event) => event.kind === 'run.mutation-sensor');
		expect(sensorEvent?.payload?.['outcome']).toBe('inconclusive');
		expect(sensorEvent?.payload?.['command']).toBeUndefined();
		expect(String(sensorEvent?.payload?.['reason'])).toContain('no space left on device');
	});

	test('cleans up the scratch worktree even when the run is cancelled mid mutation attempt', async () => {
		const dir = createTestTmpdir('gship-mutation-abort-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const controller = new AbortController();
		const calls: { cwd: string; args: string[] }[] = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner(calls),
			runCommand: async ({ cwd }) => {
				if (cwd === dir) return { exitCode: 0, stdout: '', stderr: '' };
				controller.abort();
				throw new DOMException('cancelled', 'AbortError');
			},
			mutationSelector: { select: async () => ({ candidates: [candidate()] }) },
		});

		const pending = verifier.verify(verifierInput(dir, { signal: controller.signal }));
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(calls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(true);
	});

	test('never tests more than 3 candidates in one run, even when the selector proposes more', async () => {
		const dir = createTestTmpdir('gship-mutation-limit-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		let attempts = 0;
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async ({ cwd }) => {
				if (cwd !== dir) attempts += 1;
				return { exitCode: 0, stdout: '', stderr: '' };
			},
			mutationSelector: {
				select: async () => ({
					candidates: [0, 1, 2, 3, 4].map((line) => candidate({ line })),
				}),
			},
		});

		await verifier.verify(verifierInput(dir));
		expect(attempts).toBe(3);
	});

	test('never runs the sensor when the run carries no approved contract, even with a selector configured', async () => {
		const dir = createTestTmpdir('gship-mutation-no-contract-');
		writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
		const events: string[] = [];
		let selected = false;
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
			mutationSelector: { select: async () => { selected = true; return { candidates: [candidate()] }; } },
		});

		const result = await verifier.verify({
			...verificationInput, cwd: dir,
			emit: (kind: string) => events.push(kind),
		});

		expect(result).toEqual({ ok: true });
		expect(selected).toBe(false);
		expect(events).toEqual(['full-verify.command.started', 'full-verify.command.completed']);
	});

	// GSHIP-893, fixing a review finding: the mutation patch's own paths are
	// validated against Git's read-only `--numstat`/`--summary`, never trusted
	// from `candidate.file` -- a patch that touches anything else is rejected
	// before it is ever applied, so it can never silently produce a false
	// `killed`/`survived` for a file nobody actually mutated.
	function inconclusiveApplyCase(name: string, overrides: { numstat?: { exitCode: number; stdout: string; stderr: string }; summary?: { exitCode: number; stdout: string; stderr: string } }, expectedReasonContains: string): void {
		test(name, async () => {
			const dir = createTestTmpdir('gship-mutation-patch-scope-');
			writePackageJson(dir, JSON.stringify({ scripts: { verify: 'bun run check:all' } }));
			const calls: { cwd: string; args: string[] }[] = [];
			const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
			const verifier = new GitFullVerifier({
				runGit: mutationGitRunner(calls, overrides),
				runCommand: async ({ cwd }) => {
					if (cwd !== dir) throw new Error('must not run any issue verify command for a rejected patch');
					return { exitCode: 0, stdout: '', stderr: '' };
				},
				mutationSelector: { select: async () => ({ candidates: [candidate()] }) },
			});

			const result = await verifier.verify(verifierInput(dir, {
				emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
			}));

			expect(result).toEqual({ ok: true });
			const sensorEvent = events.find((event) => event.kind === 'run.mutation-sensor');
			expect(sensorEvent?.payload).toMatchObject({ file: 'src/a.ts', line: 10, outcome: 'inconclusive' });
			expect(sensorEvent?.payload?.['command']).toBeUndefined();
			expect(String(sensorEvent?.payload?.['reason'])).toContain(expectedReasonContains);
			// Never applied: the only `apply` calls are the read-only `--numstat`/`--summary` checks.
			expect(calls.some((call) => call.args[0] === 'apply' && !call.args.includes('--numstat') && !call.args.includes('--summary'))).toBe(false);
		});
	}

	inconclusiveApplyCase(
		'rejects a patch whose numstat touches the declared file plus a test file',
		{ numstat: { exitCode: 0, stdout: '1\t1\tsrc/a.ts\x001\t1\tsrc/a.test.ts\x00', stderr: '' } },
		'src/a.test.ts',
	);

	inconclusiveApplyCase(
		'rejects a patch whose numstat touches only a different file than the candidate declared',
		{ numstat: { exitCode: 0, stdout: '1\t1\tsrc/a.test.ts\0', stderr: '' } },
		'src/a.test.ts',
	);

	inconclusiveApplyCase(
		'rejects a patch whose summary is non-empty, never a plain content edit',
		{ summary: { exitCode: 0, stdout: ' delete mode 100644 src/a.ts\n', stderr: '' } },
		'delete mode 100644 src/a.ts',
	);

	// The sensor is tied to the issue's own approved verify (`spec.verify`),
	// which already passed before `full-verify` was ever entered -- not to
	// whether the project separately declares a full-verify script. A project
	// with none must still run the sensor, never treat the absence as a
	// silent omission of mutation-sensor evidence too.
	test('still runs the sensor, and blocks a surviving mutant, when the project declares no full-verify script at all', async () => {
		const dir = createTestTmpdir('gship-mutation-no-project-verify-');
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }), // never fails: the mutant survives
			mutationSelector: { select: async () => ({ candidates: [candidate()] }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result.ok).toBe(false);
		expect(result.detail).toContain('mutation sensor');
		expect(events[0]).toEqual({ kind: 'full-verify.skipped', payload: { reason: 'no-project-verification' } });
		expect(events.find((event) => event.kind === 'run.mutation-sensor')?.payload).toMatchObject({ outcome: 'survived' });
	});

	test('still reports full-verify.skipped as an overall skip when the sensor also finds nothing to test', async () => {
		const dir = createTestTmpdir('gship-mutation-no-project-verify-no-target-');
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const verifier = new GitFullVerifier({
			runGit: mutationGitRunner([]),
			runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
			mutationSelector: { select: async () => ({ candidates: [], skippedReason: 'only tests changed' }) },
		});

		const result = await verifier.verify(verifierInput(dir, {
			emit: (kind: string, payload?: Record<string, unknown>) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		}));

		expect(result).toEqual({ ok: true, skipped: true });
		expect(events).toEqual([
			{ kind: 'full-verify.skipped', payload: { reason: 'no-project-verification' } },
			{ kind: 'run.mutation-sensor-skipped', payload: { reason: 'only tests changed' } },
		]);
	});
});

// GSHIP-893, fixing a review finding: the tests above all drive
// `createMutationWorktree`/`removeMutationWorktree` through the fake
// `mutationGitRunner`, so the real `git worktree add`, the real reapplication
// of `git diff HEAD`, the real untracked-file copy, the real cleanup and the
// `git status --porcelain` invariant were never actually exercised. This
// block runs the same scenarios against a real temporary Git repository and
// `runVerificationCommand` (no fake `runCommand`), so every one of those is
// proven for real, not assumed from the fake's behavior.
describe('GitFullVerifier mutation sensor against a real Git repository (GSHIP-893)', () => {
	// The committed base: `HEAD` has only `greet`.
	const BASE_FILE = "export function greet(name: string): string {\n\treturn 'hi ' + name;\n}\n";
	// The run's own uncommitted change on top of `HEAD`: adds `shout`. Never
	// committed -- full-verify always runs against a dirty worktree, so the
	// scratch worktree must reproduce this or the sensor tests nothing new.
	const CHANGED_FILE = "export function greet(name: string): string {\n\treturn 'hi ' + name;\n}\n\nexport function shout(name: string): string {\n\treturn 'HELLO ' + name;\n}\n";
	// Depends on both the uncommitted change (the `HELLO` line exists only in
	// `CHANGED_FILE`) and the untracked file below -- a scratch worktree that
	// failed to reproduce either one would fail this regardless of any
	// mutation, so a real "killed"/"survived" verdict is proof both worked.
	const VERIFY_COMMAND = `test -f src/note.txt && grep -q "return 'HELLO ' + name;" src/a.ts`;

	// Targets the `shout` line the verify command greps for: a scratch
	// worktree that never reproduced the uncommitted change has no such line
	// for this patch to match, so `git apply` itself would fail (inconclusive),
	// never silently produce a false "killed".
	const KILLED_PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -4,4 +4,4 @@

 export function shout(name: string): string {
-\treturn 'HELLO ' + name;
+\treturn 'BYE ' + name;
 }
`;
	// Targets `greet`, unchanged between the base commit and the uncommitted
	// version, so this patch applies either way -- only `VERIFY_COMMAND`'s own
	// dependency on the reapplied diff and the copied untracked file can tell
	// a real "survived" apart from a scratch worktree that silently lost them.
	const SURVIVED_PATCH = `--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 export function greet(name: string): string {
-\treturn 'hi ' + name;
+\treturn 'yo ' + name;
 }
`;

	function git(dir: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
		const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
		return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
	}

	/** A real repository, `origin/main` pointing at the one base commit, and the run's own uncommitted change plus an untracked file on top -- exactly what a run's workspace looks like when `full-verify` runs. */
	function initMutationSensorRepo(prefix: string): string {
		const dir = createTestTmpdir(prefix);
		git(dir, ['init', '-q']);
		git(dir, ['config', 'user.email', 'mutation-sensor@example.com']);
		git(dir, ['config', 'user.name', 'Mutation Sensor']);
		mkdirSync(join(dir, 'src'), { recursive: true });
		writeFileSync(join(dir, 'src', 'a.ts'), BASE_FILE);
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-q', '-m', 'base']);
		const baseSha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
		git(dir, ['update-ref', 'refs/remotes/origin/main', baseSha]);
		writeFileSync(join(dir, 'src', 'a.ts'), CHANGED_FILE);
		writeFileSync(join(dir, 'src', 'note.txt'), 'note\n');
		return dir;
	}

	function mutationApprovedContract(): string {
		return issueWithVerification([VERIFY_COMMAND]);
	}

	/** `git status`, `git worktree list` and every tracked/untracked file's content -- the whole observable state `git status --porcelain` equal before and after is meant to protect. */
	function repoSnapshot(dir: string): { status: string; worktrees: string; files: Record<string, string> } {
		return {
			status: git(dir, ['status', '--porcelain', '--untracked-files=all']).stdout,
			worktrees: git(dir, ['worktree', 'list', '--porcelain']).stdout,
			files: {
				'src/a.ts': readFileSync(join(dir, 'src', 'a.ts'), 'utf8'),
				'src/note.txt': readFileSync(join(dir, 'src', 'note.txt'), 'utf8'),
			},
		};
	}

	/** The real `defaultRunGit`, recording every scratch worktree path the sensor asked Git to create. */
	function trackingGit(worktreePaths: string[]): GitCommandRunner {
		return (cwd, args) => {
			if (args[0] === 'worktree' && args[1] === 'add') worktreePaths.push(args[3]!);
			return defaultRunGit(cwd, args);
		};
	}

	/** Delegates every call to the real Git except `worktree add`, which always fails -- so nothing about the failure is simulated except the one call the coverage item is about. */
	function failingWorktreeAddGit(): GitCommandRunner {
		return (cwd, args) => (args[0] === 'worktree' && args[1] === 'add')
			? { exitCode: 1, stdout: '', stderr: 'simulated: cannot create the scratch worktree' }
			: defaultRunGit(cwd, args);
	}

	test('a killed mutant reapplies the uncommitted change and the untracked file, and leaves the real repository untouched', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-killed-');
		const worktreePaths: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: trackingGit(worktreePaths),
			mutationSelector: { select: async () => ({ candidates: [{ file: 'src/a.ts', line: 6, type: 'return-altered' as const, patch: KILLED_PATCH }] }) },
		});
		const before = repoSnapshot(dir);
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];

		const result = await verifier.verify({
			...verificationInput, cwd: dir, approvedContract: mutationApprovedContract(),
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true, skipped: true });
		expect(repoSnapshot(dir)).toEqual(before);
		expect(worktreePaths).toHaveLength(1);
		expect(existsSync(worktreePaths[0]!)).toBe(false);
		expect(events.find((event) => event.kind === 'run.mutation-sensor')?.payload)
			.toMatchObject({ file: 'src/a.ts', line: 6, outcome: 'killed', command: VERIFY_COMMAND });
	});

	// GSHIP-893, fixing a review finding: a patch whose own headers touch a
	// different file than `candidate.file` declared is rejected by Git's own
	// `--numstat` reading of it, never applied -- so it can never silently
	// mutate the wrong file and report a `killed`/`survived` that does not
	// correspond to what the event claims.
	test('rejects a patch whose real headers touch a different file than the candidate declared, and leaves the repository untouched', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-file-mismatch-');
		const mismatchedPatch = `--- a/src/note.txt
+++ b/src/note.txt
@@ -1 +1 @@
-note
+note!
`;
		const worktreePaths: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: trackingGit(worktreePaths),
			mutationSelector: { select: async () => ({ candidates: [{ file: 'src/a.ts', line: 1, type: 'return-altered' as const, patch: mismatchedPatch }] }) },
		});
		const before = repoSnapshot(dir);
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];

		const result = await verifier.verify({
			...verificationInput, cwd: dir, approvedContract: mutationApprovedContract(),
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true, skipped: true });
		expect(repoSnapshot(dir)).toEqual(before);
		expect(worktreePaths).toHaveLength(1);
		expect(existsSync(worktreePaths[0]!)).toBe(false);
		const sensorEvent = events.find((event) => event.kind === 'run.mutation-sensor');
		expect(sensorEvent?.payload).toMatchObject({ file: 'src/a.ts', line: 1, outcome: 'inconclusive' });
		expect(sensorEvent?.payload?.['command']).toBeUndefined();
		expect(String(sensorEvent?.payload?.['reason'])).toContain('src/note.txt');
	});

	test('a surviving mutant fails full verification and still leaves the real repository untouched', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-survived-');
		const worktreePaths: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: trackingGit(worktreePaths),
			mutationSelector: { select: async () => ({ candidates: [{ file: 'src/a.ts', line: 2, type: 'return-altered' as const, patch: SURVIVED_PATCH }] }) },
		});
		const before = repoSnapshot(dir);

		const result = await verifier.verify({ ...verificationInput, cwd: dir, approvedContract: mutationApprovedContract() });

		expect(result.ok).toBe(false);
		expect(result.detail).toContain('src/a.ts:2');
		expect(repoSnapshot(dir)).toEqual(before);
		expect(worktreePaths).toHaveLength(1);
		expect(existsSync(worktreePaths[0]!)).toBe(false);
	});

	test('a diff with no executable target never registers a scratch worktree', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-no-target-');
		const worktreePaths: string[] = [];
		const verifier = new GitFullVerifier({
			runGit: trackingGit(worktreePaths),
			mutationSelector: { select: async () => ({ candidates: [], skippedReason: 'only tests changed' }) },
		});
		const before = repoSnapshot(dir);
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];

		const result = await verifier.verify({
			...verificationInput, cwd: dir, approvedContract: mutationApprovedContract(),
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true, skipped: true });
		expect(repoSnapshot(dir)).toEqual(before);
		expect(worktreePaths).toHaveLength(0);
		expect(events.find((event) => event.kind === 'run.mutation-sensor-skipped')?.payload)
			.toEqual({ reason: 'only tests changed' });
	});

	test('a worktree the sensor cannot create is inconclusive, with an event, and leaves the real repository untouched', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-worktree-failure-');
		const verifier = new GitFullVerifier({
			runGit: failingWorktreeAddGit(),
			mutationSelector: { select: async () => ({ candidates: [{ file: 'src/a.ts', line: 6, type: 'return-altered' as const, patch: KILLED_PATCH }] }) },
		});
		const before = repoSnapshot(dir);
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];

		const result = await verifier.verify({
			...verificationInput, cwd: dir, approvedContract: mutationApprovedContract(),
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});

		expect(result).toEqual({ ok: true, skipped: true });
		expect(repoSnapshot(dir)).toEqual(before);
		const sensorEvent = events.find((event) => event.kind === 'run.mutation-sensor');
		expect(sensorEvent?.payload?.['outcome']).toBe('inconclusive');
		expect(sensorEvent?.payload?.['command']).toBeUndefined();
		expect(String(sensorEvent?.payload?.['reason'])).toContain('cannot create the scratch worktree');
	});

	test('cleans up a real scratch worktree even when the run is cancelled mid mutation attempt', async () => {
		const dir = initMutationSensorRepo('gship-mutation-real-abort-');
		const worktreePaths: string[] = [];
		const controller = new AbortController();
		const verifier = new GitFullVerifier({
			runGit: trackingGit(worktreePaths),
			runCommand: async () => {
				controller.abort();
				throw new DOMException('cancelled', 'AbortError');
			},
			mutationSelector: { select: async () => ({ candidates: [{ file: 'src/a.ts', line: 6, type: 'return-altered' as const, patch: KILLED_PATCH }] }) },
		});
		const before = repoSnapshot(dir);

		const pending = verifier.verify({
			...verificationInput, cwd: dir, approvedContract: mutationApprovedContract(), signal: controller.signal,
		});
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

		expect(repoSnapshot(dir)).toEqual(before);
		expect(worktreePaths).toHaveLength(1);
		expect(existsSync(worktreePaths[0]!)).toBe(false);
	});
});

// GSHIP-900: reads the project's per-round lint commands from the same
// immutable base manifest as GitFullVerifier's `verify`, never inferring one
// from the stack.
describe('GitLintVerifier', () => {
	test('skips without running any command when the base manifest declares no lint', async () => {
		const verifier = new GitLintVerifier({
			runGit: fullVerifyGitRunner(),
			runCommand: () => { throw new Error('must not run any command when the project declares no lint'); },
		});
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const result = await verifier.verify({
			...verificationInput,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});
		expect(result).toEqual({ ok: true, skipped: true });
		expect(events).toEqual([{ kind: 'lint.skipped', payload: { reason: 'no-project-lint' } }]);
	});

	test('runs every declared lint command from the immutable base manifest and emits lifecycle events', async () => {
		const commands: string[] = [];
		const verifier = new GitLintVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: args[0] === 'ls-tree'
					? { exitCode: 0, stdout: '.gateship/project.json\n', stderr: '' }
					: args[0] === 'show'
						? { exitCode: 0, stdout: JSON.stringify({ version: 1, verify: ['bun test'], lint: ['bun run lint'] }), stderr: '' }
						: { exitCode: 0, stdout: '', stderr: '' },
			runCommand: async ({ command }) => {
				commands.push(command);
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const result = await verifier.verify({
			...verificationInput,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});
		expect(result).toEqual({ ok: true });
		expect(commands).toEqual(['bun run lint']);
		expect(events).toEqual([
			{ kind: 'lint.command.started', payload: { commandIndex: 1 } },
			{ kind: 'lint.command.completed', payload: { commandIndex: 1, command: 'bun run lint', exitCode: 0, verifiedVersion: 'unknown', durationMs: expect.any(Number) } },
		]);
	});

	test('ignores a worktree edit to the manifest and keeps using the base-authorized lint commands', async () => {
		const dir = createTestTmpdir('gship-lint-immutable-');
		mkdirSync(join(dir, '.gateship'), { recursive: true });
		writeFileSync(join(dir, '.gateship/project.json'), JSON.stringify({ version: 1, verify: ['bun test'], lint: ['echo tampered'] }));
		const commands: string[] = [];
		const verifier = new GitLintVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: args[0] === 'ls-tree'
					? { exitCode: 0, stdout: '.gateship/project.json\n', stderr: '' }
					: args[0] === 'show'
						? { exitCode: 0, stdout: JSON.stringify({ version: 1, verify: ['bun test'], lint: ['bun run lint'] }), stderr: '' }
						: { exitCode: 0, stdout: '', stderr: '' },
			runCommand: async ({ command }) => {
				commands.push(command);
				return { exitCode: 0, stdout: '', stderr: '' };
			},
		});
		const result = await verifier.verify({ ...verificationInput, cwd: dir });
		expect(result).toEqual({ ok: true });
		expect(commands).toEqual(['bun run lint']);
	});

	test('fails with a prefixed detail carrying the command output when a lint command exits non-zero', async () => {
		const verifier = new GitLintVerifier({
			runGit: (_cwd, args) => args[0] === 'merge-base'
				? { exitCode: 0, stdout: 'base-sha\n', stderr: '' }
				: args[0] === 'ls-tree'
					? { exitCode: 0, stdout: '.gateship/project.json\n', stderr: '' }
					: args[0] === 'show'
						? { exitCode: 0, stdout: JSON.stringify({ version: 1, verify: ['bun test'], lint: ['bun run lint'] }), stderr: '' }
						: { exitCode: 0, stdout: '', stderr: '' },
			runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'complexity too high' }),
		});
		const events: Array<{ kind: string; payload?: Record<string, unknown> }> = [];
		const result = await verifier.verify({
			...verificationInput,
			emit: (kind, payload) => events.push({ kind, ...(payload === undefined ? {} : { payload }) }),
		});
		expect(result.ok).toBe(false);
		expect(result.detail).toBe('lint failed: complexity too high');
		expect(events).toEqual([
			{ kind: 'lint.command.started', payload: { commandIndex: 1 } },
			{ kind: 'lint.command.completed', payload: { commandIndex: 1, command: 'bun run lint', exitCode: 1, verifiedVersion: 'unknown', durationMs: expect.any(Number) } },
		]);
	});
});

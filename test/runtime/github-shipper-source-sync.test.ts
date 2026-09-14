// test/runtime/github-shipper-source-sync.test.ts
//
// CAM-580 acceptance criterion 2: once GitHub confirms MERGED, the shipper
// refreshes origin/main before it reports merged. If that refresh fails the run
// stays retryable, and the repetition over an already-merged pull request
// syncs again without duplicating the commit or the pull request.
//
// Every `git` the shipper runs is the real binary against a real clone of a
// real (bare) remote, so the refresh is measured on refs rather than on a
// recorded argv. Only `gh` is a double: the merge it reports is applied to the
// remote's own main, which is what GitHub would have done.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CommandResult } from '../../src/runtime/git-runtime.ts';
import { GithubShipper, type ShipCommandRunner } from '../../src/runtime/github-shipper.ts';
import type { RuntimeShipInput, RuntimeShipResult } from '../../src/runtime/run-runtime.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

const BRANCH = 'gship/cam-580-580aaaaa';
const PR_NUMBER = 386;

function git(cwd: string, args: string[]): string {
	const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
	if ((result.status ?? 1) !== 0) throw new Error(result.stderr || result.stdout);
	return result.stdout.trim();
}

function identify(cwd: string): void {
	git(cwd, ['config', 'user.name', 'Gateship Test']);
	git(cwd, ['config', 'user.email', 'test@example.invalid']);
}

function writeIssue(cwd: string, stage: string): void {
	mkdirSync(join(cwd, '.gateship', 'issues'), { recursive: true });
	writeFileSync(
		join(cwd, '.gateship', 'issues', 'CAM-0580.json'),
		`${JSON.stringify({
			id: 'CAM-580',
			title: 'gship web: fonte remota fresca sem mover main local',
			stage,
			status: 'open',
		}, null, 2)}\n`,
	);
}

interface Fixture {
	root: string;
	remote: string;
	local: string;
	/** Commit the clone's local main is pinned at, and must stay pinned at. */
	staleMain: string;
}

function seedFixture(): Fixture {
	const root = createTestTmpdir('gship-ship-sync-');
	const seed = join(root, 'seed');
	mkdirSync(seed, { recursive: true });
	git(seed, ['init', '-q', '-b', 'main']);
	identify(seed);
	writeFileSync(join(seed, '.gitignore'), '.gship/\n');
	writeIssue(seed, 'specified');
	git(seed, ['add', '.']);
	git(seed, ['commit', '-q', '-m', 'file CAM-580']);

	const remote = join(root, 'remote');
	git(root, ['clone', '-q', '--bare', seed, remote]);
	const local = join(root, 'local');
	git(root, ['clone', '-q', remote, local]);
	identify(local);
	// The run's branch is cut from the source ref, and the change it carries is
	// the one the ship has to land.
	git(local, ['checkout', '-q', '-b', BRANCH, 'origin/main']);
	writeFileSync(join(local, 'CHANGE.md'), 'the verified change\n');

	return { root, remote, local, staleMain: git(local, ['rev-parse', 'refs/heads/main']) };
}

interface Hub {
	/** Null until `gh pr create` opens the pull request. */
	pr: { number: number; state: string; headRefOid: string; url: string } | null;
	creates: number;
	merges: number;
	/** Break the clone's remote just as GitHub reports the merge. */
	breakRemoteOnMerge: boolean;
}

function runGit(cwd: string, args: string[]): CommandResult {
	const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
	return {
		exitCode: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	} satisfies CommandResult;
}

function ghList(hub: Hub): CommandResult {
	return { exitCode: 0, stdout: JSON.stringify(hub.pr === null ? [] : [hub.pr]), stderr: '' };
}

function ghCreate(fixture: Fixture, hub: Hub): CommandResult {
	hub.creates += 1;
	hub.pr = {
		number: PR_NUMBER,
		state: 'OPEN',
		headRefOid: git(fixture.remote, ['rev-parse', `refs/heads/${BRANCH}`]),
		url: `https://github.com/x/y/pull/${PR_NUMBER}`,
	};
	return { exitCode: 0, stdout: `https://github.com/x/y/pull/${PR_NUMBER}\n`, stderr: '' };
}

function ghMerge(hub: Hub): CommandResult {
	hub.merges += 1;
	return { exitCode: 0, stdout: '', stderr: '' };
}

/** GitHub merges the branch: the REMOTE's main moves, nothing local does. */
function ghView(fixture: Fixture, hub: Hub): CommandResult {
	git(fixture.remote, ['update-ref', 'refs/heads/main', `refs/heads/${BRANCH}`]);
	if (hub.pr !== null) hub.pr.state = 'MERGED';
	if (hub.breakRemoteOnMerge) {
		git(fixture.local, ['remote', 'set-url', 'origin', join(fixture.root, 'gone')]);
	}
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			state: 'MERGED',
			mergeStateStatus: 'CLEAN',
			url: `https://github.com/x/y/pull/${PR_NUMBER}`,
			statusCheckRollup: [],
			// The merged head is the one the ship pushed, so the head check
			// the monitor runs on every poll (GSHIP-615) lets it through.
			headRefOid: git(fixture.remote, ['rev-parse', `refs/heads/${BRANCH}`]),
		}),
		stderr: '',
	};
}

function runGh(fixture: Fixture, hub: Hub, args: string[]): CommandResult | undefined {
	if (args[1] === 'list') return ghList(hub);
	if (args[1] === 'create') return ghCreate(fixture, hub);
	if (args[1] === 'merge') return ghMerge(hub);
	if (args[1] === 'view') return ghView(fixture, hub);
	return undefined;
}

/** Real git, doubled gh. The doubled merge lands on the remote's own main. */
function createRunner(fixture: Fixture, hub: Hub): ShipCommandRunner {
	return async ({ cwd, command, args }) => {
		if (command === 'git') return runGit(cwd, args);
		const response = command === 'gh' ? runGh(fixture, hub, args) : undefined;
		if (response !== undefined) return response;
		throw new Error(`unscripted command: ${command} ${args.join(' ')}`);
	};
}

function shipInput(cwd: string, events: string[]): RuntimeShipInput {
	return {
		runId: '580aaaaa-1d68-4ba4-b99b-bc3bf905114f',
		issueId: 'CAM-580',
		cwd,
		signal: new AbortController().signal,
		emit: (kind) => {
			events.push(kind);
		},
		evidence: {
			workflowRevision: 'revision-test',
			review: 'passed',
			fullVerification: 'passed',
		},
		initialCiStatus: 'not-reported',
	};
}

function ship(fixture: Fixture, hub: Hub, events: string[]): Promise<RuntimeShipResult> {
	return new GithubShipper({ runCommand: createRunner(fixture, hub), pollIntervalMs: 0 })
		.ship(shipInput(fixture.local, events));
}

function newHub(overrides: Partial<Hub> = {}): Hub {
	return { pr: null, creates: 0, merges: 0, breakRemoteOnMerge: false, ...overrides };
}

describe('the post-merge source sync', () => {
	test('refreshes origin/main before reporting merged, without moving local main', async () => {
		const fixture = seedFixture();
		const events: string[] = [];

		const shipped = await ship(fixture, newHub(), events);

		expect(shipped).toEqual({ outcome: 'merged', prNumber: PR_NUMBER });
		expect(git(fixture.local, ['rev-parse', 'origin/main']))
			.toBe(git(fixture.remote, ['rev-parse', 'refs/heads/main']));
		expect(git(fixture.local, ['rev-parse', 'refs/heads/main'])).toBe(fixture.staleMain);
		// The merge this ship landed is visible on the source ref the next run
		// reads: the issue is no longer offered as specified.
		expect(git(fixture.local, ['show', 'origin/main:.gateship/issues/CAM-0580.json']))
			.toContain('"stage": "shipped"');
		expect(events.slice(-2)).toEqual(['ship.source-synced', 'ship.merged']);
	});

	test('a failed refresh keeps the run retryable, and the retry syncs without duplicating', async () => {
		const fixture = seedFixture();
		const hub = newHub({ breakRemoteOnMerge: true });

		const failed = await ship(fixture, hub, []);

		expect(failed.outcome).toBe('failed');
		expect(failed).toMatchObject({
			detail: expect.stringContaining('origin/main could not be refreshed'),
		});
		// Done would be a lie while the source ref still offers CAM-580.
		expect(git(fixture.local, ['rev-parse', 'origin/main'])).toBe(fixture.staleMain);

		const branchHead = git(fixture.local, ['rev-parse', 'HEAD']);
		const branchCommits = git(fixture.local, ['rev-list', '--count', 'HEAD']);
		hub.breakRemoteOnMerge = false;
		git(fixture.local, ['remote', 'set-url', 'origin', fixture.remote]);

		const events: string[] = [];
		const retried = await ship(fixture, hub, events);

		expect(retried).toEqual({ outcome: 'merged', prNumber: PR_NUMBER });
		expect(git(fixture.local, ['rev-parse', 'origin/main']))
			.toBe(git(fixture.remote, ['rev-parse', 'refs/heads/main']));
		// The retry re-ran only the sync: no second commit, no second pull request.
		expect(git(fixture.local, ['rev-parse', 'HEAD'])).toBe(branchHead);
		expect(git(fixture.local, ['rev-list', '--count', 'HEAD'])).toBe(branchCommits);
		expect(hub.creates).toBe(1);
		expect(events).toEqual([
			'ship.pushed',
			'ship.pr-reused',
			'ship.source-synced',
			'ship.merged',
		]);
		expect(git(fixture.local, ['rev-parse', 'refs/heads/main'])).toBe(fixture.staleMain);
	});
});

// GSHIP-884 acceptance criterion 7: prove the merge-conflict recovery's own
// worktree write, #prepareMergeConflict, against real git and a simulated
// GitHub, not an argv double -- a scripted `git` cannot honestly tell a real
// textual conflict from a clean merge, or a real dirty workspace from a clean
// one. Four scenarios cover the paths it can take: a textual conflict, a
// clean base advance with no conflict, GitHub reporting the pull request
// changed under it before it touches anything, and a workspace already dirty
// for an unrelated reason.

const CONFLICT_BRANCH = 'gship/gship-884-884aaaaa';
const CONFLICT_PR_NUMBER = 884;

interface ConflictFixture {
	root: string;
	remote: string;
	local: string;
}

function writeConflictIssue(cwd: string): void {
	mkdirSync(join(cwd, '.gateship', 'issues'), { recursive: true });
	writeFileSync(
		join(cwd, '.gateship', 'issues', 'GSHIP-0884.json'),
		`${JSON.stringify({
			id: 'GSHIP-884',
			title: 'Ship: recuperar conflitos de merge na mesma run com nova verificação',
			stage: 'specified',
			status: 'open',
		}, null, 2)}\n`,
	);
}

/** A branch cut from main, carrying `branchChange` as its own uncommitted edit to SHARED.md. */
function seedConflictFixture(branchChange: string): ConflictFixture {
	const root = createTestTmpdir('gship-ship-conflict-');
	const seed = join(root, 'seed');
	mkdirSync(seed, { recursive: true });
	git(seed, ['init', '-q', '-b', 'main']);
	identify(seed);
	writeFileSync(join(seed, '.gitignore'), '.gship/\n');
	writeFileSync(join(seed, 'SHARED.md'), 'one\ntwo\nthree\n');
	writeConflictIssue(seed);
	git(seed, ['add', '.']);
	git(seed, ['commit', '-q', '-m', 'base SHARED.md']);

	const remote = join(root, 'remote');
	git(root, ['clone', '-q', '--bare', seed, remote]);
	const local = join(root, 'local');
	git(root, ['clone', '-q', remote, local]);
	identify(local);
	git(local, ['checkout', '-q', '-b', CONFLICT_BRANCH, 'origin/main']);
	writeFileSync(join(local, 'SHARED.md'), branchChange);

	return { root, remote, local };
}

let advanceRemoteMainCalls = 0;

/**
 * Advances the bare remote's own main from a separate clone, the way another
 * merge on GitHub would. A unique clone per call: a fixture whose main needs
 * advancing more than once -- a second, independent conflict landing after
 * the first's own recovery already resolved and pushed -- would otherwise
 * have this clone itself fail into the first call's now non-empty directory.
 */
function advanceRemoteMain(fixture: ConflictFixture, mutate: (dir: string) => void, message: string): void {
	advanceRemoteMainCalls += 1;
	const scratch = join(fixture.root, `scratch-${advanceRemoteMainCalls}`);
	git(fixture.root, ['clone', '-q', fixture.remote, scratch]);
	identify(scratch);
	mutate(scratch);
	git(scratch, ['add', '.']);
	git(scratch, ['commit', '-q', '-m', message]);
	git(scratch, ['push', '-q', 'origin', 'HEAD:main']);
}

interface ConflictHub {
	pr: { number: number; state: string; headRefOid: string; url: string } | null;
	creates: number;
	arms: number;
	disarms: number;
	directMerges: number;
	views: number;
	/** From this view onward (1-based), report this instead of the live remote base -- the head/base-changed-externally scenario. */
	raceFromView?: number;
	raceBaseRefOid?: string;
	/** On this view (1-based), drop an untracked file into `local` as a side effect -- the already-dirty-workspace scenario. */
	dirtyOnView?: number;
	local?: string;
	/** Once true, `gh pr view` reports the now-clean PR merged, the way GitHub lands an armed auto-merge once the conflict is actually resolved and pushed. */
	resolved?: boolean;
	/** On this view (1-based), push a second, independent conflicting commit to remote main before answering -- the race that produces a genuinely second conflict. */
	advanceOnView?: number;
}

function newConflictHub(overrides: Partial<ConflictHub> = {}): ConflictHub {
	return { pr: null, creates: 0, arms: 0, disarms: 0, directMerges: 0, views: 0, ...overrides };
}

function ghConflictList(hub: ConflictHub): CommandResult {
	return { exitCode: 0, stdout: JSON.stringify(hub.pr === null ? [] : [hub.pr]), stderr: '' };
}

function ghConflictCreate(fixture: ConflictFixture, hub: ConflictHub): CommandResult {
	hub.creates += 1;
	hub.pr = {
		number: CONFLICT_PR_NUMBER,
		state: 'OPEN',
		headRefOid: git(fixture.remote, ['rev-parse', `refs/heads/${CONFLICT_BRANCH}`]),
		url: `https://github.com/x/y/pull/${CONFLICT_PR_NUMBER}`,
	};
	return { exitCode: 0, stdout: `https://github.com/x/y/pull/${CONFLICT_PR_NUMBER}\n`, stderr: '' };
}

function ghConflictMerge(hub: ConflictHub, args: string[]): CommandResult {
	if (args.includes('--disable-auto')) { hub.disarms += 1; return { exitCode: 0, stdout: '', stderr: '' }; }
	if (args.includes('--auto')) { hub.arms += 1; return { exitCode: 0, stdout: '', stderr: '' }; }
	hub.directMerges += 1;
	return { exitCode: 0, stdout: '', stderr: '' };
}

/** Always DIRTY: these fixtures exist to drive #prepareMergeConflict, not the merge itself. */
function ghConflictView(fixture: ConflictFixture, hub: ConflictHub): CommandResult {
	hub.views += 1;
	if (hub.pr === null) throw new Error('no pull request open');
	if (hub.resolved === true) {
		// The conflict is resolved and pushed: GitHub lands the now-clean,
		// armed PR, the way ghView (above) simulates an instant merge.
		git(fixture.remote, ['update-ref', 'refs/heads/main', `refs/heads/${CONFLICT_BRANCH}`]);
		hub.pr.state = 'MERGED';
		return {
			exitCode: 0,
			stdout: JSON.stringify({
				state: 'MERGED',
				mergeStateStatus: 'CLEAN',
				headRefOid: git(fixture.remote, ['rev-parse', `refs/heads/${CONFLICT_BRANCH}`]),
				baseRefOid: git(fixture.remote, ['rev-parse', 'refs/heads/main']),
				url: hub.pr.url,
				statusCheckRollup: [],
			}),
			stderr: '',
		};
	}
	if (hub.dirtyOnView === hub.views && hub.local !== undefined) {
		writeFileSync(join(hub.local, 'SURPRISE.md'), 'an unrelated change nobody expected\n');
	}
	if (hub.advanceOnView === hub.views) {
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'SHARED.md'), 'one\nTWO-REMOTE-2\nthree\n'), 'a second, independent change on main');
	}
	const racing = hub.raceFromView !== undefined && hub.views >= hub.raceFromView;
	const baseRefOid = racing && hub.raceBaseRefOid !== undefined
		? hub.raceBaseRefOid
		: git(fixture.remote, ['rev-parse', 'refs/heads/main']);
	return {
		exitCode: 0,
		stdout: JSON.stringify({
			state: hub.pr.state,
			mergeStateStatus: 'DIRTY',
			headRefOid: git(fixture.remote, ['rev-parse', `refs/heads/${CONFLICT_BRANCH}`]),
			baseRefOid,
			url: hub.pr.url,
			statusCheckRollup: [],
		}),
		stderr: '',
	};
}

function runGhConflict(fixture: ConflictFixture, hub: ConflictHub, args: string[]): CommandResult | undefined {
	if (args[1] === 'list') return ghConflictList(hub);
	if (args[1] === 'create') return ghConflictCreate(fixture, hub);
	if (args[1] === 'merge') return ghConflictMerge(hub, args);
	if (args[1] === 'view') return ghConflictView(fixture, hub);
	return undefined;
}

interface ConflictCall {
	command: string;
	args: string[];
}

/** Real git, doubled gh. */
function createConflictRunner(fixture: ConflictFixture, hub: ConflictHub, calls: ConflictCall[]): ShipCommandRunner {
	return async ({ cwd, command, args }) => {
		calls.push({ command, args });
		if (command === 'git') return runGit(cwd, args);
		const response = command === 'gh' ? runGhConflict(fixture, hub, args) : undefined;
		if (response !== undefined) return response;
		throw new Error(`unscripted command: ${command} ${args.join(' ')}`);
	};
}

function conflictShipInput(cwd: string, events: string[]): RuntimeShipInput {
	return {
		runId: '884aaaaa-1d68-4ba4-b99b-bc3bf905114f',
		issueId: 'GSHIP-884',
		cwd,
		signal: new AbortController().signal,
		emit: (kind) => { events.push(kind); },
		evidence: { workflowRevision: 'revision-test', review: 'passed', fullVerification: 'passed' },
		initialCiStatus: 'not-reported',
	};
}

function shipConflict(fixture: ConflictFixture, hub: ConflictHub, calls: ConflictCall[]): Promise<RuntimeShipResult> {
	return new GithubShipper({ runCommand: createConflictRunner(fixture, hub, calls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
		.ship(conflictShipInput(fixture.local, []));
}

function findConflictCalls(calls: ConflictCall[], command: string, first: string): ConflictCall[] {
	return calls.filter((call) => call.command === command && call.args[0] === first);
}

/** Whether a `git merge --no-commit` is still pending in `cwd`, without throwing when it is not. */
function mergeInProgress(cwd: string): boolean {
	const result = spawnSync('git', ['-C', cwd, 'rev-parse', '-q', '--verify', 'MERGE_HEAD'], { encoding: 'utf8' });
	return (result.status ?? 1) === 0;
}

describe('the merge-conflict recovery against real git', () => {
	test('a textual conflict leaves the worktree with the local base merge unresolved', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'SHARED.md'), 'one\nTWO-REMOTE\nthree\n'), 'conflicting change on main');
		const hub = newConflictHub();
		const calls: ConflictCall[] = [];

		const shipped = await shipConflict(fixture, hub, calls);

		expect(shipped).toMatchObject({ outcome: 'merge-conflict', evidence: { prNumber: CONFLICT_PR_NUMBER, resolution: 'conflict' } });
		expect(hub.disarms).toBe(1);
		expect(hub.directMerges).toBe(0);
		expect(findConflictCalls(calls, 'git', 'merge')).not.toHaveLength(0);
		// The merge really is left unresolved in the worktree, conflict markers included.
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(git(fixture.local, ['diff', '--name-only', '--diff-filter=U'])).toBe('SHARED.md');
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toContain('<<<<<<<');
	});

	// GSHIP-884: the full recovery, end to end. A textual conflict leaves the
	// merge pending; once it is resolved and staged (never committed -- the
	// executor is not allowed to), the next ship must recognise its own
	// reserved recovery as resolved, commit the resolution, and publish it on
	// the very same pull request rather than refusing or opening a new one.
	test('a resolved textual conflict is committed and published to the same pull request', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'SHARED.md'), 'one\nTWO-REMOTE\nthree\n'), 'conflicting change on main');
		const hub = newConflictHub();
		const firstCalls: ConflictCall[] = [];
		const firstEvents: string[] = [];

		const shipped = await new GithubShipper({ runCommand: createConflictRunner(fixture, hub, firstCalls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship(conflictShipInput(fixture.local, firstEvents));

		expect(shipped).toMatchObject({ outcome: 'merge-conflict', evidence: { prNumber: CONFLICT_PR_NUMBER, resolution: 'conflict' } });
		expect(mergeInProgress(fixture.local)).toBe(true);
		const headBeforeResolution = git(fixture.local, ['rev-parse', 'HEAD']);
		const pendingBaseSha = git(fixture.local, ['rev-parse', 'MERGE_HEAD']);

		// The executor's own recovery: resolve the conflict inside the pending
		// merge and stage it, but never commit -- the ship's own commit is what
		// finishes the merge, the same as it would for any other change.
		writeFileSync(join(fixture.local, 'SHARED.md'), 'one\nTWO-RESOLVED\nthree\n');
		git(fixture.local, ['add', 'SHARED.md']);
		hub.resolved = true;

		const laterCalls: ConflictCall[] = [];
		const laterEvents: string[] = [];
		const input = conflictShipInput(fixture.local, laterEvents);
		const republished = await new GithubShipper({ runCommand: createConflictRunner(fixture, hub, laterCalls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship({ ...input, evidence: { ...input.evidence, mergeConflictRecovery: { baseSha: pendingBaseSha } } });

		expect(republished).toEqual({ outcome: 'merged', prNumber: CONFLICT_PR_NUMBER });
		expect(mergeInProgress(fixture.local)).toBe(false);
		expect(findConflictCalls(laterCalls, 'git', 'commit')).not.toHaveLength(0);
		// The same pull request the conflict was confirmed on, not a new one.
		expect(hub.creates).toBe(1);
		expect(git(fixture.local, ['rev-parse', 'HEAD'])).not.toBe(headBeforeResolution);
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toBe('one\nTWO-RESOLVED\nthree\n');
		expect(git(fixture.remote, ['show', 'refs/heads/main:SHARED.md'])).toContain('TWO-RESOLVED');
	});

	// GSHIP-884: the case this round closes. The first conflict's own recovery
	// completes normally -- committed, pushed, this run's claimed evidence
	// correctly trusted. A second, independent conflict then lands on main,
	// and this time the ship is cancelled between that second merge and its
	// own full confirmation. The stale claim from the first, already-resolved
	// conflict must not let a later ship commit or publish the second
	// conflict's markers -- only real git, cross-checked against the actually
	// pending merge's own base, can tell the two apart.
	test('a second conflict cancelled after the first recovery completed is preserved, never committed', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'SHARED.md'), 'one\nTWO-REMOTE-1\nthree\n'), 'a first conflicting change on main');
		const hub = newConflictHub();
		const firstCalls: ConflictCall[] = [];
		const firstEvents: string[] = [];

		const shipped = await new GithubShipper({ runCommand: createConflictRunner(fixture, hub, firstCalls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship(conflictShipInput(fixture.local, firstEvents));

		expect(shipped).toMatchObject({ outcome: 'merge-conflict', evidence: { resolution: 'conflict' } });
		const firstBaseSha = git(fixture.local, ['rev-parse', 'MERGE_HEAD']);

		// The executor's own recovery: resolve the first conflict and stage it.
		writeFileSync(join(fixture.local, 'SHARED.md'), 'one\nRESOLVED-1\nthree\n');
		git(fixture.local, ['add', 'SHARED.md']);

		// A second, independent conflict lands on main on the very next poll
		// after this ship commits and pushes the first resolution -- the same
		// race a competing PR landing while this one resolves would cause.
		hub.advanceOnView = hub.views + 1;
		const controller = new AbortController();
		const secondCalls: ConflictCall[] = [];
		const secondEvents: string[] = [];
		const cancellingRunner: ShipCommandRunner = async ({ cwd, command, args }) => {
			secondCalls.push({ command, args });
			if (command === 'git') {
				const outcome = runGit(cwd, args);
				// The exact await GSHIP-884 points at, now for the SECOND conflict:
				// right after its own merge has already written conflict markers,
				// before its own full confirmation.
				if (args[0] === 'diff' && args.includes('--diff-filter=U')) controller.abort();
				return outcome;
			}
			const response = command === 'gh' ? runGhConflict(fixture, hub, args) : undefined;
			if (response !== undefined) return response;
			throw new Error(`unscripted command: ${command} ${args.join(' ')}`);
		};
		const firstInput = conflictShipInput(fixture.local, secondEvents);

		await expect(new GithubShipper({ runCommand: cancellingRunner, pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship({ ...firstInput, evidence: { ...firstInput.evidence, mergeConflictRecovery: { baseSha: firstBaseSha } }, signal: controller.signal }))
			.rejects.toThrow();

		// The first resolution really did land (commit, push): the second
		// conflict is a real, independent one, not a repeat of the first.
		expect(git(fixture.remote, ['show', 'refs/heads/main:SHARED.md'])).toContain('TWO-REMOTE-2');
		// The second conflict is really pending, unconfirmed in full.
		expect(mergeInProgress(fixture.local)).toBe(true);
		const secondBaseSha = git(fixture.local, ['rev-parse', 'MERGE_HEAD']);
		expect(secondBaseSha).not.toBe(firstBaseSha);
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toContain('<<<<<<<');

		// A later ship, still only holding the first conflict's stale claim,
		// must refuse the second conflict's markers -- never commit or publish
		// them on the strength of a recovery that resolved a different merge.
		const laterCalls: ConflictCall[] = [];
		const laterEvents: string[] = [];
		const laterInput = conflictShipInput(fixture.local, laterEvents);
		const stale = await new GithubShipper({ runCommand: createConflictRunner(fixture, hub, laterCalls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship({ ...laterInput, evidence: { ...laterInput.evidence, mergeConflictRecovery: { baseSha: firstBaseSha } } });

		expect(stale).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('already pending') });
		expect(findConflictCalls(laterCalls, 'git', 'add')).toHaveLength(0);
		expect(findConflictCalls(laterCalls, 'git', 'commit')).toHaveLength(0);
		expect(findConflictCalls(laterCalls, 'git', 'push')).toHaveLength(0);
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toContain('<<<<<<<');
	});

	// GSHIP-884: #prepareMergeConflict now confirms durably (ship.merge-conflict-confirmed)
	// before it ever writes the local base merge, so a cancellation after that
	// -- here, the real await on `git diff --diff-filter=U` that reads the
	// unresolved paths -- still leaves a confirmation behind, but only the
	// bare, pre-merge one: it carries no `resolution` yet, so it never
	// validates as claimable evidence. A later ship must still recognise the
	// pending merge on its own (via real git, not that confirmation) and
	// refuse to commit over it -- never treat it as ordinary uncommitted work.
	test('a cancellation between the local merge and its full confirmation is preserved, never committed, by a later ship', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'SHARED.md'), 'one\nTWO-REMOTE\nthree\n'), 'conflicting change on main');
		const hub = newConflictHub();
		const controller = new AbortController();
		const calls: ConflictCall[] = [];
		const events: string[] = [];
		const cancellingRunner: ShipCommandRunner = async ({ cwd, command, args }) => {
			calls.push({ command, args });
			if (command === 'git') {
				const outcome = runGit(cwd, args);
				// The exact await GSHIP-884 points at: right after the merge has
				// already written conflict markers, before the confirmation below.
				if (args[0] === 'diff' && args.includes('--diff-filter=U')) controller.abort();
				return outcome;
			}
			const response = command === 'gh' ? runGhConflict(fixture, hub, args) : undefined;
			if (response !== undefined) return response;
			throw new Error(`unscripted command: ${command} ${args.join(' ')}`);
		};

		await expect(new GithubShipper({ runCommand: cancellingRunner, pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship({ ...conflictShipInput(fixture.local, events), signal: controller.signal })).rejects.toThrow();

		// The conflict is really in the worktree. A bare, pre-merge confirmation
		// exists -- GSHIP-884's own durability guarantee -- but never the full
		// one with a `resolution`, since the merge's own result is added by a
		// second, later event that this cancellation never let happen.
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toContain('<<<<<<<');
		expect(events.filter((kind) => kind === 'ship.merge-conflict-confirmed')).toHaveLength(1);

		// A later ship, on its own fresh signal, must recognise the pending
		// merge on sight and refuse it -- no add, no commit, no push over it.
		const laterCalls: ConflictCall[] = [];
		const laterEvents: string[] = [];
		const shipped = await new GithubShipper({ runCommand: createConflictRunner(fixture, hub, laterCalls), pollIntervalMs: 0, mergeTimeoutMs: 0 })
			.ship({ ...conflictShipInput(fixture.local, laterEvents), signal: new AbortController().signal });

		expect(shipped).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('already pending') });
		expect(findConflictCalls(laterCalls, 'git', 'add')).toHaveLength(0);
		expect(findConflictCalls(laterCalls, 'git', 'commit')).toHaveLength(0);
		expect(findConflictCalls(laterCalls, 'git', 'push')).toHaveLength(0);
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(readFileSync(join(fixture.local, 'SHARED.md'), 'utf8')).toContain('<<<<<<<');
	});

	test('a base advance with no textual conflict leaves the merge staged, ready to commit', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'OTHER.md'), 'unrelated change\n'), 'unrelated change on main');
		const hub = newConflictHub();
		const calls: ConflictCall[] = [];

		const shipped = await shipConflict(fixture, hub, calls);

		expect(shipped).toMatchObject({ outcome: 'merge-conflict', evidence: { prNumber: CONFLICT_PR_NUMBER, resolution: 'base-advanced' } });
		expect(hub.disarms).toBe(1);
		expect(hub.directMerges).toBe(0);
		expect(findConflictCalls(calls, 'git', 'merge')).not.toHaveLength(0);
		// No conflict: the merge from origin/main landed staged, uncommitted.
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(git(fixture.local, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
		expect(git(fixture.local, ['diff', '--cached', '--name-only'])).toContain('OTHER.md');
	});

	// GSHIP-884: a plain `git fetch origin main` only updates the
	// refs/remotes/origin/main tracking ref opportunistically, when the
	// remote's own configured fetch refspec covers refs/heads/main. A remote
	// added without one -- `git config remote.origin.url` set directly,
	// skipping `git remote add` -- writes only FETCH_HEAD, so the recovery has
	// to refresh through the same explicit refspec the rest of this file
	// already uses (runtimeSourceFetchArgs) for that ref to end up current.
	test('refreshes the base even when the remote has no configured fetch refspec', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'OTHER.md'), 'unrelated change\n'), 'unrelated change on main');
		git(fixture.local, ['config', '--unset-all', 'remote.origin.fetch']);
		const hub = newConflictHub();
		const calls: ConflictCall[] = [];

		const shipped = await shipConflict(fixture, hub, calls);

		expect(shipped).toMatchObject({ outcome: 'merge-conflict', evidence: { prNumber: CONFLICT_PR_NUMBER, resolution: 'base-advanced' } });
		expect(mergeInProgress(fixture.local)).toBe(true);
		expect(git(fixture.local, ['diff', '--cached', '--name-only'])).toContain('OTHER.md');
		expect(git(fixture.local, ['rev-parse', 'origin/main']))
			.toBe(git(fixture.remote, ['rev-parse', 'refs/heads/main']));
	});

	test('a pull request GitHub reports changed mid-preparation is left untouched', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'OTHER.md'), 'unrelated change\n'), 'unrelated change on main');
		// The confirming view (#2, inside #prepareMergeConflict) reports a base
		// other than the one the DIRTY-detecting poll (#1) just used, the same
		// race a concurrent merge landing on GitHub between the two would cause.
		const hub = newConflictHub({ raceFromView: 2, raceBaseRefOid: 'f'.repeat(40) });
		const calls: ConflictCall[] = [];

		const shipped = await shipConflict(fixture, hub, calls);

		expect(shipped).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('changed while preparing conflict recovery') });
		expect(hub.disarms).toBe(1);
		expect(hub.directMerges).toBe(0);
		// Nothing local was ever touched: no fetch, no status check, no merge.
		expect(findConflictCalls(calls, 'git', 'fetch')).toHaveLength(0);
		expect(findConflictCalls(calls, 'git', 'status')).toHaveLength(0);
		expect(findConflictCalls(calls, 'git', 'merge')).toHaveLength(0);
		expect(git(fixture.local, ['status', '--porcelain'])).toBe('');
		expect(mergeInProgress(fixture.local)).toBe(false);
	});

	test('a workspace already dirty for an unrelated reason is preserved instead of merged', async () => {
		const fixture = seedConflictFixture('one\nTWO-BRANCH\nthree\n');
		advanceRemoteMain(fixture, (dir) => writeFileSync(join(dir, 'OTHER.md'), 'unrelated change\n'), 'unrelated change on main');
		// The confirming view (#2) drops an untracked file into the worktree as a
		// side effect, the way something outside this ship touching the
		// workspace between the DIRTY poll and the merge preparation would.
		const hub = newConflictHub({ dirtyOnView: 2, local: fixture.local });
		const calls: ConflictCall[] = [];

		const shipped = await shipConflict(fixture, hub, calls);

		expect(shipped).toMatchObject({ outcome: 'failed', detail: expect.stringContaining('contains unknown changes') });
		expect(hub.disarms).toBe(1);
		expect(hub.directMerges).toBe(0);
		expect(findConflictCalls(calls, 'git', 'status')).not.toHaveLength(0);
		// The status check that caught the surprise file ran, but no merge was
		// ever attempted on top of it.
		expect(findConflictCalls(calls, 'git', 'merge')).toHaveLength(0);
		expect(mergeInProgress(fixture.local)).toBe(false);
	});
});

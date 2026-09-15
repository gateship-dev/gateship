import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { getIssueOnMain } from '../commands/issue-get.ts';
import { issueFilePath } from '../issues/backlog.ts';
import { type EvidenceItem, fingerprintSpec, type Spec } from '../issues/spec.ts';
import { buildAllowlistedEnv } from './child-env.ts';
import { terminateProcessGroup } from './process-group.ts';
import { readProjectVerificationManifest } from './project-verification.ts';
import { type ReviewEvidenceFile, readReviewEvidencePaths, snapshotReviewEvidenceFiles } from './review-evidence.ts';
import type {
	RuntimeEvidenceCheck,
	RuntimeExecutionInput,
	RuntimeMutationCandidate,
	RuntimeMutationSelection,
	RuntimeMutationSelector,
	RuntimeTestBaselineCommand,
	RuntimeTestBaselineRecorder,
	RuntimeVerificationResult,
	RuntimeVerifier,
} from './run-runtime.ts';
import { fetchRuntimeSource, RUNTIME_SOURCE_REF } from './source-ref.ts';
import { type ParsedTestCounts, parseTestCounts } from './test-integrity.ts';
import { verificationVersion } from './verification-version.ts';

const DEFAULT_TERMINATION_GRACE_MS = 1_000;
const DIAGNOSTIC_TAIL_LENGTH = 2_000;
export const VERIFICATION_COMMAND_TIMEOUT_MS = 30_000;

export interface CommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
}

export type GitCommandRunner = (cwd: string, args: string[]) => CommandResult;

export interface VerificationCommandInput {
	cwd: string;
	command: string;
	signal: AbortSignal;
	timeoutMs?: number;
}

export type VerificationCommandRunner = (
	input: VerificationCommandInput,
) => Promise<CommandResult>;

export interface GitRuntimeOptions {
	runGit?: GitCommandRunner;
	issueExists?: (cwd: string, issueId: string) => boolean;
	loadIssue?: (cwd: string, issueId: string) => string;
	/** Reads the issue record from the run's own checked-out workspace, not from `origin/main`. */
	loadIssueFromWorkspace?: (cwd: string, issueId: string) => string;
	runCommand?: VerificationCommandRunner;
	terminationGraceMs?: number;
	/** Read-only mutation selection (GSHIP-893), consumed only by `GitFullVerifier`. Absent skips the mutation sensor entirely. */
	mutationSelector?: RuntimeMutationSelector;
}

export class RuntimePreflightError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RuntimePreflightError';
	}
}

export function defaultRunGit(cwd: string, args: string[]): CommandResult {
	const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
	return {
		exitCode: result.status ?? 1,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

function defaultIssueExists(cwd: string, issueId: string): boolean {
	return getIssueOnMain(cwd, issueId, spawnSync, RUNTIME_SOURCE_REF).ok;
}

function defaultLoadIssue(cwd: string, issueId: string): string {
	const issue = getIssueOnMain(cwd, issueId, spawnSync, RUNTIME_SOURCE_REF);
	if (!issue.ok) throw new Error(`issue not found on ${RUNTIME_SOURCE_REF}: ${issueId}`);
	return issue.content;
}

/**
 * Read the issue record straight from the run's own checkout instead of via
 * git: by the time the evidence check runs, `workspace.prepare` has already
 * cut this exact worktree from the same `origin/main` sha the preflight
 * validated, so the file on disk is the approved record.
 */
function defaultLoadIssueFromWorkspace(cwd: string, issueId: string): string {
	return readFileSync(join(cwd, issueFilePath(issueId)), 'utf8');
}

function shellCommand(): string {
	const configured = process.env.SHELL?.trim();
	if (configured !== undefined && configured.length > 0) {
		if (!configured.startsWith('/') || existsSync(configured)) return configured;
	}
	return '/bin/sh';
}

export interface OwnedCommandInput {
	cmd: string[];
	cwd: string;
	signal: AbortSignal;
	/** Child environment; callers that own a boundary should pass it explicitly. */
	env?: Record<string, string | undefined>;
	terminationGraceMs?: number;
}

/**
 * Spawn one owned child in its own process group and collect it. Cancellation
 * terminates the whole group and surfaces as an AbortError, so no runtime step
 * can outlive the run that asked for it.
 */
export async function runOwnedCommand(input: OwnedCommandInput): Promise<CommandResult> {
	const child = Bun.spawn({
		cmd: input.cmd,
		cwd: input.cwd,
		env: input.env ?? process.env,
		detached: true,
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	let termination: Promise<void> | undefined;
	const abort = (): void => {
		termination ??= terminateProcessGroup(
			child,
			input.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
		);
	};
	input.signal.addEventListener('abort', abort, { once: true });
	if (input.signal.aborted) abort();

	try {
		const [exitCode, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		if (termination !== undefined) await termination;
		if (input.signal.aborted) throw new DOMException('cancelled', 'AbortError');
		return { exitCode, stdout, stderr };
	} finally {
		input.signal.removeEventListener('abort', abort);
	}
}

export async function runVerificationCommand(
	input: VerificationCommandInput,
	terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
): Promise<CommandResult> {
	if (input.timeoutMs === undefined) {
		return runOwnedCommand({
			cmd: [shellCommand(), '-lc', input.command],
			cwd: input.cwd,
			signal: input.signal,
			env: buildAllowlistedEnv(process.env),
			terminationGraceMs,
		});
	}
	const controller = new AbortController();
	let timedOut = false;
	const timeoutMs = input.timeoutMs;
	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const cancel = (): void => controller.abort();
	input.signal.addEventListener('abort', cancel, { once: true });
	if (input.signal.aborted) cancel();
	try {
		return await runOwnedCommand({
			cmd: [shellCommand(), '-lc', input.command],
			cwd: input.cwd,
			signal: controller.signal,
			env: buildAllowlistedEnv(process.env),
			terminationGraceMs,
		});
	} catch (error) {
		if (!timedOut || input.signal.aborted) throw error;
		return {
			exitCode: 124,
			stdout: '',
			stderr: `command timed out after ${timeoutMs}ms`,
			timedOut: true,
		};
	} finally {
		clearTimeout(timeout);
		input.signal.removeEventListener('abort', cancel);
	}
}

function runtimeVerificationCommandRunner(
	options: GitRuntimeOptions,
	timeoutMs?: number,
): VerificationCommandRunner {
	const runCommand = options.runCommand;
	if (runCommand !== undefined) return (input) => runCommand({ ...input, timeoutMs });
	return (input) => runVerificationCommand({ ...input, timeoutMs }, options.terminationGraceMs);
}

function verificationCommands(issueContent: string): string[] {
	let issue: unknown;
	try {
		issue = JSON.parse(issueContent);
	} catch {
		throw new Error('issue record on main is not valid JSON');
	}
	if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
		throw new Error('issue record on main is not an object');
	}
	const spec = (issue as Record<string, unknown>).spec;
	if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
		throw new Error('issue has no structured spec');
	}
	const direct = (spec as Record<string, unknown>).verify;
	if (Array.isArray(direct) && direct.length > 0 && direct.every((item) => typeof item === 'string')) {
		return direct;
	}
	throw new Error('issue has no verification commands');
}

type ScriptMap = Record<string, string>;

function packageScripts(content: string | null): ScriptMap | null {
	if (content === null) return null;
	try {
		const value = JSON.parse(content) as Record<string, unknown>;
		const scripts = value.scripts;
		if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return null;
		const result: ScriptMap = {};
		for (const [name, command] of Object.entries(scripts)) {
			if (typeof command === 'string' && command.trim().length > 0) result[name] = command.trim();
		}
		return result;
	} catch {
		return null;
	}
}

/** Resolve only the shell-free script alias form the harness can prove. */
function canonicalCommand(command: string, scripts: ScriptMap | null): string | null {
	if (scripts === null) return null;
	let current = command.trim();
	const seen = new Set<string>();
	for (let depth = 0; depth < 20; depth += 1) {
		const match = /^bun run ([A-Za-z0-9:_-]+)$/.exec(current);
		if (match === null) return null;
		const scriptName = match[1];
		if (scriptName === undefined || seen.has(scriptName)) return null;
		seen.add(scriptName);
		const replacement = scripts[scriptName];
		if (replacement === undefined) return null;
		if (!/^bun run ([A-Za-z0-9:_-]+)$/.test(replacement)) return scriptName;
		if (scripts[`pre${scriptName}`] !== undefined || scripts[`post${scriptName}`] !== undefined) return null;
		current = replacement;
	}
	return null;
}

interface VerificationOverlap {
	command: string;
	fullCommand: string;
}

function findTextualOverlap(focused: string[], full: string[]): VerificationOverlap | null {
	for (const command of focused) {
		for (const fullCommand of full) {
			if (command.trim() === fullCommand.trim()) return { command, fullCommand };
		}
	}
	return null;
}

function findCanonicalOverlap(focused: string[], full: string[], scripts: ScriptMap): VerificationOverlap | null {
	for (const command of focused) {
		const canonical = canonicalCommand(command, scripts);
		if (canonical === null) continue;
		for (const fullCommand of full) {
			if (canonical === canonicalCommand(fullCommand, scripts)) return { command, fullCommand };
		}
	}
	return null;
}

function workingTreePackageScripts(inputCwd: string): ScriptMap | null {
	try {
		return packageScripts(readFileSync(join(inputCwd, 'package.json'), 'utf8'));
	} catch {
		return null;
	}
}

function packageScriptsFromWorkingTree(inputCwd: string, content?: string | null): ScriptMap | null {
	return content === undefined ? workingTreePackageScripts(inputCwd) : packageScripts(content);
}

export function findVerificationOverlap(
	options: GitRuntimeOptions,
	inputCwd: string,
	issueContent: string,
	focusedCommand?: string,
	currentPackageContent?: string | null,
): VerificationOverlap | null {
	const runGit = options.runGit ?? defaultRunGit;
	const focused = focusedCommand === undefined ? verificationCommands(issueContent) : [focusedCommand];
	let full: string[];
	try {
		full = projectVerificationCommands(options, inputCwd, currentPackageContent).commands;
	} catch {
		return null;
	}
	const textualOverlap = findTextualOverlap(focused, full);
	if (textualOverlap !== null) return textualOverlap;
	let packageContent: string | null;
	try {
		packageContent = baseFile(runGit, inputCwd, 'package.json');
	} catch {
		// The harness could not establish the immutable project identity.
		// Unknown equivalence stays executable.
		return null;
	}
	const scripts = packageScripts(packageContent);
	if (scripts === null) return null;
	const baseOverlap = findCanonicalOverlap(focused, full, scripts);
	if (baseOverlap === null) return null;
	const workingTreeScripts = packageScriptsFromWorkingTree(inputCwd, currentPackageContent);
	if (workingTreeScripts === null) return null;
	const focusedCanonical = canonicalCommand(baseOverlap.command, workingTreeScripts);
	const fullCanonical = canonicalCommand(baseOverlap.fullCommand, workingTreeScripts);
	return focusedCanonical !== null && focusedCanonical === fullCanonical ? baseOverlap : null;
}

function outputTail(result: CommandResult): string {
	const output = `${result.stdout}\n${result.stderr}`.trim();
	return output.length === 0 ? '(no output)' : output.slice(-DIAGNOSTIC_TAIL_LENGTH);
}

function verifyWorkingTree(
	runGit: GitCommandRunner,
	cwd: string,
): RuntimeVerificationResult {
	for (const args of [['diff', '--check'], ['diff', '--cached', '--check']]) {
		const result = runGit(cwd, args);
		if (result.exitCode !== 0) {
			return { ok: false, detail: commandFailure('git diff check failed', result).message };
		}
	}
	const status = runGit(cwd, ['status', '--porcelain', '--untracked-files=all']);
	if (status.exitCode !== 0) {
		return { ok: false, detail: commandFailure('cannot read working tree', status).message };
	}
	if (status.stdout.trim().length === 0) {
		return { ok: false, detail: 'executor completed without a working-tree change' };
	}
	return { ok: true };
}

function commandFailure(label: string, result: CommandResult): RuntimePreflightError {
	const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`;
	return new RuntimePreflightError(`${label}: ${detail}`);
}

export function evidenceOutputText(result: CommandResult): string {
	return `${result.stdout}\n${result.stderr}`.trim();
}

/**
 * The optional evidence items on an issue's spec, or an empty array when the
 * spec has none. Unlike `verificationCommands`, a missing or malformed
 * `evidence` field is not an error -- the field is optional, and every issue
 * filed before GSHIP-629 lacks it entirely.
 */
function evidenceFromIssue(issueContent: string): EvidenceItem[] {
	let issue: unknown;
	try {
		issue = JSON.parse(issueContent);
	} catch {
		throw new Error('issue record is not valid JSON');
	}
	if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) {
		throw new Error('issue record is not an object');
	}
	const spec = (issue as Record<string, unknown>).spec;
	if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
		return [];
	}
	const evidence = (spec as Record<string, unknown>).evidence;
	return Array.isArray(evidence) ? (evidence as EvidenceItem[]) : [];
}

/**
 * Gate on a fresh source ref before a run is accepted.
 *
 * The refresh is fail-closed and happens first: a run admitted against a stale
 * `origin/main` would read an issue the remote has already shipped and branch
 * from a base commit the remote has already moved past. Only
 * `refs/remotes/origin/main` is written -- the local `main` never moves, so a
 * checked-out and dirty `main` in another worktree is unaffected.
 *
 * This does not check the spec's evidence: at this point `RunRuntime.startRun`
 * has not yet called `workspace.prepare`, so there is no run workspace to run
 * evidence commands against, and cutting one here just for this check would be
 * the additional worktree the issue's scope explicitly excluded. Evidence is
 * instead checked by `GitEvidenceChecker`, against the run's own workspace,
 * after it exists and before the executor runs (GSHIP-629).
 */
export function createGitRuntimePreflight(
	cwd: string,
	options: GitRuntimeOptions = {},
): (issueId: string) => void {
	const runGit = options.runGit ?? defaultRunGit;
	const issueExists = options.issueExists ?? defaultIssueExists;
	const loadIssue = options.loadIssue ?? defaultLoadIssue;
	return (issueId) => {
		const fetched = fetchRuntimeSource(runGit, cwd);
		if (fetched.exitCode !== 0) {
			throw commandFailure(`cannot fetch ${RUNTIME_SOURCE_REF}`, fetched);
		}
		if (!issueExists(cwd, issueId)) {
			throw new RuntimePreflightError(`issue not found on ${RUNTIME_SOURCE_REF}: ${issueId}`);
		}
		const source = runGit(cwd, ['rev-parse', '--verify', RUNTIME_SOURCE_REF]);
		if (source.exitCode !== 0) {
			throw commandFailure(`cannot resolve ${RUNTIME_SOURCE_REF}`, source);
		}
		const issue = JSON.parse(loadIssue(cwd, issueId)) as PreflightIssue;
		validatePreflightApproval(issueId, issue);
		rejectPreflightOverlap(options, cwd, issueId, issue);
	};
}

/**
 * The spec's executable premise, checked in the run's own workspace: after
 * `workspace.prepare` has cut its worktree and installed its dependencies
 * (`GitWorkspaceManager.prepare`, git-workspace.ts), and before the executor
 * is ever invoked (`RunRuntime.#drive`/`#checkEvidence`, run-runtime.ts, which
 * also owns whether a given pass runs this check at all). No worktree of its
 * own is cut here -- there is nothing to clean up and nothing that can leak an
 * orphaned `.git/worktrees` entry if the process dies mid-check. Each command
 * runs through the same owned command path as verification. Evidence gets the
 * same bounded deadline used at intake; general verification remains governed
 * only by the run's cancellation signal.
 */
export class GitEvidenceChecker implements RuntimeEvidenceCheck {
	readonly #loadIssue: (cwd: string, issueId: string) => string;
	readonly #runCommand: VerificationCommandRunner;

	constructor(options: GitRuntimeOptions = {}) {
		this.#loadIssue = options.loadIssueFromWorkspace ?? defaultLoadIssueFromWorkspace;
		this.#runCommand = runtimeVerificationCommandRunner(
			options,
			VERIFICATION_COMMAND_TIMEOUT_MS,
		);
	}

	async check(input: RuntimeExecutionInput): Promise<RuntimeVerificationResult> {
		let evidence: EvidenceItem[];
		try {
			evidence = evidenceFromIssue(this.#loadIssue(input.cwd, input.issueId));
		} catch (error) {
			return { ok: false, detail: error instanceof Error ? error.message : String(error) };
		}

		for (const item of evidence) {
			const result = await this.#runCommand({
				cwd: input.cwd,
				command: item.command,
				signal: input.signal,
			});
			const observed = evidenceOutputText(result);
			const recorded = item.output.trim();
			if (result.exitCode !== 0 || observed !== recorded) {
				// Leads with "the spec's evidence diverged" in full, not just
				// "evidence diverged": this text becomes `run.error` verbatim, with
				// no separate label distinguishing it from an implementation bug, so
				// it has to say on its own that the *spec's premise* stopped holding.
				// `recorded` is already bounded by EVIDENCE_LIMITS.output at intake;
				// `observed` is whatever the current command just printed, so it gets
				// the same tail cap `outputTail` already gives the verify diagnostic.
				return {
					ok: false,
					detail: `the run ended because the spec's evidence diverged from the repository:`
						+ ` command \`${item.command}\` recorded \`${recorded}\` but the current`
						+ ` repository observed \`${outputTail(result)}\``
						+ (result.exitCode === 0 ? '' : ` (command exited ${result.exitCode})`),
				};
			}
		}
		return { ok: true };
	}
}

/**
 * `artifacts` (GSHIP-872) is the subset of the project's declared evidence
 * paths that changed content hash during exactly this command -- a file that
 * already existed before the command and comes out unchanged is never
 * attributed to it, so a report the executor wrote before this command ran
 * (or forged outside any recorded command entirely) cannot ride along as if
 * this command had produced it.
 */
async function runVersionedVerification(runCommand: VerificationCommandRunner, runGit: GitCommandRunner, input: VerificationCommandInput) {
	const before = verificationVersion(input.cwd, runGit);
	const evidencePaths = readReviewEvidencePaths(input.cwd);
	const beforeArtifacts = new Map(snapshotReviewEvidenceFiles(input.cwd, evidencePaths).map((file) => [file.path, file.sha256]));
	const result = await runCommand(input);
	const after = verificationVersion(input.cwd, runGit);
	const artifacts: ReviewEvidenceFile[] = snapshotReviewEvidenceFiles(input.cwd, evidencePaths)
		.filter((file) => beforeArtifacts.get(file.path) !== file.sha256);
	return { result, verifiedVersion: before !== null && before === after ? before : 'unknown', artifacts };
}

/** The `verify.command.completed`/`full-verify.command.completed` payload shape, shared so neither call site's complexity carries the field-by-field assembly. */
function commandCompletedPayload(
	commandIndex: number,
	command: string,
	exitCode: number,
	verifiedVersion: string,
	attemptNumber: number | undefined,
	artifacts: readonly ReviewEvidenceFile[],
	testCounts?: ParsedTestCounts,
): Record<string, unknown> {
	return {
		commandIndex, command, exitCode, verifiedVersion,
		...(attemptNumber === undefined ? {} : { attempt: attemptNumber }),
		...(artifacts.length === 0 ? {} : { artifacts }),
		...(testCounts === undefined ? {} : { testTotal: testCounts.total, testSkip: testCounts.skip }),
	};
}

const TEST_FILE_PATTERN = /\.test\.[cm]?[jt]sx?$/;

/**
 * Test files the run's own worktree has deleted relative to the run's base
 * commit (GSHIP-895) -- the only observable fact `#checkTestIntegrity`
 * (run-runtime.ts) accepts as a candidate for a legitimate count drop. Never
 * throws: any Git failure here is unknown equivalence, same as
 * `#overlapsFullVerification`, and simply reports no removed files.
 */
function removedTestFiles(runGit: GitCommandRunner, cwd: string): string[] {
	const base = runGit(cwd, ['merge-base', 'HEAD', RUNTIME_SOURCE_REF]);
	const baseSha = base.stdout.trim();
	if (base.exitCode !== 0 || baseSha.length === 0) return [];
	const diff = runGit(cwd, ['diff', '--name-status', '--diff-filter=D', baseSha]);
	if (diff.exitCode !== 0) return [];
	return diff.stdout.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.split(/\s+/).slice(1).join(' '))
		.filter((path) => TEST_FILE_PATTERN.test(path));
}

export class GitIssueVerifier implements RuntimeVerifier, RuntimeTestBaselineRecorder {
	readonly #options: GitRuntimeOptions;
	readonly #runGit: GitCommandRunner;
	readonly #loadIssue: (cwd: string, issueId: string) => string;
	readonly #runCommand: VerificationCommandRunner;

	constructor(options: GitRuntimeOptions = {}) {
		this.#options = options;
		this.#runGit = options.runGit ?? defaultRunGit;
		this.#loadIssue = options.loadIssue ?? defaultLoadIssue;
		this.#runCommand = runtimeVerificationCommandRunner(options);
	}

	#resolveCommands(input: Parameters<RuntimeVerifier['verify']>[0]): { ok: true; commands: string[]; issueContent: string } | { ok: false; detail: string } {
		try {
			const issueContent = this.#loadIssue(input.cwd, input.issueId);
			return { ok: true, commands: verificationCommands(issueContent), issueContent };
		} catch (error) {
			return { ok: false, detail: error instanceof Error ? error.message : String(error) };
		}
	}

	#overlapsFullVerification(input: Parameters<RuntimeVerifier['verify']>[0], issueContent: string, command: string): VerificationOverlap | null {
		try {
			return findVerificationOverlap(this.#options, input.cwd, issueContent, command);
		} catch {
			return null; // unknown equivalence
		}
	}

	/** One command already known to run: emits its lifecycle events and reports whether it exited clean. */
	async #runOneCommand(input: Parameters<RuntimeVerifier['verify']>[0], commandIndex: number, command: string): Promise<RuntimeVerificationResult> {
		input.emit('verify.command.started', { commandIndex: commandIndex + 1 });
		const { result, verifiedVersion, artifacts } = await runVersionedVerification(this.#runCommand, this.#runGit, { cwd: input.cwd, command, signal: input.signal });
		const testCounts = parseTestCounts(`${result.stdout}\n${result.stderr}`);
		input.emit('verify.command.completed', commandCompletedPayload(
			commandIndex + 1, command, result.exitCode, verifiedVersion, input.attemptNumber, artifacts, testCounts ?? undefined,
		));
		return result.exitCode === 0
			? { ok: true }
			: { ok: false, detail: `verification command ${commandIndex + 1} exited ${result.exitCode}: ${outputTail(result)}` };
	}

	async verify(input: Parameters<RuntimeVerifier['verify']>[0]) {
		const workingTree = verifyWorkingTree(this.#runGit, input.cwd);
		if (!workingTree.ok) return workingTree;

		const resolved = this.#resolveCommands(input);
		if (!resolved.ok) return resolved;
		const { commands, issueContent } = resolved;

		let executed = 0;
		for (const [commandIndex, command] of commands.entries()) {
			const overlap = this.#overlapsFullVerification(input, issueContent, command);
			if (overlap !== null) {
				input.emit('verify.skipped-equivalent', { focusedCommand: overlap.command, fullCommand: overlap.fullCommand });
				continue;
			}
			executed += 1;
			if (executed === 1) {
				const removed = removedTestFiles(this.#runGit, input.cwd);
				input.emit('verify.started', removed.length === 0 ? undefined : { removedTestFiles: removed });
			}
			const outcome = await this.#runOneCommand(input, commandIndex, command);
			if (!outcome.ok) return outcome;
		}
		if (executed === 0) {
			input.emit('verify.skipped');
			return { ok: true, skipped: true };
		}
		return { ok: true };
	}

	/**
	 * Baseline capture (GSHIP-895): runs the same resolved verify commands as
	 * `verify` -- skipping the same full-verify-equivalent ones -- against
	 * the clean worktree, but never stops on a non-zero exit and never
	 * requires a working-tree change first. Only the suite's own shape
	 * matters here, not whether the clean tree happens to pass.
	 */
	async captureBaseline(input: Parameters<RuntimeVerifier['verify']>[0]): Promise<{ commands: RuntimeTestBaselineCommand[] }> {
		const resolved = this.#resolveCommands(input);
		if (!resolved.ok) return { commands: [] };
		const { commands, issueContent } = resolved;
		const captured: RuntimeTestBaselineCommand[] = [];
		for (const [commandIndex, command] of commands.entries()) {
			if (this.#overlapsFullVerification(input, issueContent, command) !== null) continue;
			const { result } = await runVersionedVerification(this.#runCommand, this.#runGit, { cwd: input.cwd, command, signal: input.signal });
			const testCounts = parseTestCounts(`${result.stdout}\n${result.stderr}`);
			captured.push({
				command,
				commandIndex: commandIndex + 1,
				...(testCounts === null ? {} : { total: testCounts.total, skip: testCounts.skip }),
			});
		}
		return { commands: captured };
	}
}

/** Whether a package.json blob declares a verify script for the legacy fallback. */
function hasVerifyScript(cwd: string): boolean {
	let raw: string;
	try {
		raw = readFileSync(join(cwd, 'package.json'), 'utf8');
	} catch {
		return false;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return false;
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
	const scripts = (parsed as Record<string, unknown>).scripts;
	if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return false;
	return typeof (scripts as Record<string, unknown>).verify === 'string';
}

const PROJECT_VERIFICATION_PATH = '.gateship/project.json';

interface PreflightIssue {
	spec?: Spec;
	approval?: { fingerprint?: string };
}

function baseFile(runGit: GitCommandRunner, cwd: string, path: string): string | null {
	const base = runGit(cwd, ['merge-base', 'HEAD', RUNTIME_SOURCE_REF]);
	if (base.exitCode !== 0 || base.stdout.trim().length === 0) {
		throw commandFailure(`cannot resolve the run base with ${RUNTIME_SOURCE_REF}`, base);
	}
	const baseSha = base.stdout.trim();
	const entry = runGit(cwd, ['ls-tree', '-r', '--name-only', baseSha, '--', path]);
	if (entry.exitCode !== 0) throw commandFailure(`cannot inspect ${path} in the run base`, entry);
	if (entry.stdout.trim().length === 0) return null;
	const result = runGit(cwd, ['show', `${baseSha}:${path}`]);
	if (result.exitCode !== 0) throw commandFailure(`cannot read ${path} from the run base`, result);
	return result.stdout;
}

function projectVerificationCommands(
	options: GitRuntimeOptions,
	inputCwd: string,
	packageContent?: string | null,
): { commands: string[]; origin: 'manifest' | 'package.json' | 'none' } {
	const runGit = options.runGit ?? defaultRunGit;
	const manifest = baseFile(runGit, inputCwd, PROJECT_VERIFICATION_PATH);
	if (manifest !== null) {
		return { commands: readProjectVerificationManifest(manifest).verify, origin: 'manifest' };
	}
	const hasVerify = packageContent === undefined ? hasVerifyScript(inputCwd) : packageScripts(packageContent)?.verify !== undefined;
	return hasVerify
		? { commands: ['bun run verify'], origin: 'package.json' }
		: { commands: [], origin: 'none' };
}

/** The project's per-round lint commands (GSHIP-900), read from the same immutable base manifest as `verify`, never from `package.json`: absent unless the project declares them explicitly. */
function projectLintCommands(options: GitRuntimeOptions, inputCwd: string): string[] {
	const runGit = options.runGit ?? defaultRunGit;
	const manifest = baseFile(runGit, inputCwd, PROJECT_VERIFICATION_PATH);
	return manifest === null ? [] : readProjectVerificationManifest(manifest).lint ?? [];
}

/**
 * The project's per-round lint gate (GSHIP-900): declared commands run once
 * after `run.work-completed`, before review, through the same owned,
 * versioned command path `GitIssueVerifier` and `GitFullVerifier` already
 * use. A failure reuses the run's existing issue-verification fix round --
 * never a new round category -- and the project's own `verify` still runs in
 * full at the ready-to-ship gate regardless. A project that declares no
 * `lint` commands is skipped, never inferred from the stack.
 */
export class GitLintVerifier implements RuntimeVerifier {
	readonly #options: GitRuntimeOptions;
	readonly #runCommand: VerificationCommandRunner;

	constructor(options: GitRuntimeOptions = {}) {
		this.#options = options;
		this.#runCommand = runtimeVerificationCommandRunner(options);
	}

	async verify(input: Parameters<RuntimeVerifier['verify']>[0]) {
		const commands = projectLintCommands(this.#options, input.cwd);
		if (commands.length === 0) {
			input.emit('lint.skipped', { reason: 'no-project-lint' });
			return { ok: true, skipped: true };
		}

		for (const [commandIndex, command] of commands.entries()) {
			input.emit('lint.command.started', { commandIndex: commandIndex + 1 });
			const startedAt = performance.now();
			const { result, verifiedVersion, artifacts } = await runVersionedVerification(this.#runCommand, this.#options.runGit ?? defaultRunGit, { cwd: input.cwd, command, signal: input.signal });
			const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
			input.emit('lint.command.completed', {
				...commandCompletedPayload(commandIndex + 1, command, result.exitCode, verifiedVersion, input.attemptNumber, artifacts),
				durationMs,
			});
			if (result.exitCode !== 0) {
				return { ok: false, detail: `lint failed: ${outputTail(result)}` };
			}
		}
		return { ok: true };
	}
}

function validatePreflightApproval(issueId: string, issue: PreflightIssue): void {
	if (issue.approval?.fingerprint === undefined) {
		throw new RuntimePreflightError(
			`${issueId} has no approval; approve this draft before starting a run`,
		);
	}
	if (issue.spec === undefined || issue.approval.fingerprint !== fingerprintSpec(issue.spec)) {
		throw new RuntimePreflightError(
			`${issueId} has stale approval; its executable contract changed after approval`,
		);
	}
}

function rejectPreflightOverlap(
	options: GitRuntimeOptions,
	cwd: string,
	issueId: string,
	issue: PreflightIssue,
): void {
	try {
		const overlap = findVerificationOverlap(options, cwd, JSON.stringify(issue));
		if (overlap !== null) {
			throw new RuntimePreflightError(
				`${issueId} focused verification command \`${overlap.command}\` is equivalent to the project's full verification \`${overlap.fullCommand}\``,
			);
		}
	} catch (error) {
		if (error instanceof RuntimePreflightError) throw error;
		// An unavailable identity is unknown equivalence, never a reason to
		// discard the operator's command.
	}
}

const MUTATION_CANDIDATE_LIMIT = 3;

function mutationScratchPath(): string {
	return join(tmpdir(), `gship-mutation-${randomUUID()}`);
}

interface NumstatEntry {
	added: string;
	deleted: string;
	/** One path for an ordinary change; two (old, new) for a rename or copy. */
	paths: string[];
}

/**
 * `git apply --numstat -z`'s own format: each entry is `added\tdeleted\tpath\0`,
 * except a rename or copy, where the third field is empty and two more
 * NUL-terminated path tokens (old, new) follow before the next entry.
 */
function parseNumstatEntries(stdout: string): NumstatEntry[] {
	const tokens = stdout.split('\0').filter((token) => token.length > 0);
	const entries: NumstatEntry[] = [];
	let index = 0;
	while (index < tokens.length) {
		const [added, deleted, path] = tokens[index]!.split('\t');
		index += 1;
		if (added === undefined || deleted === undefined) continue;
		if (path !== undefined && path.length > 0) {
			entries.push({ added, deleted, paths: [path] });
			continue;
		}
		const renamePaths = [tokens[index], tokens[index + 1]].filter((value): value is string => value !== undefined);
		index += 2;
		entries.push({ added, deleted, paths: renamePaths });
	}
	return entries;
}

/**
 * Validates a mutation candidate's patch against Git's own reading of it
 * (GSHIP-893) -- never against the candidate's own claim -- before the patch
 * is ever applied: `--numstat`/`--summary` are read-only, so a rejection here
 * leaves `file` (already written to disk, but not yet applied) untouched.
 * Rejects when the patch: touches no path at all; touches any path other
 * than `expectedFile` (`candidate.file`), including on a rename or copy;
 * touches a test file even when that is `expectedFile` itself, so a selector
 * that never went through `parseMutationSelection`'s own filter (`claude-cli-reviewer.ts`)
 * is still covered; is binary (`added`/`deleted` reported as `-`); or is
 * anything `--summary` reports at all -- create, delete, rename, copy or a
 * mode change, never a plain content edit.
 */
function rejectedMutationPatch(runGit: GitCommandRunner, cwd: string, file: string, expectedFile: string): string | null {
	const numstat = runGit(cwd, ['apply', '--numstat', '-z', file]);
	if (numstat.exitCode !== 0) return commandFailure('cannot inspect the mutation patch', numstat).message;
	const summary = runGit(cwd, ['apply', '--summary', file]);
	if (summary.exitCode !== 0) return commandFailure('cannot inspect the mutation patch', summary).message;

	const entries = parseNumstatEntries(numstat.stdout);
	const paths = entries.flatMap((entry) => entry.paths);
	if (paths.length === 0) return 'the mutation patch declares no changed path';

	const otherPaths = [...new Set(paths.filter((path) => path !== expectedFile))];
	if (otherPaths.length > 0) {
		return `the mutation patch touches paths other than ${expectedFile}: ${otherPaths.join(', ')}`;
	}
	const testPaths = [...new Set(paths.filter((path) => TEST_FILE_PATTERN.test(path)))];
	if (testPaths.length > 0) {
		return `the mutation patch touches a test file: ${testPaths.join(', ')}`;
	}
	if (entries.some((entry) => entry.added === '-' || entry.deleted === '-')) {
		return 'the mutation patch is binary';
	}
	if (summary.stdout.trim().length > 0) {
		return `the mutation patch is not a simple content edit: ${summary.stdout.trim()}`;
	}
	return null;
}

/**
 * Writes `patch` to a throwaway file inside `cwd` and applies it there with
 * `git apply`; the file never survives the call, successful or not.
 * `mkdirSync` here is a no-op against a real `git worktree add` (the
 * directory already exists) and is what lets a test drive this whole path
 * against a fake `runGit` with no real worktree ever created.
 *
 * `expectedFile`, when given, is validated first through `rejectedMutationPatch`
 * -- a mutation candidate's own `patch` is untrusted content from a read-only
 * model call, so it is never applied before Git's own reading of it confirms
 * it touches exactly the file the candidate declared. The working-diff
 * reproduction in `createMutationWorktree` calls this with no `expectedFile`:
 * that patch is the run's own diff and legitimately touches every file it
 * touched.
 */
function applyMutationPatch(
	runGit: GitCommandRunner,
	cwd: string,
	patch: string,
	expectedFile?: string,
): { ok: true } | { ok: false; detail: string } {
	const file = join(cwd, `.gship-mutation-${randomUUID()}.patch`);
	try {
		mkdirSync(cwd, { recursive: true });
		writeFileSync(file, patch);
	} catch (error) {
		return { ok: false, detail: error instanceof Error ? error.message : String(error) };
	}
	try {
		if (expectedFile !== undefined) {
			const rejection = rejectedMutationPatch(runGit, cwd, file, expectedFile);
			if (rejection !== null) return { ok: false, detail: rejection };
		}
		const result = runGit(cwd, ['apply', file]);
		return result.exitCode === 0 ? { ok: true } : { ok: false, detail: commandFailure('git apply failed', result).message };
	} finally {
		rmSync(file, { force: true });
	}
}

/**
 * Every file a run's own diff added but `git diff` cannot carry (GSHIP-893):
 * an untracked file never has a HEAD-relative diff. Best-effort and read-only
 * on `cwd` -- a file the sensor cannot copy is simply absent from the scratch
 * worktree, never a reason to fail the whole attempt.
 */
function copyUntrackedFiles(runGit: GitCommandRunner, cwd: string, scratchPath: string): void {
	const status = runGit(cwd, ['status', '--porcelain', '--untracked-files=all']);
	if (status.exitCode !== 0) return;
	for (const line of status.stdout.split('\n')) {
		if (!line.startsWith('?? ')) continue;
		const relativePath = line.slice(3).trim();
		if (relativePath.length === 0) continue;
		try {
			const target = join(scratchPath, relativePath);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, readFileSync(join(cwd, relativePath)));
		} catch {
			// best-effort, see docstring above.
		}
	}
}

/** Best-effort dependency reuse: a symlink, never a reinstall and never a write into `cwd`. Verify commands that still find no dependencies surface their own failure. */
function linkMutationDependencies(cwd: string, scratchPath: string): void {
	try {
		const source = join(cwd, 'node_modules');
		if (existsSync(source) && !existsSync(join(scratchPath, 'node_modules'))) {
			symlinkSync(source, join(scratchPath, 'node_modules'), 'dir');
		}
	} catch {
		// best-effort, see docstring above.
	}
}

/**
 * A detached worktree cut from the run's own HEAD, with the run's own
 * uncommitted changes reproduced on top (GSHIP-893): a run's work is never
 * committed before `ready-to-ship`, so `git worktree add` alone would only
 * carry the base commit, not the new code the mutation sensor exists to
 * test. Every write lands only in the returned scratch path; `cwd` -- the
 * run's real worktree -- is only ever read.
 */
function createMutationWorktree(
	runGit: GitCommandRunner,
	cwd: string,
): { ok: true; path: string } | { ok: false; detail: string } {
	const head = runGit(cwd, ['rev-parse', 'HEAD']);
	if (head.exitCode !== 0 || head.stdout.trim().length === 0) {
		return { ok: false, detail: commandFailure('cannot resolve the run head', head).message };
	}
	const path = mutationScratchPath();
	const added = runGit(cwd, ['worktree', 'add', '--detach', path, head.stdout.trim()]);
	if (added.exitCode !== 0) {
		return { ok: false, detail: commandFailure('cannot create the mutation scratch worktree', added).message };
	}
	const diff = runGit(cwd, ['diff', 'HEAD']);
	if (diff.exitCode === 0 && diff.stdout.trim().length > 0) {
		const applied = applyMutationPatch(runGit, path, diff.stdout);
		if (!applied.ok) {
			removeMutationWorktree(runGit, cwd, path);
			return { ok: false, detail: `cannot reproduce the run's own changes in the scratch worktree: ${applied.detail}` };
		}
	}
	copyUntrackedFiles(runGit, cwd, path);
	linkMutationDependencies(cwd, path);
	return { ok: true, path };
}

/**
 * Best-effort, mirrors `GitReconciliationWorkspace#forceRemove`
 * (git-workspace.ts): always leaves `cwd` untouched. Removes the directory
 * itself unconditionally, on top of asking git to: a real `git worktree
 * remove` already deletes it, so this is a harmless no-op there, and it is
 * what actually cleans up the directory `applyMutationPatch`/`mkdirSync`
 * created directly against a fake `runGit` in a test.
 */
function removeMutationWorktree(runGit: GitCommandRunner, cwd: string, path: string): void {
	runGit(cwd, ['worktree', 'remove', '--force', path]);
	if (existsSync(path)) rmSync(path, { recursive: true, force: true });
	runGit(cwd, ['worktree', 'prune']);
}

/**
 * The project's full verification gate (GSHIP-649): whatever `package.json`
 * already declares as its `verify` script -- e.g. `bun run check:all` --
 * run once per ready-to-ship pass, through the same owned, cancellable command
 * path `GitIssueVerifier` and `GitEvidenceChecker` already use. General
 * verification has no deadline of its own. The slice never hardcodes what `verify` runs: a project that
 * declares no such script is skipped, not failed, so this stays exactly the
 * cutout the issue's own `spec.verify` and the project's full manifest
 * already agree on.
 *
 * Once that verify passes -- or is itself skipped, since a project with no
 * `verify` script declares nothing this gate could fail on -- the mutation
 * sensor (GSHIP-893) runs as one more step: the sensor is tied to the issue's
 * own approved verify (`spec.verify`), which already passed in the run's
 * earlier `verify` phase, never to whether the project separately declares a
 * full-verify script, so it runs either way. A read-only reviewer step
 * proposes up to `MUTATION_CANDIDATE_LIMIT` minimal behavior mutations
 * against the run's own diff, and each is tested, one at a time, in its own
 * scratch worktree cut from this run's HEAD -- never in `input.cwd`, the
 * run's real worktree. The issue's own verify commands run there directly
 * (`this.#runCommand`, never `GitIssueVerifier`), so this never emits `verify.*` events the durable
 * test-integrity guard (GSHIP-895, `run-runtime.ts#checkTestIntegrity`) reads;
 * only `run.mutation-sensor`/`run.mutation-sensor-skipped` record what
 * happened. A surviving mutant -- the mutated code still passed every verify
 * command -- fails this step exactly like a failed full-verify command
 * already does, so it returns to the executor through the run's existing
 * `run.full-verify-fix-requested` path and spends no round budget of its own.
 * Absent `mutationSelector` (e.g. every test in this file that does not
 * configure one), the sensor never runs at all -- not even `full-verify.skipped`-
 * style event, since there is nothing this run's own dependencies asked for.
 */
export class GitFullVerifier implements RuntimeVerifier {
	readonly #options: GitRuntimeOptions;
	readonly #runCommand: VerificationCommandRunner;
	readonly #mutationSelector: RuntimeMutationSelector | undefined;
	#origin: 'manifest' | 'package.json' | 'none' = 'none';

	constructor(options: GitRuntimeOptions = {}) {
		this.#options = options;
		this.#runCommand = runtimeVerificationCommandRunner(options);
		this.#mutationSelector = options.mutationSelector;
	}

	async verify(input: Parameters<RuntimeVerifier['verify']>[0]) {
		const selected = projectVerificationCommands(this.#options, input.cwd);
		this.#origin = selected.origin;
		if (selected.commands.length === 0) {
			input.emit('full-verify.skipped', { reason: 'no-project-verification' });
			// GSHIP-893: the mutation sensor is tied to the issue's own approved
			// verify (spec.verify), which already passed before `full-verify` was
			// ever entered -- not to whether the project separately declares a
			// full-verify script. A project with none still runs the sensor.
			return this.#afterProjectVerify(input, true);
		}

		for (const [commandIndex, command] of selected.commands.entries()) {
			input.emit('full-verify.command.started', {
				commandIndex: commandIndex + 1,
				origin: this.#origin,
			});
			const { result, verifiedVersion, artifacts } = await runVersionedVerification(this.#runCommand, this.#options.runGit ?? defaultRunGit, { cwd: input.cwd, command, signal: input.signal });
			input.emit('full-verify.command.completed', {
				commandIndex: commandIndex + 1,
				command,
				exitCode: result.exitCode,
				origin: this.#origin,
				verifiedVersion,
				...(input.attemptNumber === undefined ? {} : { attempt: input.attemptNumber }),
				...(artifacts.length === 0 ? {} : { artifacts }),
			});
			if (result.exitCode !== 0) {
				return { ok: false, detail: `full verification failed: ${outputTail(result)}` };
			}
		}
		return this.#afterProjectVerify(input, false);
	}

	/** Runs the mutation sensor once the project's own full verify is settled (passed, or had nothing to run), and restores `skipped` on an `ok` result -- the sensor's own result is never itself reported as skipped. */
	async #afterProjectVerify(input: Parameters<RuntimeVerifier['verify']>[0], projectVerifySkipped: boolean): Promise<RuntimeVerificationResult> {
		const sensorResult = await this.#runMutationSensor(input);
		if (!sensorResult.ok) return sensorResult;
		return projectVerifySkipped ? { ok: true, skipped: true } : { ok: true };
	}

	async #runMutationSensor(input: Parameters<RuntimeVerifier['verify']>[0]): Promise<RuntimeVerificationResult> {
		const selector = this.#mutationSelector;
		if (selector === undefined) return { ok: true };
		const issueContent = input.approvedContract;
		if (issueContent === undefined) return { ok: true };
		let commands: string[];
		try {
			commands = verificationCommands(issueContent);
		} catch {
			return { ok: true };
		}

		let selection: RuntimeMutationSelection;
		try {
			selection = await selector.select(input);
		} catch (error) {
			const provider = input.providerId ?? 'claude';
			input.emit('run.mutation-sensor-skipped', {
				reason: `mutation selection failed on provider ${provider}: ${error instanceof Error ? error.message : String(error)}`,
			});
			return { ok: true };
		}
		const candidates = selection.candidates.slice(0, MUTATION_CANDIDATE_LIMIT);
		if (candidates.length === 0) {
			input.emit('run.mutation-sensor-skipped', {
				reason: selection.skippedReason ?? 'the run diff exposed no executable mutation target',
			});
			return { ok: true };
		}

		const runGit = this.#options.runGit ?? defaultRunGit;
		const survivors: string[] = [];
		for (const candidate of candidates) {
			const outcome = await this.#runMutationAttempt(input, runGit, commands, candidate);
			if (outcome === 'survived') survivors.push(`${candidate.file}:${candidate.line} (${candidate.type})`);
		}
		return survivors.length === 0
			? { ok: true }
			: {
				ok: false,
				detail: `mutation sensor: the approved verify commands did not catch the injected regression at ${survivors.join(', ')}`,
			};
	}

	/** One candidate, fully isolated: its own scratch worktree, always removed, whichever way this returns. */
	async #runMutationAttempt(
		input: Parameters<RuntimeVerifier['verify']>[0],
		runGit: GitCommandRunner,
		commands: readonly string[],
		candidate: RuntimeMutationCandidate,
	): Promise<'killed' | 'survived' | 'inconclusive'> {
		const startedAt = performance.now();
		const durationMs = (): number => Math.max(0, Math.round(performance.now() - startedAt));
		const scratch = createMutationWorktree(runGit, input.cwd);
		if (!scratch.ok) {
			input.emit('run.mutation-sensor', {
				file: candidate.file, line: candidate.line, type: candidate.type,
				outcome: 'inconclusive', reason: scratch.detail, durationMs: durationMs(),
			});
			return 'inconclusive';
		}
		try {
			const applied = applyMutationPatch(runGit, scratch.path, candidate.patch, candidate.file);
			if (!applied.ok) {
				input.emit('run.mutation-sensor', {
					file: candidate.file, line: candidate.line, type: candidate.type,
					outcome: 'inconclusive', reason: `cannot apply the mutation patch: ${applied.detail}`, durationMs: durationMs(),
				});
				return 'inconclusive';
			}
			for (const command of commands) {
				const result = await this.#runCommand({ cwd: scratch.path, command, signal: input.signal });
				if (result.exitCode !== 0) {
					input.emit('run.mutation-sensor', {
						file: candidate.file, line: candidate.line, type: candidate.type, command,
						outcome: 'killed', durationMs: durationMs(),
					});
					return 'killed';
				}
			}
			input.emit('run.mutation-sensor', {
				file: candidate.file, line: candidate.line, type: candidate.type, command: commands[commands.length - 1],
				outcome: 'survived', durationMs: durationMs(),
			});
			return 'survived';
		} finally {
			removeMutationWorktree(runGit, input.cwd, scratch.path);
		}
	}
}

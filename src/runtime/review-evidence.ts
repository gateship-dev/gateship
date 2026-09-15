// src/runtime/review-evidence.ts
//
// GSHIP-872: shared, filesystem-only primitives for review evidence. Two
// callers build on these: `git-runtime.ts` snapshots a project's declared
// evidence paths around each verification command it actually runs, so a
// report can be attributed to the command that produced it; the reviewer
// (`claude-cli-reviewer.ts`) walks the same paths again at review time and
// classifies each file against that recorded attribution. Neither creates a
// new tool, a new process or a capability beyond reading files already inside
// the run's own worktree.

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { isSafeRelativeEvidencePath, readProjectVerificationManifest } from './project-verification.ts';

export const MAX_EVIDENCE_FILES = 50;
export const MAX_EVIDENCE_BYTES = 20 * 1024 * 1024;

export interface ReviewEvidenceFile {
	path: string;
	sizeBytes: number;
	sha256: string;
}

interface EvidenceWalkState {
	files: number;
	bytes: number;
	truncated: boolean;
}

/** project-declared, candidate report paths -- see `ProjectVerificationManifest.reviewEvidencePaths`. */
export function readReviewEvidencePaths(cwd: string): string[] {
	try {
		const manifest = readProjectVerificationManifest(readFileSync(join(cwd, '.gateship', 'project.json'), 'utf8'));
		return manifest.reviewEvidencePaths ?? [];
	} catch {
		return [];
	}
}

export function realWorktreeRoot(cwd: string): string {
	try {
		return realpathSync(resolve(cwd));
	} catch {
		return resolve(cwd);
	}
}

/**
 * Resolves every symlink in `resolvedPath`'s own ancestor directories --
 * never `resolvedPath`'s own last component, which callers lstat separately
 * and never follow regardless of target -- and confirms the result still
 * sits under `realRoot`. Plain string/path-prefix comparison never touches
 * the filesystem, so it cannot see an intermediate directory (e.g. a
 * declared path's own leading segment) that is itself a symlink redirecting
 * outside the worktree.
 */
export function ancestorEscapesWorktree(realRoot: string, resolvedPath: string): boolean {
	let realParent: string;
	try {
		realParent = realpathSync(dirname(resolvedPath));
	} catch (error) {
		// An ancestor that does not exist yet is not an escape -- the caller's
		// own `lstatSync` on the leaf reports that as missing. Any other
		// failure (permission denied, a loop) cannot be confirmed safe.
		return (error as NodeJS.ErrnoException).code !== 'ENOENT';
	}
	return realParent !== realRoot && !realParent.startsWith(realRoot + sep);
}

export function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** `null` when `relativePath` is unsafe, escapes `cwd`, or is reached through a symlinked ancestor directory. */
function resolveEvidencePath(cwd: string, realRoot: string, relativePath: string): string | null {
	if (!isSafeRelativeEvidencePath(relativePath)) return null;
	const root = resolve(cwd);
	const resolved = resolve(cwd, relativePath);
	if (resolved !== root && !resolved.startsWith(root + sep)) return null;
	if (ancestorEscapesWorktree(realRoot, resolved)) return null;
	return resolved;
}

function directoryHasCapacity(state: EvidenceWalkState): boolean {
	if (state.files >= MAX_EVIDENCE_FILES || state.bytes >= MAX_EVIDENCE_BYTES) {
		state.truncated = true;
		return false;
	}
	return true;
}

function fileHasCapacity(state: EvidenceWalkState, sizeBytes: number): boolean {
	if (state.files >= MAX_EVIDENCE_FILES || state.bytes + sizeBytes > MAX_EVIDENCE_BYTES) {
		state.truncated = true;
		return false;
	}
	return true;
}

function walkDirectory(
	cwd: string,
	realRoot: string,
	relativePath: string,
	resolved: string,
	state: EvidenceWalkState,
	out: ReviewEvidenceFile[],
): void {
	let entries: string[];
	try {
		entries = readdirSync(resolved).sort();
	} catch {
		return;
	}
	for (const entry of entries) {
		if (state.truncated || !directoryHasCapacity(state)) return;
		walkEvidenceFiles(cwd, realRoot, join(relativePath, entry), state, out);
	}
}

function recordFile(
	relativePath: string,
	resolved: string,
	sizeBytes: number,
	state: EvidenceWalkState,
	out: ReviewEvidenceFile[],
): void {
	if (!fileHasCapacity(state, sizeBytes)) return;
	state.files += 1;
	state.bytes += sizeBytes;
	try {
		out.push({ path: relativePath, sizeBytes, sha256: sha256File(resolved) });
	} catch { /* unreadable content is simply absent from the snapshot */ }
}

function walkEvidenceFiles(
	cwd: string,
	realRoot: string,
	relativePath: string,
	state: EvidenceWalkState,
	out: ReviewEvidenceFile[],
): void {
	if (state.truncated) return;
	const resolved = resolveEvidencePath(cwd, realRoot, relativePath);
	if (resolved === null) return;
	let stat;
	try {
		stat = lstatSync(resolved);
	} catch {
		return;
	}
	if (stat.isSymbolicLink()) return;
	if (stat.isDirectory()) {
		walkDirectory(cwd, realRoot, relativePath, resolved, state, out);
		return;
	}
	if (stat.isFile()) recordFile(relativePath, resolved, stat.size, state, out);
}

/**
 * A safe, bounded, symlink-free snapshot of every file currently reachable
 * under the declared evidence paths -- path, size and content hash only,
 * never raw content and never a file outside the worktree. Used both before
 * and after a verification command runs, so the caller can diff the two
 * snapshots down to exactly the files that command produced or changed.
 */
export function snapshotReviewEvidenceFiles(cwd: string, paths: readonly string[]): ReviewEvidenceFile[] {
	const realRoot = realWorktreeRoot(cwd);
	const state: EvidenceWalkState = { files: 0, bytes: 0, truncated: false };
	const out: ReviewEvidenceFile[] = [];
	for (const declaredPath of paths) {
		if (state.truncated) break;
		walkEvidenceFiles(cwd, realRoot, declaredPath, state, out);
	}
	return out;
}

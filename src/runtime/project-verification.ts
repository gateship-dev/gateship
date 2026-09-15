export const PROJECT_VERIFICATION_VERSION = 1;

export interface ProjectDiagnosticManifest {
	command: string;
}

export interface ProjectVerificationManifest {
	version: typeof PROJECT_VERIFICATION_VERSION;
	/** Commands run in order after the worktree is cut and before the agent starts. */
	prepare?: string[];
	verify: string[];
	/** One repository-owned advisory command run in an isolated diagnostic checkout. */
	diagnostic?: ProjectDiagnosticManifest;
	/**
	 * Relative report paths (files or directories), candidates for GSHIP-872
	 * review evidence to read from the run's own worktree -- declaring one
	 * here does not by itself make it verified. `runVersionedVerification`
	 * (git-runtime.ts) snapshots these paths around each `verify`/`full-verify`
	 * command it actually runs, and only a file that changed content hash
	 * during that command is attributed to it; a declared path some other
	 * command produced (or the run's `verify` array never runs at all, e.g. a
	 * Playwright report when `verify` never invokes Playwright) stays an
	 * explicit, unattributed limitation, never presented as current
	 * validation. Optional and project-owned: a project that names none gets
	 * no evidence section, and this never authorizes a new capture tool or a
	 * path outside the worktree.
	 */
	reviewEvidencePaths?: string[];
}

function validCommands(value: unknown, allowEmpty: boolean): value is string[] {
	return Array.isArray(value)
		&& (allowEmpty || value.length > 0)
		&& value.every((command) => typeof command === 'string' && command.trim().length > 0);
}

/**
 * No absolute path, no `..` traversal segment, no embedded NUL: the
 * manifest's own first line of defense. `collectReviewEvidence`
 * (claude-cli-reviewer.ts) re-checks every declared path against this same
 * rule before touching the filesystem, since a path could reach it from a
 * source other than this parser.
 */
export function isSafeRelativeEvidencePath(path: string): boolean {
	const trimmed = path.trim();
	if (trimmed.length === 0 || trimmed.includes('\0')) return false;
	if (trimmed.startsWith('/') || trimmed.startsWith('~') || /^[A-Za-z]:[\\/]/.test(trimmed)) return false;
	return trimmed.split(/[\\/]+/).every((segment) => segment !== '..');
}

function validEvidencePaths(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.length > 0
		&& value.every((path) => typeof path === 'string' && isSafeRelativeEvidencePath(path))
		&& new Set(value).size === value.length;
}

function diagnostic(value: unknown): ProjectDiagnosticManifest | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length !== 1 || !Object.hasOwn(record, 'command')) return null;
	const command = record.command;
	return typeof command === 'string' && command.trim().length > 0 ? { command } : null;
}

/** Parse the repository-owned full-verification contract without filesystem or Git access. */
export function readProjectVerificationManifest(content: string): ProjectVerificationManifest {
	let value: unknown;
	try {
		value = JSON.parse(content);
	} catch {
		throw new Error('project verification manifest is not valid JSON');
	}
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('project verification manifest is not an object');
	}
	const record = value as Record<string, unknown>;
	if (record.version !== PROJECT_VERIFICATION_VERSION) {
		throw new Error(`project verification manifest has unsupported version: ${String(record.version)}`);
	}
	if (!validCommands(record.verify, false)) {
		throw new Error('project verification manifest has no valid verification commands');
	}
	const hasPrepare = Object.hasOwn(record, 'prepare');
	if (hasPrepare && !validCommands(record.prepare, true)) {
		throw new Error('project verification manifest has invalid preparation commands');
	}
	const hasDiagnostic = Object.hasOwn(record, 'diagnostic');
	const projectDiagnostic = hasDiagnostic ? diagnostic(record.diagnostic) : undefined;
	if (projectDiagnostic === null) {
		throw new Error('project verification manifest has invalid diagnostic command');
	}
	const hasReviewEvidencePaths = Object.hasOwn(record, 'reviewEvidencePaths');
	if (hasReviewEvidencePaths && !validEvidencePaths(record.reviewEvidencePaths)) {
		throw new Error('project verification manifest has invalid review evidence paths');
	}
	return {
		version: PROJECT_VERIFICATION_VERSION,
		...(hasPrepare ? { prepare: [...record.prepare as string[]] } : {}),
		verify: [...record.verify],
		...(projectDiagnostic === undefined ? {} : { diagnostic: projectDiagnostic }),
		...(hasReviewEvidencePaths ? { reviewEvidencePaths: [...record.reviewEvidencePaths as string[]] } : {}),
	};
}

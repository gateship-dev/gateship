import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { GitCommandRunner } from './git-runtime.ts';

/** Read-only identity of tracked and non-ignored new files, not the workflow build.
 * Ignored dependencies, secrets and external services are outside this identity.
 * Unsupported entries (e.g. submodules) or unreadable content remain unknown.
 */
export function verificationVersion(cwd: string, runGit: GitCommandRunner): string | null {
	try {
		const listing = runGit(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
		if (listing.exitCode !== 0 || !listing.stdout.endsWith('\0')) return null;
		const hash = createHash('sha256');
		for (const path of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) {
			hash.update(JSON.stringify(path));
			const stat = lstatSync(join(cwd, path), { throwIfNoEntry: false });
			if (stat === undefined) {
				hash.update(':deleted;');
				continue;
			}
			if (!stat.isFile() && !stat.isSymbolicLink()) return null;
			const bytes = stat.isSymbolicLink() ? Buffer.from(readlinkSync(join(cwd, path))) : readFileSync(join(cwd, path));
			hash.update(JSON.stringify([stat.isSymbolicLink() ? 'link' : 'file', stat.mode & 0o111, bytes.length]));
			hash.update(bytes);
		}
		return `worktree-sha256:${hash.digest('hex')}`;
	} catch { return null; }
}

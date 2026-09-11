#!/usr/bin/env bun

export type CiEvent = 'pull_request' | 'push';
export type CiArchitectures = { amd64: boolean; arm64: boolean };

const PACKAGING_PATH = /(^|\n)(Dockerfile|\.dockerignore|compose\.yaml|provider-cli-versions\.json|\.bun-version|package\.json|bun\.lock|vite\.config\.(ts|js|mjs|cjs)|\.github\/workflows\/|scripts\/)/;

export function selectCiArchitectures(event: CiEvent, diff: string | null): CiArchitectures {
	if (event === 'push') return { amd64: false, arm64: false };
	if (diff === null) return { amd64: true, arm64: true };
	const paths = diff.split('\n').flatMap((line) => {
		const fields = line.split('\t');
		if (fields[0]?.startsWith('R') && fields.length >= 3) return fields.slice(1, 3);
		return fields[1] ? [fields[1]] : [];
	}).join('\n');
	return { amd64: true, arm64: PACKAGING_PATH.test(paths) };
}

if (import.meta.main) {
	const event = process.env.GITHUB_EVENT_NAME === 'push' ? 'push' : 'pull_request';
	const [base, head] = process.argv.slice(2);
	let diff: string | null = '';
	if (event === 'pull_request') {
		if (!base || !head) diff = null;
		else {
			const result = Bun.spawnSync(['git', 'diff', '--name-status', '--find-renames', base, head]);
			diff = result.exitCode === 0 ? result.stdout.toString() : null;
		}
	}
	const result = selectCiArchitectures(event, diff);
	console.log(`needs_arm64=${result.arm64}`);
}

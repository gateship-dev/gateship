import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { inspectProject } from './project-readiness.ts';

export interface OnboardingCheck {
	key: 'git' | 'github' | 'branch' | 'container' | 'claude' | 'codex' | 'gh' | 'manifest' | 'verification';
	state: 'ready' | 'missing' | 'attention' | 'not-applicable';
	detail: string;
}

export interface ProjectOnboardingSnapshot {
	project: ReturnType<typeof inspectProject>;
	checks: OnboardingCheck[];
	verificationCommands: string[];
	manifestProposal: { commands: string[]; exclusions: string[]; risks: string[] } | null;
}

function executable(command: string): boolean {
	return Bun.which(command) !== null;
}

function ghAuthenticated(): boolean {
	if (!executable('gh')) return false;
	try {
		const result = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
			stdio: 'ignore',
			env: { PATH: process.env.PATH ?? '' },
		});
		return result.status === 0;
	} catch {
		return false;
	}
}

function detectedVerification(root: string): string[] {
	const manifestPath = join(root, '.gateship', 'project.json');
	if (existsSync(manifestPath)) {
		try {
			const value = JSON.parse(readFileSync(manifestPath, 'utf8')) as { verify?: unknown };
			if (Array.isArray(value.verify)) return value.verify.filter((command): command is string => typeof command === 'string' && command.trim() !== '');
		} catch { /* The readiness check reports the malformed manifest as attention. */ }
	}
	try {
		const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> };
		const verify = packageJson.scripts?.verify;
		return typeof verify === 'string' && verify.trim() !== '' ? [`bun run verify`] : [];
	} catch {
		return [];
	}
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the checklist keeps every prerequisite explicit for the operator
export function inspectProjectOnboarding(root: string | null, targetRepository?: string): ProjectOnboardingSnapshot {
	const remoteOnly = targetRepository !== undefined;
	const project = remoteOnly
		? { state: 'empty' as const, name: targetRepository, detail: 'A remote repository is selected; local checkout checks are not applicable yet.' }
		: inspectProject(root ?? '');
	const commands = !remoteOnly && project.state === 'ready' ? detectedVerification(root!) : [];
	const manifestExists = !remoteOnly && project.state === 'ready' && existsSync(join(root!, '.gateship', 'project.json'));
	const ghReady = ghAuthenticated();
	const checks: OnboardingCheck[] = [
		{ key: 'git', state: remoteOnly ? 'not-applicable' : project.state === 'empty' ? 'missing' : project.state === 'ready' ? 'ready' : 'attention', detail: remoteOnly ? 'Checked after the repository is imported.' : project.state === 'ready' ? 'Git repository detected.' : project.detail },
		{ key: 'github', state: remoteOnly ? 'ready' : project.state === 'ready' ? 'ready' : 'attention', detail: remoteOnly ? `Selected GitHub repository: ${targetRepository}` : project.state === 'ready' ? `GitHub remote: ${project.repository}` : 'A GitHub origin is required.' },
		{ key: 'branch', state: remoteOnly ? 'not-applicable' : project.state === 'ready' ? 'ready' : 'attention', detail: remoteOnly ? 'Checked after the repository is imported.' : project.state === 'ready' ? 'origin/main detected.' : 'origin/main is required.' },
		{ key: 'container', state: 'ready', detail: 'The Gateship container is available.' },
		{ key: 'claude', state: executable('claude') ? 'ready' : 'missing', detail: executable('claude') ? 'Claude is installed.' : 'Claude was not found in the container.' },
		{ key: 'codex', state: executable('codex') ? 'ready' : 'missing', detail: executable('codex') ? 'Codex is installed.' : 'Codex was not found in the container.' },
		{ key: 'gh', state: ghReady ? 'ready' : executable('gh') ? 'attention' : 'missing', detail: ghReady ? 'GitHub CLI is authenticated.' : 'Use gh auth login inside the container.' },
		{ key: 'manifest', state: remoteOnly ? 'not-applicable' : manifestExists ? 'ready' : 'attention', detail: remoteOnly ? 'Checked after the repository is imported.' : manifestExists ? '.gateship/project.json detected.' : 'No .gateship/project.json was found.' },
		{ key: 'verification', state: remoteOnly ? 'not-applicable' : commands.length > 0 ? 'ready' : 'attention', detail: remoteOnly ? 'Checked after the repository is imported.' : commands.length > 0 ? `${commands.length} verification command(s) detected.` : 'No verification command was detected.' },
	];
	return {
		project,
		checks,
		verificationCommands: commands,
		manifestProposal: remoteOnly || manifestExists ? null : {
			commands,
			exclusions: ['No command will run.', 'No file will be written.'],
			risks: ['Review the detected commands and project-specific risks before creating a manifest.'],
		},
	};
}

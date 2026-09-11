import { join } from 'node:path';

const project = Bun.argv[2];
if (project !== 'smoke' && project !== 'visual' && project !== 'update') {
	console.error('Usage: bun scripts/ui-test.ts <smoke|visual|update>');
	process.exit(2);
}

const fixedImage = 'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
const fixedProject = project === 'update' ? 'visual' : project;
const playwrightArgs = ['test', '--project=chromium', `--grep=@${fixedProject}`];
if (project === 'update') playwrightArgs.push('--update-snapshots');

if (process.env.GSHIP_UI_FIXED_CONTAINER !== '1') {
	const result = Bun.spawnSync([
		'docker', 'run', '--rm', '--platform', 'linux/amd64',
		'--env', 'GSHIP_UI_FIXED_CONTAINER=1',
		'--volume', '/workspace/node_modules',
		'--volume', `${process.cwd()}:/workspace`, '--workdir', '/workspace',
		fixedImage, 'bash', '-lc',
		'npm install --global bun@1.3.14 >/dev/null && bun install --frozen-lockfile && bun scripts/ui-test.ts "$@"',
		'gateship-ui-test', project,
	], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
	process.exit(result.exitCode);
}


const playwrightCli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const version = Bun.spawnSync([process.execPath, playwrightCli, '--version'], { stdout: 'pipe', stderr: 'pipe' });
const versionText = new TextDecoder().decode(version.stdout).trim();
if (version.exitCode !== 0 || versionText !== 'Version 1.63.0') {
	console.error(`Expected @playwright/test Version 1.63.0, got ${versionText || 'unknown'}`);
	process.exit(version.exitCode || 1);
}
console.log(`Using @playwright/test ${versionText} on linux/amd64`);

const result = Bun.spawnSync([process.execPath, playwrightCli, ...playwrightArgs], {
	cwd: process.cwd(),
	env: { ...process.env, GSHIP_UI_PROJECT: project },
	 stdin: 'inherit',
	 stdout: 'inherit',
	 stderr: 'inherit',
});
process.exit(result.exitCode);

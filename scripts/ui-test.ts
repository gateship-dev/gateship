import { join } from 'node:path';

const project = Bun.argv[2];
if (project !== 'smoke' && project !== 'visual') {
	console.error('Usage: bun scripts/ui-test.ts <smoke|visual>');
	process.exit(2);
}


const playwrightCli = join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const version = Bun.spawnSync([process.execPath, playwrightCli, '--version'], { stdout: 'pipe', stderr: 'pipe' });
const versionText = new TextDecoder().decode(version.stdout).trim();
if (version.exitCode !== 0 || versionText !== 'Version 1.63.0') {
	console.error(`Expected @playwright/test Version 1.63.0, got ${versionText || 'unknown'}`);
	process.exit(version.exitCode || 1);
}
console.log(`Using @playwright/test ${versionText}`);

const result = Bun.spawnSync([process.execPath, playwrightCli, 'test', '--project=chromium', `--grep=@${project}`], {
	cwd: process.cwd(),
	env: { ...process.env, GSHIP_UI_PROJECT: project },
	 stdin: 'inherit',
	 stdout: 'inherit',
	 stderr: 'inherit',
});
process.exit(result.exitCode);

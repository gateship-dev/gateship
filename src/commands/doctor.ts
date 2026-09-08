import process from 'node:process';

type Check = { name: string; ok: boolean; detail: string };

declare const GSHIP_CONTAINER_BUILD: string | undefined;

function commandCheck(name: string, args: string[], detail = name): Check {
	const path = Bun.which(name);
	if (path === null) return { name, ok: false, detail: `${detail}: ausente` };
	const result = Bun.spawnSync([path, ...args], { stdout: 'pipe', stderr: 'pipe' });
	return {
		name,
		ok: result.exitCode === 0,
		detail: result.exitCode === 0 ? `${detail}: disponível` : `${detail}: falhou (código ${result.exitCode})`,
	};
}

async function volumeCheck(): Promise<Check> {
	const home = process.env.GATESHIP_HOME ?? process.cwd();
	const path = `${home}/.gateship-doctor-${process.pid}`;
	let created = false;
	try {
		await Bun.write(path, 'ok');
		created = true;
		await Bun.file(path).delete();
		created = false;
		return { name: 'volume', ok: true, detail: `gravável: ${home}` };
	} catch {
		return { name: 'volume', ok: false, detail: `sem permissão de escrita: ${home}` };
	} finally {
		if (created) await Bun.file(path).delete().catch(() => undefined);
	}
}

export async function collectDoctorChecks(): Promise<Check[]> {
	const checks: Check[] = [
		{ name: 'arquitetura', ok: process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch), detail: `${process.platform}/${process.arch}` },
		{ name: 'container', ok: typeof GSHIP_CONTAINER_BUILD === 'string', detail: typeof GSHIP_CONTAINER_BUILD === 'string' ? 'imagem Gateship detectada' : 'execução nativa' },
		commandCheck('git', ['--version'], 'Git'),
		commandCheck('gh', ['--version'], 'GitHub CLI'),
		commandCheck('claude', ['--version'], 'Claude'),
		commandCheck('codex', ['--version'], 'Codex'),
		commandCheck('gh', ['auth', 'status'], 'login do GitHub CLI'),
		commandCheck('claude', ['auth', 'status'], 'login do Claude'),
	];
	checks.splice(2, 0, await volumeCheck());
	checks.push(commandCheck('codex', ['login', 'status'], 'login do Codex'));
	const port = Number(process.env.GATESHIP_PORT ?? '7777');
	try {
		const response = Bun.spawnSync(['curl', '--fail', '--silent', `http://127.0.0.1:${port}/api/snapshot`], { stdout: 'pipe', stderr: 'pipe' });
		checks.push({ name: 'conectividade-local', ok: response.exitCode === 0, detail: response.exitCode === 0 ? `responde em 127.0.0.1:${port}` : `sem resposta em 127.0.0.1:${port}` });
	} catch {
		checks.push({ name: 'conectividade-local', ok: false, detail: `sem resposta em 127.0.0.1:${port}` });
	}
	return checks;
}

export async function runDoctor(args: string[]): Promise<number> {
	if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
		process.stderr.write('Uso: gship doctor [--json]\n');
		return 1;
	}
	const checks = await collectDoctorChecks();
	if (args[0] === '--json') {
		process.stdout.write(`${JSON.stringify({ ok: checks.every((check) => check.ok), checks })}\n`);
	} else {
		process.stdout.write(`${checks.map((check) => `${check.ok ? 'OK' : 'FALHA'} ${check.name}: ${check.detail}`).join('\n')}\n`);
	}
	return checks.every((check) => check.ok) ? 0 : 1;
}

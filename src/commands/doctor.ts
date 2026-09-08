import process from 'node:process';

export type DoctorCheck = {
	id: string;
	name: string;
	ok: boolean;
	detail: string;
	actionable: boolean;
};

type DoctorOptions = {
	platform?: string;
	arch?: string;
	containerBuild?: boolean;
	env?: Record<string, string | undefined>;
	commandCheck?: (id: string, command: string[], name: string) => DoctorCheck;
	volumeCheck?: () => Promise<DoctorCheck>;
	connectivityCheck?: (port: number) => DoctorCheck;
};

declare const GSHIP_CONTAINER_BUILD: string | undefined;

function commandCheck(id: string, name: string, args: string[], label = name): DoctorCheck {
	const path = Bun.which(name);
	if (path === null) return { id, name: label, ok: false, detail: `${label}: ausente`, actionable: true };
	const result = Bun.spawnSync([path, ...args], { stdout: 'pipe', stderr: 'pipe' });
	return {
		id,
		name: label,
		ok: result.exitCode === 0,
		detail: result.exitCode === 0 ? `${label}: disponível` : `${label}: falhou (código ${result.exitCode})`,
		actionable: true,
	};
}

async function volumeCheck(env = process.env): Promise<DoctorCheck> {
	const home = env.GATESHIP_HOME ?? process.cwd();
	const path = `${home}/.gateship-doctor-${process.pid}`;
	let created = false;
	try {
		await Bun.write(path, 'ok');
		created = true;
		await Bun.file(path).delete();
		created = false;
		return { id: 'volume', name: 'volume', ok: true, detail: `gravável: ${home}`, actionable: true };
	} catch {
		return { id: 'volume', name: 'volume', ok: false, detail: `sem permissão de escrita: ${home}`, actionable: true };
	} finally {
		if (created) await Bun.file(path).delete().catch(() => undefined);
	}
}

function connectivityCheck(port: number): DoctorCheck {
	try {
		const response = Bun.spawnSync(['curl', '--fail', '--silent', `http://127.0.0.1:${port}/api/snapshot`], { stdout: 'pipe', stderr: 'pipe' });
		return { id: 'conectividade-local', name: 'conectividade-local', ok: response.exitCode === 0, detail: response.exitCode === 0 ? `responde em 127.0.0.1:${port}` : `sem resposta em 127.0.0.1:${port}`, actionable: true };
	} catch {
		return { id: 'conectividade-local', name: 'conectividade-local', ok: false, detail: `sem resposta em 127.0.0.1:${port}`, actionable: true };
	}
}

export async function collectDoctorChecks(options: DoctorOptions = {}): Promise<DoctorCheck[]> {
	const platform = options.platform ?? process.platform;
	const arch = options.arch ?? process.arch;
	const env = options.env ?? process.env;
	const containerBuild = options.containerBuild ?? typeof GSHIP_CONTAINER_BUILD === 'string';
	const runCommand = options.commandCheck ?? ((id, command, name) => commandCheck(id, command[0]!, command.slice(1), name));
	const checks: DoctorCheck[] = [
		{ id: 'arquitetura', name: 'arquitetura', ok: (containerBuild ? platform === 'linux' : platform === 'darwin' || platform === 'linux') && ['x64', 'arm64'].includes(arch), detail: `${platform}/${arch}`, actionable: true },
		{ id: 'container', name: 'container', ok: true, detail: containerBuild ? 'imagem Gateship detectada' : 'não aplicável: execução nativa', actionable: containerBuild },
		runCommand('git-disponibilidade', ['git', '--version'], 'Git'),
		runCommand('gh-disponibilidade', ['gh', '--version'], 'GitHub CLI disponível'),
		runCommand('claude-disponibilidade', ['claude', '--version'], 'Claude disponível'),
		runCommand('codex-disponibilidade', ['codex', '--version'], 'Codex disponível'),
		runCommand('gh-autenticacao', ['gh', 'auth', 'status'], 'GitHub CLI autenticado'),
		runCommand('claude-autenticacao', ['claude', 'auth', 'status'], 'Claude autenticado'),
	];
	if (containerBuild) checks.splice(2, 0, await (options.volumeCheck ?? (() => volumeCheck(env)))());
	checks.push(runCommand('codex-autenticacao', ['codex', 'login', 'status'], 'Codex autenticado'));
	const port = Number(env.GATESHIP_PORT ?? '7777');
	checks.push((options.connectivityCheck ?? connectivityCheck)(port));
	return checks;
}

export function doctorSucceeded(checks: DoctorCheck[]): boolean {
	return checks.every((check) => !check.actionable || check.ok);
}

export function doctorJson(checks: DoctorCheck[]): string {
	return JSON.stringify({ ok: doctorSucceeded(checks), checks });
}

export async function runDoctor(args: string[]): Promise<number> {
	if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
		process.stderr.write('Uso: gship doctor [--json]\n');
		return 1;
	}
	const checks = await collectDoctorChecks();
	if (args[0] === '--json') {
		process.stdout.write(`${doctorJson(checks)}\n`);
	} else {
		process.stdout.write(`${checks.map((check) => `${check.actionable ? (check.ok ? 'OK' : 'FALHA') : 'INFO'} ${check.name}: ${check.detail}`).join('\n')}\n`);
	}
	return doctorSucceeded(checks) ? 0 : 1;
}

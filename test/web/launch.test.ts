// test/web/launch.test.ts
//
// Real-process coverage for the `bun index.ts` launch boundary: resolved
// localhost bind, both --port spellings, CLI-only port validation, occupied
// port diagnostics, and signal-to-exit-code shutdown.
//
// The launched processes bind explicit ephemeral ports so the suite coexists
// with the live Gateship on 127.0.0.1:7777. The default port itself is asserted
// through parseWebArgs/DEFAULT_WEB_PORT, without opening a socket.

import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseWebArgs } from '../../index.ts';
import {
	BIND_HOSTNAME_ENV_VAR,
	DEFAULT_WEB_PORT,
	isTrustedCommandOrigin,
	isTrustedServiceHost,
	MAX_REQUEST_BODY_BYTES,
	resolveBindHostname,
	startWebServer,
	WEB_HOSTNAME,
} from '../../src/commands/web.ts';
import {
	GATESHIP_HOME_ENV_VAR,
	openProjectRegistry,
	PROJECT_REGISTRY_DATABASE,
} from '../../src/runtime/project-registry.ts';
import { createTestTmpdir } from '../helpers/test-tmpdir.ts';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const INDEX_TS = join(REPO_ROOT, 'index.ts');
const liveProcesses = new Set<ReturnType<typeof Bun.spawn>>();

interface SpawnedWebCli {
	proc: ReturnType<typeof Bun.spawn>;
	readyUrl: Promise<string>;
	stdoutText: Promise<string>;
	stderrText: Promise<string>;
}

interface WebProcessFixture {
	cwd: string;
	gateshipHome: string;
}

function createWebProcessFixture(prefix: string): WebProcessFixture {
	return {
		cwd: createTestTmpdir(`${prefix}-project-`),
		gateshipHome: createTestTmpdir(`${prefix}-home-`),
	};
}

function fixtureEnv(fixture: WebProcessFixture): Record<string, string | undefined> {
	return { ...process.env, [GATESHIP_HOME_ENV_VAR]: fixture.gateshipHome };
}

function readyCheckout(root: string): void {
	execFileSync('git', ['init', '-b', 'main'], { cwd: root });
	execFileSync('git', ['config', 'user.name', 'Test Operator'], { cwd: root });
	execFileSync('git', ['config', 'user.email', 'operator@example.com'], { cwd: root });
	writeFileSync(join(root, 'README.md'), '# product\n');
	execFileSync('git', ['add', 'README.md'], { cwd: root });
	execFileSync('git', ['commit', '-m', 'seed'], { cwd: root });
}

async function collectTextUntilClose(
	stream: ReadableStream<Uint8Array>,
	onText: (text: string) => void,
): Promise<string> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let text = '';
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		text += decoder.decode(chunk.value, { stream: true });
		onText(text);
	}
	text += decoder.decode();
	onText(text);
	return text;
}

/** Binds and releases an ephemeral port so the CLI can be given it explicitly. */
function reserveEphemeralPort(): number {
	const server = Bun.serve({ hostname: WEB_HOSTNAME, port: 0, fetch: () => new Response('') });
	const { port } = server;
	server.stop(true);
	if (port === undefined) throw new Error('Bun.serve did not report an ephemeral port');
	return port;
}

function spawnWebCli(args: string[], fixture = createWebProcessFixture('gship-web-cli')): SpawnedWebCli {
	const proc = Bun.spawn(['bun', INDEX_TS, ...args], {
		cwd: fixture.cwd,
		env: fixtureEnv(fixture),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	liveProcesses.add(proc);

	let resolveReady!: (url: string) => void;
	let rejectReady!: (error: Error) => void;
	let settled = false;
	const readyUrl = new Promise<string>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const stdoutText = collectTextUntilClose(proc.stdout, (text) => {
		const firstLine = text.split('\n')[0]?.trim();
		if (!settled && firstLine?.startsWith('http://')) {
			settled = true;
			resolveReady(firstLine);
		}
	}).then((text) => {
		if (!settled) {
			settled = true;
			rejectReady(new Error(`web CLI exited before printing its URL: ${JSON.stringify(text)}`));
		}
		return text;
	});
	const stderrText = new Response(proc.stderr).text();
	return { proc, readyUrl, stdoutText, stderrText };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function launchAndTerminate(args: string[], fixture?: WebProcessFixture): Promise<{
	url: string;
	exitCode: number;
	stdout: string;
	stderr: string;
}> {
	const launched = spawnWebCli(args, fixture);
	const url = await withTimeout(launched.readyUrl);
	const response = await fetch(url);
	expect(response.status).toBe(200);
	launched.proc.kill('SIGTERM');
	const [exitCode, stdout, stderr] = await Promise.all([
		launched.proc.exited,
		launched.stdoutText,
		launched.stderrText,
	]);
	liveProcesses.delete(launched.proc);
	return { url, exitCode, stdout, stderr };
}

afterEach(async () => {
	for (const proc of liveProcesses) {
		proc.kill('SIGKILL');
		await proc.exited;
	}
	liveProcesses.clear();
});

describe('web server launch', () => {
	test('startWebServer supports an ephemeral port and reports the resolved localhost address', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-launch-') });
		try {
			expect(handle.port).toBeGreaterThan(0);
			expect(handle.hostname).toBe('127.0.0.1');
			const response = await fetch(`http://${handle.hostname}:${handle.port}/`);
			expect(response.headers.get('content-type')).toContain('text/html');
			expect(await response.text()).toContain('<title>Gateship</title>');
		} finally {
			await handle.stop();
		}
	});

	test('refuses boot from a linked worktree before opening project state', () => {
		const root = createTestTmpdir('gship-web-worktree-root-');
		const worktree = createTestTmpdir('gship-web-worktree-linked-');
		const home = createTestTmpdir('gship-web-worktree-home-');
		readyCheckout(root);
		execFileSync('git', ['worktree', 'add', '-b', 'linked-web', worktree], { cwd: root });

		expect(() => startWebServer({ port: 0, cwd: worktree, gateshipHome: home }))
			.toThrow('Gateship cannot start from a linked Git worktree.');
		expect(existsSync(join(home, PROJECT_REGISTRY_DATABASE))).toBe(false);
		expect(existsSync(join(root, '.gship'))).toBe(false);
		expect(existsSync(join(worktree, '.gship'))).toBe(false);
	});

	test('the CLI default port is 7777 and needs no socket to resolve', () => {
		expect(DEFAULT_WEB_PORT).toBe(7777);
		expect(parseWebArgs([])).toEqual({ port: DEFAULT_WEB_PORT, help: false });
	});

	test('bun index.ts binds the requested port and exits 143 on SIGTERM', async () => {
		const fixture = createWebProcessFixture('gship-web-requested-port');
		const port = reserveEphemeralPort();
		const result = await launchAndTerminate([`--port=${port}`], fixture);
		expect(result.url).toBe(`http://127.0.0.1:${port}`);
		expect(result.stdout).toContain(`http://127.0.0.1:${port}`);
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(143);

		const registry = openProjectRegistry(fixture.gateshipHome);
		try {
			const projects = registry.list(fixture.cwd);
			expect(projects).toHaveLength(1);
			expect(projects[0]).toMatchObject({
				root: realpathSync(fixture.cwd),
				stateDir: join(fixture.cwd, '.gship'),
				current: true,
			});
		} finally {
			registry.close();
		}
	}, 10_000);

	// The default entry takes no options, so its target is always DEFAULT_WEB_PORT
	// and it is read from whichever channel the process reports it on: the printed
	// URL when the port is free, or the bind diagnostic when a Gateship owns it.
	test('bun index.ts with no subcommand targets the default web server', async () => {
		const launched = spawnWebCli([]);
		let url: string | null = null;
		try {
			url = await withTimeout(launched.readyUrl);
		} catch {
			url = null;
		}
		if (url !== null) launched.proc.kill('SIGTERM');
		const [exitCode, stderr] = await Promise.all([launched.proc.exited, launched.stderrText]);
		liveProcesses.delete(launched.proc);

		if (url !== null) {
			expect(url).toBe(`http://${WEB_HOSTNAME}:${DEFAULT_WEB_PORT}`);
			expect(stderr).toBe('');
			expect(exitCode).toBe(143);
			return;
		}
		expect(stderr).toContain(`failed to bind --port ${DEFAULT_WEB_PORT} on ${WEB_HOSTNAME}`);
		expect(exitCode).toBe(1);
	}, 10_000);

	test('the CLI accepts both --port N and --port=N', async () => {
		for (const joined of [false, true]) {
			const port = reserveEphemeralPort();
			const result = await launchAndTerminate(joined ? [`--port=${port}`] : ['--port', String(port)]);
			expect(result.url).toBe(`http://127.0.0.1:${port}`);
			expect(result.exitCode).toBe(143);
		}
	}, 15_000);

	test.each(['0', '-1', 'NaN', 'Infinity'])(
		'rejects invalid CLI --port value %s with a named diagnostic',
		(value) => {
			const fixture = createWebProcessFixture('gship-web-invalid-port');
			const result = Bun.spawnSync(['bun', INDEX_TS, '--port', value], {
				cwd: fixture.cwd,
				env: fixtureEnv(fixture),
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(result.exitCode).not.toBe(0);
			expect(new TextDecoder().decode(result.stderr)).toContain('--port');
		},
	);

	test('an occupied port fails nonzero with a --port diagnostic', async () => {
		const fixture = createWebProcessFixture('gship-web-occupied');
		const occupied = startWebServer({
			port: 0,
			cwd: fixture.cwd,
			gateshipHome: fixture.gateshipHome,
		});
		try {
			const result = Bun.spawnSync(['bun', INDEX_TS, `--port=${occupied.port}`], {
				cwd: fixture.cwd,
				env: fixtureEnv(fixture),
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(result.exitCode).not.toBe(0);
			expect(new TextDecoder().decode(result.stderr)).toContain('--port');
		} finally {
			await occupied.stop();
		}
	});
});

describe('GATESHIP_BIND_HOST (container bind address)', () => {
	test('resolveBindHostname keeps WEB_HOSTNAME when unset or blank', () => {
		expect(resolveBindHostname({})).toBe(WEB_HOSTNAME);
		expect(resolveBindHostname({ [BIND_HOSTNAME_ENV_VAR]: '' })).toBe(WEB_HOSTNAME);
		expect(resolveBindHostname({ [BIND_HOSTNAME_ENV_VAR]: '   ' })).toBe(WEB_HOSTNAME);
	});

	test('resolveBindHostname trims and returns an explicit override', () => {
		expect(resolveBindHostname({ [BIND_HOSTNAME_ENV_VAR]: '0.0.0.0' })).toBe('0.0.0.0');
		expect(resolveBindHostname({ [BIND_HOSTNAME_ENV_VAR]: '  0.0.0.0  ' })).toBe('0.0.0.0');
	});

	// A container must bind a non-loopback interface, or Docker's
	// published-port proxy -- which always connects to the container's own
	// network address, never its loopback -- has nothing to reach.
	test('startWebServer binds the overridden host, not WEB_HOSTNAME', async () => {
		const previous = process.env[BIND_HOSTNAME_ENV_VAR];
		process.env[BIND_HOSTNAME_ENV_VAR] = '0.0.0.0';
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-bind-host-') });
		try {
			expect(handle.hostname).not.toBe(WEB_HOSTNAME);
			const response = await fetch(`http://127.0.0.1:${handle.port}/`);
			expect(response.status).toBe(200);
		} finally {
			await handle.stop();
			if (previous === undefined) delete process.env[BIND_HOSTNAME_ENV_VAR];
			else process.env[BIND_HOSTNAME_ENV_VAR] = previous;
		}
	});

	// The bind address is a socket concern only: the browser always reaches
	// the service through 127.0.0.1 or localhost (the host side of a
	// container's published port stays restricted to loopback), so the
	// trusted-origin check must keep accepting exactly those regardless of
	// what the process bound to.
	test('the trusted-origin check is unaffected by the bind host override', () => {
		const trusted = new Request('http://127.0.0.1:7777/api/runs', {
			headers: { origin: 'http://127.0.0.1:7777' },
		});
		expect(isTrustedCommandOrigin(trusted)).toBe(true);
	});
});

// GSHIP-897: DNS rebinding closes over `Host`, not `Origin` -- an attacker's
// page is served from the attacker's own hostname, which DNS then resolves to
// 127.0.0.1, and the browser keeps sending that attacker hostname as `Host`
// regardless of what DNS resolved it to. This check runs ahead of and
// independent of the trusted-origin check above.
//
// GSHIP-902: the port carries no trust signal -- it does not stop DNS
// rebinding, and Docker's published-port mapping (`docker run -p
// 127.0.0.1:17778:7777`) routinely puts a different port in front of this
// process than the one it actually binds. Only the hostname is compared.
describe('isTrustedServiceHost (GSHIP-897, GSHIP-902)', () => {
	const request = (host: string | null) => new Request('http://ignored/', {
		headers: host === null ? {} : { host },
	});

	test('accepts 127.0.0.1 on any port, or no port at all', () => {
		expect(isTrustedServiceHost(request('127.0.0.1:17778'))).toBe(true);
		expect(isTrustedServiceHost(request('127.0.0.1'))).toBe(true);
	});

	test('accepts localhost on any port, or no port at all', () => {
		expect(isTrustedServiceHost(request('localhost:9999'))).toBe(true);
		expect(isTrustedServiceHost(request('localhost'))).toBe(true);
	});

	test('refuses a different hostname regardless of port, and a missing Host header', () => {
		expect(isTrustedServiceHost(request('evil.example'))).toBe(false);
		expect(isTrustedServiceHost(request('evil.example:7777'))).toBe(false);
		expect(isTrustedServiceHost(request(null))).toBe(false);
	});
});

describe('Host guard and security headers (GSHIP-897)', () => {
	test('a mismatched Host is refused with 421 and no body, on GET and POST, on every kind of route', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-host-guard-') });
		try {
			const origin = `http://${handle.hostname}:${handle.port}`;
			const rebound = { host: 'evil.example' };
			const getTargets = ['/', '/app.js', '/api/snapshot', '/api/runs', '/api/events'];
			for (const path of getTargets) {
				const response = await fetch(`${origin}${path}`, { headers: rebound });
				expect(response.status).toBe(421);
				expect(await response.text()).toBe('');
			}
			const post = await fetch(`${origin}/api/runs`, {
				method: 'POST',
				headers: { ...rebound, 'content-type': 'application/json' },
				body: JSON.stringify({ issueId: 'GSHIP-1' }),
			});
			expect(post.status).toBe(421);
			expect(await post.text()).toBe('');
		} finally {
			await handle.stop();
		}
	});

	test('a valid Host is accepted with any port, or none at all', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-host-guard-valid-') });
		try {
			const base = `http://${handle.hostname}:${handle.port}/api/snapshot`;
			const withPort = await fetch(base, { headers: { host: `${handle.hostname}:${handle.port}` } });
			expect(withPort.status).toBe(200);
			const withoutPort = await fetch(base, { headers: { host: handle.hostname } });
			expect(withoutPort.status).toBe(200);
			const localhostWithPort = await fetch(base, { headers: { host: `localhost:${handle.port}` } });
			expect(localhostWithPort.status).toBe(200);
		} finally {
			await handle.stop();
		}
	});

	// GSHIP-902: `docker run -p 127.0.0.1:17778:7777` publishes this service's
	// fixed internal port under a host port the process never binds and cannot
	// see through Docker's NAT; the browser (or curl, as in the release smoke)
	// legitimately sends that published port as Host regardless of what this
	// process actually bound. Port comparison offers no security benefit here
	// -- only the hostname does -- so any port on 127.0.0.1 is accepted, on
	// GET and POST alike.
	test('a Host naming 127.0.0.1 on a port other than the bind port is still accepted, on GET and POST', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-host-guard-published-ip-') });
		try {
			const otherPort = handle.port > 1024 ? handle.port - 1 : handle.port + 1;
			const host = `${handle.hostname}:${otherPort}`;
			const get = await fetch(`http://${handle.hostname}:${handle.port}/api/snapshot`, { headers: { host } });
			expect(get.status).toBe(200);
			const post = await fetch(`http://${handle.hostname}:${handle.port}/api/runs`, {
				method: 'POST',
				headers: { host, 'content-type': 'application/json' },
				body: JSON.stringify({ issueId: 'GSHIP-1' }),
			});
			expect(post.status).not.toBe(421);
		} finally {
			await handle.stop();
		}
	});

	test('a Host naming localhost on a port other than the bind port is still accepted, for a static asset', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-host-guard-published-localhost-') });
		try {
			const otherPort = handle.port > 1024 ? handle.port - 1 : handle.port + 1;
			const response = await fetch(`http://${handle.hostname}:${handle.port}/app.js`, {
				headers: { host: `localhost:${otherPort}` },
			});
			expect(response.status).toBe(200);
		} finally {
			await handle.stop();
		}
	});

	test('every response carries the fixed security headers, on an API route and on a static asset', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-security-headers-') });
		try {
			const origin = `http://${handle.hostname}:${handle.port}`;
			for (const path of ['/api/snapshot', '/app.js']) {
				const response = await fetch(`${origin}${path}`);
				expect(response.headers.get('content-security-policy'))
					.toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'");
				expect(response.headers.get('x-content-type-options')).toBe('nosniff');
				expect(response.headers.get('referrer-policy')).toBe('no-referrer');
			}
		} finally {
			await handle.stop();
		}
	});

	// `routes` only dispatches the paths and methods it declares; anything
	// else falls through to Bun.serve's `fetch` fallback, which must apply the
	// same Host guard and security headers `guard` applies to every declared
	// route.
	test('an unknown path with a mismatched Host is refused with 421 and no body', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-unknown-path-host-') });
		try {
			const response = await fetch(`http://${handle.hostname}:${handle.port}/no-such-route`, {
				headers: { host: 'evil.example' },
			});
			expect(response.status).toBe(421);
			expect(await response.text()).toBe('');
		} finally {
			await handle.stop();
		}
	});

	test('an unknown path with a valid Host answers 404 and still carries the security headers', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-unknown-path-') });
		try {
			const response = await fetch(`http://${handle.hostname}:${handle.port}/no-such-route`);
			expect(response.status).toBe(404);
			expect(response.headers.get('content-security-policy'))
				.toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'");
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		} finally {
			await handle.stop();
		}
	});

	test('a method not declared on a known route still carries the security headers', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-undeclared-method-') });
		try {
			// '/api/runs' declares only GET and POST; DELETE falls through to the
			// fetch fallback exactly like an unknown path does.
			const response = await fetch(`http://${handle.hostname}:${handle.port}/api/runs`, { method: 'DELETE' });
			expect(response.status).toBe(404);
			expect(response.headers.get('content-security-policy'))
				.toBe("default-src 'self'; script-src 'self'; frame-ancestors 'none'");
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('referrer-policy')).toBe('no-referrer');
		} finally {
			await handle.stop();
		}
	});

	test('a request body over the configured limit is refused with 413', async () => {
		const handle = startWebServer({ port: 0, cwd: createTestTmpdir('gship-web-body-limit-') });
		try {
			const origin = `http://${handle.hostname}:${handle.port}`;
			const oversized = 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1);
			const response = await fetch(`${origin}/api/projects`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin },
				body: oversized,
			});
			expect(response.status).toBe(413);
			// Bun rejects an oversized body at the connection level -- before
			// `routes`, the `fetch` fallback or `error` ever run -- so this
			// specific response cannot carry the security headers every other
			// response in this file does. Known Bun limitation, not something
			// this issue works around by resizing the limit.
			expect(response.headers.get('content-security-policy')).toBeNull();
		} finally {
			await handle.stop();
		}
	}, 10_000);
});

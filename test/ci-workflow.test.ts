// Static-source guard for .github/workflows/ci.yml (GSHIP-734). The workflow
// shape is intentionally checked from source so a concurrency or trigger
// change cannot silently reintroduce release suppression.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_PATH = resolve(import.meta.dir, '..', '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

function blockBetween(startMarker: string, endMarker: string): string {
	const start = workflow.indexOf(startMarker);
	expect(start).toBeGreaterThan(-1);
	const end = workflow.indexOf(endMarker, start + startMarker.length);
	return workflow.slice(start, end === -1 ? workflow.length : end);
}

describe('ci.yml push trigger (GSHIP-734)', () => {
	test('ignores only issue metadata paths on pushes to main', () => {
		const pushBlock = blockBetween('\n  push:\n', '\n  pull_request:\n');

		expect(pushBlock).toContain('branches: [main]');
		expect(pushBlock).toContain("paths-ignore:\n      - '.gateship/issues/**'");
		expect(pushBlock.match(/^      - .+$/gm)).toEqual(["      - '.gateship/issues/**'"]);
	});
});

describe('ci.yml concurrency (GSHIP-734)', () => {
	test('separates push runs by SHA and groups pull request runs by PR number', () => {
		const concurrencyBlock = blockBetween('\nconcurrency:\n', '\njobs:\n');

		expect(concurrencyBlock).toContain("github.event_name == 'push'");
		expect(concurrencyBlock).toContain('github.sha');
		expect(concurrencyBlock).toContain('github.event.pull_request.number');
		expect(concurrencyBlock).toContain('cancel-in-progress: true');
	});
});

describe('ci.yml container architecture smoke coverage (GSHIP-816)', () => {
	test('registers QEMU and Buildx, builds both Linux platforms and loads separate local tags', () => {
		expect(workflow).toContain('uses: docker/setup-qemu-action@v3');
		expect(workflow).toContain('platforms: arm64');
		expect(workflow).toContain('uses: docker/setup-buildx-action@v3');
		expect(workflow).toContain('docker buildx build --platform linux/amd64');
		expect(workflow).toContain('docker buildx build --platform linux/arm64');
		expect(workflow).toContain('-t gateship:ci-amd64 --load .');
		expect(workflow).toContain('-t gateship:ci-arm64 --load .');
	});

	test('smokes amd64 health and runs CLI checks under arm64 emulation', () => {
		expect(workflow).toContain('docker run --rm -d --name gateship-ci -p 127.0.0.1:17777:7777 gateship:ci-amd64');
		expect(workflow).toContain('docker run --rm --entrypoint claude gateship:ci-arm64 --version');
		expect(workflow).toContain('docker run --rm --entrypoint codex gateship:ci-arm64 --version');
	});
});

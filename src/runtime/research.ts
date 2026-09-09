import { createHash } from 'node:crypto';
import type { ResearchContract, ResearchReceipt, ResearchSourceClass } from '../issues/spec.ts';

export interface ResearchExcerpt {
	url: string;
	sourceType: ResearchSourceClass;
	contentHash: string;
	claim: string;
	applicability: string;
	excerpt: string;
	installedVersion?: string;
	targetVersion?: string;
	resolvedRef?: ResearchReceipt['resolvedRef'];
}

export interface ResearchBundle {
	questions: readonly string[];
	sources: readonly ResearchExcerpt[];
	provider: string;
	model: string;
	effort: string;
	latencyMs: number;
}

export class ResearchFailure extends Error {
	readonly code: 'unavailable' | 'timeout' | 'too-large' | 'redirect' | 'invalid-source' | 'incomplete';
	constructor(code: ResearchFailure['code'], message: string) {
		super(message);
		this.name = 'ResearchFailure';
		this.code = code;
	}
}

export interface Researcher {
	readonly provider: string;
	readonly model: string;
	readonly effort: string;
	research(input: { contract: ResearchContract; signal: AbortSignal; reusable?: readonly ResearchExcerpt[] }): Promise<ResearchBundle>;
}

function sameRef(left: ResearchReceipt['resolvedRef'], right: ResearchReceipt['resolvedRef']): boolean {
	return left?.kind === right?.kind && left?.value === right?.value;
}

/** Runtime boundary validation for injected researchers and persisted bundles. */
export function validateResearchBundle(contract: ResearchContract, bundle: ResearchBundle): ResearchFailure | null {
	if (!Array.isArray(bundle.questions) || bundle.questions.length !== contract.questions.length
		|| bundle.questions.some((question, index) => question !== contract.questions[index])) {
		return new ResearchFailure('incomplete', 'Research bundle questions do not match the approved contract.');
	}
	if (!Array.isArray(bundle.sources) || bundle.sources.length !== (contract.receipts?.length ?? 0)) {
		return new ResearchFailure('incomplete', 'Research bundle does not contain one validated source for every approved receipt.');
	}
	if (typeof bundle.provider !== 'string' || bundle.provider.trim().length === 0
		|| typeof bundle.model !== 'string' || bundle.model.trim().length === 0
		|| typeof bundle.effort !== 'string' || bundle.effort.trim().length === 0
		|| !Number.isFinite(bundle.latencyMs) || bundle.latencyMs < 0) {
		return new ResearchFailure('incomplete', 'Research bundle telemetry is invalid.');
	}
	const receipts = contract.receipts ?? [];
	const matched = new Set<number>();
	for (const source of bundle.sources) {
		if (typeof source.url !== 'string' || typeof source.sourceType !== 'string'
			|| typeof source.contentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(source.contentHash)
			|| typeof source.claim !== 'string' || source.claim.trim().length === 0
			|| typeof source.applicability !== 'string' || source.applicability.trim().length === 0
			|| typeof source.excerpt !== 'string' || source.excerpt.length === 0 || source.excerpt.length > 2_000) {
			return new ResearchFailure('incomplete', 'Research bundle contains an invalid source.');
		}
		const index = receipts.findIndex((receipt, candidate) => !matched.has(candidate)
			&& receipt.url === source.url
			&& receipt.sourceType === source.sourceType
			&& receipt.contentHash.toLowerCase() === source.contentHash.toLowerCase()
			&& receipt.claim === source.claim
			&& receipt.applicability === source.applicability
			&& receipt.installedVersion === source.installedVersion
			&& receipt.targetVersion === source.targetVersion
			&& sameRef(receipt.resolvedRef, source.resolvedRef));
		if (index < 0) return new ResearchFailure('incomplete', 'Research bundle source does not match an approved receipt.');
		matched.add(index);
	}
	const covered = contract.questions.every((question) => bundle.sources.some((source) => `${source.claim} ${source.applicability}`.toLowerCase().includes(question.toLowerCase())));
	return covered ? null : new ResearchFailure('incomplete', 'Research bundle does not cover every approved question.');
}

const MAX_SOURCE_BYTES = 512 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

async function readBounded(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (reader === undefined) throw new ResearchFailure('unavailable', 'Research source returned no body.');
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			size += next.value.byteLength;
			if (size > MAX_SOURCE_BYTES) throw new ResearchFailure('too-large', 'Research source exceeded the size limit.');
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return new TextDecoder().decode(bytes);
}

function parseHttpsUrl(url: string): URL {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'https:') throw new Error('not HTTPS');
		return parsed;
	} catch {
		throw new ResearchFailure('invalid-source', `Invalid research URL: ${url}`);
	}
}

async function fetchOnce(url: string, signal: AbortSignal): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const abort = (): void => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	try {
		const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
		if (!response.ok && !(response.status >= 300 && response.status < 400)) {
			throw new ResearchFailure('unavailable', `Research source returned HTTP ${response.status}.`);
		}
		return response;
	} catch (error) {
		if (error instanceof ResearchFailure) throw error;
		if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
		if (error instanceof DOMException && error.name === 'AbortError') throw new ResearchFailure('timeout', 'Research source timed out.');
		throw new ResearchFailure('unavailable', error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', abort);
	}
}

function nextRedirect(response: Response, current: string): string {
	const location = response.headers.get('location');
	if (location === null) throw new ResearchFailure('redirect', 'Research source returned an invalid redirect.');
	return parseHttpsUrl(new URL(location, current).toString()).toString();
}

async function fetchSource(url: string, signal: AbortSignal): Promise<{ body: string; finalUrl: string }> {
	let current = parseHttpsUrl(url).toString();
	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
		const response = await fetchOnce(current, signal);
		if (response.status >= 300 && response.status < 400) {
			current = nextRedirect(response, current);
			continue;
		}
		return { body: await readBounded(response), finalUrl: current };
	}
	throw new ResearchFailure('redirect', 'Research source exceeded the redirect limit.');
}

export class HttpResearcher implements Researcher {
	readonly provider = 'gateship';
	readonly model = 'typed-http';
	readonly effort = 'deterministic';

	async research({ contract, signal, reusable = [] }: { contract: ResearchContract; signal: AbortSignal; reusable?: readonly ResearchExcerpt[] }): Promise<ResearchBundle> {
		const started = performance.now();
		const sources: ResearchExcerpt[] = [...reusable];
		for (const receipt of contract.receipts ?? []) {
			if (reusable.some((source) => source.url === receipt.url
				&& source.contentHash.toLowerCase() === receipt.contentHash.toLowerCase()
				&& source.sourceType === receipt.sourceType
				&& source.claim === receipt.claim
				&& source.applicability === receipt.applicability
				&& source.installedVersion === receipt.installedVersion
				&& source.targetVersion === receipt.targetVersion
				&& sameRef(source.resolvedRef, receipt.resolvedRef))) continue;
			const fetched = await fetchSource(receipt.url, signal);
			const contentHash = `sha256:${createHash('sha256').update(fetched.body).digest('hex')}`;
			if (contentHash !== receipt.contentHash) throw new ResearchFailure('incomplete', `Research source changed: ${receipt.url}`);
			sources.push({
				url: receipt.url,
				sourceType: receipt.sourceType,
				contentHash,
				claim: receipt.claim,
				applicability: receipt.applicability,
				excerpt: fetched.body.slice(0, 2_000),
				...(receipt.installedVersion === undefined ? {} : { installedVersion: receipt.installedVersion }),
				...(receipt.targetVersion === undefined ? {} : { targetVersion: receipt.targetVersion }),
				...(receipt.resolvedRef === undefined ? {} : { resolvedRef: receipt.resolvedRef }),
			});
		}
		if (sources.length === 0) throw new ResearchFailure('incomplete', 'Research produced no validated sources.');
		const covered = contract.questions.every((question) => sources.some((source) => `${source.claim} ${source.applicability}`.toLowerCase().includes(question.toLowerCase())));
		if (!covered) throw new ResearchFailure('incomplete', 'Research did not cover every approved question.');
		return { questions: contract.questions, sources, provider: this.provider, model: this.model, effort: this.effort, latencyMs: Math.round(performance.now() - started) };
	}
}

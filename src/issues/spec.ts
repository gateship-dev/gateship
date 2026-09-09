import { createHash } from 'node:crypto';

/**
 * One command that was run while specifying, and the output observed then.
 * Once a run starts, the same command runs again in the run's own workspace
 * -- after it is prepared and before any provider is invoked -- and fails the
 * run if `output` no longer matches: evidence that the spec's premise, not
 * just its conclusion, describes the repository.
 */
export interface EvidenceItem {
	command: string;
	/** Empty only in intake payloads; the server replaces it with observed output. */
	output: string;
}

export const EVIDENCE_LIMITS = {
	maxItems: 3,
	command: 200,
	output: 600,
} as const;

export const SPEC_V2_LIMITS = {
	objective: 300,
	acceptance: 300,
	maxAcceptance: 7,
	boundary: 200,
	maxBoundaries: 5,
	maxResearchQuestions: 5,
	maxResearchReceipts: 12,
	researchQuestion: 300,
	researchClaim: 500,
	researchApplicability: 300,
	researchUrl: 2000,
	researchHash: 128,
} as const;

export const RESEARCH_SOURCE_CLASSES = ['official-documentation', 'primary-code', 'release-notes', 'security-advisory', 'standard'] as const;
export type ResearchSourceClass = typeof RESEARCH_SOURCE_CLASSES[number];
export type ResearchResolvedRef = { kind: 'release' | 'tag' | 'commit'; value: string };
export type ResearchFreshnessPolicy =
	| { mode: 'installed-version'; installedVersion: string }
	| { mode: 'target-version'; installedVersion: string; targetVersion: string }
	| { mode: 'current'; resolvedAt: string };

export interface ResearchReceipt {
	readonly url: string;
	readonly sourceType: ResearchSourceClass;
	readonly fetchedAt: string;
	readonly installedVersion?: string;
	readonly targetVersion?: string;
	readonly resolvedRef?: ResearchResolvedRef;
	readonly contentHash: string;
	readonly claim: string;
	readonly applicability: string;
}

export interface ResearchContract {
	readonly questions: string[];
	readonly sourceClasses: ResearchSourceClass[];
	readonly freshness: ResearchFreshnessPolicy;
	readonly receipts?: ResearchReceipt[];
}

export interface LegacySpec {
	scope: string;
	verify?: string[];
	/** Executable premise, captured at intake and checked again before any provider runs. */
	evidence?: EvidenceItem[];
}

export interface SpecV2 {
	version: 2;
	objective: string;
	acceptance: string[];
	boundaries?: string[];
	verify: string[];
	evidence?: EvidenceItem[];
	research?: ResearchContract;
}

export type Spec = LegacySpec | SpecV2;

export interface SpecProfile {
	version: 'legacy' | 'v2' | 'unknown';
	fingerprint: string | null;
	counts: {
		acceptance: number | null;
		boundaries: number | null;
		verify: number | null;
		evidence: number | null;
	};
}

/** The immutable, text-free spec facts recorded on a new run. */
export function profileSpec(spec: Spec | undefined): SpecProfile {
	if (spec === undefined) {
		return { version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null } };
	}
	if ('version' in spec && spec.version === 2) {
		return {
			version: 'v2',
			fingerprint: fingerprintSpec(spec),
			counts: {
				acceptance: spec.acceptance.length,
				boundaries: spec.boundaries?.length ?? 0,
				verify: spec.verify.length,
				evidence: spec.evidence?.length ?? 0,
			},
		};
	}
	return {
		version: 'legacy',
		fingerprint: fingerprintSpec(spec),
		counts: {
			acceptance: 0,
			boundaries: 0,
			verify: spec.verify?.length ?? 0,
			evidence: spec.evidence?.length ?? 0,
		},
	};
}

export interface ValidationResult {
	ok: boolean;
	errors: string[];
}

function canonicalResearch(research: ResearchContract): Record<string, unknown> {
	const freshness = research.freshness.mode === 'installed-version'
		? { mode: research.freshness.mode, installedVersion: research.freshness.installedVersion.trim() }
		: research.freshness.mode === 'target-version'
			? { mode: research.freshness.mode, installedVersion: research.freshness.installedVersion.trim(), targetVersion: research.freshness.targetVersion.trim() }
			: { mode: research.freshness.mode, resolvedAt: research.freshness.resolvedAt.trim() };
	const receipts = research.receipts?.map((receipt) => ({
		url: receipt.url.trim(),
		sourceType: receipt.sourceType,
		fetchedAt: receipt.fetchedAt.trim(),
		...(receipt.installedVersion === undefined ? {} : { installedVersion: receipt.installedVersion.trim() }),
		...(receipt.targetVersion === undefined ? {} : { targetVersion: receipt.targetVersion.trim() }),
		...(receipt.resolvedRef === undefined ? {} : { resolvedRef: { kind: receipt.resolvedRef.kind, value: receipt.resolvedRef.value.trim() } }),
		contentHash: receipt.contentHash.trim(),
		claim: receipt.claim.trim(),
		applicability: receipt.applicability.trim(),
	}));
	return {
		questions: research.questions.map((question) => question.trim()),
		sourceClasses: [...research.sourceClasses],
		freshness,
		...(receipts === undefined ? {} : { receipts }),
	};
}

/** Fingerprint every normalized command the operator authorizes the runtime to execute. */
export function fingerprintSpec(spec: Spec): string {
	const evidence = (spec.evidence ?? []).map((item) => ({
		command: item.command.trim(),
		output: item.output.trim(),
	}));
	let canonical: string;
	if ('version' in spec && spec.version === 2) {
		canonical = JSON.stringify({
			version: 2,
			objective: spec.objective.trim(),
			acceptance: spec.acceptance.map((item) => item.trim()),
			...(spec.boundaries === undefined || spec.boundaries.length === 0
				? {} : { boundaries: spec.boundaries.map((item) => item.trim()) }),
			verify: spec.verify.map((command) => command.trim()),
			...(evidence.length === 0 ? {} : { evidence }),
			...(spec.research === undefined ? {} : { research: canonicalResearch(spec.research) }),
		});
	} else {
		canonical = JSON.stringify({
			scope: (spec as LegacySpec).scope.trim(),
			verify: (spec.verify ?? []).map((command) => command.trim()),
			...(evidence.length === 0 ? {} : { evidence }),
		});
	}
	return createHash('sha256').update(canonical).digest('hex');
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function validateStringList(value: unknown, label: string, maxItems: number, maxLength: number, errors: string[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push(`${label} must be a non-empty list`);
		return;
	}
	if (value.length > maxItems) errors.push(`${label} accepts at most ${maxItems} items`);
	const normalized = new Set<string>();
	value.forEach((item, index) => {
		if (!isNonEmptyString(item)) {
			errors.push(`${label}[${index}] must be a non-empty string`);
			return;
		}
		const trimmed = item.trim();
		if (trimmed.length > maxLength) errors.push(`${label}[${index}] exceeds ${maxLength} characters`);
		if (normalized.has(trimmed)) errors.push(`${label}[${index}] is duplicated`);
		normalized.add(trimmed);
	});
}

/** Validate one evidence item's shape and size, appending to `errors` in place. */
function validateEvidenceItem(value: unknown, index: number, errors: string[]): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		errors.push(`evidence[${index}] must be an object with command and output`);
		return;
	}
	const item = value as Record<string, unknown>;
	if (!isNonEmptyString(item['command'])) {
		errors.push(`evidence[${index}].command must be a non-empty string`);
	} else if (item['command'].length > EVIDENCE_LIMITS.command) {
		errors.push(`evidence[${index}].command exceeds ${EVIDENCE_LIMITS.command} characters`);
	}
	if (!isNonEmptyString(item['output'])) {
		errors.push(`evidence[${index}].output must be a non-empty string`);
	} else if (item['output'].length > EVIDENCE_LIMITS.output) {
		errors.push(`evidence[${index}].output exceeds ${EVIDENCE_LIMITS.output} characters`);
	}
}

/** Validate the optional evidence field, appending to `errors` in place. */
function validateEvidence(value: unknown, errors: string[]): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push('evidence must be an array');
		return;
	}
	if (value.length > EVIDENCE_LIMITS.maxItems) {
		errors.push(`evidence accepts at most ${EVIDENCE_LIMITS.maxItems} items`);
	}
	value.forEach((item, index) => validateEvidenceItem(item, index, errors));
}

function validateAllowedFields(candidate: Record<string, unknown>, allowed: Set<string>, label: string, errors: string[]): void {
	for (const key of Object.keys(candidate)) if (!allowed.has(key)) errors.push(`${key} is not allowed in a ${label} spec`);
}

function isValidUtcTimestamp(candidate: unknown): candidate is string {
	if (typeof candidate !== 'string') return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(candidate);
	if (match === null) return false;
	const [, yearText, monthText, dayText, hourText, minuteText, secondText, millisecondText] = match;
	const date = new Date(0);
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	const millisecond = millisecondText === undefined ? 0 : Number(millisecondText);
	date.setUTCFullYear(year, month - 1, day);
	date.setUTCHours(hour, minute, second, millisecond);
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day && date.getUTCHours() === hour
		&& date.getUTCMinutes() === minute && date.getUTCSeconds() === second
		&& date.getUTCMilliseconds() === millisecond;
}

type RepositoryRoute = { value?: string; kinds: string[]; moving?: boolean; invalid?: boolean };
type ResearchPolicyContext = { isUpgrade: boolean; isInstalledVersionPolicy: boolean; installedVersion?: unknown };

function validateResearchSourceClasses(value: unknown, errors: string[]): void {
	if (!Array.isArray(value) || value.length === 0) {
		errors.push('research.sourceClasses must be a non-empty list');
		return;
	}
	const seen = new Set<string>();
	for (const [index, item] of value.entries()) {
		if (!RESEARCH_SOURCE_CLASSES.includes(item as ResearchSourceClass)) errors.push(`research.sourceClasses[${index}] is not a supported primary source class`);
		if (typeof item === 'string' && seen.has(item)) errors.push(`research.sourceClasses[${index}] is duplicated`);
		if (typeof item === 'string') seen.add(item);
	}
}

function validateResearchFreshness(value: unknown, errors: string[]): ResearchPolicyContext {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		errors.push('research.freshness must be an object');
		return { isUpgrade: false, isInstalledVersionPolicy: false };
	}
	return validateResearchFreshnessPolicy(value as Record<string, unknown>, errors);
}

function validateResearchFreshnessPolicy(policy: Record<string, unknown>, errors: string[]): ResearchPolicyContext {
	const context: ResearchPolicyContext = { isUpgrade: false, isInstalledVersionPolicy: false };
	const mode = policy['mode'];
	if (!['installed-version', 'target-version', 'current'].includes(mode as string)) {
		errors.push('research.freshness.mode is invalid');
		return context;
	}
	const fields = mode === 'installed-version' ? ['mode', 'installedVersion'] : mode === 'target-version' ? ['mode', 'installedVersion', 'targetVersion'] : ['mode', 'resolvedAt'];
	validateAllowedFields(policy, new Set(fields), 'research.freshness', errors);
	if (mode === 'installed-version') {
		context.isInstalledVersionPolicy = true;
		context.installedVersion = policy['installedVersion'];
		if (!isNonEmptyString(policy['installedVersion'])) errors.push('research.freshness.installedVersion is required for installed-version');
	}
	if (mode === 'target-version') {
		context.isUpgrade = true;
		context.installedVersion = policy['installedVersion'];
		if (!isNonEmptyString(policy['installedVersion'])) errors.push('research.freshness.installedVersion is required for target-version');
		if (!isNonEmptyString(policy['targetVersion'])) errors.push('research.freshness.targetVersion is required for target-version');
	}
	if (mode === 'current' && !isValidUtcTimestamp(policy['resolvedAt'])) errors.push('research.freshness.resolvedAt must be a valid UTC timestamp');
	return context;
}

function hasMatchingUpgradeReceipt(receipts: unknown[], policy: Record<string, unknown>): boolean {
	return receipts.some((item) => {
		if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
		const receipt = item as Record<string, unknown>;
		return ['release-notes', 'official-documentation'].includes(receipt['sourceType'] as string)
			&& receipt['installedVersion'] === policy['installedVersion']
			&& receipt['targetVersion'] === policy['targetVersion'];
	});
}

function hasMatchingInstalledVersionReceipt(receipts: unknown[], installedVersion: unknown): boolean {
	return receipts.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>)['installedVersion'] === installedVersion);
}

function validateResearchReceiptIdentity(receipt: Record<string, unknown>, index: number, errors: string[]): void {
	const resolvedRef = receipt['resolvedRef'];
	if (resolvedRef !== undefined && (resolvedRef === null || typeof resolvedRef !== 'object' || Array.isArray(resolvedRef))) errors.push(`research.receipts[${index}].resolvedRef must identify a release, tag or commit`);
	if (resolvedRef === undefined || resolvedRef === null || typeof resolvedRef !== 'object' || Array.isArray(resolvedRef)) return;
	const reference = resolvedRef as Record<string, unknown>;
	validateAllowedFields(reference, new Set(['kind', 'value']), `research.receipts[${index}].resolvedRef`, errors);
	if (!['release', 'tag', 'commit'].includes(reference['kind'] as string)) errors.push(`research.receipts[${index}].resolvedRef.kind is invalid`);
	if (!isNonEmptyString(reference['value'])) errors.push(`research.receipts[${index}].resolvedRef.value must be a non-empty string`);
	if (typeof reference['value'] === 'string' && /^(?:main|master|latest|current|head)$/i.test(reference['value'])) errors.push(`research.receipts[${index}].resolvedRef.value must not be a moving reference`);
	if (typeof reference['value'] === 'string' && /^(?:refs\/(?:heads|remotes)\/|(?:heads|remotes)\/|origin\/)/i.test(reference['value'])) errors.push(`research.receipts[${index}].resolvedRef.value must not be a moving reference`);
	if (reference['kind'] === 'commit' && (typeof reference['value'] !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(reference['value']))) errors.push(`research.receipts[${index}].resolvedRef.value must be a complete hexadecimal commit object ID`);
}

function classifyGitHubRoute(hostname: string, segments: string[]): RepositoryRoute | null {
	if (hostname === 'raw.githubusercontent.com' && segments.length >= 3) return { value: segments[2], kinds: embeddedReferenceKinds(segments[2], segments.length > 3, false) };
	if (segments.length === 2) return { kinds: ['tag', 'release', 'commit'] };
	if (segments[2]?.toLowerCase() === 'wiki' && segments.length >= 3) return { kinds: ['tag', 'release', 'commit'] };
	if (segments[2]?.toLowerCase() === 'commit' && segments.length >= 4) return { value: segments[3], kinds: ['commit'] };
	if (segments[2]?.toLowerCase() === 'commits' && segments.length >= 4) return { value: segments[3], kinds: ['commit'] };
	return classifyGitHubArchiveOrReleaseRoute(segments) ?? classifyGitHubContentRoute(segments) ?? { kinds: ['tag', 'release', 'commit'] };
}

function classifyGitHubArchiveOrReleaseRoute(segments: string[]): RepositoryRoute | null {
	const marker = segments[2]?.toLowerCase();
	if (marker === 'archive' && segments[3]?.toLowerCase() === 'refs' && segments[4]?.toLowerCase() === 'heads' && segments.length >= 6) return { kinds: [], moving: true };
	if (marker === 'archive' && segments[3]?.toLowerCase() === 'refs' && segments[4]?.toLowerCase() === 'tags' && segments.length >= 6) return { value: archiveReference(segments[5]), kinds: ['tag', 'release'] };
	if (marker === 'archive' && segments.length >= 4) return { value: archiveReference(segments[3]), kinds: ['commit'] };
	if (marker !== 'releases') return null;
	if (segments[3]?.toLowerCase() === 'download' && segments.length >= 5) return { value: segments[4], kinds: ['tag', 'release'] };
	if (segments[3]?.toLowerCase() === 'latest') return { kinds: [], moving: true };
	if (segments[3]?.toLowerCase() === 'tag' && segments.length >= 5) return { value: segments[4], kinds: ['tag', 'release'] };
	return segments.length >= 3 ? { kinds: ['tag', 'release', 'commit'] } : null;
}

function classifyGitHubContentRoute(segments: string[]): RepositoryRoute | null {
	const marker = segments[2]?.toLowerCase();
	if (marker === 'raw' && segments.length >= 4) return { value: segments[3], kinds: embeddedReferenceKinds(segments[3], segments.length > 4, false) };
	if (marker === 'blob' && segments.length >= 4) return { value: segments[3], kinds: embeddedReferenceKinds(segments[3], segments.length > 4, false) };
	if (marker === 'tree' && segments.length >= 4) return { value: segments[3], kinds: embeddedReferenceKinds(segments[3], segments.length > 4, true) };
	return segments.length >= 2 ? { kinds: ['tag', 'release', 'commit'] } : null;
}

function classifyGitLabRoute(segments: string[]): RepositoryRoute | null {
	const delimiter = segments.indexOf('-');
	if (delimiter >= 0) return classifyGitLabCanonicalRoute(segments, delimiter);
	return classifyGitLabLegacyRoute(segments);
}

function classifyGitLabCanonicalRoute(segments: string[], delimiter: number): RepositoryRoute | null {
	const marker = segments[delimiter + 1]?.toLowerCase();
	const value = segments[delimiter + 2];
	if (marker === 'archive' && value !== undefined) return { value: archiveReference(value), kinds: archiveReferenceKinds(archiveReference(value)) };
	if (marker === 'blob' || marker === 'tree' || marker === 'raw') return { value, kinds: embeddedReferenceKinds(value, segments.length > delimiter + 3, marker === 'tree') };
	if (marker === 'commit' || marker === 'commits') return { value, kinds: ['commit'] };
	if (marker === 'releases' && value?.toLowerCase() === 'permalink' && segments[delimiter + 3]?.toLowerCase() === 'latest') return { kinds: [], moving: true };
	if (marker === 'releases' && value?.toLowerCase() === 'latest') return { kinds: [], moving: true };
	if (marker === 'releases') return { value, kinds: ['tag', 'release'] };
	return segments.length >= 2 ? { kinds: ['tag', 'release', 'commit'] } : null;
}

function classifyGitLabLegacyRoute(segments: string[]): RepositoryRoute | null {
	const markerIndex = segments.findIndex((segment, index) => index >= 2 && ['blob', 'tree', 'raw', 'commit', 'commits', 'releases'].includes(segment.toLowerCase()));
	if (markerIndex < 0) return segments.length >= 2 ? { kinds: ['tag', 'release', 'commit'] } : null;
	const marker = segments[markerIndex]!.toLowerCase();
	const value = segments[markerIndex + 1];
	if (marker === 'blob' || marker === 'tree' || marker === 'raw') return { value, kinds: embeddedReferenceKinds(value, segments.length > markerIndex + 2, marker === 'tree') };
	if (marker === 'commit' || marker === 'commits') return { value, kinds: ['commit'] };
	if (value?.toLowerCase() === 'permalink' && segments[markerIndex + 2]?.toLowerCase() === 'latest') return { kinds: [], moving: true };
	if (value?.toLowerCase() === 'latest') return { kinds: [], moving: true };
	return { value, kinds: ['tag', 'release'] };
}

function embeddedReferenceKinds(value: string | undefined, hasPathAfterReference: boolean, allowTagWithoutPath: boolean): string[] {
	if (hasPathAfterReference || !allowTagWithoutPath) return ['commit'];
	return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? ['commit'] : ['tag', 'release'];
}

function archiveReference(value: string | undefined): string | undefined { return value?.replace(/\.(?:zip|tar\.gz)$/i, ''); }
function archiveReferenceKinds(value: string | undefined): string[] { return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value) ? ['commit'] : ['tag', 'release']; }

function classifyRepositoryRoute(rawUrl: string): RepositoryRoute | null {
	try {
		const url = new URL(rawUrl);
		const hostname = url.hostname.toLowerCase();
		if (!['github.com', 'raw.githubusercontent.com', 'gitlab.com'].includes(hostname)) return null;
		const segments = url.pathname.split('/').filter((segment) => segment.length > 0).map((segment) => decodeURIComponent(segment));
		return hostname === 'gitlab.com' ? classifyGitLabRoute(segments) : classifyGitHubRoute(hostname, segments);
	} catch {
		return { kinds: [], invalid: true };
	}
}

function validateRepositoryRoute(rawUrl: string | undefined, resolvedRef: unknown, index: number, errors: string[]): void {
	if (rawUrl === undefined) return;
	const route = classifyRepositoryRoute(rawUrl);
	if (route?.invalid === true) errors.push(`research.receipts[${index}].url must contain valid encoded path segments`);
	if (route?.moving === true) errors.push(`research.receipts[${index}].url must not use a moving repository reference`);
	if (route !== null && resolvedRef === undefined) errors.push(`research.receipts[${index}].resolvedRef is required for repository sources`);
	if (route === null || route.moving === true || route.value === undefined || resolvedRef === undefined || resolvedRef === null || typeof resolvedRef !== 'object' || Array.isArray(resolvedRef)) return;
	const reference = resolvedRef as Record<string, unknown>;
	if (reference['value'] !== route.value || !route.kinds.includes(reference['kind'] as string)) errors.push(`research.receipts[${index}].resolvedRef must match the repository URL reference`);
}

function validateResearchReceipt(value: unknown, index: number, research: Record<string, unknown>, context: ResearchPolicyContext, errors: string[]): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(`research.receipts[${index}] must be an object`); return; }
	const receipt = value as Record<string, unknown>;
	validateResearchReceiptShape(receipt, index, errors);
	validateResearchReceiptFields(receipt, index, errors);
	validateResearchReceiptIdentity(receipt, index, errors);
	if (receipt['sourceType'] === 'primary-code' && receipt['resolvedRef'] === undefined) errors.push(`research.receipts[${index}].resolvedRef is required for primary-code sources`);
	validateRepositoryRoute(receipt['url'] as string | undefined, receipt['resolvedRef'], index, errors);
	if (Array.isArray(research['sourceClasses']) && !research['sourceClasses'].includes(receipt['sourceType'] as ResearchSourceClass)) errors.push(`research.receipts[${index}].sourceType must be declared in research.sourceClasses`);
	if (context.isInstalledVersionPolicy && receipt['installedVersion'] !== undefined && receipt['installedVersion'] !== context.installedVersion) errors.push(`research.receipts[${index}].installedVersion must match research.freshness.installedVersion`);
	if (receipt['sourceType'] === 'official-documentation' && ((context.isInstalledVersionPolicy && receipt['installedVersion'] !== context.installedVersion) || (context.isUpgrade && receipt['installedVersion'] !== undefined && receipt['installedVersion'] !== context.installedVersion))) errors.push(`research.receipts[${index}].installedVersion must match research.freshness.installedVersion`);
}

function validateResearchReceiptShape(receipt: Record<string, unknown>, index: number, errors: string[]): void {
	validateAllowedFields(receipt, new Set(['url', 'sourceType', 'fetchedAt', 'installedVersion', 'targetVersion', 'resolvedRef', 'contentHash', 'claim', 'applicability']), `research.receipts[${index}]`, errors);
	for (const field of ['url', 'fetchedAt', 'contentHash', 'claim', 'applicability']) if (!isNonEmptyString(receipt[field])) errors.push(`research.receipts[${index}].${field} must be a non-empty string`);
	if (typeof receipt['url'] === 'string' && receipt['url'].length > SPEC_V2_LIMITS.researchUrl) errors.push(`research.receipts[${index}].url exceeds ${SPEC_V2_LIMITS.researchUrl} characters`);
	for (const [field, limit] of [['contentHash', SPEC_V2_LIMITS.researchHash], ['claim', SPEC_V2_LIMITS.researchClaim], ['applicability', SPEC_V2_LIMITS.researchApplicability]] as const) if (typeof receipt[field] === 'string' && receipt[field].length > limit) errors.push(`research.receipts[${index}].${field} exceeds ${limit} characters`);
}

function validateResearchReceiptFields(receipt: Record<string, unknown>, index: number, errors: string[]): void {
	if (typeof receipt['url'] === 'string') {
		try { if (!['http:', 'https:'].includes(new URL(receipt['url']).protocol)) errors.push(`research.receipts[${index}].url must use http or https`); }
		catch { errors.push(`research.receipts[${index}].url must be a valid URL`); }
	}
	if (!isValidUtcTimestamp(receipt['fetchedAt'])) errors.push(`research.receipts[${index}].fetchedAt must be a valid UTC timestamp`);
	if (typeof receipt['contentHash'] !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(receipt['contentHash'])) errors.push(`research.receipts[${index}].contentHash must be a sha256 hash`);
	if (!RESEARCH_SOURCE_CLASSES.includes(receipt['sourceType'] as ResearchSourceClass)) errors.push(`research.receipts[${index}].sourceType is invalid`);
	for (const field of ['installedVersion', 'targetVersion']) if (receipt[field] !== undefined && !isNonEmptyString(receipt[field])) errors.push(`research.receipts[${index}].${field} must be a non-empty string`);
}

function validateResearch(value: unknown, errors: string[]): void {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push('research must be an object'); return; }
	const research = value as Record<string, unknown>;
	validateAllowedFields(research, new Set(['questions', 'sourceClasses', 'freshness', 'receipts']), 'research', errors);
	validateStringList(research['questions'], 'research.questions', SPEC_V2_LIMITS.maxResearchQuestions, SPEC_V2_LIMITS.researchQuestion, errors);
	validateResearchSourceClasses(research['sourceClasses'], errors);
	const context = validateResearchFreshness(research['freshness'], errors);
	const receipts = research['receipts'];
	if (receipts === undefined) { errors.push('research.receipts must be a non-empty list when research is present'); return; }
	if (!Array.isArray(receipts)) { errors.push('research.receipts must be a list'); return; }
	if (receipts.length === 0) { errors.push('research.receipts must be a non-empty list when research is present'); return; }
	if (context.isInstalledVersionPolicy && !hasMatchingInstalledVersionReceipt(receipts, context.installedVersion)) errors.push('installed-version research requires a receipt with matching installedVersion');
	if (context.isUpgrade && typeof research['freshness'] === 'object' && research['freshness'] !== null && !Array.isArray(research['freshness']) && !hasMatchingUpgradeReceipt(receipts, research['freshness'] as Record<string, unknown>)) errors.push('target-version research requires a release-notes or official-documentation receipt with matching versions');
	if (receipts.length > SPEC_V2_LIMITS.maxResearchReceipts) { errors.push(`research.receipts accepts at most ${SPEC_V2_LIMITS.maxResearchReceipts} items`); return; }
	for (const [index, receipt] of receipts.entries()) validateResearchReceipt(receipt, index, research, context, errors);
}

function validateOptionalStringList(value: unknown, label: string, maxItems: number, maxLength: number, errors: string[]): void {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		errors.push(`${label} must be a list`);
		return;
	}
	if (value.length === 0) return;
	validateStringList(value, label, maxItems, maxLength, errors);
}

function validateV2Spec(candidate: Record<string, unknown>, errors: string[]): void {
	validateAllowedFields(candidate, new Set(['version', 'objective', 'acceptance', 'boundaries', 'verify', 'evidence', 'research']), 'v2', errors);
	if (!isNonEmptyString(candidate['objective'])) errors.push('objective must be a non-empty string');
	else if (candidate['objective'].trim().length > SPEC_V2_LIMITS.objective) errors.push(`objective exceeds ${SPEC_V2_LIMITS.objective} characters`);
	validateStringList(candidate['acceptance'], 'acceptance', SPEC_V2_LIMITS.maxAcceptance, SPEC_V2_LIMITS.acceptance, errors);
	validateOptionalStringList(candidate['boundaries'], 'boundaries', SPEC_V2_LIMITS.maxBoundaries, SPEC_V2_LIMITS.boundary, errors);
	validateStringList(candidate['verify'], 'verify', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, errors);
	validateEvidence(candidate['evidence'], errors);
	if (candidate['research'] !== undefined) validateResearch(candidate['research'], errors);
}

function validateLegacySpec(candidate: Record<string, unknown>, errors: string[]): void {
	validateAllowedFields(candidate, new Set(['scope', 'verify', 'evidence']), 'legacy', errors);
	if (!isNonEmptyString(candidate['scope'])) errors.push('scope must be a non-empty string');
	if (!isNonEmptyStringArray(candidate['verify'])) errors.push('spec requires non-empty verify commands');
	validateEvidence(candidate['evidence'], errors);
}

/** Accept the direct contract. */
export function validateSpec(value: unknown): ValidationResult {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { ok: false, errors: ['spec must be a non-null object'] };
	}
	const candidate = value as Record<string, unknown>;
	const errors: string[] = [];
	if (candidate['version'] !== undefined && candidate['version'] !== 2) {
		errors.push('version must be 2');
		return { ok: false, errors };
	}
	if (candidate['version'] === 2) {
		validateV2Spec(candidate, errors);
		return { ok: errors.length === 0, errors };
	}
	validateLegacySpec(candidate, errors);
	return { ok: errors.length === 0, errors };
}

/** Validate current-research freshness against the clocks observed at run admission. */
export function validateCurrentResearchAtRunStart(spec: Spec | undefined, runStartedAt: string, observedAt: string): ValidationResult {
	if (spec === undefined || !('version' in spec) || spec.version !== 2 || spec.research?.freshness.mode !== 'current') return { ok: true, errors: [] };
	if (!isValidUtcTimestamp(runStartedAt) || !isValidUtcTimestamp(observedAt)) return { ok: false, errors: ['run admission clock must be valid UTC timestamps'] };
	const resolvedAt = Date.parse(spec.research.freshness.resolvedAt);
	if (resolvedAt > Date.parse(observedAt)) return { ok: false, errors: ['research.freshness.resolvedAt is after the observed run clock'] };
	for (const [index, receipt] of (spec.research.receipts ?? []).entries()) {
		if (Date.parse(receipt.fetchedAt) > Date.parse(observedAt)) return { ok: false, errors: [`research.receipts[${index}].fetchedAt is after the observed run clock`] };
	}
	return { ok: true, errors: [] };
}

/** Pure plannability check. */
export function hasVerification(spec: Spec | undefined): boolean {
	return isNonEmptyStringArray(spec?.verify);
}

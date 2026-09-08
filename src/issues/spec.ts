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
} as const;

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
	validateAllowedFields(candidate, new Set(['version', 'objective', 'acceptance', 'boundaries', 'verify', 'evidence']), 'v2', errors);
	if (!isNonEmptyString(candidate['objective'])) errors.push('objective must be a non-empty string');
	else if (candidate['objective'].trim().length > SPEC_V2_LIMITS.objective) errors.push(`objective exceeds ${SPEC_V2_LIMITS.objective} characters`);
	validateStringList(candidate['acceptance'], 'acceptance', SPEC_V2_LIMITS.maxAcceptance, SPEC_V2_LIMITS.acceptance, errors);
	validateOptionalStringList(candidate['boundaries'], 'boundaries', SPEC_V2_LIMITS.maxBoundaries, SPEC_V2_LIMITS.boundary, errors);
	validateStringList(candidate['verify'], 'verify', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, errors);
	validateEvidence(candidate['evidence'], errors);
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

/** Pure plannability check. */
export function hasVerification(spec: Spec | undefined): boolean {
	return isNonEmptyStringArray(spec?.verify);
}

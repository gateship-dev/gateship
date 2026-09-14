export type CycleDiagnosticKind =
	| 'correction'
	| 'human-decision'
	| 'insufficient-evidence'
	| 'technical-failure';

export interface CycleObservationReference {
	id: string;
	runId: string;
	attempt: number;
	verifiedVersion: string;
	result: string;
	tool?: string;
	action?: string;
	toolUseId?: string;
	exitCode?: number;
	isError?: boolean;
}

export interface CycleDiagnostic {
	kind: CycleDiagnosticKind;
	hypothesis?: string;
	action?: string;
	expectedObservation?: string;
	question?: string;
	failure?: string;
	missing?: string;
	evidence: CycleObservationReference[];
}

const KINDS: readonly CycleDiagnosticKind[] = [
	'correction', 'human-decision', 'insufficient-evidence', 'technical-failure',
];

function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function recordOf(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}

function validObservation(value: unknown): value is CycleObservationReference {
	const record = recordOf(value);
	return record !== null
		&& text(record['id']).length > 0
		&& text(record['runId']).length > 0
		&& typeof record['attempt'] === 'number' && Number.isSafeInteger(record['attempt']) && record['attempt'] > 0
		&& text(record['verifiedVersion']).length > 0
		&& text(record['result']).length > 0
		&& (record['tool'] === undefined || (text(record['tool']).length > 0 && text(record['action']).length > 0))
		&& (record['toolUseId'] === undefined || text(record['toolUseId']).length > 0)
		&& (record['exitCode'] === undefined || (typeof record['exitCode'] === 'number' && Number.isSafeInteger(record['exitCode'])))
		&& (record['isError'] === undefined || typeof record['isError'] === 'boolean');
}

function validObservationSet(
	value: unknown,
	available: readonly CycleObservationReference[],
): CycleObservationReference[] | null {
	if (!Array.isArray(value)) return null;
	const byId = new Map(available.map((observation) => [observation.id, observation]));
	const result: CycleObservationReference[] = [];
	for (const item of value) {
		const raw = recordOf(item);
		// Strict provider schemas require optional fields to be present as null.
		const reference = raw === null ? null : Object.fromEntries(Object.entries(raw)
			.filter(([key, value]) => value !== null || !['tool', 'action', 'toolUseId', 'exitCode', 'isError'].includes(key)));
		const observed = reference === null ? undefined : byId.get(text(reference['id']));
		if (observed === undefined || !validObservation(reference)
			|| reference['runId'] !== observed.runId
			|| reference['attempt'] !== observed.attempt
			|| reference['verifiedVersion'] !== observed.verifiedVersion
			|| reference['result'] !== observed.result) return null;
		if (reference['tool'] !== observed.tool || reference['action'] !== observed.action
			|| reference['toolUseId'] !== observed.toolUseId
			|| reference['exitCode'] !== observed.exitCode || reference['isError'] !== observed.isError) return null;
		if (!result.some((candidate) => candidate.id === observed.id)) result.push(observed);
	}
	return result;
}

export function insufficientEvidence(
	missing: string,
	evidence: readonly CycleObservationReference[] = [],
): CycleDiagnostic {
	return { kind: 'insufficient-evidence', missing: text(missing) || 'No valid tool observation was recorded.', evidence: [...evidence] };
}

/** Validate model-provided diagnosis without treating prose as an observation. */
export function normalizeCycleDiagnostic(
	value: unknown,
	available: readonly CycleObservationReference[],
): CycleDiagnostic {
	const record = recordOf(value);
	const kind = record?.['kind'];
	const evidence = validObservationSet(record?.['evidence'], available);
	if (record === null || typeof kind !== 'string' || !KINDS.includes(kind as CycleDiagnosticKind) || evidence === null) {
		return insufficientEvidence('A diagnosis did not cite valid recorded observations.');
	}
	const diagnostic: CycleDiagnostic = { kind: kind as CycleDiagnosticKind, evidence };
	if (diagnostic.kind === 'correction') {
		const hypothesis = text(record['hypothesis']);
		const action = text(record['action']);
		const expectedObservation = text(record['expectedObservation']);
		if (!hypothesis || !action || !expectedObservation) return insufficientEvidence('Correction requires hypothesis, action and expected observation.', evidence);
		return { ...diagnostic, hypothesis, action, expectedObservation };
	}
	if (diagnostic.kind === 'human-decision') return { ...diagnostic, question: text(record['question']) || 'A human decision is required.' };
	if (diagnostic.kind === 'technical-failure') return { ...diagnostic, failure: text(record['failure']) || 'A technical failure prevented progress.' };
	return { ...diagnostic, missing: text(record['missing']) || 'The recorded observations do not establish progress.' };
}

export function cycleObservation(
	runId: string,
	attempt: number,
	verifiedVersion: string | null,
	seq: number,
	result: string,
	details: { tool?: string; action?: string; toolUseId?: string; exitCode?: number; isError?: boolean } = {},
): CycleObservationReference | null {
	const version = text(verifiedVersion);
	const outcome = text(result);
	if (!runId || !Number.isSafeInteger(attempt) || attempt < 1 || !version || !outcome) return null;
	return { id: 'run-observation-' + seq, runId, attempt, verifiedVersion: version, result: outcome, ...details };
}

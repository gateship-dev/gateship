import { EXECUTOR_HANDOFF_EVENT } from './agent-executor-router.ts';
import { REVIEW_FALLBACK_EVENT } from './agent-reviewer-router.ts';
import type { AgentProviderId } from './agent-session.ts';
import { isTerminalRunState } from './run-state.ts';
import type { RunState } from './run-state.ts';
import type { RunCostRole, RunEvent, RunRecord } from './run-store.ts';
import type { SpecProfile } from '../issues/spec.ts';

export type RunEvaluationOutcome = 'shipped' | 'failed' | 'cancelled' | 'incomplete';

export const RUN_DURATION_PHASES = [
	'queued', 'working', 'verify', 'review', 'full-verify', 'shipping',
	'waiting-provider', 'waiting-user',
] as const;
export type RunDurationPhase = (typeof RUN_DURATION_PHASES)[number];
export interface RunPhaseDuration { durationMs: number | null; entries: number }
export interface RunDurationReconciliation {
	classifiedMs: number | null;
	unassignedMs: number | null;
	totalMs: number | null;
	toleranceMs: number;
	reconciles: boolean | null;
}

export interface RunRoleConfiguration {
	role: RunCostRole;
	models: string[];
	efforts: string[];
	/**
	 * The providers this role was actually invoked on (GSHIP-709), the same
	 * reading `models` and `efforts` already have: what ran, not what it
	 * produced. The run's own provider ran every invocation it configured, and
	 * a review fallback adds the alternative it invoked beside -- never
	 * instead of -- the origin it started from. Whether that attempt reached a
	 * verdict is the fallback event's own `outcome`, not a provider's absence.
	 */
	providers: AgentProviderId[];
}

/**
 * Replayable facts for one run. Every field is derived from the run and its
 * complete durable decision log; no evaluator model or stored score exists.
 */
export interface RunEvaluation {
	specProfile: SpecProfile;
	corrections: { verification: number; review: number; fullVerify: number; ci: number; total: number };
	cycleQuestions: { executor: number; review: number; fullVerify: number; total: number };
	reconciliations: { unchanged: number; adapted: number; 'contract-change-required': number; total: number };
	workflowRevision: string | null;
	provider: AgentProviderId;
	outcome: RunEvaluationOutcome;
	wallTimeMs: number | null;
	phaseDurations: Record<RunDurationPhase, RunPhaseDuration>;
	unassignedDuration: RunPhaseDuration;
	durationReconciliation: RunDurationReconciliation;
	attentionRequests: number;
	operatorInterventions: number;
	providerHolds: number;
	resolvedCycleQuestions?: number;
	roles: RunRoleConfiguration[];
	/** The observed split between focused checks and the project full verify. */
	verificationCadence?: {
		focused: { executed: number; skipped: number };
		full: { executed: number; skipped: number };
	};
}

const MODEL_EVENT_ROLES: Readonly<Record<string, RunCostRole>> = {
	'provider.model': 'executor',
	'review.model': 'reviewer',
	'run.cycle-response': 'orchestrator',
};

function providerOf(value: unknown): AgentProviderId | null {
	return value === 'claude' || value === 'codex' ? value : null;
}

function normalizedText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : null;
}

function outcomeOf(run: RunRecord): RunEvaluationOutcome {
	if (run.state === 'done') return 'shipped';
	if (run.state === 'failed') return 'failed';
	if (run.state === 'cancelled') return 'cancelled';
	return 'incomplete';
}

function wallTimeOf(run: RunRecord): number | null {
	if (!isTerminalRunState(run.state)) return null;
	const createdAt = Date.parse(run.createdAt);
	const updatedAt = Date.parse(run.updatedAt);
	if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt) || updatedAt < createdAt) return null;
	return updatedAt - createdAt;
}

interface DurationBreakdownAccumulator {
	phaseDurations: Record<RunDurationPhase, RunPhaseDuration>;
	unassignedDuration: RunPhaseDuration;
	unknownTargets: Set<RunPhaseDuration>;
	classifiedMs: number;
	unassignedMs: number;
	hasUnknownInterval: boolean;
}

function durableDurationEvents(events: readonly RunEvent[]): RunEvent[] {
	return events
		.filter((event) => event.kind === 'run.created' || event.fromState !== event.toState)
		.slice().sort((a, b) => a.seq - b.seq);
}

function durationTarget(
	state: RunState | null,
	phaseDurations: Record<RunDurationPhase, RunPhaseDuration>,
	unassignedDuration: RunPhaseDuration,
): RunPhaseDuration {
	return state !== null && RUN_DURATION_PHASES.includes(state as RunDurationPhase)
		? phaseDurations[state as RunDurationPhase]
		: unassignedDuration;
}

function markUnknownDuration(accumulator: DurationBreakdownAccumulator, target: RunPhaseDuration): void {
	accumulator.hasUnknownInterval = true;
	target.durationMs = null;
	accumulator.unknownTargets.add(target);
}

function addKnownDuration(
	accumulator: DurationBreakdownAccumulator,
	target: RunPhaseDuration,
	amount: number,
): void {
	if (accumulator.unknownTargets.has(target)) return;
	target.durationMs = (target.durationMs ?? 0) + amount;
	if (target === accumulator.unassignedDuration) accumulator.unassignedMs += amount;
	else accumulator.classifiedMs += amount;
}

function addDurationEntry(
	state: RunState | null,
	next: RunState,
	phaseDurations: Record<RunDurationPhase, RunPhaseDuration>,
	unassignedDuration: RunPhaseDuration,
): void {
	if (RUN_DURATION_PHASES.includes(next as RunDurationPhase)) {
		const phase = phaseDurations[next as RunDurationPhase];
		if (state !== next || phase.entries === 0) phase.entries += 1;
	} else if (state !== next || unassignedDuration.entries === 0) unassignedDuration.entries += 1;
}

function durationInterval(
	previousAt: number,
	eventAt: number,
	runEndAt: number,
	terminalWallTime: number | null,
): number | null {
	const afterTerminal = terminalWallTime !== null && (eventAt > runEndAt || previousAt > runEndAt);
	if (afterTerminal || !Number.isFinite(previousAt) || !Number.isFinite(eventAt) || eventAt < previousAt) return null;
	return eventAt - previousAt;
}

function missingInitialAnchor(state: RunState | null, event: RunEvent, eventAt: number, previousAt: number): boolean {
	return state === null && !(event.kind === 'run.created' && event.fromState === null && eventAt === previousAt);
}

function processDurationEvent(
	accumulator: DurationBreakdownAccumulator,
	event: RunEvent,
	state: RunState | null,
	previousAt: number,
	runEndAt: number,
	terminalWallTime: number | null,
): { state: RunState; previousAt: number } {
	const at = Date.parse(event.createdAt);
	const target = durationTarget(state, accumulator.phaseDurations, accumulator.unassignedDuration);
	const amount = durationInterval(previousAt, at, runEndAt, terminalWallTime);
	const incomplete = missingInitialAnchor(state, event, at, previousAt)
		|| (state !== null && event.fromState !== state)
		|| amount === null;
	if (incomplete) markUnknownDuration(accumulator, target);
	else addKnownDuration(accumulator, target, amount);
	if (event.toState !== state) addDurationEntry(state, event.toState, accumulator.phaseDurations, accumulator.unassignedDuration);
	return { state: event.toState, previousAt: at };
}

function durationBreakdown(run: RunRecord, events: readonly RunEvent[]): {
	phaseDurations: Record<RunDurationPhase, RunPhaseDuration>;
	unassignedDuration: RunPhaseDuration;
	durationReconciliation: RunDurationReconciliation;
} {
	const phases = Object.fromEntries(RUN_DURATION_PHASES.map((phase) => [phase, { durationMs: 0, entries: 0 }])) as Record<RunDurationPhase, RunPhaseDuration>;
	const unassignedDuration: RunPhaseDuration = { durationMs: 0, entries: 0 };
	const terminalWallTime = wallTimeOf(run);
	const accumulator: DurationBreakdownAccumulator = {
		phaseDurations: phases, unassignedDuration, unknownTargets: new Set(), classifiedMs: 0, unassignedMs: 0, hasUnknownInterval: false,
	};
	const parsedEvents = durableDurationEvents(events);
	let previousAt = Date.parse(run.createdAt);
	let state: RunState | null = null;
	const runEndAt = Date.parse(run.updatedAt);
	if (!Number.isFinite(previousAt)) accumulator.hasUnknownInterval = true;
	for (const event of parsedEvents) {
		({ state, previousAt } = processDurationEvent(accumulator, event, state, previousAt, runEndAt, terminalWallTime));
	}
	const endAt = runEndAt;
	const finalAmount = Number.isFinite(previousAt) && Number.isFinite(endAt) && endAt >= previousAt ? endAt - previousAt : null;
	const finalTarget = durationTarget(state, phases, unassignedDuration);
	if (finalAmount === null) markUnknownDuration(accumulator, finalTarget);
	else addKnownDuration(accumulator, finalTarget, finalAmount);
	const unknown = terminalWallTime === null || accumulator.hasUnknownInterval;
	return {
		phaseDurations: phases,
		unassignedDuration,
		durationReconciliation: {
			classifiedMs: unknown ? null : accumulator.classifiedMs,
			unassignedMs: unknown ? null : accumulator.unassignedMs,
			totalMs: terminalWallTime,
			toleranceMs: 1000,
			reconciles: unknown || terminalWallTime === null ? null : Math.abs(accumulator.classifiedMs + accumulator.unassignedMs - terminalWallTime) <= 1000,
		},
	};
}

function workflowRevisionOf(events: readonly RunEvent[]): string | null {
	const created = events.find((event) => event.kind === 'run.created');
	return normalizedText(created?.payload['workflowRevision']);
}

function specProfileOf(events: readonly RunEvent[]): SpecProfile {
	const created = events.find((event) => event.kind === 'run.created');
	const profile = created?.payload['specProfile'];
	if (profile !== null && typeof profile === 'object' && !Array.isArray(profile)) {
		const candidate = profile as Record<string, unknown>;
		const counts = candidate['counts'];
		if ((candidate['version'] === 'legacy' || candidate['version'] === 'v2' || candidate['version'] === 'unknown')
			&& (typeof candidate['fingerprint'] === 'string' || candidate['fingerprint'] === null)
			&& counts !== null && typeof counts === 'object' && !Array.isArray(counts)) {
			const values = counts as Record<string, unknown>;
			const count = (key: string): number | null => typeof values[key] === 'number' ? values[key] as number : null;
			return { version: candidate['version'], fingerprint: candidate['fingerprint'], counts: {
				acceptance: count('acceptance'), boundaries: count('boundaries'), verify: count('verify'), evidence: count('evidence'),
			} } as SpecProfile;
		}
	}
	return { version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null } };
}

function countByOrigin(events: readonly RunEvent[], kind: string, field: string): Record<string, number> {
	const result: Record<string, number> = {};
	for (const event of events) {
		if (event.kind !== kind) continue;
		const origin = event.payload[field];
		if (typeof origin === 'string') result[origin] = (result[origin] ?? 0) + 1;
	}
	return result;
}

interface RoleConfigurationAccumulator {
	models: Set<string>;
	efforts: Set<string>;
	providers: Set<AgentProviderId>;
}

/**
 * Both providers one review fallback or executor handoff names (GSHIP-709,
 * GSHIP-722). Either event is written only once the alternative actually
 * settled, so the target counts as invoked even when it refused: its own
 * spawn already reported the model and effort it ran with, and dropping the
 * provider alone would leave the role showing a model no listed provider ever
 * ran.
 */
function foldProviderPair(
	entry: RoleConfigurationAccumulator,
	payload: Record<string, unknown>,
): void {
	const from = providerOf(payload['from']);
	const to = providerOf(payload['to']);
	if (from !== null) entry.providers.add(from);
	if (to !== null) entry.providers.add(to);
}

/**
 * The models, efforts and providers each role was actually invoked with. The
 * model events carry the first two; the provider comes from the run, which is
 * the one that spawned them, plus the review fallback's own durable record --
 * the only place a role runs on a provider the run did not select.
 */
function roleConfigurations(run: RunRecord, events: readonly RunEvent[]): RunRoleConfiguration[] {
	const configurations = new Map<RunCostRole, RoleConfigurationAccumulator>();
	const entryFor = (role: RunCostRole): RoleConfigurationAccumulator => {
		const entry = configurations.get(role)
			?? { models: new Set<string>(), efforts: new Set<string>(), providers: new Set<AgentProviderId>() };
		configurations.set(role, entry);
		return entry;
	};
	for (const event of events) {
		if (event.kind === REVIEW_FALLBACK_EVENT) {
			foldProviderPair(entryFor('reviewer'), event.payload);
			continue;
		}
		if (event.kind === EXECUTOR_HANDOFF_EVENT) {
			foldProviderPair(entryFor('executor'), event.payload);
			continue;
		}
		const role = MODEL_EVENT_ROLES[event.kind];
		if (role === undefined) continue;
		const entry = entryFor(role);
		const model = normalizedText(event.payload['model']);
		const effort = normalizedText(event.payload['effort']);
		if (model !== null) entry.models.add(model);
		if (effort !== null) entry.efforts.add(effort);
		entry.providers.add(providerOf(event.payload['provider']) ?? run.providerId);
	}
	return [...configurations.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([role, configuration]) => ({
			role,
			models: [...configuration.models].sort(),
			efforts: [...configuration.efforts].sort(),
			providers: [...configuration.providers].sort(),
		}));
}

export function evaluateRun(run: RunRecord, events: readonly RunEvent[]): RunEvaluation {
	const duration = durationBreakdown(run, events);
	const corrections = {
		verification: events.filter((event) => event.kind === 'run.verification-fix-requested').length,
		review: events.filter((event) => event.kind === 'run.review-fix-requested').length,
		fullVerify: events.filter((event) => event.kind === 'run.full-verify-fix-requested').length,
		ci: events.filter((event) => event.kind === 'run.ci-fix-requested').length,
	};
	const cycleQuestionOrigins = countByOrigin(events, 'run.cycle-question', 'origin');
	const cycleQuestions = {
		executor: cycleQuestionOrigins['executor'] ?? 0,
		review: cycleQuestionOrigins['review'] ?? 0,
		fullVerify: cycleQuestionOrigins['full-verify'] ?? 0,
	};
	const reconciliations = {
		unchanged: events.filter((event) => event.kind === 'run.chain-reconciliation' && event.payload['outcome'] === 'unchanged').length,
		adapted: events.filter((event) => event.kind === 'run.chain-reconciliation' && event.payload['outcome'] === 'clarified').length,
		'contract-change-required': events.filter((event) => event.kind === 'run.chain-reconciliation' && event.payload['outcome'] === 'material').length,
	};
	const focusedExecuted = events.filter((event) => event.kind === 'verify.started').length;
	const focusedSkipped = events.filter((event) => event.kind === 'verify.skipped').length;
	const fullExecuted = events.filter((event) => event.kind === 'full-verify.command.started' && event.payload['commandIndex'] === 1).length;
	const fullSkipped = events.filter((event) => event.kind === 'full-verify.skipped').length;
	const verificationCadence = focusedExecuted + focusedSkipped + fullExecuted + fullSkipped > 0
		? { focused: { executed: focusedExecuted, skipped: focusedSkipped }, full: { executed: fullExecuted, skipped: fullSkipped } }
		: undefined;
	return {
		specProfile: specProfileOf(events),
		corrections: { ...corrections, total: Object.values(corrections).reduce((sum, count) => sum + count, 0) },
		cycleQuestions: { ...cycleQuestions, total: Object.values(cycleQuestions).reduce((sum, count) => sum + count, 0) },
		reconciliations: { ...reconciliations, total: Object.values(reconciliations).reduce((sum, count) => sum + count, 0) },
		workflowRevision: workflowRevisionOf(events),
		provider: run.providerId,
		outcome: outcomeOf(run),
		wallTimeMs: wallTimeOf(run),
		...duration,
		attentionRequests: events.filter((event) =>
			event.toState === 'waiting-user' && event.fromState !== 'waiting-user').length,
		operatorInterventions: events.filter((event) => event.kind === 'run.operator-guidance').length,
		providerHolds: events.filter((event) => event.kind === 'run.provider-waiting').length,
		resolvedCycleQuestions: events.filter((event) => event.kind === 'run.cycle-response').length,
		roles: roleConfigurations(run, events),
		...(verificationCadence === undefined ? {} : { verificationCadence }),
	};
}

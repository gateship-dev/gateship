import { EXECUTOR_HANDOFF_EVENT } from './agent-executor-router.ts';
import { REVIEW_FALLBACK_EVENT } from './agent-reviewer-router.ts';
import type { AgentProviderId } from './agent-session.ts';
import { recoveryConvergenceDiagnosis, type RecoveryConvergenceDiagnosis } from './recovery-convergence.ts';
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

export type RunGuidanceChannel = 'web' | 'agent-cli' | 'other' | 'unknown';
export type AuthorizationEvidence = 'observed' | 'absent' | 'unknown';

/**
 * Versions the dispatch-counting methodology (GSHIP-890). `'cli-process-v1'`
 * counts only the CLI process invocation itself -- one `provider.model` /
 * `review.model` spawn, one `run.cycle-response` the orchestrator's own
 * resolver answered, or one `run.cycle-response-invalid` (the same resolver
 * call, confirmed even though its response failed validation). It never
 * counts, and is not a zero for: internal LLM calls or subagents a CLI
 * process makes on its own (not observed by this run's event log at all, so
 * not measurable here), or usage from any chat or agent session outside this
 * run (out of scope by construction, since only this run's own events are
 * read). A future methodology that changes what counts as a dispatch gets its
 * own version string, so a report reading multiple runs can tell which rule
 * produced which count.
 */
export const DISPATCH_METHODOLOGY_VERSION = 'cli-process-v1' as const;
export type DispatchMethodologyVersion = typeof DISPATCH_METHODOLOGY_VERSION;

export interface RunDispatches {
	total: number;
	executor: number;
	reviewer: number;
	orchestrator: number;
	/**
	 * `run.cycle-response` events with no responder recorded, or an
	 * unrecognized one (GSHIP-890): a legacy event with no verifiable evidence
	 * of whether the resolver ran. Never folded into `total` -- that would
	 * either invent an invocation that may not have happened or silently drop
	 * one that did -- and never reclassified as autonomous or as a human/
	 * agent-cli answer by guessing.
	 */
	unknown: number;
}

export interface RunGuidanceEvidence {
	channels: Record<RunGuidanceChannel, number>;
	authorization: Record<AuthorizationEvidence, number>;
}

/**
 * Replayable facts for one run. Every field is derived from the run and its
 * complete durable decision log; no evaluator model or stored score exists.
 */
export interface RunEvaluation {
	specProfile: SpecProfile;
	corrections: { verification: number; review: number; fullVerify: number; ci: number; total: number };
	dispatches?: RunDispatches;
	/**
	 * Which counting rule produced `dispatches` (GSHIP-890) -- see
	 * `DISPATCH_METHODOLOGY_VERSION`. Always the current version: this run is
	 * replayed by today's `evaluateRun`, not read back pre-computed, so there is
	 * no older methodology it could carry forward. A report comparing runs
	 * across a methodology change reads this to know which rule produced which
	 * count, rather than assuming every run in the sample was measured the
	 * same way.
	 */
	dispatchMethodologyVersion: DispatchMethodologyVersion;
	recovery?: {
		policy: { version: 1; maxRecoveryDispatches: number } | null;
		reserved: number;
		finished: number;
		/**
		 * Whether this run actually stopped at `run.recovery-limit` (GSHIP-874): a
		 * spent budget alone (`reserved` reaching `policy.maxRecoveryDispatches`)
		 * is not the same claim -- a run that is still open, or one that shipped
		 * with an exactly-spent budget and no further dispatch cause, never
		 * reached this stop.
		 */
		limitReached: boolean;
		/**
		 * The same convergence diagnosis `run.recovery-limit` itself reported,
		 * replayed identically from the durable log (GSHIP-874) -- so a report
		 * over historical runs can tell an unproductive loop apart from a run
		 * that was still uncovering fresh findings when its budget ran out,
		 * without re-deriving that judgment from raw events. `null` whenever
		 * `limitReached` is `false`: there is no cutoff to ask whether the run
		 * was still converging before.
		 */
		convergence: RecoveryConvergenceDiagnosis | null;
	};
	guidance?: RunGuidanceEvidence;
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
	/**
	 * `run.operator-guidance` events, excluding only an agent-cli/MCP answer
	 * with observed authorization evidence (GSHIP-890): that one combination is
	 * a technical response the operator explicitly authorized, not text or
	 * intervention the human produced directly, even though it still required
	 * the operator to call `resumeRun`. An agent-cli answer with authorization
	 * `'absent'` or `'unknown'` (including legacy events with no evidence at
	 * all) still counts -- legacy with no evidence stays unknown, never
	 * reclassified as autonomous by assuming every agent-cli answer was
	 * authorized. `guidance.channels` and `guidance.authorization` are the
	 * distinct, complete breakdown this reads from.
	 */
	operatorInterventions: number;
	providerHolds: number;
	/**
	 * `run.cycle-response` events the orchestrator's own resolver answered
	 * `continue` (GSHIP-890): never a human/agent-cli-authorized answer to a
	 * pending question (`responder` other than `'orchestrator'`, no resolver
	 * call made at all) and never an escalation (`outcome: 'operator'`) --
	 * escalating to a human decision is not an internal resolution. A `continue`
	 * here is the resolver's own claim, not proof the follow-up correction was
	 * ever effective; `corrections` and `dispatches.executor` are the distinct
	 * measures for that.
	 */
	resolvedCycleQuestions?: number;
	roles: RunRoleConfiguration[];
	/** The observed split between focused checks and the project full verify. */
	verificationCadence?: {
		focused: { executed: number; skipped: number };
		full: { executed: number; skipped: number };
	};
	verificationRetries?: {
		attempts: number;
		failures: number;
		durationMs: number | null;
		usage: readonly Record<string, unknown>[] | null;
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

function guidanceChannel(event: RunEvent): RunGuidanceChannel {
	const source = event.payload['source'];
	if (source === 'web') return 'web';
	if (source === 'agent-cli') return 'agent-cli';
	if (typeof source === 'string' && source.trim().length > 0) return 'other';
	return 'unknown';
}

function authorizationEvidence(event: RunEvent): AuthorizationEvidence {
	const value = event.payload['authorizationEvidence'];
	if (value === 'explicit' || event.payload['operatorAuthorized'] === true) return 'observed';
	if (value === 'absent' || event.payload['operatorAuthorized'] === false) return 'absent';
	return 'unknown';
}

function guidanceEvidence(events: readonly RunEvent[]): RunGuidanceEvidence {
	const channels: RunGuidanceEvidence['channels'] = { web: 0, 'agent-cli': 0, other: 0, unknown: 0 };
	const authorization: RunGuidanceEvidence['authorization'] = { observed: 0, absent: 0, unknown: 0 };
	for (const event of events) {
		if (event.kind !== 'run.operator-guidance') continue;
		channels[guidanceChannel(event)] += 1;
		authorization[authorizationEvidence(event)] += 1;
	}
	return { channels, authorization };
}

/**
 * Whether a `run.cycle-response` event actually invoked the resolver, never
 * called it, or leaves that undecidable (GSHIP-890). `orchestrator` is a
 * confirmed CLI-process invocation. `guidance` is `#applyOperatorCycleGuidance`
 * (run-runtime.ts) answering a pending question directly, human or agent-cli
 * -- it never calls the resolver, the same distinction `payloadCarriesUsage`
 * already draws for cost (run-store.ts, GSHIP-889). `unknown` is a legacy
 * event with no responder recorded at all: not zero, not guessed either way.
 * `run.cycle-response-invalid` (`#answerCycleQuestion`, run-runtime.ts) is not
 * covered here -- it is never a `run.cycle-response`, always a confirmed
 * invocation on its own, folded directly in `dispatchesOf`.
 */
function cycleResponseInvocation(event: RunEvent): 'orchestrator' | 'guidance' | 'unknown' {
	const { responder } = event.payload;
	if (responder === 'orchestrator') return 'orchestrator';
	if (responder === 'operator' || responder === 'agent-cli') return 'guidance';
	return 'unknown';
}

/**
 * Whether `event` is shaped like a dispatch at all -- a `provider.model` /
 * `review.model` / `run.cycle-response` spawn or a `run.cycle-response-invalid`
 * -- before `dispatchesOf` disambiguates which of those are a confirmed
 * CLI-process invocation (GSHIP-891). Reused by `reevaluateHistoricalSample`
 * (run-store.ts) as the raw, undisambiguated count a historical sample's
 * `dispatches.total + dispatches.unknown` is compared against: never a second
 * counting rule, only the membership test `dispatchesOf` already applies
 * before it decides what each match means.
 */
export function isDispatchLikeEvent(event: RunEvent): boolean {
	return event.kind === 'run.cycle-response-invalid' || event.kind in MODEL_EVENT_ROLES;
}

/**
 * Counts every confirmed CLI-process invocation (GSHIP-890): an executor or
 * reviewer spawn, a `run.cycle-response` the orchestrator's own resolver
 * answered, and a `run.cycle-response-invalid` (`#answerCycleQuestion`,
 * run-runtime.ts) -- recorded only once `#resolveCycleQuestionCall` returns a
 * result that fails validation, so the resolver call itself is confirmed even
 * though it produced no usable answer and never counts toward
 * `resolvedCycleQuestions`. A repeated attempt after that invalid response,
 * whether it lands on another invalid response or a valid orchestrator
 * continue, is its own additional dispatch.
 */
function dispatchesOf(events: readonly RunEvent[]): RunDispatches {
	const dispatches: RunDispatches = { total: 0, executor: 0, reviewer: 0, orchestrator: 0, unknown: 0 };
	for (const event of events) {
		if (event.kind === 'run.cycle-response-invalid') {
			dispatches.orchestrator += 1;
			dispatches.total += 1;
			continue;
		}
		if (event.kind === 'run.cycle-response') {
			const invocation = cycleResponseInvocation(event);
			if (invocation === 'orchestrator') { dispatches.orchestrator += 1; dispatches.total += 1; }
			else if (invocation === 'unknown') dispatches.unknown += 1;
			continue;
		}
		const role = MODEL_EVENT_ROLES[event.kind];
		if (role === undefined) continue;
		dispatches[role] += 1;
		dispatches.total += 1;
	}
	return dispatches;
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
 * the only place a role runs on a provider the run did not select. A
 * `run.cycle-response` only ever feeds the `orchestrator` entry when
 * `cycleResponseInvocation` confirms the resolver actually ran (GSHIP-890):
 * an operator or agent-cli answer to a pending question never called it, and
 * a legacy event with no responder recorded leaves that undecidable, so
 * neither lists a configuration for a call that may never have happened --
 * the same rule `addModelConfiguration` applies in project-status.ts.
 */
/** Folds one model event's own model, effort and provider into `entry` (GSHIP-709/890 share this shape between `provider.model`/`review.model` and a confirmed orchestrator `run.cycle-response`). */
function foldModelEvent(entry: RoleConfigurationAccumulator, payload: Record<string, unknown>, run: RunRecord): void {
	const model = normalizedText(payload['model']);
	const effort = normalizedText(payload['effort']);
	if (model !== null) entry.models.add(model);
	if (effort !== null) entry.efforts.add(effort);
	entry.providers.add(providerOf(payload['provider']) ?? run.providerId);
}

function foldRoleConfigurationEvent(
	entryFor: (role: RunCostRole) => RoleConfigurationAccumulator,
	run: RunRecord,
	event: RunEvent,
): void {
	if (event.kind === REVIEW_FALLBACK_EVENT) {
		foldProviderPair(entryFor('reviewer'), event.payload);
		return;
	}
	if (event.kind === EXECUTOR_HANDOFF_EVENT) {
		foldProviderPair(entryFor('executor'), event.payload);
		return;
	}
	if (event.kind === 'run.cycle-response') {
		if (cycleResponseInvocation(event) === 'orchestrator') foldModelEvent(entryFor('orchestrator'), event.payload, run);
		return;
	}
	const role = MODEL_EVENT_ROLES[event.kind];
	if (role !== undefined) foldModelEvent(entryFor(role), event.payload, run);
}

function roleConfigurations(run: RunRecord, events: readonly RunEvent[]): RunRoleConfiguration[] {
	const configurations = new Map<RunCostRole, RoleConfigurationAccumulator>();
	const entryFor = (role: RunCostRole): RoleConfigurationAccumulator => {
		const entry = configurations.get(role)
			?? { models: new Set<string>(), efforts: new Set<string>(), providers: new Set<AgentProviderId>() };
		configurations.set(role, entry);
		return entry;
	};
	for (const event of events) foldRoleConfigurationEvent(entryFor, run, event);
	return [...configurations.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([role, configuration]) => ({
			role,
			models: [...configuration.models].sort(),
			efforts: [...configuration.efforts].sort(),
			providers: [...configuration.providers].sort(),
		}));
}

function correctionCounts(events: readonly RunEvent[]): RunEvaluation['corrections'] {
	const corrections = {
		verification: events.filter((event) => event.kind === 'run.verification-fix-requested').length,
		review: events.filter((event) => event.kind === 'run.review-fix-requested').length,
		fullVerify: events.filter((event) => event.kind === 'run.full-verify-fix-requested').length,
		ci: events.filter((event) => event.kind === 'run.ci-fix-requested').length,
	};
	return { ...corrections, total: Object.values(corrections).reduce((sum, count) => sum + count, 0) };
}

function recoveryCounts(events: readonly RunEvent[]): { reserved: number; finished: number } {
	const reserved = new Set<string>();
	const finished = new Set<string>();
	for (const event of events) {
		const id = event.payload['dispatchId'];
		if (typeof id !== 'string') continue;
		if (event.kind === 'run.recovery-dispatch-reserved') reserved.add(id);
		if (event.kind === 'run.recovery-dispatch-finished' || (event.kind === 'run.recovery-dispatch-reconciled' && event.payload['state'] === 'finished')) finished.add(id);
	}
	return { reserved: reserved.size, finished: finished.size };
}

function verificationRetryMetrics(events: readonly RunEvent[]): RunEvaluation['verificationRetries'] {
	const requests = events.filter((event) => event.kind === 'run.verification-retry-requested');
	if (requests.length === 0) return undefined;
	const results = events.filter((event) => event.kind === 'run.verification-retry-result');
	const resultsForRequest = requests.map((request, index) => results.filter((result) => result.seq > request.seq && result.seq < (requests[index + 1]?.seq ?? Infinity)));
	const completedResults = resultsForRequest.flat();
	const durations = results.map((event) => event.payload['durationMs']).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
	const usage = results.flatMap((event) => {
		const value = event.payload['usage'];
		return value !== null && typeof value === 'object' && !Array.isArray(value) ? [value as Record<string, unknown>] : [];
	});
	return {
		attempts: requests.length,
		failures: results.filter((event) => event.payload['outcome'] === 'failed').length,
		durationMs: completedResults.length === requests.length && durations.length === results.length ? durations.reduce((sum, value) => sum + value, 0) : null,
		usage: usage.length === 0 ? null : usage,
	};
}

export function evaluateRun(run: RunRecord, events: readonly RunEvent[]): RunEvaluation {
	const duration = durationBreakdown(run, events);
	const corrections = correctionCounts(events);
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
	const recoveryCountsValue = recoveryCounts(events);
	const recoveryLimitReached = events.some((recordedEvent) => recordedEvent.kind === 'run.recovery-limit');
	return {
		specProfile: specProfileOf(events),
		corrections,
		dispatches: dispatchesOf(events),
		dispatchMethodologyVersion: DISPATCH_METHODOLOGY_VERSION,
		recovery: {
			policy: run.recoveryPolicy ?? null,
			...recoveryCountsValue,
			limitReached: recoveryLimitReached,
			convergence: recoveryLimitReached ? recoveryConvergenceDiagnosis(events) : null,
		},
		guidance: guidanceEvidence(events),
		cycleQuestions: { ...cycleQuestions, total: Object.values(cycleQuestions).reduce((sum, count) => sum + count, 0) },
		reconciliations: { ...reconciliations, total: Object.values(reconciliations).reduce((sum, count) => sum + count, 0) },
		workflowRevision: workflowRevisionOf(events),
		provider: run.providerId,
		outcome: outcomeOf(run),
		wallTimeMs: wallTimeOf(run),
		...duration,
		attentionRequests: events.filter((event) =>
			event.toState === 'waiting-user' && event.fromState !== 'waiting-user').length,
		operatorInterventions: events.filter((event) => event.kind === 'run.operator-guidance'
			&& !(guidanceChannel(event) === 'agent-cli' && authorizationEvidence(event) === 'observed')).length,
		providerHolds: events.filter((event) => event.kind === 'run.provider-waiting').length,
		resolvedCycleQuestions: events.filter((event) => event.kind === 'run.cycle-response'
			&& event.payload['responder'] === 'orchestrator' && event.payload['outcome'] === 'continue').length,
		roles: roleConfigurations(run, events),
		...(verificationCadence === undefined ? {} : { verificationCadence }),
		...(verificationRetryMetrics(events) === undefined ? {} : { verificationRetries: verificationRetryMetrics(events) }),
	};
}

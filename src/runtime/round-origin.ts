import type { RunEvent } from './run-store.ts';

/**
 * Every event kind that opens a new pass through the executor -- i.e. a
 * transition into `working` (GSHIP-659). `run.started` fires both for a run's
 * own launch and for every resume; `run.review-fix-requested`,
 * `run.full-verify-fix-requested` and `run.merge-conflict-fix-requested`
 * (GSHIP-884) fire only for the runtime's own automatic fix rounds.
 */
const ROUND_START_KINDS: ReadonlySet<string> = new Set([
	'run.started',
	'run.review-fix-requested',
	'run.verification-fix-requested',
	'run.full-verify-fix-requested',
	'run.ci-fix-requested',
	'run.merge-conflict-fix-requested',
]);

/**
 * Counts of a run's correction rounds, grouped by where each one came from.
 * `indeterminate` is a round the recorded history admits no pattern for --
 * never a guess.
 */
export interface RunRoundOrigins {
	executor: number;
	ci?: number;
	decision: number;
	orchestrator?: number;
	indeterminate: number;
}

function recordRound(
	origins: RunRoundOrigins,
	event: RunEvent,
	previousKind: string | null,
): void {
	const { kind } = event;
	if (kind === 'run.ci-fix-requested') {
		origins.ci = (origins.ci ?? 0) + 1;
		return;
	}
	if (kind === 'run.started') {
		if (previousKind === 'run.operator-guidance') origins.decision += 1;
		else origins.indeterminate += 1;
		return;
	}
	if (kind === 'run.cycle-response' && event.payload['outcome'] === 'continue') {
		// GSHIP-890: a human or agent-cli answer to a pending cycle question
		// (`#applyOperatorCycleGuidance`, run-runtime.ts) never called the
		// resolver, so the round it opens is a decision, not an orchestrator
		// one -- the same distinction `isResolverInvocation` draws in
		// run-evaluation.ts. A legacy event with no responder recorded at all
		// admits no pattern either way and is never guessed as either kind of
		// round -- `indeterminate`, the same as any other unattributed resume.
		// An operator or agent-cli continue that follows its own resume's
		// `run.started` (`resumeRoundOpen` in `selectRunRoundOrigins`) never
		// reaches here at all: that `run.started` already counted the one
		// decision this resume-and-answer pair represents, so a single
		// operator decision beside one executor dispatch is one `decision`
		// round, not two.
		const { responder } = event.payload;
		if (responder === 'orchestrator') origins.orchestrator = (origins.orchestrator ?? 0) + 1;
		else if (responder === 'operator' || responder === 'agent-cli') origins.decision += 1;
		else origins.indeterminate += 1;
		return;
	}
	origins.executor += 1;
}

/**
 * Derives, from a run's own decision-class history (GSHIP-627's
 * `listRunDecisionEvents`, read in order), where each correction round came
 * from -- the executor's own automatic fix, or the consequence of an operator
 * decision (GSHIP-659). No new capture: every event this reads already exists
 * because the runtime records its transitions as decisions by construction.
 *
 * The run's own first entry into `working` is the launch, not a correction,
 * so it is never counted. `run.review-fix-requested`,
 * `run.full-verify-fix-requested` and `run.merge-conflict-fix-requested` are
 * raised by the runtime itself, mid-run, with no operator turn possible in
 * between -- always `executor`. Every other
 * round starts at `run.started`, which fires both for that first launch and
 * for every later resume; a resume is `decision` only when the event
 * immediately before it is `run.operator-guidance` -- exactly what
 * `resumeRun` emits, synchronously, right before it. Any other resume (e.g.
 * recovering an interrupted run with no guidance) matches neither rule, so it
 * is reported `indeterminate` rather than attributed by supposition. The one
 * exception is a `run.started` replay while a durable orchestrator continue
 * response is still unconsumed: that reopens the same correction round and is
 * not a second origin, with or without recovery guidance.
 *
 * An operator or agent-cli answer to a pending cycle question
 * (`#applyOperatorCycleGuidance`, run-runtime.ts, GSHIP-890) is a second event
 * from that very same resume, not a second decision: `resumeRun` emits
 * `run.operator-guidance`, then a `run.started` that already counted this
 * decision (or, if unattributed, `indeterminate`), and only then the
 * `run.cycle-response` continue that applies it. `resumeRoundOpen` tracks
 * that window -- open the instant this resume's own `run.started` is counted,
 * closed by `run.work-completed` or by any other round starting -- so that
 * trailing continue is folded into the round its own resume already opened
 * instead of counted again. A continue with no preceding `run.started` at all
 * (the executor's own pending question, answered without an interruption in
 * between) still counts its own `decision` round exactly as before.
 */
interface RoundScanState {
	seenFirstRound: boolean;
	previousKind: string | null;
	unconsumedCycleContinue: boolean;
	resumeRoundOpen: boolean;
}

function isCycleContinue(event: RunEvent): boolean {
	return event.kind === 'run.cycle-response' && event.payload['outcome'] === 'continue';
}

/**
 * Whether this cycle-continue is the trailing half of a resume already
 * counted as a decision (GSHIP-890) -- see `selectRunRoundOrigins`.
 * `cycleContinue` is only true once `event.kind === 'run.cycle-response'` is
 * already confirmed, so `event.payload` is safe to read here -- never
 * evaluated for any other round-start kind.
 */
function isGuidanceContinueDuringResume(event: RunEvent, cycleContinue: boolean, resumeRoundOpen: boolean): boolean {
	if (!cycleContinue || !resumeRoundOpen) return false;
	const { responder } = event.payload;
	return responder === 'operator' || responder === 'agent-cli';
}

function processRoundEvent(origins: RunRoundOrigins, event: RunEvent, state: RoundScanState): void {
	const cycleContinue = isCycleContinue(event);
	const replayingCycleContinue = event.kind === 'run.started' && state.unconsumedCycleContinue;
	const startsRound = (ROUND_START_KINDS.has(event.kind) && !replayingCycleContinue) || cycleContinue;
	if (startsRound) {
		if (!state.seenFirstRound) {
			state.seenFirstRound = true;
		} else {
			const guidanceContinueDuringResume = isGuidanceContinueDuringResume(event, cycleContinue, state.resumeRoundOpen);
			if (!guidanceContinueDuringResume) recordRound(origins, event, state.previousKind);
			state.resumeRoundOpen = event.kind === 'run.started';
		}
	}
	if (event.kind === 'run.work-completed') { state.unconsumedCycleContinue = false; state.resumeRoundOpen = false; }
	if (cycleContinue) state.unconsumedCycleContinue = true;
	state.previousKind = event.kind;
}

export function selectRunRoundOrigins(events: readonly RunEvent[]): RunRoundOrigins {
	const origins: RunRoundOrigins = { executor: 0, ci: 0, decision: 0, orchestrator: 0, indeterminate: 0 };
	const state: RoundScanState = {
		seenFirstRound: false, previousKind: null, unconsumedCycleContinue: false, resumeRoundOpen: false,
	};
	for (const event of events) processRoundEvent(origins, event, state);
	return origins;
}

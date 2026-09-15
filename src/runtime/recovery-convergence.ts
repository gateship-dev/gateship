import type { RunEvent } from './run-store.ts';

/** The correction-request events a recovery round is read from (GSHIP-864). */
export type RecoveryConvergenceOrigin = 'verification' | 'review' | 'full-verify' | 'ci';

const ROUND_EVENT_ORIGINS: Readonly<Record<string, RecoveryConvergenceOrigin>> = {
	'run.verification-fix-requested': 'verification',
	'run.review-fix-requested': 'review',
	'run.full-verify-fix-requested': 'full-verify',
	'run.ci-fix-requested': 'ci',
	// A repeated no-diff CI correction under an explicit policy (GSHIP-864):
	// the executor is retried without a fresh `run.ci-fix-requested`, so this
	// is the only durable marker of that round -- without it, a CI stagnation
	// exhausted purely by repeated no-op rounds would read as a single round
	// with nothing to compare, hiding exactly the repetition it caused.
	'run.ci-fix-no-change-retry': 'ci',
};

export interface RecoveryConvergenceRound {
	origin: RecoveryConvergenceOrigin;
	finding: string;
}

/**
 * What a recovery-limit `waiting-user` reports about whether the run was
 * still making progress (GSHIP-864): the findings behind up to the last three
 * corrective rounds, oldest first, and whether the latest round's finding
 * differs from the one before it -- the model's own claim of progress is
 * never evidence, only the finding text a fresh verification/review/CI
 * failure actually reported.
 */
export interface RecoveryConvergenceDiagnosis {
	rounds: RecoveryConvergenceRound[];
	/** `null` when fewer than two rounds exist to compare. */
	lastRoundIsNewFinding: boolean | null;
}

const CONVERGENCE_ROUND_WINDOW = 3;

function findingText(kind: string, payload: Record<string, unknown>): string | null {
	const findings = payload['findings'];
	if (typeof findings === 'string' && findings.trim().length > 0) return findings.trim();
	if (kind !== 'run.ci-fix-requested' && kind !== 'run.ci-fix-no-change-retry') return null;
	const evidence = payload['evidence'];
	if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
	const check = (evidence as Record<string, unknown>)['check'];
	const name = check !== null && typeof check === 'object' && !Array.isArray(check)
		? (check as Record<string, unknown>)['name'] : undefined;
	return typeof name === 'string' && name.trim().length > 0 ? name.trim() : JSON.stringify(evidence);
}

/**
 * Reads recovery rounds straight from the run's own durable decision log,
 * never from a resolver's self-report: a round exists only once a fresh
 * verification, review, full-verify or CI failure actually requested another
 * correction.
 */
export function recoveryConvergenceDiagnosis(events: readonly RunEvent[]): RecoveryConvergenceDiagnosis {
	const rounds: RecoveryConvergenceRound[] = [];
	for (const event of events) {
		const origin = ROUND_EVENT_ORIGINS[event.kind];
		if (origin === undefined) continue;
		const finding = findingText(event.kind, event.payload);
		if (finding === null) continue;
		rounds.push({ origin, finding });
	}
	const lastRounds = rounds.slice(-CONVERGENCE_ROUND_WINDOW);
	const lastRoundIsNewFinding = lastRounds.length < 2 ? null
		: lastRounds[lastRounds.length - 1]?.finding !== lastRounds[lastRounds.length - 2]?.finding;
	return { rounds: lastRounds, lastRoundIsNewFinding };
}

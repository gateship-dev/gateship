import { randomUUID } from 'node:crypto';

import type { AgentSession } from './agent-session.ts';
import {
	buildMutationSelectionPrompt,
	buildReviewPrompt,
	collectChange,
	emitReviewCoverage,
	MUTATION_SELECTION_SCHEMA,
	parseMutationSelection,
	parseReviewVerdict,
	REVIEW_RESULT_SCHEMA,
	reviewEvidenceForPrompt,
} from './claude-cli-reviewer.ts';
import {
	CodexReviewSession,
	type CodexCliExecutorOptions,
} from './codex-cli-executor.ts';
import { defaultRunGit, type GitCommandRunner } from './git-runtime.ts';
import type { ModelSlotResolver } from './model-settings.ts';
import type {
	RuntimeExecutionInput,
	RuntimeMutationSelection,
	RuntimeMutationSelector,
	RuntimeReviewer,
	RuntimeReviewResult,
} from './run-runtime.ts';

export interface CodexCliReviewerOptions {
	session?: AgentSession;
	command?: string[];
	model?: string;
	effort?: string;
	/** Asked at every review, so the operator's choice needs no restart. */
	resolveModel?: ModelSlotResolver;
	sourceEnv?: Record<string, string | undefined>;
	terminationGraceMs?: number;
	/** Internal/test seam; production uses the shared ten-minute constant. */
	activityTimeoutMs?: number;
	loadIssue?: (cwd: string, issueId: string) => string;
	approvedContract?: string;
	runGit?: GitCommandRunner;
	onSpawn?: (pid: number) => void;
}

function sessionOptions(options: CodexCliReviewerOptions): Omit<
	CodexCliExecutorOptions,
	'loadIssue' | 'session'
> {
	return {
		...(options.command === undefined ? {} : { command: options.command }),
		...(options.model === undefined ? {} : { model: options.model }),
		...(options.effort === undefined ? {} : { effort: options.effort }),
		...(options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel }),
		...(options.sourceEnv === undefined ? {} : { sourceEnv: options.sourceEnv }),
		...(options.terminationGraceMs === undefined
			? {}
			: { terminationGraceMs: options.terminationGraceMs }),
		...(options.activityTimeoutMs === undefined
			? {}
			: { activityTimeoutMs: options.activityTimeoutMs }),
		...(options.onSpawn === undefined ? {} : { onSpawn: options.onSpawn }),
	};
}

export class CodexCliReviewer implements RuntimeReviewer {
	readonly #options: CodexCliReviewerOptions;
	readonly #session: AgentSession;

	constructor(options: CodexCliReviewerOptions = {}) {
		this.#options = options;
		this.#session = options.session ?? new CodexReviewSession(sessionOptions(options));
	}

	async review(input: RuntimeExecutionInput): Promise<RuntimeReviewResult> {
		const issue = (input.approvedContract ?? this.#options.approvedContract)?.trim();
		if (issue === undefined || issue.length === 0) throw new Error('approved issue contract is unavailable for this run');
		const runGit = this.#options.runGit ?? defaultRunGit;
		const change = collectChange(runGit, input.cwd);
		const evidence = reviewEvidenceForPrompt(input, runGit);
		const result = await this.#session.run({
			sessionId: randomUUID(),
			resume: false,
			cwd: input.cwd,
			prompt: buildReviewPrompt(
				input.issueId, issue, change, input.operatorDecisions ?? [], input.ciFeedback,
				input.operatorGuidance, input.operatorGuidanceSource, input.operatorGuidanceAuthorizationEvidence,
				evidence,
			),
			outputSchema: REVIEW_RESULT_SCHEMA,
			signal: input.signal,
			emit: input.emit,
			eventPrefix: 'review',
		});
		const coverageFindings = emitReviewCoverage(input, issue, result.structuredOutput);
		return parseReviewVerdict(result.structuredOutput, result.summary, coverageFindings);
	}
}

// GSHIP-893: mirrors `CodexCliReviewer` above -- same session shape, same
// read-only session (`CodexReviewSession` never grants write access), and the
// same `sessionOptions` mapping -- but for the reviewer's read-only mutation-
// selection step instead of its verdict. See `ClaudeCliMutationSelector`
// (claude-cli-reviewer.ts) for the Claude counterpart this shares its prompt,
// schema and parsing with.
export type CodexCliMutationSelectorOptions = Omit<CodexCliReviewerOptions, 'loadIssue' | 'approvedContract'>;

export class CodexCliMutationSelector implements RuntimeMutationSelector {
	readonly #options: CodexCliMutationSelectorOptions;
	readonly #session: AgentSession;

	constructor(options: CodexCliMutationSelectorOptions = {}) {
		this.#options = options;
		this.#session = options.session ?? new CodexReviewSession(sessionOptions(options));
	}

	async select(input: RuntimeExecutionInput): Promise<RuntimeMutationSelection> {
		const runGit = this.#options.runGit ?? defaultRunGit;
		const change = collectChange(runGit, input.cwd);
		const result = await this.#session.run({
			sessionId: randomUUID(),
			resume: false,
			cwd: input.cwd,
			prompt: buildMutationSelectionPrompt(input.issueId, input.approvedContract, change),
			outputSchema: MUTATION_SELECTION_SCHEMA,
			signal: input.signal,
			emit: input.emit,
			eventPrefix: 'mutation-sensor',
		});
		return parseMutationSelection(result.structuredOutput);
	}
}

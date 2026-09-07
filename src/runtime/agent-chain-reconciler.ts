import { randomUUID } from 'node:crypto';

import type { AgentProviderId, AgentSession } from './agent-session.ts';
import { OPERATOR_LANGUAGE_CONTRACT } from './operator-language.ts';
import type {
	RuntimeChainReconciliationInput,
	RuntimeChainReconciliationResult,
	RuntimeCycleResponseUsage,
	RuntimeChainReconciler,
} from './run-runtime.ts';

export const CHAIN_RECONCILIATION_RESULT_SCHEMA = {
	type: 'object',
	properties: {
		outcome: { type: 'string', enum: ['unchanged', 'clarified', 'material'] },
		justification: { type: 'string' },
		guidance: { type: ['string', 'null'] },
	},
	required: ['outcome', 'justification', 'guidance'],
	additionalProperties: false,
} as const;

function recordOf(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function usageOf(payload: Record<string, unknown> | undefined, modelPayload: Record<string, unknown> | undefined): RuntimeCycleResponseUsage {
	return {
		model: typeof payload?.['model'] === 'string' ? payload['model'] : typeof modelPayload?.['model'] === 'string' ? modelPayload['model'] : 'provider-default',
		effort: typeof payload?.['effort'] === 'string' ? payload['effort'] : typeof modelPayload?.['effort'] === 'string' ? modelPayload['effort'] : 'provider-default',
		...(typeof payload?.['totalCostUsd'] === 'number' ? { totalCostUsd: payload['totalCostUsd'] } : {}),
	};
}

export function buildChainReconciliationPrompt(input: RuntimeChainReconciliationInput): string {
	return [
		`Reconcile the delivered Gateship issue ${input.sourceIssueId} before dispatching ${input.targetIssueId}.`,
		'Use a fresh mechanically read-only session. Do not edit files, approve, start, ship, alter an issue, alter its specification or fingerprint, or change verification commands.',
		'Compare the new origin/main, the prior delivery and the next approved specification.',
		'Return unchanged when the approved specification still maps directly to the delivered tree.',
		'Return clarified only for non-binding execution guidance that does not change the specification or fingerprint.',
		'Return material when the objective, observable behavior, risk, irreversible effects, exclusions, evidence or verification commands would change.',
		'Never invent a planner or global memory. Keep the result concise and evidence-based.',
		'', ...OPERATOR_LANGUAGE_CONTRACT, '',
		`Origin: ${input.originMain}.`,
		`Prior delivery: ${JSON.stringify(input.priorDelivery)}.`,
		'Next approved specification:', input.nextSpecification,
	].join('\n');
}

export class AgentChainReconciler implements RuntimeChainReconciler {
	readonly #sessions: Readonly<Record<AgentProviderId, AgentSession>>;

	constructor(sessions: Readonly<Record<AgentProviderId, AgentSession>>) { this.#sessions = sessions; }

	async reconcile(input: RuntimeChainReconciliationInput): Promise<RuntimeChainReconciliationResult> {
		let usagePayload: Record<string, unknown> | undefined;
		let modelPayload: Record<string, unknown> | undefined;
		const result = await this.#sessions[input.providerId].run({
			sessionId: randomUUID(), resume: false, cwd: input.workspace,
			prompt: buildChainReconciliationPrompt(input), access: 'read-only',
			outputSchema: CHAIN_RECONCILIATION_RESULT_SCHEMA, signal: input.signal,
			eventPrefix: 'chain-reconciliation',
			emit: (kind, payload, eventClass) => {
				if (kind === 'chain-reconciliation.usage') usagePayload = payload;
				if (kind === 'chain-reconciliation.model') modelPayload = payload;
				input.emit(kind, payload, eventClass);
			},
		});
		const value = recordOf(result.structuredOutput);
		const outcome = value?.['outcome'];
		const justification = typeof value?.['justification'] === 'string' ? value['justification'].trim() : '';
		const guidance = typeof value?.['guidance'] === 'string' ? value['guidance'].trim() : '';
		if ((outcome !== 'unchanged' && outcome !== 'clarified' && outcome !== 'material') || justification.length === 0
			|| (outcome === 'clarified' && guidance.length === 0)) {
			throw new Error('Chain reconciliation returned an invalid response.');
		}
		return {
			outcome, justification,
			...(guidance.length === 0 ? {} : { guidance }),
			usage: usageOf(usagePayload, modelPayload),
		} as RuntimeChainReconciliationResult;
	}
}

import { describe, expect, test } from 'bun:test';

import type { RegisteredProject } from '../../src/runtime/project-registry.ts';
import { readProjectHistoricalOverview } from '../../src/runtime/project-status.ts';
import { parseRunOverviewFilters, readRunOverview } from '../../src/runtime/run-overview.ts';
import type { PersistedRunHistory } from '../../src/runtime/run-store.ts';

function project(id: string, name = id): RegisteredProject {
	return {
		id, name, root: `/safe/${id}`, stateDir: `/safe/${id}/.gship`, readiness: 'ready',
		repository: `acme/${id}`, current: false,
	};
}

function history(id: string, updatedAt: string, providerId: 'claude' | 'codex' = 'claude'): PersistedRunHistory {
	const run = {
		id, issueId: `GSHIP-${id}`, sessionId: id, providerId, workspacePath: '/private/workspace',
		state: 'done' as const, fixRounds: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt,
		summary: null, error: null,
	};
	return {
		run,
		events: [],
		evaluation: {
			specProfile: { version: 'unknown', fingerprint: null, counts: { acceptance: null, boundaries: null, verify: null, evidence: null } },
			corrections: { verification: 0, review: 0, fullVerify: 0, ci: 0, total: 0 },
			cycleQuestions: { executor: 0, review: 0, fullVerify: 0, total: 0 },
			reconciliations: { unchanged: 0, adapted: 0, 'contract-change-required': 0, total: 0 },
			workflowRevision: null, provider: providerId, outcome: 'shipped', wallTimeMs: 1,
			attentionRequests: 0, operatorInterventions: 0, providerHolds: 0, roles: [],
			phaseDurations: {
				queued: { durationMs: 0, entries: 0 }, working: { durationMs: 0, entries: 0 }, verify: { durationMs: 0, entries: 0 }, review: { durationMs: 0, entries: 0 },
				'full-verify': { durationMs: 0, entries: 0 }, shipping: { durationMs: 0, entries: 0 }, 'waiting-provider': { durationMs: 0, entries: 0 }, 'waiting-user': { durationMs: 0, entries: 0 },
			},
			unassignedDuration: { durationMs: 1, entries: 1 },
			durationReconciliation: { classifiedMs: 0, unassignedMs: 1, totalMs: 1, toleranceMs: 1000, reconciles: true },
	},
		cost: { totalCostUsd: null, breakdown: [], roles: [] },
	};
}

describe('readRunOverview', () => {
	test('agrega, filtra e ordena com desempate estável antes de paginar', () => {
		const data: Record<string, PersistedRunHistory[]> = {
			'/safe/one/.gship/runtime.sqlite': [history('z', '2026-09-02T00:00:00.000Z')],
			'/safe/two/.gship/runtime.sqlite': [history('a', '2026-09-02T00:00:00.000Z', 'codex')],
		};
		const result = readRunOverview([project('two'), project('one')], {
			providerId: 'codex', limit: 1, offset: 0,
		}, { readHistory: (path) => data[path] ?? [] });
		expect(result.runs.map((run) => run.runId)).toEqual(['a']);
		expect(result.page).toEqual({ limit: 1, offset: 0, returned: 1, total: 1 });
		expect(result.runs[0]?.repository).toBe('acme/two');
	});

	test('mantém resultados e identifica projeto indisponível sem expor path', () => {
		const result = readRunOverview([project('good'), project('bad', 'Projeto indisponível')], {}, {
			readHistory: (path) => {
				if (path.includes('/bad/')) throw new Error('/private/secret/runtime.sqlite');
				return [history('good-run', '2026-09-03T00:00:00.000Z')];
			},
		});
		expect(result.runs).toHaveLength(1);
		expect(result.errors).toEqual([{
			projectId: 'bad', projectName: 'Projeto indisponível', code: 'project-unavailable',
			message: 'Project runs are unavailable.',
		}]);
		expect(JSON.stringify(result)).not.toContain('private');
	});

	test('filtra período e busca por runId ou issueId antes da paginação', () => {
		const recent = history('recent-run', '2026-09-05T00:00:00.000Z');
		recent.run.createdAt = '2026-09-05T00:00:00.000Z';
		const old = history('old-run', '2026-07-01T00:00:00.000Z');
		old.run.createdAt = '2026-07-01T00:00:00.000Z';
		const options = {
			readHistory: () => [recent, old],
			now: () => Date.parse('2026-09-07T00:00:00.000Z'),
		};
		expect(readRunOverview([project('one')], { period: '7d' }, options).runs.map((run) => run.runId)).toEqual(['recent-run']);
		expect(readRunOverview([project('one')], { search: 'GSHIP-old' }, options).runs.map((run) => run.runId)).toEqual(['old-run']);
	});

	test('ordena globalmente por campos reais, mantém nulos no fim e pagina sem duplicar', () => {
		const first = history('first', '2026-09-01T00:00:00.000Z');
		first.cost.totalCostUsd = null;
		const second = history('second', '2026-09-03T00:00:00.000Z');
		second.cost.totalCostUsd = 2;
		const third = history('third', '2026-09-02T00:00:00.000Z');
		third.cost.totalCostUsd = 1;
		const options = { readHistory: () => [first, second, third] };
		expect(readRunOverview([project('one')], { sortBy: 'cost', sortDirection: 'asc', limit: 2 }, options).runs.map((run) => run.runId)).toEqual(['third', 'second']);
		expect(readRunOverview([project('one')], { sortBy: 'cost', sortDirection: 'asc', offset: 2, limit: 2 }, options).runs.map((run) => run.runId)).toEqual(['first']);
	});

	test('rejeita parâmetros de ordenação desconhecidos com contrato explícito', () => {
		expect(() => parseRunOverviewFilters(new URLSearchParams('sortBy=unknown'))).toThrow('sortBy must be a valid run field.');
		expect(() => parseRunOverviewFilters(new URLSearchParams('sortDirection=sideways'))).toThrow('sortDirection must be asc or desc.');
	});

	test('mede espera do provider pela duração, preserva o denominador e exclui durações desconhecidas', () => {
		const first = history('wait-1', '2026-09-01T00:00:00.000Z');
		const second = history('wait-2', '2026-09-02T00:00:00.000Z');
		const unknown = history('wait-3', '2026-09-03T00:00:00.000Z');
		for (const [item, durationMs] of [[first, 1000], [second, 2000], [unknown, null]] as const) {
			item.evaluation.providerHolds = 99;
			item.evaluation.phaseDurations['waiting-provider'].durationMs = durationMs;
		}
		const overview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-04T00:00:00.000Z'), () => [first, second, unknown], {}, null).overview;
		const waits = overview?.autonomyEvidence?.comparables.waits.provider;
		expect(waits).toEqual({ median: 1500, p90: 2000, max: 2000, known: 2, denominator: 3 });
	});

	test('marca autorização ausente só quando a evidência é desconhecida ou não existe', () => {
		const observed = history('auth-observed', '2026-09-01T00:00:00.000Z');
		observed.evaluation.guidance = { channels: { web: 1, 'agent-cli': 0, other: 0, unknown: 0 }, authorization: { observed: 1, absent: 0, unknown: 0 } };
		const absent = history('auth-absent', '2026-09-02T00:00:00.000Z');
		absent.evaluation.guidance = { channels: { web: 1, 'agent-cli': 0, other: 0, unknown: 0 }, authorization: { observed: 0, absent: 1, unknown: 0 } };
		const unknown = history('auth-unknown', '2026-09-03T00:00:00.000Z');
		unknown.evaluation.guidance = { channels: { web: 1, 'agent-cli': 0, other: 0, unknown: 0 }, authorization: { observed: 0, absent: 0, unknown: 1 } };
		const none = history('auth-none', '2026-09-04T00:00:00.000Z');
		const mixed = history('auth-mixed', '2026-09-05T00:00:00.000Z');
		mixed.evaluation.guidance = { channels: { web: 1, 'agent-cli': 0, other: 0, unknown: 0 }, authorization: { observed: 0, absent: 1, unknown: 1 } };
		const overview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-06T00:00:00.000Z'), () => [observed, absent, unknown, none, mixed], {}, null).overview;
		expect(overview?.autonomyEvidence?.missing.authorizationEvidence).toBe(3);
	});

	test('agrega canais da orientação e evidências de autorização entre runs', () => {
		const first = history('guidance-1', '2026-09-01T00:00:00.000Z');
		first.evaluation.guidance = { channels: { web: 2, 'agent-cli': 1, other: 0, unknown: 1 }, authorization: { observed: 1, absent: 1, unknown: 2 } };
		const second = history('guidance-2', '2026-09-02T00:00:00.000Z');
		second.evaluation.guidance = { channels: { web: 0, 'agent-cli': 2, other: 1, unknown: 0 }, authorization: { observed: 2, absent: 0, unknown: 1 } };
		const overview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-03T00:00:00.000Z'), () => [first, second], {}, null).overview;
		expect(overview?.autonomyEvidence?.guidance).toEqual({
			channels: { web: 2, 'agent-cli': 3, other: 1, unknown: 1 },
			authorization: { observed: 3, absent: 1, unknown: 3 },
		});
		expect(overview?.autonomyEvidence?.denominator).toBe('selected-historical-runs');
		expect(overview?.autonomyEvidence?.percentileMethod).toBe('median-center-nearest-rank-p90');
		expect(overview?.dispatchCeilings?.reason).toBe('equivalent-outcome-not-demonstrated');
	});

	test('publica cobertura de despachos sem transformar ausência em zero', () => {
		const missing = [1, 2, 3].map((index) => history(`dispatch-missing-${index}`, `2026-09-0${index}T00:00:00.000Z`));
		const missingOverview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-04T00:00:00.000Z'), () => missing, {}, null).overview;
		expect(missingOverview?.autonomyEvidence?.missing.dispatches).toBe(3);
		expect(missingOverview?.dispatchCeilings).toMatchObject({ known: 0, denominator: 3 });
		expect(missingOverview?.dispatchCeilings?.candidates).toHaveLength(3);
		for (const candidate of missingOverview?.dispatchCeilings?.candidates ?? []) expect(candidate).toMatchObject({ observedRuns: null, cappedDispatches: null });

		const partial = [1, 2, 3, 4].map((index) => history(`dispatch-partial-${index}`, `2026-09-0${index}T00:00:00.000Z`));
		partial[0]!.evaluation.dispatches = { total: 7, executor: 7, reviewer: 0, orchestrator: 0 };
		partial[1]!.evaluation.dispatches = { total: 10, executor: 10, reviewer: 0, orchestrator: 0 };
		const partialOverview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-05T00:00:00.000Z'), () => partial, {}, null).overview;
		expect(partialOverview?.dispatchCeilings).toMatchObject({ known: 2, denominator: 4 });
		expect(partialOverview?.dispatchCeilings?.candidates.find((candidate) => candidate.ceiling === 7)).toEqual({ ceiling: 7, observedRuns: 1, cappedDispatches: 3 });
	});

	test('soma todos os períodos ativos de recuperação e preserva medições ausentes', () => {
		const recovered = history('recovered-many', '2026-09-01T00:00:00.000Z');
		recovered.events = [
			{ seq: 1, runId: recovered.run.id, kind: 'run.recovered-interrupted', fromState: 'working', toState: 'interrupted', payload: { activeDurationMs: 1000 }, createdAt: recovered.run.createdAt, eventClass: 'decision' },
			{ seq: 2, runId: recovered.run.id, kind: 'run.recovered-shippable', fromState: 'shipping', toState: 'ready-to-ship', payload: { activeDurationMs: 2000 }, createdAt: recovered.run.updatedAt, eventClass: 'decision' },
		];
		const recoveredAgain = history('recovered-once', '2026-09-02T00:00:00.000Z');
		recoveredAgain.events = [{ seq: 1, runId: recoveredAgain.run.id, kind: 'run.recovered-interrupted', fromState: 'working', toState: 'interrupted', payload: { activeDurationMs: 1000 }, createdAt: recoveredAgain.run.createdAt, eventClass: 'decision' }];
		const missing = history('recovered-unknown', '2026-09-03T00:00:00.000Z');
		missing.events = [{ seq: 1, runId: missing.run.id, kind: 'run.recovered-interrupted', fromState: 'working', toState: 'interrupted', payload: { activeDurationMs: 'unknown' }, createdAt: missing.run.createdAt, eventClass: 'decision' }];
		const overview = readProjectHistoricalOverview(project('one'), 'all', new Date('2026-09-04T00:00:00.000Z'), () => [recovered, recoveredAgain, missing], {}, null).overview;
		expect(overview?.autonomyEvidence?.comparables.activeRecoveryDuration).toEqual({ median: 2000, p90: 3000, max: 3000, known: 2, denominator: 3 });
	});
});

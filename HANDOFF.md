# Gateship current checkpoint

> Updated: 2026-09-15, against the `v0.510.0` tag plus PRs #745 to #750.
> Source metadata remains `0.0.0-dev` by design; release builds receive their
> version and source revision at build time.

## Product objective

Gateship lets one operator discuss, approve, and deliver well-specified
software changes with as little attention as correctness allows. Autonomy is
useful only when it reduces operator attention or observed failures.

## Present architecture

Gateship is one Bun web service, distributed as native binaries and one
container image. It serves a React/Vite-built UI, stores durable run state and
events in SQLite, and supervises subscription-authenticated Claude Code or
Codex CLI children through provider adapters. Authentication stays
credential-blind: no provider or GitHub token reaches the UI or SQLite.

O agente conversacional externo escolhido pelo operador é a interface
primária. Ele pode investigar o projeto, refinar a intenção e invocar comandos
Gateship tipados. Gateship é o control plane persistente e determinístico,
acessível por agent CLI, MCP ou HTTP tipado, sem backend conversacional próprio.
O project brief é o único handoff durável entre sessões externas. O runtime
determinístico detém mutações, estado da run, verificação, review, shipping e
cleanup.

Approved runs start from a fresh `origin/main` worktree without moving local
`main`, execute the task's explicit verification, receive an independent
mechanically read-only review, and ship through a squash-merged pull request.
Clean merged workspaces are released; dirty, failed, or uncertain leftovers
are preserved and surfaced. There is one active run per project: work is
serialized within a repository and may run in parallel only across independent
projects.

There is no tmux path, terminal UI, sidecar, second daemon, message broker,
separate database service, or conversational backend. The container is the
isolation boundary; provider and GitHub authentication happens inside it and
persists on the single state volume.

The multiproject control center is organized as Agora at `/overview`,
Execuções at `/overview/runs`, Filas at `/overview/queues`, and Insights at
`/overview/insights`. `/projects` is project management; project context lives
at `/projects/:projectId/{runs,work,settings}` and global configuration at
`/settings`. Project selection persists when the operator visits the Control
center and remains navigation context rather than an implicit API scope.

## Current evidence

By `v0.510.0`, Gateship has delivered the Spec v2 contract with a conditional
research contract and receipts (GSHIP-831 to 842); the executor escalation
contract; focused verification separated from the full verify; per-phase run
duration and factual consumption cohorts in Insights; the control center on a
shadcn base with Gateship identity and TanStack tables for Execuções, Agora,
Filas and Análises (GSHIP-851 to 859); the semantic run timeline with cursor
pagination; queue dependencies with explicit execution order (GSHIP-875);
automatic provider CLI updates through Renovate; and CI and release hardening
(GSHIP-866, 877 to 880).

The autonomy seam is partly delivered: verifiable contract and context in every
cycle (GSHIP-869), technical progress distinguished from repeated questions
(GSHIP-870), a persisted shared recovery budget per run (GSHIP-871), recovery
evaluation and human-attention provenance (GSHIP-873), retry bounded per
failure after a correction (GSHIP-881, 882), final CI result recorded on merge
with reconciliation of older runs (GSHIP-883), and same-run recovery of a
confirmed merge conflict with fresh verification (GSHIP-884, PR #745). The
activation of the policy before notifying the operator (GSHIP-864) and its
post-activation validation (GSHIP-874) remain in the approved queue.

Operational state on 2026-09-14: the Codex subscription is exhausted until
2026-09-19. The gateship project runs on Claude Code with `claude-sonnet-5`
(high) as executor and `claude-opus-5` (high) as orchestrator and reviewer;
`chain-runs` and `executor-handoff` are enabled for the project. The executor
and the reviewer hand off to the alternate provider on a usage limit, but the
cycle-question resolver does not (GSHIP-892, unapproved proposal), so a run
born on Codex needs `runs.respond` with the review findings as operator
guidance at every review with findings. Runs created before GSHIP-871 carry no
recovery policy; the 884 run took 14 review rounds and 4 fix rounds under manual
guidance before shipping.

Review statistics over 286 completed runs: 226 runs closed with no review
finding, mean 1.1 findings per run, median 1 review, p90 7 reviews, 10 runs at
10 or more findings, all of them in runtime and shipper state-machine work. The
`maxRecoveryDispatches=10` chosen for GSHIP-864 cuts exactly that tail.

The explicit versioned multistack contract lives in `.gateship/project.json`.
Project-defined commands run with the shared minimum child-environment
allowlist rather than the service's ambient environment. Provider, GitHub CLI,
update, and notification environments remain independently owned.

The control plane reports independent operational metrics and evidence types;
it does not collapse them into a composite score. Autonomous adaptation must
preserve the approved objective, behavior, risk and verification. A change to
any of those dimensions returns to the operator as a proposal.

Use the tag, commit graph, and the running service's `/api/snapshot` as factual
evidence for an installed version. Git history and GitHub Releases own older
release and decision detail; this checkpoint is not a changelog and does not
duplicate issue-by-issue history.

## Governing decisions

- Prefer deletion or a small root-cause repair over a policy layer,
  compatibility path, daemon, or speculative abstraction.
- The operator-approved specification is the execution contract. Approval
  covers scope and every evidence or verification command.
- Run state, admission, verification, review, shipping, and cleanup remain
  deterministic runtime responsibilities.
- Keep provider authentication credential-blind and subscription-backed. Do
  not add provider or GitHub token fields to the UI or SQLite.
- Keep implementer work isolated to its assigned worktree and keep each fresh
  review session mechanically read-only.
- Keep same-project runs serial. Parallelism belongs only across independent
  projects.
- Keep the control center focused on project state, executions, queues and
  independent insights. Do not add a global agent page, generic memory,
  generic Kanban, primary event explorer or AI-decided merge.
- Keep one specification and approval contract whose depth scales with delivery
  risk. Shipped AI behavior, sensitive data, security boundaries, or
  irreversible effects require proportionate evaluation cases, limits,
  observable success, containment or rollback, and stronger evidence.
- Type evidence by origin: deterministic check, human judgment, or model
  evaluation. Preserve provenance and review; never collapse the signals into
  one composite score.
- Diagnostics, cohort observations, and derived ideas remain advisory. They
  may create reviewable proposals but never approve, start, fix, or block work.
- Run focused checks while editing. The project `verify` spine runs once at the
  ship boundary rather than inside every implementation loop.
- Let production evidence drive priorities: real usage, provider failures,
  latency, known cost, operator attention, and regressions.

## Approval boundary

This file records current direction; it grants no execution authority. Only an
operator-approved issue specification authorizes a bounded change. Discoveries
outside that scope return as proposals, and unresolved product judgment returns
to the operator. Publishing, merging, changing lifecycle state, or starting a
different roadmap stage requires its own authorization.

## Next ordered seams

The approved queue was drained on 2026-09-15: GSHIP-884, 888, 889, 890, 891
and 872 shipped through PRs #745 to #750 under `chain-runs`, all on Claude
Code. The chain is paused on `no-admissible-issue`. GSHIP-864 and GSHIP-874
are specified but need re-approval: on 2026-09-14 both gained a convergence
diagnosis (findings per round over the last rounds, and whether the last fix
produced a new finding) at the recovery limit and in the post-activation
report.

Observed during the drain: the chain reconciler reads the operator's local
checkout, which is deliberately behind `origin/main`, and returned `material`
once and `clarified` twice for the same limitation (GSHIP-898); the direct
`gh pr merge` raced the armed auto-merge on three of six ships and left the run
in `ready-to-ship` until a manual `runs.ship` (GSHIP-899); four of six runs
passed verify and review and failed the full verify only on biome complexity
(GSHIP-900).

Unapproved proposals filed on 2026-09-14 and 2026-09-15: GSHIP-892
(cycle-question provider fallback), 893 (mutation sensor as deterministic
evidence in full verify), 894 (per-acceptance verdict with file:line evidence
in review), 895 (deterministic test-integrity guard in verify), 896
(implicit-requirement sweep in the agent guide), 897 (Host validation, security
headers and body limit on the local web service), 898 (chain reconciliation in
a fresh `origin/main` worktree), 899 (re-read the PR after a failed direct
merge) and 900 (per-round lint command declared by the project). They approve
nothing by themselves.

## Product radar

Comparable projects and tools, adopted and rejected decisions, and items held
pending evidence live in `docs/product-radar.md`. The radar is conditional on
evidence, approves nothing, and is never execution authorization.

The radar records Warren only as a reference for operational density and Aperant
only as a reference for onboarding and distribution. Third-party names do not
enter the interface or catalogs.

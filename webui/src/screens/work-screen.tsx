// webui/src/screens/work-screen.tsx

import React, { useMemo, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import type { DiagnosticFindingView, DiagnosticsView, IssueReviewDraft } from '../client.ts';
import type { BadgeVariant } from '../components/ui/badge.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardAction, CardDescription, CardDisclosure, CardFooter, CardHeader, CardPanel, CardSummary, CardTitle } from '../components/ui/card.tsx';
import { FormField, FormStack } from '../components/ui/card-layout.tsx';
import { DataTable, DataTableFilter, DataTablePagination, DataTableToolbar, gateshipTableFeatures, useClientPage, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { Input } from '../components/ui/input.tsx';
import { SelectField } from '../components/ui/select.tsx';
import { Tabs, TabsCount, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { cn } from '../lib/cn.ts';
import type { Locale, WorkCatalog } from '../locale.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import { OperationalReadPanel } from '../operational-unavailable.tsx';
import { actionsFor, activeRunIssueId } from '../run-view.ts';
import { ActionButton, BUTTON_CLASS, ContextPanel, PRIMARY_BUTTON_CLASS } from './operator-controls.tsx';
import { fieldReader, formatCount } from './runs.tsx';
import { draftChanged } from './runs-screen.tsx';
import { SurfaceColumn } from './surface-column.tsx';

function parseLines(value: string, optional = false): string[] {
	if (optional && value.trim() === '') return [];
	return value.split('\n').map((item) => item.trim());
}

export function BacklogPanel({
	backlog,
	catalog,
	locale,
	selectedIssueId,
	canStart,
	onSelectIssue,
	onStart,
}: Pick<AppProps, 'backlog' | 'selectedIssueId' | 'onSelectIssue' | 'onStart'> & {
	canStart: boolean;
	catalog: WorkCatalog['backlog'];
	locale: Locale;
}): React.ReactElement {
	if (backlog.length === 0) {
		return (
			<Card data-state="empty">
				<CardHeader>
					<CardTitle>{catalog.title}</CardTitle>
					<CardDescription>{catalog.description(0, formatCount(0, locale))}</CardDescription>
				</CardHeader>
			</Card>
		);
	}
	return (
		<ContextPanel
			description={catalog.description(backlog.length, formatCount(backlog.length, locale))}
			open
			title={catalog.title}
		>
			<div className="flex flex-col gap-3">
				<ul className="flex flex-col gap-1">
					{backlog.map((issue) => (
						<li key={issue.id}>
							<button
								aria-pressed={issue.id === selectedIssueId}
								className={cn(
									'flex w-full items-baseline gap-3 break-words rounded-lg border border-transparent px-3 py-2 text-left text-sm outline-none',
									'focus-visible:ring-2 focus-visible:ring-ring',
									issue.id === selectedIssueId
										? 'border-border bg-secondary text-foreground'
										: 'hover:bg-muted',
								)}
								onClick={() => onSelectIssue(issue.id)}
								type="button"
							>
								<span className="shrink-0 font-mono text-muted-foreground text-xs">{issue.id}</span>
								<span className="min-w-0 font-medium">{issue.title}</span>
							</button>
						</li>
					))}
				</ul>
				<CardFooter>
					<Button disabled={!canStart} onClick={onStart} type="button">
						{catalog.start}
					</Button>
				</CardFooter>
			</div>
		</ContextPanel>
	);
}

export function IssueIntakePanel({
	catalog,
	pending,
	onCreateIssue,
}: Pick<AppProps, 'pending' | 'onCreateIssue'> & { catalog: WorkCatalog }): React.ReactElement {
	return (
		<ContextPanel
			description={catalog.intake.description}
			title={catalog.intake.title}
		>
			<FormStack
				onSubmit={(event) => {
					event.preventDefault();
					const value = fieldReader(event.currentTarget);
					onCreateIssue({
						title: value('title'),
						objective: value('objective'),
						acceptance: parseLines(value('acceptance')),
						boundaries: parseLines(value('boundaries'), true),
						verify: parseLines(value('verify')),
					});
				}}
			>
				<FormField htmlFor="issue-title">
					<span className="font-medium">{catalog.form.title}</span>
					<Input id="issue-title" name="title" required />
				</FormField>
				<FormField htmlFor="issue-objective">
					<span className="font-medium">{catalog.form.objective}</span>
					<Textarea className="min-h-24" id="issue-objective" name="objective" required />
				</FormField>
				<input aria-hidden="true" name="scope" type="hidden" />
				<input aria-hidden="true" name="verificationCommand" type="hidden" />
				<FormField htmlFor="issue-acceptance">
					<span className="font-medium">{catalog.form.acceptance}</span>
					<Textarea className="min-h-24" id="issue-acceptance" name="acceptance" required />
				</FormField>
				<FormField htmlFor="issue-boundaries">
					<span className="font-medium">{catalog.form.boundaries}</span>
					<Textarea className="min-h-20" id="issue-boundaries" name="boundaries" />
				</FormField>
				<FormField htmlFor="issue-verify">
					<span className="font-medium">{catalog.form.verify}</span>
					<Textarea className="min-h-20" mono id="issue-verify" name="verify" placeholder={catalog.form.verificationPlaceholder} required />
				</FormField>
				<CardFooter>
					<button className={PRIMARY_BUTTON_CLASS} disabled={pending} type="submit">
					{catalog.intake.create}
				</button>
				</CardFooter>
			</FormStack>
		</ContextPanel>
	);
}

export function IssueSpecifyPanel({
	catalog,
	ideas,
	pending,
	onSpecifyIssue,
}: Pick<AppProps, 'ideas' | 'pending' | 'onSpecifyIssue'> & { catalog: WorkCatalog }): React.ReactElement | null {
	if (ideas.length === 0) return null;
	return (
		<ContextPanel
			description={catalog.specification.description}
			title={catalog.specification.title}
		>
			<FormStack
				onSubmit={(event) => {
					event.preventDefault();
					const value = fieldReader(event.currentTarget);
					onSpecifyIssue(value('ideaId'), {
						objective: value('ideaObjective'),
						acceptance: parseLines(value('ideaAcceptance')),
						boundaries: parseLines(value('ideaBoundaries'), true),
						verify: parseLines(value('ideaVerify')),
					});
				}}
			>
				<FormField htmlFor="idea-id">
					<span className="font-medium">{catalog.specification.idea}</span>
					<SelectField
						defaultValue={ideas[0]?.id}
						id="idea-id"
						items={ideas.map((idea) => ({ value: idea.id, label: `${idea.id} — ${idea.title}` }))}
						name="ideaId"
						required
					/>
				</FormField>
				<FormField htmlFor="idea-objective">
					<span className="font-medium">{catalog.form.objective}</span>
					<Textarea className="min-h-24" id="idea-objective" name="ideaObjective" required />
				</FormField>
				<input aria-hidden="true" name="ideaScope" type="hidden" />
				<input aria-hidden="true" name="ideaVerificationCommand" type="hidden" />
				<FormField htmlFor="idea-acceptance">
					<span className="font-medium">{catalog.form.acceptance}</span>
					<Textarea className="min-h-24" id="idea-acceptance" name="ideaAcceptance" required />
				</FormField>
				<FormField htmlFor="idea-boundaries">
					<span className="font-medium">{catalog.form.boundaries}</span>
					<Textarea className="min-h-20" id="idea-boundaries" name="ideaBoundaries" />
				</FormField>
				<FormField htmlFor="idea-verify">
					<span className="font-medium">{catalog.form.verify}</span>
					<Textarea className="min-h-20" mono id="idea-verify" name="ideaVerify" placeholder={catalog.form.verificationPlaceholder} required />
				</FormField>
				<CardFooter>
					<button className={PRIMARY_BUTTON_CLASS} disabled={pending} type="submit">
					{catalog.specification.submit}
				</button>
				</CardFooter>
			</FormStack>
		</ContextPanel>
	);
}

type ReviewValues = { objective: string; acceptance: string[]; boundaries: string[]; verify: string[] };

function reviewInitialValues(draft: IssueReviewDraft): ReviewValues {
	return {
		objective: draft.objective ?? draft.scope ?? '',
		acceptance: draft.acceptance ?? [],
		boundaries: draft.boundaries ?? [],
		verify: draft.verify ?? (draft.verificationCommand === undefined ? [] : [draft.verificationCommand]),
	};
}

function reviewDraftIsDirty(draft: IssueReviewDraft, initial: ReviewValues, objective: string, acceptance: string[], boundaries: string[], verify: string[]): boolean {
	return draft.objective === undefined || draft.acceptance === undefined || draftChanged(
		{ ...draft, ...initial }, objective, acceptance, boundaries, verify,
	);
}

function reviewPayload(values: ReviewValues & { evidence?: IssueReviewDraft['evidence'] }): Parameters<AppProps['onReviewIssue']>[1] {
	return {
		objective: values.objective.trim(),
		acceptance: values.acceptance.map((item) => item.trim()),
		boundaries: values.boundaries.map((item) => item.trim()),
		verify: values.verify.map((item) => item.trim()),
		evidence: values.evidence,
	};
}

function SpecFields({ catalog, values, setters }: { catalog: WorkCatalog; values: ReviewValues; setters: { setObjective: React.Dispatch<React.SetStateAction<string>>; setAcceptance: React.Dispatch<React.SetStateAction<string[]>>; setBoundaries: React.Dispatch<React.SetStateAction<string[]>>; setVerify: React.Dispatch<React.SetStateAction<string[]>> } }): React.ReactElement {
	return <>
		<FormField htmlFor="review-objective">
			<span className="font-medium">{catalog.form.objective}</span><span className="sr-only">Scope and expected outcome Escopo e resultado esperado</span>
			<Textarea className="min-h-24" id="review-objective" onChange={(event) => setters.setObjective((event.currentTarget as unknown as { value: string }).value)} required value={values.objective} />
		</FormField>
		<FormField htmlFor="review-acceptance">
			<span className="font-medium">{catalog.form.acceptance}</span>
			<Textarea className="min-h-24" id="review-acceptance" onChange={(event) => setters.setAcceptance((event.currentTarget as unknown as { value: string }).value.split('\n'))} required value={values.acceptance.join('\n')} />
		</FormField>
		<FormField htmlFor="review-boundaries">
			<span className="font-medium">{catalog.form.boundaries}</span>
			<Textarea className="min-h-20" id="review-boundaries" onChange={(event) => setters.setBoundaries((event.currentTarget as unknown as { value: string }).value.split('\n'))} value={values.boundaries.join('\n')} />
		</FormField>
		<FormField htmlFor="review-verify">
			<span className="font-medium">{catalog.form.verify}</span><span className="sr-only">Verification command Comando de verificação</span>
			<Textarea className="min-h-20" mono id="review-verify" onChange={(event) => setters.setVerify((event.currentTarget as unknown as { value: string }).value.split('\n'))} required value={values.verify.join('\n')} />
		</FormField>
	</>;
}

function EvidencePanel({ catalog, evidence }: { catalog: WorkCatalog; evidence: IssueReviewDraft['evidence'] }): React.ReactElement | null {
	if (evidence === undefined || evidence.length === 0) return null;
	return <div className="flex flex-col gap-2 text-sm">
		<span className="font-medium">{catalog.review.evidence}</span>
		<ul className="flex flex-col gap-2">
			{evidence.map((item, index) => <li className="flex flex-col gap-1" key={index}>
				<code className="break-all text-xs">{item.command}</code>
				<p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{item.output}</p>
			</li>)}
		</ul>
	</div>;
}

/**
 * The three list fields both records carry, named once: the form edits them as
 * text, the read-only panel prints them, and neither spells the names twice.
 */

export function IssueReviewForm({
	catalog,
	draft,
	pending,
	onReviewIssue,
	onApproveIssue,
	onAbandonIssue,
}: Pick<AppProps, 'pending' | 'onReviewIssue' | 'onApproveIssue' | 'onAbandonIssue'> & {
	catalog: WorkCatalog;
	draft: IssueReviewDraft;
}): React.ReactElement {
	const initial = reviewInitialValues(draft);
	const [objective, setObjective] = useState(initial.objective);
	const [acceptance, setAcceptance] = useState(initial.acceptance);
	const [boundaries, setBoundaries] = useState(initial.boundaries);
	const [verify, setVerify] = useState(initial.verify);
	const [confirmed, setConfirmed] = useState(false);
	const [abandonReason, setAbandonReason] = useState('');
	const [abandonConfirmed, setAbandonConfirmed] = useState(false);
	const values = { objective, acceptance, boundaries, verify };
	const setters = { setObjective, setAcceptance, setBoundaries, setVerify };

	const dirty = reviewDraftIsDirty(draft, initial, objective, acceptance, boundaries, verify);

	return (
		<FormStack
			onSubmit={(event) => {
				event.preventDefault();
				setConfirmed(false);
				onReviewIssue(draft.id, reviewPayload({ objective, acceptance, boundaries, verify, evidence: draft.evidence }));
			}}
		>
			<div><Badge variant={draft.state === 'approved' ? 'success' : draft.state === 'stale' ? 'warning' : 'outline'}>{catalog.review.stateLabels[draft.state]}</Badge></div>
			<SpecFields catalog={catalog} setters={setters} values={values} />
			<EvidencePanel catalog={catalog} evidence={draft.evidence} />
			<label className="flex items-start gap-2 text-sm">
				<input checked={confirmed} disabled={pending || dirty} onChange={(event) => setConfirmed((event.currentTarget as unknown as { checked: boolean }).checked)} type="checkbox" />
				<span>{catalog.review.confirmPersisted}</span>
			</label>
			<FormField htmlFor="abandon-reason">
				<span className="font-medium">{catalog.review.abandonReason}</span>
				<Textarea className="min-h-20" id="abandon-reason" onChange={(event) => setAbandonReason((event.currentTarget as unknown as { value: string }).value)} value={abandonReason} />
			</FormField>
			<label className="flex items-start gap-2 text-sm">
				<input checked={abandonConfirmed} disabled={pending || abandonReason.trim().length === 0} onChange={(event) => setAbandonConfirmed((event.currentTarget as unknown as { checked: boolean }).checked)} type="checkbox" />
				<span>{catalog.review.confirmAbandon(draft.id)}</span>
			</label>
			<CardFooter>
				<button className={BUTTON_CLASS} disabled={pending || !dirty} type="submit">{catalog.review.saveRevision}</button>
				<button
					className={PRIMARY_BUTTON_CLASS}
					disabled={pending || dirty || !confirmed}
					onClick={() => { setConfirmed(false); onApproveIssue(draft.id); }}
					type="button"
				>{catalog.review.approve}</button>
				<button
					className={BUTTON_CLASS}
					disabled={pending || abandonReason.trim().length === 0 || !abandonConfirmed}
					onClick={() => {
						setAbandonConfirmed(false);
						onAbandonIssue(draft.id, abandonReason.trim());
					}}
					type="button"
				>{catalog.review.abandon}</button>
			</CardFooter>
		</FormStack>
	);
}

export function IssueReviewPanel({
	catalog,
	drafts,
	locale,
	pending,
	runs,
	onReviewIssue,
	onApproveIssue,
	onAbandonIssue,
}: Pick<
	AppProps,
	'drafts' | 'locale' | 'pending' | 'runs' | 'onReviewIssue' | 'onApproveIssue' | 'onAbandonIssue'
> & { catalog: WorkCatalog }): React.ReactElement {
	const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);
	const selected = drafts.find((draft) => draft.id === selectedId) ?? null;
	// The run owns the issue file while it is in flight: revising, approving or
	// abandoning it would write on main what the ship closes on the run's branch.
	const ownedByRun = selected !== null && activeRunIssueId(runs) === selected.id;

	return (
		<CardDisclosure>
			<CardSummary>
				<CardTitle>{catalog.review.title}</CardTitle>
				<CardDescription>{catalog.review.description(drafts.length, formatCount(drafts.length, locale))}</CardDescription>
				<CardAction><Badge variant="secondary">{formatCount(drafts.length, locale)}</Badge></CardAction>
			</CardSummary>
			<CardPanel>
				<label className="flex flex-col gap-1 text-sm" htmlFor="review-issue">
					<span className="font-medium">{catalog.review.draft}</span>
					<SelectField
						id="review-issue"
						items={[
							{ value: '', label: catalog.review.selectDraft },
							...drafts.map((draft) => ({ value: draft.id, label: `${draft.id} — ${draft.title}` })),
						]}
						onValueChange={(value) => setSelectedId(value === '' ? null : value)}
						value={selectedId ?? ''}
					/>
				</label>
				{selected === null || !ownedByRun ? null : (
					<p className="text-muted-foreground text-sm">
						{catalog.review.ownedByRun(selected.id)}
					</p>
				)}
				{selected === null || ownedByRun ? null : (
					<IssueReviewForm
						catalog={catalog}
						draft={selected}
						key={JSON.stringify([selected.id, selected.objective, selected.acceptance, selected.boundaries, selected.verify])}
						onAbandonIssue={onAbandonIssue}
						onApproveIssue={onApproveIssue}
						onReviewIssue={onReviewIssue}
						pending={pending}
					/>
				)}
			</CardPanel>
		</CardDisclosure>
	);
}

export function diagnosticFindingLocation(finding: DiagnosticFindingView): string {
	if (finding.line === undefined) return finding.file;
	return `${finding.file}:${finding.line}${finding.column === undefined ? '' : `:${finding.column}`}`;
}

export function diagnosticSeverityVariant(severity: DiagnosticFindingView['severity']): BadgeVariant {
	if (severity === 'error') return 'error';
	if (severity === 'warning') return 'warning';
	return 'info';
}

export function diagnosticScanVariant(
	state: NonNullable<DiagnosticsView['scan']>['state'],
): BadgeVariant {
	if (state === 'completed') return 'success';
	if (state === 'failed') return 'error';
	if (state === 'queued' || state === 'running') return 'info';
	return 'secondary';
}

export function DiagnosticScanSummary({
	catalog,
	scan,
}: Pick<DiagnosticsView, 'scan'> & { catalog: WorkCatalog['diagnostics'] }): React.ReactElement | null {
	if (scan === null) return null;
	return (
		<div className="flex flex-col gap-1 text-sm">
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={diagnosticScanVariant(scan.state)}>{catalog.scanStateLabels[scan.state]}</Badge>
				{scan.sourceSha === null ? null : <code className="text-xs">{scan.sourceSha.slice(0, 12)}</code>}
				{scan.state === 'completed' && !scan.coverageComplete ? <Badge variant="warning">{catalog.partial}</Badge> : null}
			</div>
			{scan.error === null ? null : <p className="text-destructive-foreground">{scan.error}</p>}
		</div>
	);
}

function DiagnosticsFooter({
	active,
	analyzer,
	pending,
	scan,
	catalog,
	onStartDiagnostic,
	onCancelDiagnostic,
}: {
	active: boolean;
	analyzer: DiagnosticsView['analyzers'][number] | undefined;
	pending: boolean;
	scan: DiagnosticsView['scan'];
	catalog: WorkCatalog['diagnostics'];
	onStartDiagnostic: AppProps['onStartDiagnostic'];
	onCancelDiagnostic: AppProps['onCancelDiagnostic'];
}): React.ReactElement | null {
	if (!active && analyzer === undefined) return null;
	return (
		<CardFooter>
			{!active && analyzer !== undefined ? (
				<ActionButton enabled={!pending} label={catalog.runNow} onClick={() => onStartDiagnostic(analyzer.id)} />
			) : null}
			{active && scan !== null ? (
				<ActionButton enabled={!pending} label={catalog.cancel} onClick={() => onCancelDiagnostic(scan.id)} />
			) : null}
		</CardFooter>
	);
}

type PromoteInput = Parameters<AppProps['onPromoteProposal']>[1];

/*
 * The contract a suggestion turns into. A proposal and a diagnostic finding are
 * promoted the same way, so they share the form; `prefix` keeps each one's
 * field names. It exists only while its row is open: eighty of these mounted
 * behind a closed tab was hundreds of fields nobody was filling.
 */
function PromoteForm({ catalog, prefix, defaultTitle, pending, onPromote }: { catalog: WorkCatalog; prefix: 'proposal' | 'diagnostic'; defaultTitle: string; pending: boolean; onPromote: (input: PromoteInput) => void }): React.ReactElement {
	return (
		<FormStack
			onSubmit={(event) => {
				event.preventDefault();
				const value = fieldReader(event.currentTarget);
				onPromote({
					title: value(`${prefix}Title`),
					objective: value(`${prefix}Objective`),
					acceptance: parseLines(value(`${prefix}Acceptance`)),
					boundaries: parseLines(value(`${prefix}Boundaries`), true),
					verify: [value(`${prefix}VerificationCommand`)],
				});
			}}
		>
			<FormField><span className="font-medium">{catalog.form.title}</span><Input defaultValue={defaultTitle} name={`${prefix}Title`} required /></FormField>
			<FormField><span className="font-medium">{catalog.form.objective}</span><Textarea className="min-h-24" name={`${prefix}Objective`} required /></FormField>
			<FormField><span className="font-medium">{catalog.form.acceptance}</span><Textarea className="min-h-24" name={`${prefix}Acceptance`} required /></FormField>
			<FormField><span className="font-medium">{catalog.form.boundaries}</span><Textarea className="min-h-20" name={`${prefix}Boundaries`} /></FormField>
			<FormField><span className="font-medium">{catalog.form.verify}</span><Input mono name={`${prefix}VerificationCommand`} placeholder={catalog.form.verificationPlaceholder} required /></FormField>
			<button className={cn(PRIMARY_BUTTON_CLASS, 'self-end')} disabled={pending} type="submit">{catalog.form.promote}</button>
		</FormStack>
	);
}

/** What a row opens into: the evidence as captured, then whatever the row still admits. */
function SuggestionDetail({ evidence, meta, children }: { evidence: string; meta?: React.ReactNode; children?: React.ReactNode }): React.ReactElement {
	return (
		<div className="flex max-w-3xl flex-col gap-4 text-sm" data-slot="suggestion-detail">
			<p className="whitespace-pre-wrap break-words text-muted-foreground">{evidence}</p>
			{meta}
			{children}
		</div>
	);
}

type SuggestionView = 'pending' | 'resolved';
function SuggestionViews({ label, value, onChange, pending, resolved }: { label: string; value: SuggestionView; onChange: (value: SuggestionView) => void; pending: string; resolved: string }): React.ReactElement {
	return (
		<ToggleGroup aria-label={label} spacing={1} value={[value]} variant="outline" onValueChange={(next) => { if (next[0] !== undefined) onChange(next[0] as SuggestionView); }}>
			<ToggleGroupItem aria-label={pending} value="pending">{pending}</ToggleGroupItem>
			<ToggleGroupItem aria-label={resolved} value="resolved">{resolved}</ToggleGroupItem>
		</ToggleGroup>
	);
}

const findingMatches = (finding: DiagnosticFindingView, needle: string): boolean => `${finding.rule} ${finding.file} ${finding.evidence} ${finding.promotedIssueId ?? ''}`.toLocaleLowerCase().includes(needle);

/** Findings as the product's table: severity, rule, where, how often. Evidence and promotion open under the row. */
function DiagnosticFindingsTable({ catalog, diagnostics, locale, pending, onDismiss, onPromote, defaultView = 'pending', defaultOpenId }: {
	catalog: WorkCatalog; diagnostics: DiagnosticsView; locale: Locale; pending: boolean; defaultView?: SuggestionView; defaultOpenId?: string;
	onDismiss: AppProps['onDismissDiagnosticFinding']; onPromote: AppProps['onPromoteDiagnosticFinding'];
}): React.ReactElement {
	const [view, setView] = useState<SuggestionView>(defaultView);
	const rows = view === 'pending' ? diagnostics.findings : diagnostics.resolvedFindings;
	const list = useClientPage(rows, findingMatches);
	const columns = useMemo<GateshipColumnDef<DiagnosticFindingView>[]>(() => {
		const defs: GateshipColumnDef<DiagnosticFindingView>[] = [
			{ id: 'severity', header: catalog.list.columns.severity, cell: ({ row }) => <Badge variant={diagnosticSeverityVariant(row.original.severity)}>{catalog.diagnostics.severityLabels[row.original.severity]}</Badge> },
			{ id: 'rule', header: catalog.list.columns.rule, meta: { className: 'max-w-64 whitespace-normal break-words font-medium' }, cell: ({ row }) => row.original.rule },
			{ id: 'location', header: catalog.list.columns.location, meta: { className: 'type-data max-w-80 truncate text-muted-foreground text-xs', hideBelow: 'md' }, cell: ({ row }) => diagnosticFindingLocation(row.original) },
			{ id: 'occurrences', header: catalog.list.columns.occurrences, meta: { align: 'end', className: 'type-data', hideBelow: 'sm' }, cell: ({ row }) => formatCount(row.original.occurrenceCount, locale) },
			...(view === 'pending'
				? [{ id: 'actions', header: () => <span className="sr-only">{catalog.list.columns.actions}</span>, meta: { align: 'end' as const, label: catalog.list.columns.actions }, cell: ({ row }: { row: { original: DiagnosticFindingView } }) => <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={() => onDismiss(row.original.id)}>{catalog.diagnostics.dismiss}</Button> }]
				: [{ id: 'status', header: catalog.list.columns.status, cell: ({ row }: { row: { original: DiagnosticFindingView } }) => <span className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{catalog.diagnostics.statusLabels[row.original.status]}</Badge>{row.original.promotedIssueId === null ? null : <Badge variant="info">{row.original.promotedIssueId}</Badge>}</span> }]),
		];
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, locale, onDismiss, pending, view]);
	const table = useGateshipTable({ columns, data: list.page, features: gateshipTableFeatures, getRowId: (finding) => finding.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: list.total, state: { globalFilter: list.search, pagination: { pageIndex: Math.floor(list.offset / list.limit), pageSize: list.limit } }, onGlobalFilterChange: (value) => list.setSearch(String(value ?? '')) });
	return (
		<>
			<DataTableToolbar>
				<SuggestionViews label={catalog.list.views} pending={catalog.list.pendingFindings(formatCount(diagnostics.findings.length, locale))} resolved={catalog.list.resolvedFindings(formatCount(diagnostics.resolvedFindings.length, locale))} value={view} onChange={(next) => { setView(next); list.setOffset(0); }} />
				<DataTableFilter className="sm:max-w-64" locale={locale} placeholder={catalog.list.searchFindings} table={table} />
			</DataTableToolbar>
			<DataTable
				emptyDetail={list.search === '' ? '' : undefined}
				defaultExpanded={defaultOpenId === undefined ? undefined : [defaultOpenId]}
				emptyState={list.search !== '' ? undefined : view === 'pending' ? catalog.diagnostics.noPending : catalog.diagnostics.noResolved}
				locale={locale}
				renderExpanded={(finding) => (
					<SuggestionDetail evidence={finding.evidence} meta={<p className="type-data flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs"><code className="break-all">{diagnosticFindingLocation(finding)}</code><span>{catalog.diagnostics.toolVersion(finding.toolVersion)}</span><code>{finding.sourceSha.slice(0, 12)}</code></p>}>
						{finding.status === 'pending' ? <PromoteForm catalog={catalog} defaultTitle={catalog.diagnostics.defaultIssueTitle(finding.rule, finding.file).slice(0, 120)} pending={pending} prefix="diagnostic" onPromote={(input) => onPromote(finding.id, input)} /> : null}
					</SuggestionDetail>
				)}
				table={table}
			/>
			<DataTablePagination locale={locale} offset={list.offset} total={list.total} onOffsetChange={list.setOffset} onPageSizeChange={list.setLimit} table={table} />
			{view === 'resolved' && diagnostics.resolvedFindingsOmittedCount > 0 ? <p className="text-muted-foreground text-sm">{catalog.diagnostics.omitted(formatCount(diagnostics.resolvedFindingsOmittedCount, locale))}</p> : null}
		</>
	);
}

export function DiagnosticOutcomeSummary({
	catalog,
	locale,
	stats,
}: Pick<DiagnosticsView, 'stats'> & { catalog: WorkCatalog['diagnostics']; locale: Locale }): React.ReactElement {
	if (stats.total === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				{catalog.noHistory}
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-1 text-sm">
			<p>
				{catalog.history(
					formatCount(stats.promoted, locale),
					formatCount(stats.dismissed, locale),
					formatCount(stats.cleared, locale),
					formatCount(stats.pending, locale),
				)}
			</p>
			{stats.recurring === 0 ? null : (
				<p className="text-muted-foreground">{catalog.recurring(stats.recurring, formatCount(stats.recurring, locale))}</p>
			)}
			<p className="text-muted-foreground text-xs">
				{catalog.dismissalDisclaimer}
			</p>
		</div>
	);
}

/**
 * One optional, advisory analyzer at a time, on a tab of its own: what it is,
 * how its last scan went and what its findings became, then the findings.
 */
export function DiagnosticsPanel({
	catalog,
	diagnostics,
	locale,
	pending,
	onStartDiagnostic,
	onCancelDiagnostic,
	onDismissDiagnosticFinding,
	onPromoteDiagnosticFinding,
	defaultView,
	defaultOpenId,
}: Pick<
	AppProps,
	| 'diagnostics'
	| 'pending'
	| 'onStartDiagnostic'
	| 'onCancelDiagnostic'
	| 'onDismissDiagnosticFinding'
	| 'onPromoteDiagnosticFinding'
	| 'locale'
> & { catalog: WorkCatalog; defaultView?: SuggestionView; defaultOpenId?: string }): React.ReactElement {
	const scan = diagnostics.scan;
	const active = scan?.state === 'queued' || scan?.state === 'running';
	const analyzer = diagnostics.analyzers[0];
	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>{catalog.diagnostics.title}</CardTitle>
					<CardDescription>{active ? catalog.diagnostics.analyzing : catalog.diagnostics.pendingCount(diagnostics.findings.length, formatCount(diagnostics.findings.length, locale))}</CardDescription>
					{active ? <CardAction><Badge variant="info">{catalog.diagnostics.running}</Badge></CardAction> : null}
				</CardHeader>
				<CardPanel>
					<div className="flex flex-col gap-2 text-sm">
						<p className="text-muted-foreground">{catalog.diagnostics.advisory}</p>
						{analyzer === undefined ? null : (
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant="outline">{analyzer.label}</Badge>
								<code className="text-xs">v{analyzer.version}</code>
								<span className="text-muted-foreground">{analyzer.id === 'react' ? catalog.diagnostics.analyzerDescriptions.react : analyzer.description}</span>
							</div>
						)}
					</div>
					<DiagnosticScanSummary catalog={catalog.diagnostics} scan={scan} />
					{diagnostics.workspaceNotices.map((notice) => <p className="text-sm text-warning-foreground" key={notice}>{notice}</p>)}
					<DiagnosticOutcomeSummary catalog={catalog.diagnostics} locale={locale} stats={diagnostics.stats} />
					<DiagnosticsFooter active={active} analyzer={analyzer} catalog={catalog.diagnostics} onCancelDiagnostic={onCancelDiagnostic} onStartDiagnostic={onStartDiagnostic} pending={pending} scan={scan} />
				</CardPanel>
			</Card>
			<DiagnosticFindingsTable catalog={catalog} defaultOpenId={defaultOpenId} defaultView={defaultView} diagnostics={diagnostics} locale={locale} onDismiss={onDismissDiagnosticFinding} onPromote={onPromoteDiagnosticFinding} pending={pending} />
		</>
	);
}

type AnyProposal = AppProps['proposals'][number] & { status?: 'dismissed' | 'promoted'; promotedIssueId?: string | null };
const proposalMatches = (proposal: AnyProposal, needle: string): boolean => `${proposal.title} ${proposal.evidence} ${proposal.sourceIssueId} ${proposal.sourceRunId} ${proposal.promotedIssueId ?? ''}`.toLocaleLowerCase().includes(needle);

/**
 * The inbox of ideas the runs found outside their issue, as the product's
 * table: search it, page it, open one. Pending proposals admit two decisions:
 * discarding writes nothing else; promoting files a new task with the contract
 * the operator authors here, pre-filled with the proposal's own title and
 * never approved or started by this screen. Resolved ones are a read-only
 * record of what each became (GSHIP-643): no undo, no re-promotion.
 */
export function ProposalsPanel({
	catalog,
	locale,
	proposals,
	resolvedProposals,
	resolvedProposalsOmittedCount,
	resolvedUnavailable,
	pending,
	onDismissProposal,
	onPromoteProposal,
	defaultView = 'pending',
	defaultOpenId,
}: Pick<
	AppProps,
	'locale' | 'proposals' | 'resolvedProposals' | 'resolvedProposalsOmittedCount' | 'pending' | 'onDismissProposal' | 'onPromoteProposal'
> & { catalog: WorkCatalog; resolvedUnavailable?: React.ReactNode; defaultView?: SuggestionView; defaultOpenId?: string }): React.ReactElement {
	const [view, setView] = useState<SuggestionView>(defaultView);
	const rows: readonly AnyProposal[] = view === 'pending' ? proposals : resolvedProposals;
	const list = useClientPage(rows, proposalMatches);
	const columns = useMemo<GateshipColumnDef<AnyProposal>[]>(() => {
		const defs: GateshipColumnDef<AnyProposal>[] = [
			{ id: 'title', header: catalog.list.columns.title, meta: { className: 'max-w-xl whitespace-normal break-words font-medium' }, cell: ({ row }) => row.original.title },
			{ id: 'origin', header: catalog.list.columns.origin, meta: { hideBelow: 'sm' }, cell: ({ row }) => <Badge variant="outline">{row.original.sourceIssueId}</Badge> },
			{ id: 'run', header: catalog.list.columns.run, meta: { className: 'type-data text-muted-foreground text-xs', hideBelow: 'md' }, cell: ({ row }) => <span title={row.original.sourceRunId}>{row.original.sourceRunId.slice(0, 8)}</span> },
			...(view === 'pending'
				? [{ id: 'actions', header: () => <span className="sr-only">{catalog.list.columns.actions}</span>, meta: { align: 'end' as const, label: catalog.list.columns.actions }, cell: ({ row }: { row: { original: AnyProposal } }) => <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={() => onDismissProposal(row.original.id)}>{catalog.proposals.dismiss}</Button> }]
				: [{ id: 'status', header: catalog.list.columns.status, cell: ({ row }: { row: { original: AnyProposal } }) => <span className="flex flex-wrap items-center gap-2"><Badge variant={row.original.status === 'promoted' ? 'success' : 'secondary'}>{catalog.proposals.statusLabels[row.original.status ?? 'dismissed']}</Badge>{row.original.status === 'promoted' && row.original.promotedIssueId != null ? <><span className="text-muted-foreground">{catalog.proposals.became}</span><Badge variant="info">{row.original.promotedIssueId}</Badge></> : null}</span> }]),
		];
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, onDismissProposal, pending, view]);
	const table = useGateshipTable({ columns, data: list.page, features: gateshipTableFeatures, getRowId: (proposal) => proposal.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: list.total, state: { globalFilter: list.search, pagination: { pageIndex: Math.floor(list.offset / list.limit), pageSize: list.limit } }, onGlobalFilterChange: (value) => list.setSearch(String(value ?? '')) });
	return (
		<>
			<DataTableToolbar>
				<SuggestionViews label={catalog.list.views} pending={catalog.list.pendingProposals(formatCount(proposals.length, locale))} resolved={catalog.list.resolvedProposals(formatCount(resolvedProposals.length, locale))} value={view} onChange={(next) => { setView(next); list.setOffset(0); }} />
				<DataTableFilter className="sm:max-w-64" locale={locale} placeholder={catalog.list.searchProposals} table={table} />
			</DataTableToolbar>
			{view === 'resolved' ? <p className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm"><Badge variant="outline">{catalog.proposals.readOnly}</Badge>{catalog.proposals.settledNote}</p> : null}
			{view === 'resolved' ? resolvedUnavailable : null}
			<DataTable
				emptyDetail={list.search === '' ? '' : undefined}
				defaultExpanded={defaultOpenId === undefined ? undefined : [defaultOpenId]}
				emptyState={list.search !== '' ? undefined : view === 'pending' ? catalog.proposals.emptyPending : catalog.proposals.emptyResolved}
				locale={locale}
				renderExpanded={(proposal) => (
					<SuggestionDetail evidence={proposal.evidence} meta={<p className="flex flex-wrap items-center gap-2 text-muted-foreground"><Badge variant="outline">{proposal.sourceIssueId}</Badge><code className="type-data break-all text-xs">{proposal.sourceRunId}</code></p>}>
						{view === 'pending' ? <PromoteForm catalog={catalog} defaultTitle={proposal.title} pending={pending} prefix="proposal" onPromote={(input) => onPromoteProposal(proposal.id, input)} /> : null}
					</SuggestionDetail>
				)}
				table={table}
			/>
			<DataTablePagination locale={locale} offset={list.offset} total={list.total} onOffsetChange={list.setOffset} onPageSizeChange={list.setLimit} table={table} />
			{view === 'resolved' && resolvedProposalsOmittedCount > 0 ? <p className="text-muted-foreground text-sm">{catalog.proposals.omitted(resolvedProposalsOmittedCount, formatCount(resolvedProposalsOmittedCount, locale))}</p> : null}
		</>
	);
}

/**
 * Work is four operator questions, one visible at a time (the panels
 * themselves are unchanged from GSHIP-712; only the disclosure is new):
 * what is ready to run (queue), what waits on my approval (the only tab whose
 * count may go acid, because approval is the operator's turn), what is still
 * an idea (specify and intake), and what does the system suggest
 * (diagnostics, boot-runtime-only, and the project-scoped proposal inbox with
 * its resolved history). Panels stay mounted behind their tabs so
 * find-in-page and static rendering keep seeing the whole surface. The
 * surface opens on approval when something actually waits there.
 */
export function WorkSurface(props: AppProps): React.ReactElement {
	const localeCatalog = LOCALE_CATALOG[props.locale];
	const catalog = localeCatalog.work;
	const failed = (resource: keyof NonNullable<typeof props.operationalFailures>): string | undefined => props.operationalFailures?.[resource];
	const loaded = (resource: keyof NonNullable<typeof props.operationalLoaded>): boolean => props.operationalLoaded?.[resource] === true;
	const pending = (resource: keyof NonNullable<typeof props.operationalPending>): boolean => props.operationalPending?.[resource] === true;
	const unavailableInitially = (resource: keyof NonNullable<typeof props.operationalFailures>): boolean =>
		(failed(resource) !== undefined || pending(resource)) && !loaded(resource);
	const runsUnavailableInitially = unavailableInitially('Runs');
	const knownRuns = runsUnavailableInitially ? [] : props.runs;
	const actions = actionsFor(knownRuns[0] ?? null, props.selectedIssueId !== null);
	const runsUnavailable = failed('Runs');
	const reviewActionsDisabled = props.pending || runsUnavailableInitially;
	return (
		<SurfaceColumn label={localeCatalog.shell.routeLabels.work} status={props.status}>
			<Tabs defaultValue={props.drafts.length > 0 ? 'approval' : 'queue'}>
				<TabsList aria-label={localeCatalog.shell.routeLabels.work}>
					<TabsTab value="queue">
						{catalog.tabs.queue}
						<TabsCount>{unavailableInitially('Snapshot') ? '—' : props.backlog.length}</TabsCount>
					</TabsTab>
					<TabsTab value="approval">
						{catalog.tabs.approval}
						<TabsCount attention={!unavailableInitially('Snapshot') && props.drafts.length > 0}>{unavailableInitially('Snapshot') ? '—' : props.drafts.length}</TabsCount>
					</TabsTab>
					<TabsTab value="ideas">
						{catalog.tabs.ideas}
						<TabsCount>{unavailableInitially('Snapshot') ? '—' : props.ideas.length}</TabsCount>
					</TabsTab>
					<TabsTab value="diagnostics">
						{catalog.tabs.diagnostics}
						<TabsCount>{unavailableInitially('Diagnostics') ? '—' : props.diagnostics.findings.length}</TabsCount>
					</TabsTab>
					<TabsTab value="proposals">
						{catalog.tabs.proposals}
						<TabsCount>{unavailableInitially('Proposals') ? '—' : props.proposals.length}</TabsCount>
					</TabsTab>
				</TabsList>
				<TabsPanel value="queue">
					<OperationalReadPanel detail={runsUnavailable} loaded={loaded('Runs')} locale={props.locale} pending={pending('Runs')} resource="Runs"><span /></OperationalReadPanel>
					<OperationalReadPanel detail={failed('Snapshot')} loaded={loaded('Snapshot')} locale={props.locale} pending={pending('Snapshot')} resource="Snapshot"><BacklogPanel
						backlog={props.backlog}
						canStart={actions.start && !reviewActionsDisabled}
						catalog={catalog.backlog}
						locale={props.locale}
						onSelectIssue={props.onSelectIssue}
						onStart={props.onStart}
						selectedIssueId={props.selectedIssueId}
					/></OperationalReadPanel>
				</TabsPanel>
				<TabsPanel value="approval">
					<OperationalReadPanel detail={runsUnavailable} loaded={loaded('Runs')} locale={props.locale} pending={pending('Runs')} resource="Runs"><span /></OperationalReadPanel>
					<OperationalReadPanel detail={failed('Snapshot')} loaded={loaded('Snapshot')} locale={props.locale} pending={pending('Snapshot')} resource="Snapshot"><IssueReviewPanel catalog={catalog} drafts={props.drafts} locale={props.locale} onAbandonIssue={props.onAbandonIssue} onApproveIssue={props.onApproveIssue} onReviewIssue={props.onReviewIssue} pending={reviewActionsDisabled} runs={knownRuns} /></OperationalReadPanel>
				</TabsPanel>
				<TabsPanel value="ideas">
					<OperationalReadPanel detail={failed('Snapshot')} loaded={loaded('Snapshot')} locale={props.locale} pending={pending('Snapshot')} resource="Snapshot"><IssueSpecifyPanel
						catalog={catalog}
						ideas={props.ideas}
						onSpecifyIssue={props.onSpecifyIssue}
						pending={props.pending}
					/></OperationalReadPanel>
					<IssueIntakePanel catalog={catalog} onCreateIssue={props.onCreateIssue} pending={props.pending} />
				</TabsPanel>
				<TabsPanel value="diagnostics">
					<OperationalReadPanel detail={failed('Diagnostics')} loaded={loaded('Diagnostics')} locale={props.locale} pending={pending('Diagnostics')} resource="Diagnostics"><DiagnosticsPanel
						catalog={catalog}
						diagnostics={props.diagnostics}
						locale={props.locale}
						onCancelDiagnostic={props.onCancelDiagnostic}
						onDismissDiagnosticFinding={props.onDismissDiagnosticFinding}
						onPromoteDiagnosticFinding={props.onPromoteDiagnosticFinding}
						onStartDiagnostic={props.onStartDiagnostic}
						pending={props.pending}
					/></OperationalReadPanel>
				</TabsPanel>
				<TabsPanel value="proposals">
					<OperationalReadPanel detail={failed('Proposals')} loaded={loaded('Proposals')} locale={props.locale} pending={pending('Proposals')} resource="Proposals"><ProposalsPanel
						catalog={catalog}
						locale={props.locale}
						onDismissProposal={props.onDismissProposal}
						onPromoteProposal={props.onPromoteProposal}
						pending={props.pending}
						proposals={props.proposals}
						resolvedProposals={props.resolvedProposals}
						resolvedProposalsOmittedCount={props.resolvedProposalsOmittedCount}
						resolvedUnavailable={<OperationalReadPanel detail={failed('Resolved proposals')} loaded={loaded('Resolved proposals')} locale={props.locale} pending={pending('Resolved proposals')} resource="Resolved proposals"><span /></OperationalReadPanel>}
					/></OperationalReadPanel>
				</TabsPanel>
			</Tabs>
		</SurfaceColumn>
	);
}

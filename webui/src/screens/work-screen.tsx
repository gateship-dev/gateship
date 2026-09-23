// webui/src/screens/work-screen.tsx

import React, { useMemo, useState } from 'react';
import type { AppProps, BulkOutcome } from '../app-props.ts';
import type { DiagnosticFindingView, DiagnosticsView, IssueReviewDraft } from '../client.ts';
import type { BadgeVariant } from '../components/ui/badge.tsx';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Count } from '../components/ui/count.tsx';
import { Reference } from '../components/ui/reference.tsx';
import { Tag } from '../components/ui/tag.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardAction, CardDescription, CardDisclosure, CardFooter, CardHeader, CardPanel, CardSummary, CardTitle } from '../components/ui/card.tsx';
import { CheckField, FormField, FormStack } from '../components/ui/card-layout.tsx';
import { DataTable, DataTableBulkAction, DataTableFilter, DataTableNote, DataTablePagination, DataTableToolbar, gateshipTableFeatures, useClientPage, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { Input } from '../components/ui/input.tsx';
import { DrawerLayout, ItemDrawer, successorOf, useOpenItem } from '../components/ui/item-drawer.tsx';
import { SelectField } from '../components/ui/select.tsx';
import { Tabs, TabsCount, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { cn } from '../lib/cn.ts';
import type { Locale, WorkCatalog } from '../locale.ts';
import { LOCALE_CATALOG } from '../locale.ts';
import { OperationalReadPanel, OperationalUnavailable } from '../operational-unavailable.tsx';
import { actionsFor, activeRunIssueId } from '../run-view.ts';
import { ActionButton, ContextPanel } from './operator-controls.tsx';
import { fieldReader, formatCount } from './runs.tsx';
import { draftChanged } from './runs-screen.tsx';
import { SurfaceColumn } from './surface-column.tsx';
import { useTabParam } from '../lib/use-tab-param.ts';

const WORK_TABS = ['queue', 'approval', 'ideas', 'diagnostics', 'proposals'] as const;

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
				<FormField htmlFor="issue-title" measure="prose">
					<span className="font-medium">{catalog.form.title}</span>
					<Input id="issue-title" name="title" required />
				</FormField>
				<FormField htmlFor="issue-objective" measure="prose">
					<span className="font-medium">{catalog.form.objective}</span>
					<Textarea className="min-h-24" id="issue-objective" name="objective" required />
				</FormField>
				<input aria-hidden="true" name="scope" type="hidden" />
				<input aria-hidden="true" name="verificationCommand" type="hidden" />
				<FormField htmlFor="issue-acceptance" measure="prose">
					<span className="font-medium">{catalog.form.acceptance}</span>
					<Textarea className="min-h-24" id="issue-acceptance" name="acceptance" required />
				</FormField>
				<FormField htmlFor="issue-boundaries" measure="prose">
					<span className="font-medium">{catalog.form.boundaries}</span>
					<Textarea className="min-h-20" id="issue-boundaries" name="boundaries" />
				</FormField>
				<FormField htmlFor="issue-verify" measure="prose">
					<span className="font-medium">{catalog.form.verify}</span>
					<Textarea className="min-h-20" mono id="issue-verify" name="verify" placeholder={catalog.form.verificationPlaceholder} required />
				</FormField>
				<CardFooter>
					<Button disabled={pending} type="submit">
					{catalog.intake.create}
				</Button>
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
				<FormField htmlFor="idea-objective" measure="prose">
					<span className="font-medium">{catalog.form.objective}</span>
					<Textarea className="min-h-24" id="idea-objective" name="ideaObjective" required />
				</FormField>
				<input aria-hidden="true" name="ideaScope" type="hidden" />
				<input aria-hidden="true" name="ideaVerificationCommand" type="hidden" />
				<FormField htmlFor="idea-acceptance" measure="prose">
					<span className="font-medium">{catalog.form.acceptance}</span>
					<Textarea className="min-h-24" id="idea-acceptance" name="ideaAcceptance" required />
				</FormField>
				<FormField htmlFor="idea-boundaries" measure="prose">
					<span className="font-medium">{catalog.form.boundaries}</span>
					<Textarea className="min-h-20" id="idea-boundaries" name="ideaBoundaries" />
				</FormField>
				<FormField htmlFor="idea-verify" measure="prose">
					<span className="font-medium">{catalog.form.verify}</span>
					<Textarea className="min-h-20" mono id="idea-verify" name="ideaVerify" placeholder={catalog.form.verificationPlaceholder} required />
				</FormField>
				<CardFooter>
					<Button disabled={pending} type="submit">
					{catalog.specification.submit}
				</Button>
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
		<FormField htmlFor="review-objective" measure="prose">
			<span className="font-medium">{catalog.form.objective}</span><span className="sr-only">Scope and expected outcome Escopo e resultado esperado</span>
			<Textarea className="min-h-24" id="review-objective" onChange={(event) => setters.setObjective((event.currentTarget as unknown as { value: string }).value)} required value={values.objective} />
		</FormField>
		<FormField htmlFor="review-acceptance" measure="prose">
			<span className="font-medium">{catalog.form.acceptance}</span>
			<Textarea className="min-h-24" id="review-acceptance" onChange={(event) => setters.setAcceptance((event.currentTarget as unknown as { value: string }).value.split('\n'))} required value={values.acceptance.join('\n')} />
		</FormField>
		<FormField htmlFor="review-boundaries" measure="prose">
			<span className="font-medium">{catalog.form.boundaries}</span>
			<Textarea className="min-h-20" id="review-boundaries" onChange={(event) => setters.setBoundaries((event.currentTarget as unknown as { value: string }).value.split('\n'))} value={values.boundaries.join('\n')} />
		</FormField>
		<FormField htmlFor="review-verify" measure="prose">
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
			<div><Badge variant={draft.state === 'approved' ? 'success' : draft.state === 'stale' ? 'warning' : 'neutral'}>{catalog.review.stateLabels[draft.state]}</Badge></div>
			<SpecFields catalog={catalog} setters={setters} values={values} />
			<EvidencePanel catalog={catalog} evidence={draft.evidence} />
			<CheckField>
				<input checked={confirmed} disabled={pending || dirty} onChange={(event) => setConfirmed((event.currentTarget as unknown as { checked: boolean }).checked)} type="checkbox" />
				<span>{catalog.review.confirmPersisted}</span>
			</CheckField>
			<FormField htmlFor="abandon-reason" measure="prose">
				<span className="font-medium">{catalog.review.abandonReason}</span>
				<Textarea className="min-h-20" id="abandon-reason" onChange={(event) => setAbandonReason((event.currentTarget as unknown as { value: string }).value)} value={abandonReason} />
			</FormField>
			<CheckField>
				<input checked={abandonConfirmed} disabled={pending || abandonReason.trim().length === 0} onChange={(event) => setAbandonConfirmed((event.currentTarget as unknown as { checked: boolean }).checked)} type="checkbox" />
				<span>{catalog.review.confirmAbandon(draft.id)}</span>
			</CheckField>
			<CardFooter>
				<Button variant="destructive"
					disabled={pending || abandonReason.trim().length === 0 || !abandonConfirmed}
					onClick={() => {
						setAbandonConfirmed(false);
						onAbandonIssue(draft.id, abandonReason.trim());
					}}
					type="button"
				>{catalog.review.abandon}</Button>
				<Button variant="outline" disabled={pending || !dirty} type="submit">{catalog.review.saveRevision}</Button>
				<Button
					disabled={pending || dirty || !confirmed}
					onClick={() => { setConfirmed(false); onApproveIssue(draft.id); }}
					type="button"
				>{catalog.review.approve}</Button>
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
				<CardAction><Count>{formatCount(drafts.length, locale)}</Count></CardAction>
			</CardSummary>
			<CardPanel>
				<FormField htmlFor="review-issue">
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
				</FormField>
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
	return 'neutral';
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
/* The form's own submit lives in the drawer's foot, beside dismiss, and reaches the form by its id: one row of actions, never two. */
function PromoteForm({ catalog, prefix, defaultTitle, onPromote }: { catalog: WorkCatalog; prefix: 'proposal' | 'diagnostic'; defaultTitle: string; onPromote: (input: PromoteInput) => void }): React.ReactElement {
	return (
		<FormStack
			id={`${prefix}-promote`}
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
			<FormField measure="prose"><span className="font-medium">{catalog.form.title}</span><Input defaultValue={defaultTitle} name={`${prefix}Title`} required /></FormField>
			<FormField measure="prose"><span className="font-medium">{catalog.form.objective}</span><Textarea className="min-h-24" name={`${prefix}Objective`} required /></FormField>
			<FormField measure="prose"><span className="font-medium">{catalog.form.acceptance}</span><Textarea className="min-h-24" name={`${prefix}Acceptance`} required /></FormField>
			<FormField measure="prose"><span className="font-medium">{catalog.form.boundaries}</span><Textarea className="min-h-20" name={`${prefix}Boundaries`} /></FormField>
			<FormField measure="prose"><span className="font-medium">{catalog.form.verify}</span><Input mono name={`${prefix}VerificationCommand`} placeholder={catalog.form.verificationPlaceholder} required /></FormField>
		</FormStack>
	);
}

/** What a row opens into: the evidence as captured, then whatever the row still admits. */
/** A run of evidence text with its code spans set apart: what is between backticks is read character by character. */
function inlineCode(text: string): React.ReactNode[] {
	return text.split(/(`[^`]+`)/).filter((part) => part !== '').map((part, index) => part.startsWith('`') && part.endsWith('`')
		? <code className="rounded bg-muted px-1 font-mono text-xs" key={index}>{part.slice(1, -1)}</code>
		: <React.Fragment key={index}>{part}</React.Fragment>);
}

/**
 * An analyzer's evidence is three lines: what it saw, why it matters, what to
 * do. The first is the finding's own name and leads in the row's weight; the
 * rest are paragraphs in the body's ink, because they are the reading, not a
 * note beside it.
 */
export function EvidenceProse({ text }: { text: string }): React.ReactElement {
	const [lead, ...rest] = text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
	return (
		<div className="flex flex-col gap-2" data-slot="evidence">
			{lead === undefined ? null : <p className="font-medium">{inlineCode(lead)}</p>}
			{rest.map((line, index) => <p className="break-words text-muted-foreground" key={index}>{inlineCode(line)}</p>)}
		</div>
	);
}

function SuggestionDetail({ evidence, meta, children }: { evidence: string; meta?: React.ReactNode; children?: React.ReactNode }): React.ReactElement {
	return (
		<div className="flex max-w-3xl flex-col gap-4 text-sm" data-slot="suggestion-detail">
			<EvidenceProse text={evidence} />
			{meta}
			{children}
		</div>
	);
}

type SuggestionView = 'pending' | 'resolved';
/* A view's count is a Count, the figure every label in the product carries: mono, quiet, absent at zero. The accessible name keeps the number. */
function SuggestionViews({ label, value, onChange, pending, resolved }: { label: string; value: SuggestionView; onChange: (value: SuggestionView) => void; pending: [string, string]; resolved: [string, string] }): React.ReactElement {
	return (
		<ToggleGroup aria-label={label} spacing={1} value={[value]} variant="outline" onValueChange={(next) => { if (next[0] !== undefined) onChange(next[0] as SuggestionView); }}>
			<ToggleGroupItem aria-label={`${pending[0]} ${pending[1]}`} value="pending">{pending[0]}<Count form="plain">{pending[1]}</Count></ToggleGroupItem>
			<ToggleGroupItem aria-label={`${resolved[0]} ${resolved[1]}`} value="resolved">{resolved[0]}<Count form="plain">{resolved[1]}</Count></ToggleGroupItem>
		</ToggleGroup>
	);
}

const findingMatches = (finding: DiagnosticFindingView, needle: string): boolean => `${finding.rule} ${finding.file} ${finding.evidence} ${finding.promotedIssueId ?? ''}`.toLocaleLowerCase().includes(needle);

/** Findings as the product's table: severity, rule, where, how often. Evidence and promotion open under the row. */
/**
 * Dismissing the selected rows at once. The button asks first, naming the
 * count, because a dismissal cannot be undone here. The rows the service
 * accepted leave the list; the ones it refused stay, and the table's notice
 * names each of them with the service's own reason until the next action.
 */
function useBulkDismiss(dismiss: ((ids: readonly string[]) => Promise<BulkOutcome>) | undefined, label: string, confirm: (count: number) => string, nameOf: (id: string) => string, catalog: WorkCatalog, locale: Locale): {
	selection: { actions: (ids: readonly string[], clear: () => void) => React.ReactNode } | undefined;
	notice: React.ReactNode;
} {
	const [refused, setRefused] = useState<{ settled: number; failed: BulkOutcome['failed'] } | null>(null);
	if (dismiss === undefined) return { selection: undefined, notice: null };
	const run = (ids: readonly string[], clear: () => void): void => {
		setRefused(null);
		void dismiss(ids).then((outcome) => { clear(); setRefused(outcome.failed.length === 0 ? null : { settled: outcome.settled.length, failed: outcome.failed }); });
	};
	return {
		selection: { actions: (ids, clear) => <DataTableBulkAction confirm={confirm(ids.length)} label={label} locale={locale} onRun={() => run(ids, clear)} /> },
		notice: refused === null ? null : (
			<Alert variant="warning">
				<AlertTitle>{catalog.bulk.partial(refused.settled, refused.failed.length)}</AlertTitle>
				<AlertDescription><ul className="flex flex-col gap-1">{refused.failed.map((row) => <li key={row.id}><span className="font-medium text-foreground">{nameOf(row.id)}</span>: {row.reason}</li>)}</ul></AlertDescription>
			</Alert>
		),
	};
}

function DiagnosticFindingsTable({ catalog, diagnostics, locale, pending, onDismiss, onDismissMany, onPromote, defaultView = 'pending', defaultOpenId }: {
	catalog: WorkCatalog; diagnostics: DiagnosticsView; locale: Locale; pending: boolean; defaultView?: SuggestionView; defaultOpenId?: string;
	onDismiss: AppProps['onDismissDiagnosticFinding']; onDismissMany?: AppProps['onDismissDiagnosticFindings']; onPromote: AppProps['onPromoteDiagnosticFinding'];
}): React.ReactElement {
	const [view, setView] = useState<SuggestionView>(defaultView);
	const rows = view === 'pending' ? diagnostics.findings : diagnostics.resolvedFindings;
	/* Only a pending finding can be dismissed, so only the pending view selects. */
	const bulk = useBulkDismiss(view === 'pending' ? onDismissMany : undefined, catalog.diagnostics.dismiss, catalog.bulk.dismissFindings, (id) => rows.find((finding) => finding.id === id)?.rule ?? id, catalog, locale);
	const list = useClientPage(rows, findingMatches);
	const columns = useMemo<GateshipColumnDef<DiagnosticFindingView>[]>(() => {
		const defs: GateshipColumnDef<DiagnosticFindingView>[] = [
			{ id: 'severity', header: catalog.list.columns.severity, meta: { kind: 'label' }, cell: ({ row }) => <Badge variant={diagnosticSeverityVariant(row.original.severity)}>{catalog.diagnostics.severityLabels[row.original.severity]}</Badge> },
			{ id: 'rule', header: catalog.list.columns.rule, meta: { kind: 'name', className: 'font-medium', primary: true }, cell: ({ row }) => row.original.rule },
			{ id: 'location', header: catalog.list.columns.location, meta: { kind: 'code', className: 'max-w-80 truncate text-muted-foreground', hideBelow: 'md' }, cell: ({ row }) => diagnosticFindingLocation(row.original) },
			{ id: 'occurrences', header: catalog.list.columns.occurrences, meta: { kind: 'measure', hideBelow: 'sm' }, cell: ({ row }) => formatCount(row.original.occurrenceCount, locale) },
			...(view === 'pending'
				? [{ id: 'actions', header: () => <span className="sr-only">{catalog.list.columns.actions}</span>, meta: { kind: 'action' as const, label: catalog.list.columns.actions }, cell: ({ row }: { row: { original: DiagnosticFindingView } }) => <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={() => onDismiss(row.original.id)}>{catalog.diagnostics.dismiss}</Button> }]
				: [{ id: 'status', header: catalog.list.columns.status, meta: { kind: 'label' }, cell: ({ row }: { row: { original: DiagnosticFindingView } }) => <span className="flex flex-wrap items-center gap-2"><Badge variant="neutral">{catalog.diagnostics.statusLabels[row.original.status]}</Badge>{row.original.promotedIssueId === null ? null : <Reference>{row.original.promotedIssueId}</Reference>}</span> }]),
		];
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, locale, onDismiss, pending, view]);
	const table = useGateshipTable({ columns, data: list.page, features: gateshipTableFeatures, getRowId: (finding) => finding.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: list.total, state: { globalFilter: list.search, pagination: { pageIndex: Math.floor(list.offset / list.limit), pageSize: list.limit } }, onGlobalFilterChange: (value) => list.setSearch(String(value ?? '')) });
	const ids = list.page.map((finding) => finding.id);
	const [openId, setOpenId] = useOpenItem('finding', ids, defaultOpenId);
	const open = openId === null ? null : rows.find((finding) => finding.id === openId) ?? null;
	/* Dismissed from its drawer, the finding leaves and the drawer moves on to the next row, or closes on the last. */
	const dismissOpen = (finding: DiagnosticFindingView): void => { setOpenId(successorOf(ids, finding.id)); onDismiss(finding.id); };
	return (
		<DrawerLayout open={open !== null}>
			<DataTable
				activeRowId={openId}
				emptyDetail={list.search === '' ? '' : undefined}
				emptyState={list.search !== '' ? undefined : view === 'pending' ? catalog.diagnostics.noPending : catalog.diagnostics.noResolved}
				notice={bulk.notice}
				selection={bulk.selection}
				storageKey="findings"
				foot={<>
					<DataTablePagination locale={locale} offset={list.offset} total={list.total} onOffsetChange={list.setOffset} onPageSizeChange={list.setLimit} table={table} />
					{view === 'resolved' && diagnostics.resolvedFindingsOmittedCount > 0 ? <DataTableNote>{catalog.diagnostics.omitted(formatCount(diagnostics.resolvedFindingsOmittedCount, locale))}</DataTableNote> : null}
				</>}
				head={<DataTableToolbar>
					<SuggestionViews label={catalog.list.views} pending={[catalog.list.pendingFindings, formatCount(diagnostics.findings.length, locale)]} resolved={[catalog.list.resolvedFindings, formatCount(diagnostics.resolvedFindings.length, locale)]} value={view} onChange={(next) => { setView(next); list.setOffset(0); }} />
					<DataTableFilter className="sm:max-w-64" locale={locale} placeholder={catalog.list.searchFindings} table={table} />
				</DataTableToolbar>}
				locale={locale}
				onRowActivate={setOpenId}
				table={table}
			/>
			<ItemDrawer
				footer={open?.status === 'pending' ? <>
					<Button disabled={pending} type="button" variant="outline" onClick={() => dismissOpen(open)}>{catalog.diagnostics.dismiss}</Button>
					<Button disabled={pending} form="diagnostic-promote" type="submit">{catalog.form.promote}</Button>
				</> : undefined}
				locale={locale}
				open={open !== null}
				title={open?.rule ?? ''}
				onClose={() => setOpenId(null)}
			>
				{open === null ? null : (
					<SuggestionDetail evidence={open.evidence} meta={<p className="type-data flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs"><code className="break-all">{diagnosticFindingLocation(open)}</code><span>{catalog.diagnostics.toolVersion(open.toolVersion)}</span><code>{open.sourceSha.slice(0, 12)}</code></p>}>
						{open.status === 'pending' ? <PromoteForm catalog={catalog} defaultTitle={catalog.diagnostics.defaultIssueTitle(open.rule, open.file).slice(0, 120)} prefix="diagnostic" onPromote={(input) => onPromote(open.id, input)} /> : null}
					</SuggestionDetail>
				)}
			</ItemDrawer>
		</DrawerLayout>
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
	onDismissDiagnosticFindings,
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
	| 'onDismissDiagnosticFindings'
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
								<Tag>{analyzer.label}</Tag>
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
			<DiagnosticFindingsTable catalog={catalog} defaultOpenId={defaultOpenId} defaultView={defaultView} diagnostics={diagnostics} locale={locale} onDismiss={onDismissDiagnosticFinding} onDismissMany={onDismissDiagnosticFindings} onPromote={onPromoteDiagnosticFinding} pending={pending} />
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
	resolvedRead,
	pending,
	onDismissProposal,
	onDismissProposals,
	onPromoteProposal,
	defaultView = 'pending',
	defaultOpenId,
}: Pick<
	AppProps,
	'locale' | 'proposals' | 'resolvedProposals' | 'resolvedProposalsOmittedCount' | 'pending' | 'onDismissProposal' | 'onDismissProposals' | 'onPromoteProposal'
> & { catalog: WorkCatalog; /** How the settled proposals were read: a failure is the table's notice, a first load is its skeleton rows. */ resolvedRead?: { failure: string | undefined; loading: boolean }; defaultView?: SuggestionView; defaultOpenId?: string }): React.ReactElement {
	const [view, setView] = useState<SuggestionView>(defaultView);
	const rows: readonly AnyProposal[] = view === 'pending' ? proposals : resolvedProposals;
	const list = useClientPage(rows, proposalMatches);
	const columns = useMemo<GateshipColumnDef<AnyProposal>[]>(() => {
		const defs: GateshipColumnDef<AnyProposal>[] = [
			{ id: 'title', header: catalog.list.columns.title, meta: { kind: 'name', className: 'font-medium', primary: true }, cell: ({ row }) => row.original.title },
			{ id: 'origin', header: catalog.list.columns.origin, meta: { kind: 'code', hideBelow: 'sm' }, cell: ({ row }) => <Reference>{row.original.sourceIssueId}</Reference> },
			{ id: 'run', header: catalog.list.columns.run, meta: { kind: 'code', className: 'text-muted-foreground', hideBelow: 'md' }, cell: ({ row }) => <span title={row.original.sourceRunId}>{row.original.sourceRunId.slice(0, 8)}</span> },
			...(view === 'pending'
				? [{ id: 'actions', header: () => <span className="sr-only">{catalog.list.columns.actions}</span>, meta: { kind: 'action' as const, label: catalog.list.columns.actions }, cell: ({ row }: { row: { original: AnyProposal } }) => <Button disabled={pending} size="sm" type="button" variant="ghost" onClick={() => onDismissProposal(row.original.id)}>{catalog.proposals.dismiss}</Button> }]
				: [{ id: 'status', header: catalog.list.columns.status, meta: { kind: 'label' }, cell: ({ row }: { row: { original: AnyProposal } }) => <span className="flex flex-wrap items-center gap-2"><Badge variant={row.original.status === 'promoted' ? 'success' : 'neutral'}>{catalog.proposals.statusLabels[row.original.status ?? 'dismissed']}</Badge>{row.original.status === 'promoted' && row.original.promotedIssueId != null ? <><span className="text-muted-foreground">{catalog.proposals.became}</span><Reference>{row.original.promotedIssueId}</Reference></> : null}</span> }]),
		];
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, onDismissProposal, pending, view]);
	const table = useGateshipTable({ columns, data: list.page, features: gateshipTableFeatures, getRowId: (proposal) => proposal.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: list.total, state: { globalFilter: list.search, pagination: { pageIndex: Math.floor(list.offset / list.limit), pageSize: list.limit } }, onGlobalFilterChange: (value) => list.setSearch(String(value ?? '')) });
	const resolving = view === 'resolved';
	/* A settled proposal cannot be dismissed again, so only the pending view selects. */
	const bulk = useBulkDismiss(resolving ? undefined : onDismissProposals, catalog.proposals.dismiss, catalog.bulk.dismissProposals, (id) => rows.find((proposal) => proposal.id === id)?.title ?? id, catalog, locale);
	const ids = list.page.map((proposal) => proposal.id);
	const [openId, setOpenId] = useOpenItem('proposal', ids, defaultOpenId);
	const open = openId === null ? null : rows.find((proposal) => proposal.id === openId) ?? null;
	const dismissOpen = (proposal: AnyProposal): void => { setOpenId(successorOf(ids, proposal.id)); onDismissProposal(proposal.id); };
	/* What the settled view is, and why it may be short: facts about these rows, so they sit in the rows' frame. */
	const notice = resolving ? <>
		<DataTableNote><Tag>{catalog.proposals.readOnly}</Tag>{catalog.proposals.settledNote}</DataTableNote>
		{resolvedRead?.failure === undefined ? null : <OperationalUnavailable detail={resolvedRead.failure} locale={locale} resource="Resolved proposals" />}
	</> : bulk.notice;
	return (
		<DrawerLayout open={open !== null}>
			<DataTable
				activeRowId={openId}
				emptyDetail={list.search === '' ? '' : undefined}
				emptyState={list.search !== '' ? undefined : view === 'pending' ? catalog.proposals.emptyPending : catalog.proposals.emptyResolved}
				storageKey="proposals"
				foot={<>
					<DataTablePagination locale={locale} offset={list.offset} total={list.total} onOffsetChange={list.setOffset} onPageSizeChange={list.setLimit} table={table} />
					{resolving && resolvedProposalsOmittedCount > 0 ? <DataTableNote>{catalog.proposals.omitted(resolvedProposalsOmittedCount, formatCount(resolvedProposalsOmittedCount, locale))}</DataTableNote> : null}
				</>}
				head={<DataTableToolbar>
					<SuggestionViews label={catalog.list.views} pending={[catalog.list.pendingProposals, formatCount(proposals.length, locale)]} resolved={[catalog.list.resolvedProposals, formatCount(resolvedProposals.length, locale)]} value={view} onChange={(next) => { setView(next); list.setOffset(0); }} />
					<DataTableFilter className="sm:max-w-64" locale={locale} placeholder={catalog.list.searchProposals} table={table} />
				</DataTableToolbar>}
				notice={notice}
				selection={bulk.selection}
				status={resolving && resolvedRead?.loading === true && rows.length === 0 ? 'loading' : 'ready'}
				locale={locale}
				onRowActivate={setOpenId}
				table={table}
			/>
			<ProposalDrawer catalog={catalog} locale={locale} open={open} pending={pending} resolving={resolving} onClose={() => setOpenId(null)} onDismiss={dismissOpen} onPromote={onPromoteProposal} />
		</DrawerLayout>
	);
}

/* A proposal beside its list: the evidence and where it came from, the contract to promote it while it is pending, and the way to dismiss it at the foot. */
function ProposalDrawer({ open, resolving, pending, catalog, locale, onClose, onDismiss, onPromote }: {
	open: AnyProposal | null; resolving: boolean; pending: boolean; catalog: WorkCatalog; locale: Locale;
	onClose: () => void; onDismiss: (proposal: AnyProposal) => void; onPromote: AppProps['onPromoteProposal'];
}): React.ReactElement {
	return (
		<ItemDrawer
			footer={open !== null && !resolving ? <>
				<Button disabled={pending} type="button" variant="outline" onClick={() => onDismiss(open)}>{catalog.proposals.dismiss}</Button>
				<Button disabled={pending} form="proposal-promote" type="submit">{catalog.form.promote}</Button>
			</> : undefined}
			locale={locale}
			open={open !== null}
			title={open?.title ?? ''}
			onClose={onClose}
		>
			{open === null ? null : (
				<SuggestionDetail evidence={open.evidence} meta={<p className="flex flex-wrap items-center gap-2 text-muted-foreground"><Reference>{open.sourceIssueId}</Reference><Reference>{open.sourceRunId}</Reference></p>}>
					{resolving ? null : <PromoteForm catalog={catalog} defaultTitle={open.title} prefix="proposal" onPromote={(input) => onPromote(open.id, input)} />}
				</SuggestionDetail>
			)}
		</ItemDrawer>
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
	/* Drafts waiting for approval open the page on them, unless the address names a tab. */
	const [tab, setTab] = useTabParam(WORK_TABS, props.drafts.length > 0 ? 'approval' : 'queue');
	return (
		<SurfaceColumn label={localeCatalog.shell.routeLabels.work} status={props.status}>
			<Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)}>
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
						onDismissDiagnosticFindings={props.onDismissDiagnosticFindings}
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
						onDismissProposals={props.onDismissProposals}
						onPromoteProposal={props.onPromoteProposal}
						pending={props.pending}
						proposals={props.proposals}
						resolvedProposals={props.resolvedProposals}
						resolvedProposalsOmittedCount={props.resolvedProposalsOmittedCount}
						resolvedRead={{ failure: failed('Resolved proposals'), loading: pending('Resolved proposals') && !loaded('Resolved proposals') }}
					/></OperationalReadPanel>
				</TabsPanel>
			</Tabs>
		</SurfaceColumn>
	);
}

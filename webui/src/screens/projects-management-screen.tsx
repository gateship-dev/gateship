import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import { fetchProjectOnboarding, type ProjectOnboardingSnapshot } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { Tag } from '../components/ui/tag.tsx';
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from '../components/ui/card.tsx';
import { CheckField, FormField } from '../components/ui/card-layout.tsx';
import { Input } from '../components/ui/input.tsx';
import { DataTable, DataTableToolbar, gateshipTableFeatures, useGateshipTable, type GateshipColumnDef } from '../components/ui/data-table.tsx';
import { cn } from '../lib/cn.ts';
import { TEXT_LINK_CLASS, TITLE_LINK_CLASS } from './operator-links.ts';
import { ProjectActivity, READINESS_TONE } from './overview-screen.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import { CreateProjectPanel, ImportProjectPanel, RegisterProjectPanel } from './projects.tsx';
import { SurfaceColumn } from './surface-column.tsx';

export interface OnboardingProposalConfirmation {
	operation: 'register' | 'import' | 'create';
	target: string;
	identity: string;
}

export function isOnboardingProposalConfirmed(
	confirmation: OnboardingProposalConfirmation | null,
	operation: 'register' | 'import' | 'create' | null,
	target: string,
	proposal: ProjectOnboardingSnapshot['manifestProposal'],
): boolean {
	return confirmation !== null
		&& operation !== null
		&& confirmation.operation === operation
		&& confirmation.target === target.trim()
		&& confirmation.identity === JSON.stringify(proposal);
}

export function isCurrentOnboardingRequest(expected: string, current: string): boolean {
	return expected === current;
}

type OnboardingStorage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };

export function clearOnboardingStorage(storage: OnboardingStorage | null): void {
	storage?.removeItem('gship-onboarding-choice'); storage?.removeItem('gship-onboarding-operation'); storage?.removeItem('gship-onboarding-target'); storage?.removeItem('gship-onboarding-proposal');
}

export function onboardingCheckPresentation(state: string): { label: 'ready' | 'not found' | 'needs attention' | 'not applicable yet'; variant: 'success' | 'error' | 'warning' | 'neutral' } {
	return state === 'ready' ? { label: 'ready', variant: 'success' } : state === 'missing' ? { label: 'not found', variant: 'error' } : state === 'not-applicable' ? { label: 'not applicable yet', variant: 'neutral' } : { label: 'needs attention', variant: 'warning' };
}

export function onboardingDetailsVisible(choice: 'existing' | 'new' | null): boolean {
	return choice !== null;
}

export function onboardingTargetGuidance(operation: 'register' | 'import' | 'create' | null, local: string, remote: string): string {
	return operation === 'register' ? local : remote;
}

export function onboardingTargetPlaceholder(operation: 'register' | 'import' | 'create' | null, local: string, remote: string): string {
	return operation === 'register' ? local : remote;
}

type RegisteredProject = AppProps['projects'][number];

/*
 * What the page is named for: the projects this instance knows, each with where
 * it lives, whether it can run, what it is doing and the way to its settings
 * (where a project is also removed). Activity comes from the overview when the
 * page has it; a project the overview does not report says nothing there.
 */
export function RegisteredProjectsTable({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].projects;
	const overviewCatalog = LOCALE_CATALOG[props.locale].overview;
	const entries = props.overview?.projects;
	const columns = useMemo<GateshipColumnDef<RegisteredProject>[]>(() => {
		const entryOf = (project: RegisteredProject) => entries?.find((entry) => entry.project.id === project.id);
		const defs: GateshipColumnDef<RegisteredProject>[] = [
			{ id: 'project', header: overviewCatalog.project, meta: { className: 'max-w-44 sm:max-w-52' }, cell: ({ row }) => <span className="flex min-w-0 flex-wrap items-center gap-2"><a className={cn(TITLE_LINK_CLASS, 'truncate')} href={`/projects/${encodeURIComponent(row.original.id)}`}>{row.original.name}</a>{row.original.current ? <span className="hidden @xl:inline-flex"><Tag>{catalog.currentBadge}</Tag></span> : null}</span> },
			{ id: 'repository', header: catalog.list.repository, meta: { className: 'type-data max-w-64 truncate text-muted-foreground text-xs', hideBelow: 'md' }, cell: ({ row }) => row.original.repository ?? catalog.repositoryUnknown },
			{ id: 'readiness', header: catalog.readinessLabel, cell: ({ row }) => <Badge variant={READINESS_TONE[row.original.readiness]}>{catalog.readiness[row.original.readiness]}</Badge> },
			{ id: 'activity', header: overviewCatalog.activity, meta: { className: 'max-w-56', hideBelow: 'sm' }, cell: ({ row }) => { const entry = entryOf(row.original); return entry === undefined ? null : <ProjectActivity catalog={overviewCatalog} entry={entry} locale={props.locale} />; } },
			{ id: 'settings', header: () => <span className="sr-only">{catalog.list.settings}</span>, meta: { align: 'end', label: catalog.list.settings }, cell: ({ row }) => <a className={TEXT_LINK_CLASS} href={`/projects/${encodeURIComponent(row.original.id)}/settings`}>{catalog.list.settings}</a> },
		];
		return defs.map((column) => ({ ...column, enableHiding: false, enableSorting: false }));
	}, [catalog, overviewCatalog, entries, props.locale]);
	const data = useMemo(() => [...props.projects], [props.projects]);
	const table = useGateshipTable({ columns, data, features: gateshipTableFeatures, getRowId: (project) => project.id, manualFiltering: true, manualPagination: true, manualSorting: true, rowCount: data.length });
	return (
		<section aria-labelledby="registered-projects">
			<h2 className="sr-only" id="registered-projects">{catalog.list.title}</h2>
			<DataTable emptyDetail={catalog.list.emptyDetail} emptyState={catalog.list.empty} locale={props.locale} table={table} />
		</section>
	);
}

/** Global registry management remains separate from the operational overview. */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the guided surface keeps the operator choices and read-only checks together
export function ProjectsManagementSurface(props: AppProps): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].projects;
	const onboarding = LOCALE_CATALOG[props.locale].onboarding;
	const storage = 'localStorage' in globalThis ? (globalThis as unknown as { localStorage: OnboardingStorage }).localStorage : null;
	const savedChoice = storage?.getItem('gship-onboarding-choice');
	const [choice, setChoice] = useState<'existing' | 'new' | null>(() => {
		return savedChoice === 'existing' || savedChoice === 'new' ? savedChoice : null;
	});
	const [operation, setOperation] = useState<'register' | 'import' | 'create' | null>(() => {
		const saved = storage?.getItem('gship-onboarding-operation');
		if (savedChoice === 'new') return saved === 'create' ? saved : 'create';
		if (savedChoice === 'existing') return saved === 'import' || saved === 'register' ? saved : 'register';
		return null;
	});
	const [target, setTarget] = useState(() => storage?.getItem('gship-onboarding-target') ?? '');
	const [snapshot, setSnapshot] = useState<ProjectOnboardingSnapshot | null>(null);
	const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
	const requestKey = useRef('');
	const [proposalConfirmed, setProposalConfirmed] = useState<OnboardingProposalConfirmation | null>(() => {
		try { return JSON.parse(storage?.getItem('gship-onboarding-proposal') ?? 'null') as OnboardingProposalConfirmation | null; } catch { return null; }
	});
	/* The list is the page; the guided path opens on demand, on a registry with nothing in it, or where the operator left it. */
	const [adding, setAdding] = useState(() => props.projects.length === 0 || savedChoice === 'existing' || savedChoice === 'new');
	const confirmed = isOnboardingProposalConfirmed(proposalConfirmed, operation, target, snapshot?.manifestProposal ?? null);
	useEffect(() => { if (choice === null) return; storage?.setItem('gship-onboarding-choice', choice); }, [choice, storage]);
	useEffect(() => { if (operation === null) return; storage?.setItem('gship-onboarding-operation', operation); }, [operation, storage]);
	useEffect(() => { storage?.setItem('gship-onboarding-target', target); }, [target, storage]);
	useEffect(() => { storage?.setItem('gship-onboarding-proposal', JSON.stringify(proposalConfirmed)); }, [proposalConfirmed, storage]);
	useEffect(() => {
		if (choice === null) return;
		const targetInput = target.trim();
		const request = operation === 'register' ? { operation, value: targetInput } : operation === null ? {} : { operation, value: targetInput };
		const key = JSON.stringify([choice, operation, targetInput]);
		requestKey.current = key;
		setSnapshot(null); setDiagnosticError(null);
		void fetchProjectOnboarding(request).then((value) => { if (isCurrentOnboardingRequest(key, requestKey.current)) setSnapshot(value); }).catch((error: unknown) => { if (isCurrentOnboardingRequest(key, requestKey.current)) setDiagnosticError(error instanceof Error ? error.message : String(error)); });
	}, [choice, operation, target]);
	const checkCatalog = onboarding.checks;
	const checkState = (state: string) => state === 'ready' ? checkCatalog.ready : state === 'missing' ? checkCatalog.missing : state === 'not-applicable' ? checkCatalog.notApplicable : checkCatalog.attention;
	const resetToProjectType = (): void => {
		setChoice(null); setOperation(null); setProposalConfirmed(null); setSnapshot(null); setDiagnosticError(null); requestKey.current = '';
		clearOnboardingStorage(storage);
	};
	return (
		<SurfaceColumn label={catalog.title} status={props.status}>
			<DataTableToolbar><Button aria-expanded={adding} className="ml-auto" onClick={() => setAdding((current) => !current)} type="button" variant={adding ? 'outline' : 'default'}>{adding ? catalog.list.closeAdd : catalog.list.add}</Button></DataTableToolbar>
			<RegisteredProjectsTable props={props} />
			{adding ? <>
			<Card>
				<CardHeader><CardTitle>{onboarding.choice.title}</CardTitle><CardDescription>{onboarding.choice.description}</CardDescription></CardHeader>
				<CardPanel>
					{/* One choice of two, and then one of two ways in: a toggle group, as every exclusive choice in the product is. */}
					<ToggleGroup aria-label={onboarding.choice.title} spacing={1} value={choice === null ? [] : [choice]} variant="outline" onValueChange={(next) => { const value = next[0]; if (value === 'existing') { setChoice('existing'); setOperation('register'); setProposalConfirmed(null); } else if (value === 'new') { setChoice('new'); setOperation('create'); setProposalConfirmed(null); } }}>
						<ToggleGroupItem value="existing">{onboarding.choice.existing}</ToggleGroupItem>
						<ToggleGroupItem value="new">{onboarding.choice.fresh}</ToggleGroupItem>
					</ToggleGroup>
					{choice !== null ? <FormField className="mt-3" measure="prose"><span className="font-medium">{onboarding.choice.targetLabel}</span><Input mono onChange={(event) => { setTarget((event.currentTarget as unknown as { value: string }).value); setProposalConfirmed(null); }} placeholder={onboardingTargetPlaceholder(operation, onboarding.choice.targetPlaceholder, onboarding.choice.repositoryPlaceholder)} value={target} /><span className="text-muted-foreground text-xs">{onboardingTargetGuidance(operation, onboarding.choice.localTargetGuidance, onboarding.choice.remoteTargetGuidance)}</span></FormField> : null}
					{choice === 'existing' ? <ToggleGroup aria-label={onboarding.choice.existing} className="mt-3 max-w-full flex-wrap" spacing={1} value={operation === null ? [] : [operation]} variant="outline" onValueChange={(next) => { const value = next[0]; if (value === 'register' || value === 'import') { setOperation(value); setProposalConfirmed(null); } }}>
						<ToggleGroupItem value="register">{catalog.register.title}</ToggleGroupItem>
						<ToggleGroupItem value="import">{catalog.import.title}</ToggleGroupItem>
					</ToggleGroup> : null}
				</CardPanel>
			</Card>
			{onboardingDetailsVisible(choice) ? <>
			<Card>
				<CardHeader><CardTitle>{checkCatalog.title}</CardTitle></CardHeader>
				<CardPanel>
					{diagnosticError !== null ? <p className="text-destructive text-sm" role="alert">{diagnosticError}</p> : snapshot === null ? <p className="text-muted-foreground text-sm" role="status">{checkCatalog.loading}</p> : <div className="grid gap-2 sm:grid-cols-2">
						{snapshot.checks.map((check) => <div className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm" key={check.key}><span><span className="font-medium">{checkCatalog.labels[check.key as keyof typeof checkCatalog.labels] ?? check.key}</span><span className="mt-1 block text-muted-foreground text-xs">{check.detail}</span></span><Badge variant={onboardingCheckPresentation(check.state).variant}>{check.state === 'not-applicable' ? checkCatalog.notApplicable : checkState(check.state)}</Badge></div>)}
					</div>}
					{snapshot?.manifestProposal !== null && snapshot?.manifestProposal !== undefined ? <section className="mt-5 rounded-lg border border-warning/40 bg-warning/8 p-4 text-sm dark:bg-warning/16"><h3 className="font-medium">{onboarding.proposal.title}</h3><p className="mt-1 text-muted-foreground text-xs">{onboarding.proposal.description}</p><p className="mt-3 font-medium">{onboarding.proposal.commands}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.commands.length === 0 ? <li>{checkCatalog.attention}</li> : snapshot.manifestProposal.commands.map((command) => <li key={command}><code>{command}</code></li>)}</ul><p className="mt-3 font-medium">{onboarding.proposal.exclusions}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.exclusions.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-3 font-medium">{onboarding.proposal.risks}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.risks.map((item) => <li key={item}>{item}</li>)}</ul><CheckField><input checked={confirmed} onChange={(event) => { const checked = (event.currentTarget as unknown as { checked: boolean }).checked; setProposalConfirmed(checked && operation !== null ? { operation, target: target.trim(), identity: JSON.stringify(snapshot.manifestProposal) } : null); }} type="checkbox" /><span>{onboarding.proposal.confirmation}</span></CheckField></section> : null}
				</CardPanel>
			</Card>
			{operation === 'create' ? <CreateProjectPanel catalog={catalog} onCreateProject={props.onCreateProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{operation === 'import' ? <ImportProjectPanel catalog={catalog} onImportProject={props.onImportProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{operation === 'register' ? <RegisterProjectPanel catalog={catalog} onRegisterProject={props.onRegisterProject} pending={props.pending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{choice !== null ? <Button className="self-start" size="sm" variant="ghost" onClick={resetToProjectType} type="button">{onboarding.choice.back}</Button> : null}
			<Card>
				<CardHeader><CardTitle>{onboarding.nextSteps.title}</CardTitle><CardDescription>{onboarding.nextSteps.description}</CardDescription></CardHeader>
				<CardPanel>
					<div className="flex flex-wrap items-center gap-3"><span className="font-medium text-sm">{onboarding.nextSteps.notification}</span><Button disabled={props.pending} onClick={() => props.onSendNotificationTest('ntfy')} size="sm" variant="outline">{onboarding.nextSteps.test} ntfy</Button><Button disabled={props.pending} onClick={() => props.onSendNotificationTest('resend')} size="sm" variant="outline">{onboarding.nextSteps.test} Resend</Button></div>
					<p className="text-muted-foreground text-sm">{onboarding.nextSteps.reversible}</p>
				</CardPanel>
			</Card>
			</> : null}
			</> : null}
			{/* Keep the established registry form contract mounted for deep links and assistive tooling; the guided path above is the visible entry point. */}
			<div hidden><CreateProjectPanel catalog={catalog} onCreateProject={props.onCreateProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} /><ImportProjectPanel catalog={catalog} onImportProject={props.onImportProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} /><RegisterProjectPanel catalog={catalog} onRegisterProject={props.onRegisterProject} pending={props.pending} /></div>
		</SurfaceColumn>
	);
}

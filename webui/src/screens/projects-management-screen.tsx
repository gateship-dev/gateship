import React, { useEffect, useRef, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import { fetchProjectOnboarding, type ProjectOnboardingSnapshot } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardHeader, CardPanel, CardTitle } from '../components/ui/card.tsx';
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

export function onboardingCheckPresentation(state: string): { label: 'ready' | 'not found' | 'needs attention' | 'not applicable yet'; variant: 'success' | 'error' | 'warning' | 'secondary' } {
	return state === 'ready' ? { label: 'ready', variant: 'success' } : state === 'missing' ? { label: 'not found', variant: 'error' } : state === 'not-applicable' ? { label: 'not applicable yet', variant: 'secondary' } : { label: 'needs attention', variant: 'warning' };
}

export function onboardingDetailsVisible(choice: 'existing' | 'new' | null): boolean {
	return choice !== null;
}

export function onboardingSelectionPressed(selected: boolean): boolean {
	return selected;
}

export function onboardingTargetGuidance(operation: 'register' | 'import' | 'create' | null, local: string, remote: string): string {
	return operation === 'register' ? local : remote;
}

export function onboardingTargetPlaceholder(operation: 'register' | 'import' | 'create' | null, local: string, remote: string): string {
	return operation === 'register' ? local : remote;
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
			<Card>
				<CardHeader><CardTitle>{onboarding.choice.title}</CardTitle></CardHeader>
				<CardPanel>
					<p className="text-muted-foreground text-sm">{onboarding.choice.description}</p>
					<div className="grid gap-3 sm:grid-cols-2">
						<Button aria-pressed={onboardingSelectionPressed(choice === 'existing')} variant={choice === 'existing' ? 'default' : 'outline'} onClick={() => { setChoice('existing'); setOperation('register'); setProposalConfirmed(null); }}>{onboarding.choice.existing}</Button>
						<Button aria-pressed={onboardingSelectionPressed(choice === 'new')} variant={choice === 'new' ? 'default' : 'outline'} onClick={() => { setChoice('new'); setOperation('create'); setProposalConfirmed(null); }}>{onboarding.choice.fresh}</Button>
					</div>
					{choice !== null ? <label className="mt-3 flex flex-col gap-1 text-sm"><span className="font-medium">{onboarding.choice.targetLabel}</span><input className="min-h-9 rounded-lg border bg-background px-3" onChange={(event) => { setTarget((event.currentTarget as unknown as { value: string }).value); setProposalConfirmed(null); }} placeholder={onboardingTargetPlaceholder(operation, onboarding.choice.targetPlaceholder, onboarding.choice.repositoryPlaceholder)} value={target} /><span className="text-muted-foreground text-xs">{onboardingTargetGuidance(operation, onboarding.choice.localTargetGuidance, onboarding.choice.remoteTargetGuidance)}</span></label> : null}
					{choice === 'existing' ? <div className="mt-3 flex flex-wrap gap-2"><Button aria-pressed={onboardingSelectionPressed(operation === 'register')} size="sm" variant={operation === 'register' ? 'default' : 'outline'} onClick={() => { setOperation('register'); setProposalConfirmed(null); }}>{catalog.register.title}</Button><Button aria-pressed={onboardingSelectionPressed(operation === 'import')} size="sm" variant={operation === 'import' ? 'default' : 'outline'} onClick={() => { setOperation('import'); setProposalConfirmed(null); }}>{catalog.import.title}</Button></div> : null}
				</CardPanel>
			</Card>
			{onboardingDetailsVisible(choice) ? <>
			<Card>
				<CardHeader><CardTitle>{checkCatalog.title}</CardTitle></CardHeader>
				<CardPanel>
					{diagnosticError !== null ? <p className="text-destructive text-sm" role="alert">{diagnosticError}</p> : snapshot === null ? <p className="text-muted-foreground text-sm" role="status">{checkCatalog.loading}</p> : <div className="grid gap-2 sm:grid-cols-2">
						{snapshot.checks.map((check) => <div className="flex items-start justify-between gap-3 rounded-lg border p-3 text-sm" key={check.key}><span><span className="font-medium">{checkCatalog.labels[check.key as keyof typeof checkCatalog.labels] ?? check.key}</span><span className="mt-1 block text-muted-foreground text-xs">{check.detail}</span></span><Badge variant={onboardingCheckPresentation(check.state).variant}>{check.state === 'not-applicable' ? checkCatalog.notApplicable : checkState(check.state)}</Badge></div>)}
					</div>}
					{snapshot?.manifestProposal !== null && snapshot?.manifestProposal !== undefined ? <section className="mt-5 rounded-lg border border-attention/50 bg-attention/10 p-4 text-sm"><h3 className="font-medium">{onboarding.proposal.title}</h3><p className="mt-1 text-muted-foreground text-xs">{onboarding.proposal.description}</p><p className="mt-3 font-medium">{onboarding.proposal.commands}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.commands.length === 0 ? <li>{checkCatalog.attention}</li> : snapshot.manifestProposal.commands.map((command) => <li key={command}><code>{command}</code></li>)}</ul><p className="mt-3 font-medium">{onboarding.proposal.exclusions}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.exclusions.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-3 font-medium">{onboarding.proposal.risks}</p><ul className="list-disc pl-5 text-muted-foreground text-xs">{snapshot.manifestProposal.risks.map((item) => <li key={item}>{item}</li>)}</ul><label className="mt-3 flex items-start gap-2"><input checked={confirmed} onChange={(event) => { const checked = (event.currentTarget as unknown as { checked: boolean }).checked; setProposalConfirmed(checked && operation !== null ? { operation, target: target.trim(), identity: JSON.stringify(snapshot.manifestProposal) } : null); }} type="checkbox" /><span>{onboarding.proposal.confirmation}</span></label></section> : null}
				</CardPanel>
			</Card>
			{operation === 'create' ? <CreateProjectPanel catalog={catalog} onCreateProject={props.onCreateProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{operation === 'import' ? <ImportProjectPanel catalog={catalog} onImportProject={props.onImportProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{operation === 'register' ? <RegisterProjectPanel catalog={catalog} onRegisterProject={props.onRegisterProject} pending={props.pending} onboardingConfirmed={confirmed || snapshot?.manifestProposal === null} value={target} onValueChange={(value) => { setTarget(value); setProposalConfirmed(null); }} /> : null}
			{choice !== null ? <button className="self-start text-muted-foreground text-sm underline underline-offset-4" onClick={resetToProjectType} type="button">{onboarding.choice.back}</button> : null}
			<Card>
				<CardHeader><CardTitle>{onboarding.nextSteps.title}</CardTitle></CardHeader>
				<CardPanel>
					<p className="text-muted-foreground text-sm">{onboarding.nextSteps.description}</p>
					<div className="flex flex-wrap items-center gap-3"><span className="font-medium text-sm">{onboarding.nextSteps.notification}</span><Button disabled={props.pending} onClick={() => props.onSendNotificationTest('ntfy')} size="sm" variant="outline">{onboarding.nextSteps.test} ntfy</Button><Button disabled={props.pending} onClick={() => props.onSendNotificationTest('resend')} size="sm" variant="outline">{onboarding.nextSteps.test} Resend</Button></div>
					<p className="text-muted-foreground text-sm">{onboarding.nextSteps.reversible}</p>
				</CardPanel>
			</Card>
			</> : null}
			{/* Keep the established registry form contract mounted for deep links and assistive tooling; the guided path above is the visible entry point. */}
			<div hidden><CreateProjectPanel catalog={catalog} onCreateProject={props.onCreateProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} /><ImportProjectPanel catalog={catalog} onImportProject={props.onImportProject} pending={props.pending} projectOnboardingPending={props.projectOnboardingPending} /><RegisterProjectPanel catalog={catalog} onRegisterProject={props.onRegisterProject} pending={props.pending} /></div>
		</SurfaceColumn>
	);
}

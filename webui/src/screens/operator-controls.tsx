// webui/src/screens/operator-controls.tsx

import React from 'react';
import { Button } from '../components/ui/button.tsx';
import { Card, CardDescription, CardDisclosure, CardHeader, CardPanel, CardSummary, CardTitle } from '../components/ui/card.tsx';

export function ActionButton({ label, enabled, onClick, variant = 'outline' }: { label: string; enabled: boolean; onClick: () => void; variant?: 'default' | 'outline' | 'destructive' }): React.ReactElement {
	return <Button variant={variant} disabled={!enabled} onClick={onClick} type="button">{label}</Button>;
}

export function ContextPanel({ title, description, open = false, children }: { title: string; description: string; open?: boolean; children: React.ReactNode }): React.ReactElement {
	return (
		<CardDisclosure open={open}>
			<CardSummary>
				<CardTitle>{title}</CardTitle>
			</CardSummary>
			<CardPanel>
				{/* A disclosure keeps its description inside: closed, it is one line and its summary is only a name. */}
				<p className="text-muted-foreground text-sm">{description}</p>
				{children}
			</CardPanel>
		</CardDisclosure>
	);
}

/** A section the page is about: always there, so it is a card and carries no chevron to fold what nobody folds. */
export function SectionCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.ReactElement {
	return (
		<Card>
			{/* What the section is sits with its name; the panel starts with the content. */}
			<CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
			<CardPanel>{children}</CardPanel>
		</Card>
	);
}

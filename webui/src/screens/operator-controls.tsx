// webui/src/screens/operator-controls.tsx

import React from 'react';
import { Button, buttonVariants } from '../components/ui/button.tsx';
import { Card, CardDisclosure, CardHeader, CardPanel, CardSummary, CardTitle } from '../components/ui/card.tsx';

export const BUTTON_CLASS = buttonVariants({ variant: 'outline' });
export const PRIMARY_BUTTON_CLASS = buttonVariants({ variant: 'default' });

export function ActionButton({ label, enabled, onClick }: { label: string; enabled: boolean; onClick: () => void }): React.ReactElement {
	return <Button variant="outline" disabled={!enabled} onClick={onClick} type="button">{label}</Button>;
}

export function ContextPanel({ title, description, open = false, children }: { title: string; description: string; open?: boolean; children: React.ReactNode }): React.ReactElement {
	return (
		<CardDisclosure open={open}>
			<CardSummary>
				<CardTitle>{title}</CardTitle>
			</CardSummary>
			<CardPanel>
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
			<CardHeader><CardTitle>{title}</CardTitle></CardHeader>
			<CardPanel>
				<p className="text-muted-foreground text-sm">{description}</p>
				{children}
			</CardPanel>
		</Card>
	);
}

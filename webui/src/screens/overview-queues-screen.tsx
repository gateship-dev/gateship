import React, { useEffect, useState } from 'react';
import type { AppProps } from '../app-props.ts';
import { fetchOverviewQueues, type QueueOverviewView } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Card, CardPanel } from '../components/ui/card.tsx';
import { EmptyState } from '../components/ui/empty-state.tsx';
import { LOCALE_CATALOG } from '../locale.ts';
import { SurfaceColumn } from './surface-column.tsx';
import { ControlCenterNavigation } from './overview-screen.tsx';

export function OverviewQueuesSurface({ props }: { props: AppProps }): React.ReactElement {
	const catalog = LOCALE_CATALOG[props.locale].overview;
	const [data, setData] = useState<QueueOverviewView | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		const controller = new AbortController();
		void fetchOverviewQueues(controller.signal).then(setData).catch((reason: unknown) => {
			if (!(reason instanceof DOMException && reason.name === 'AbortError')) setError(String(reason));
		});
		return () => controller.abort();
	}, []);
	return <SurfaceColumn label={catalog.queues.title} status={props.status}>
		<ControlCenterNavigation current="queues" locale={props.locale} />
		<h1 className="text-2xl font-semibold">{catalog.queues.title}</h1>
		<p className="text-muted-foreground text-sm">{catalog.queues.description}</p>
		{data === null && error === null ? <p role="status">{catalog.queues.loading}</p> : null}
		{error !== null ? <p role="alert">{catalog.queues.error}: {error}</p> : null}
		{data !== null && data.queues.length === 0 ? <EmptyState>{catalog.queues.empty}</EmptyState> : null}
		<div className="flex flex-col gap-3">
			{data?.queues.map((queue) => <Card key={queue.project.id}><CardPanel>
				<div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{queue.project.name}</h2><Badge>{queue.readiness}</Badge></div>
				<dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
					<div><dt className="text-muted-foreground">{catalog.queues.chain}</dt><dd>{queue.chainEnabled ? catalog.queues.enabled : catalog.queues.disabled}{queue.pause !== null ? ` · ${catalog.queues.paused} (${queue.pause.reason})` : ''}</dd></div>
					<div><dt className="text-muted-foreground">{catalog.queues.current}</dt><dd>{queue.currentIssue?.id ?? catalog.queues.none}{queue.currentRun === null ? '' : ` · ${queue.currentRun.state}`}</dd></div>
					<div><dt className="text-muted-foreground">{catalog.queues.next}</dt><dd>{queue.nextIssue?.id ?? catalog.queues.none}</dd></div>
					<div><dt className="text-muted-foreground">{catalog.queues.planned}</dt><dd>{queue.plannedIssues.length}</dd></div>
				</dl>
			</CardPanel></Card>)}
		</div>
		{data?.errors.map((item) => <p className="text-warning-foreground text-sm" role="alert" key={item.projectId}>{item.projectName}: {catalog.queues.unavailable}</p>)}
	</SurfaceColumn>;
}

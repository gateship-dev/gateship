import React from 'react';
import { ShellContentFrame } from './app-shell.tsx';
import { Button } from './components/ui/button.tsx';
import { PageLoading } from './components/ui/page-loading.tsx';
import type { Locale } from './locale.ts';

/** A local main-area boundary while an operational scope is being hydrated. */
export function InitialOperationalLoading({ locale }: { locale: Locale }): React.ReactElement {
	return <main aria-busy="true" aria-label={locale === 'pt-BR' ? 'Carregamento operacional' : 'Operational loading'} className="scroll-container scroll-fade flex min-h-0 w-full min-w-0 flex-1 overflow-y-auto p-4 lg:p-6" id="main-content" tabIndex={-1}>
		<ShellContentFrame className="flex flex-1 flex-col">
			<PageLoading label={locale === 'pt-BR' ? 'Carregando dados operacionais…' : 'Loading operational data…'} />
		</ShellContentFrame>
	</main>;
}

/** A failed first read remains explicit instead of rendering unknown data as empty. */
export function InitialOperationalFailure({
	locale,
	detail,
	onRetry,
}: {
	locale: Locale;
	detail: string;
	onRetry: () => void;
}): React.ReactElement {
	const Portuguese = locale === 'pt-BR';
	return <main aria-busy="false" className="scroll-container scroll-fade flex min-h-0 w-full min-w-0 flex-1 overflow-y-auto p-4 lg:p-6" id="main-content" tabIndex={-1}>
		<ShellContentFrame className="flex flex-col gap-3">
			<p role="alert">{Portuguese ? 'Não foi possível carregar os dados operacionais.' : 'Operational data could not be loaded.'}</p>
			<p className="text-muted-foreground text-sm">{detail}</p>
			<Button className="mt-1 self-start" onClick={onRetry} type="button">{Portuguese ? 'Tentar novamente' : 'Try again'}</Button>
		</ShellContentFrame>
	</main>;
}

/** A refresh can fail after data is visible: keep it visible and make retry explicit. */
export function OperationalRefreshFailure({
	locale,
	detail,
	onRetry,
}: {
	locale: Locale;
	detail: string;
	onRetry: () => void;
}): React.ReactElement {
	const Portuguese = locale === 'pt-BR';
	return <div className="mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-(--content-measure) flex-wrap items-center gap-3 rounded-xl border border-warning-ui bg-warning-surface p-4 text-sm" role="alert">
		<div className="min-w-0 flex-1"><p className="font-medium">{Portuguese ? 'Não foi possível atualizar os dados operacionais.' : 'Operational data could not be refreshed.'}</p><p className="mt-1 break-words text-muted-foreground">{detail}</p></div>
		<Button onClick={onRetry} type="button">{Portuguese ? 'Tentar novamente' : 'Try again'}</Button>
	</div>;
}

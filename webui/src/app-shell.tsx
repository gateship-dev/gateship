import type React from 'react';
import { useEffect, useRef } from 'react';
import { cn } from './lib/cn.ts';

export const MAIN_CONTENT_ID = 'main-content';
/** The conversation inspector and matching shell-control column share one width. */
export const INSPECTOR_COLUMN_WIDTH_CLASS = '[--inspector-column-width:24rem]';
export const INSPECTOR_COLUMN_CLASS = 'xl:w-(--inspector-column-width) xl:shrink-0';
export const INSPECTOR_GRID_CLASS = 'xl:grid xl:grid-cols-[minmax(0,1fr)_var(--inspector-column-width)]';

/**
 * The one horizontal frame shared by the shell controls and every route
 * surface. Its measure is a shell preference, never a page-local offset.
 */
export function ShellContentFrame({
	className,
	...props
}: React.ComponentProps<'div'>): React.ReactElement {
	return <div className={cn('mx-auto w-full max-w-(--content-measure)', className)} data-slot="shell-content-frame" {...props} />;
}

/** Structural shell. Navigation and controls remain independent slots. */
type PanelElement = { querySelector: (selector: string) => { offsetWidth: number; clientWidth: number } | null; style: { setProperty: (name: string, value: string) => void } };
type PanelRuntime = { ResizeObserver?: new (callback: () => void) => { observe: (element: unknown) => void; disconnect: () => void } };

function ShellPanel({ children }: { children: React.ReactNode }): React.ReactElement {
	const panel = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = panel.current as unknown as PanelElement | null;
		const Observer = (globalThis as unknown as PanelRuntime).ResizeObserver;
		if (element === null || Observer === undefined) return;
		const read = (): void => {
			const main = element.querySelector('main');
			element.style.setProperty('--content-scrollbar', `${main === null ? 0 : main.offsetWidth - main.clientWidth}px`);
		};
		const observer = new Observer(read);
		observer.observe(element);
		const main = element.querySelector('main');
		if (main !== null) observer.observe(main);
		read();
		return () => observer.disconnect();
	}, []);
	return <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--border)_64%,transparent)] bg-(--shell-panel) [--content-scrollbar:0px]" data-slot="shell-panel" ref={panel}>{children}</div>;
}

export function AppShell({
	skipLabel,
	sidebar,
	controls,
	tabBar,
	children,
}: {
	skipLabel: string;
	sidebar: React.ReactNode;
	controls: React.ReactNode;
	/** The destinations below lg, the last row of the column. */
	tabBar?: React.ReactNode;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div className={cn('flex h-svh w-full flex-col overflow-hidden bg-sidebar lg:flex-row', INSPECTOR_COLUMN_WIDTH_CLASS)}>
			<a
				className="fixed top-0 left-4 z-50 -translate-y-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground text-sm outline-none focus:translate-y-4 focus-visible:ring-2 focus-visible:ring-ring"
				href={`#${MAIN_CONTENT_ID}`}
			>
				{skipLabel}
			</a>
			{sidebar}
			<div className="flex min-h-0 w-full min-w-0 flex-1 flex-col p-2 lg:p-3">
				{/* The content column owns the scrollbar. Where the platform draws a classic one it takes width from the content and not from the controls above it, so the panel measures that width and the controls give it back: the two right edges stay one, and nothing is reserved where no bar is drawn. */}
				<ShellPanel>
					{controls}
					{children}
				</ShellPanel>
			</div>
			{tabBar}
		</div>
	);
}

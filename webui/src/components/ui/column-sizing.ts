// webui/src/components/ui/column-sizing.ts
//
// Column widths the operator sets by dragging. A table starts in the browser's
// own layout, where each column is as wide as its content and the primary one
// takes the slack; that default is what the visual gate measures. The first
// drag takes a picture of those widths and from then on the table is fixed:
// every column keeps the width it was given, the primary still absorbs the
// frame's slack while there is any, and once the widths add up to more than
// the frame the rows scroll sideways inside it.
//
// Widths are this browser's, stored per table the way the theme and the
// measure are. A width that does not survive navigation is not worth
// dragging for.

import { useCallback, useEffect, useRef, useState } from 'react';

/** The narrowest a column may be dragged: a 32px control and the cells' 8px either side. */
export const MIN_COLUMN_WIDTH = 48;
/** Arrow keys move a grip one grid step twice over; with shift, eight. */
export const KEY_STEP = 8;
export const KEY_STEP_LARGE = 32;

export interface ColumnSizing {
	/** The widths the browser gave each column before the first drag: where a double click returns one. */
	natural: Readonly<Record<string, number>>;
	current: Readonly<Record<string, number>>;
	/** The column the operator dragged last, which "fit to width" leaves at the width they chose. */
	dragged: string | null;
}

type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };

function storage(): Storage | undefined {
	try {
		return (globalThis as unknown as { localStorage?: Storage }).localStorage;
	} catch {
		return undefined;
	}
}

const keyOf = (table: string): string => `gship-table:${table}:widths`;

function isWidths(value: unknown): value is Record<string, number> {
	return typeof value === 'object' && value !== null && Object.values(value).every((width) => typeof width === 'number' && Number.isFinite(width));
}

export function readSizing(table: string): ColumnSizing | null {
	try {
		const parsed: unknown = JSON.parse(storage()?.getItem(keyOf(table)) ?? 'null');
		if (typeof parsed !== 'object' || parsed === null) return null;
		const { natural, current, dragged } = parsed as Partial<ColumnSizing>;
		if (!isWidths(natural) || !isWidths(current)) return null;
		return { natural, current, dragged: typeof dragged === 'string' ? dragged : null };
	} catch {
		return null;
	}
}

function writeSizing(table: string, sizing: ColumnSizing | null): void {
	try {
		if (sizing === null) storage()?.removeItem(keyOf(table));
		else storage()?.setItem(keyOf(table), JSON.stringify(sizing));
	} catch {
		// The widths still apply for this visit when storage refuses them.
	}
}

/** A dragged width lands on whole pixels and never below the floor. */
export function clampWidth(width: number): number {
	return Math.max(MIN_COLUMN_WIDTH, Math.round(width));
}

/**
 * Spreads what the frame has left over the columns that can take it,
 * in proportion to the width each already has, so their relative weight
 * survives. The column dragged last keeps the width the operator gave it.
 * `leftover` may be negative: then the same columns give the space back,
 * down to the floor.
 */
export function fitWidths(current: Readonly<Record<string, number>>, flexible: readonly string[], leftover: number): Record<string, number> {
	const pool = flexible.reduce((sum, id) => sum + (current[id] ?? 0), 0);
	if (pool <= 0 || leftover === 0) return { ...current };
	const next: Record<string, number> = { ...current };
	for (const id of flexible) next[id] = clampWidth((current[id] ?? 0) + leftover * ((current[id] ?? 0) / pool));
	return next;
}

/** The widths the table renders with, and the frame's slack given to the primary column. */
export function renderedWidths(sizing: ColumnSizing, shown: readonly string[], primary: string | undefined, frame: number, fixedExtra = 0): { widths: Record<string, number>; total: number } {
	const widths: Record<string, number> = {};
	for (const id of shown) widths[id] = sizing.current[id] ?? sizing.natural[id] ?? 120;
	const sum = shown.reduce((total, id) => total + (widths[id] ?? 0), fixedExtra);
	const slack = Math.max(0, frame - sum);
	if (primary !== undefined && widths[primary] !== undefined) widths[primary] += slack;
	return { widths, total: sum + slack };
}

export interface ColumnSizingControls {
	sizing: ColumnSizing | null;
	/** Begins a drag from a grip. `measure` reads the widths the browser laid out, for the first drag. */
	startDrag: (id: string, clientX: number, measure: () => Record<string, number>) => void;
	nudge: (id: string, delta: number, measure: () => Record<string, number>) => void;
	restore: (id: string) => void;
	fit: (flexible: readonly string[], leftover: number) => void;
	reset: () => void;
}

export function useColumnSizing(table: string | undefined): ColumnSizingControls {
	const [sizing, setSizingState] = useState<ColumnSizing | null>(() => (table === undefined ? null : readSizing(table)));
	const latest = useRef(sizing);
	const setSizing = useCallback((next: ColumnSizing | null, persist: boolean): void => {
		latest.current = next;
		setSizingState(next);
		if (persist && table !== undefined) writeSizing(table, next);
	}, [table]);
	const cleanup = useRef<(() => void) | null>(null);
	useEffect(() => () => cleanup.current?.(), []);

	const base = (measure: () => Record<string, number>): ColumnSizing => {
		if (latest.current !== null) return latest.current;
		const measured = measure();
		return { natural: measured, current: measured, dragged: null };
	};

	const startDrag = (id: string, clientX: number, measure: () => Record<string, number>): void => {
		const before = latest.current;
		const from = base(measure);
		const width = from.current[id] ?? MIN_COLUMN_WIDTH;
		const runtime = globalThis as unknown as { addEventListener: (type: string, listener: (event: never) => void) => void; removeEventListener: (type: string, listener: (event: never) => void) => void };
		const move = (event: { clientX: number }): void => setSizing({ ...from, current: { ...from.current, [id]: clampWidth(width + event.clientX - clientX) }, dragged: id }, false);
		const stop = (): void => {
			runtime.removeEventListener('pointermove', move);
			runtime.removeEventListener('pointerup', finish);
			runtime.removeEventListener('keydown', cancel);
			cleanup.current = null;
		};
		const finish = (): void => { stop(); setSizing(latest.current, true); };
		/* Escape puts the table back exactly as the drag found it, the browser's own layout included. */
		const cancel = (event: { key: string }): void => { if (event.key === 'Escape') { stop(); setSizing(before, false); } };
		runtime.addEventListener('pointermove', move);
		runtime.addEventListener('pointerup', finish);
		runtime.addEventListener('keydown', cancel);
		cleanup.current = stop;
	};

	const nudge = (id: string, delta: number, measure: () => Record<string, number>): void => {
		const from = base(measure);
		setSizing({ ...from, current: { ...from.current, [id]: clampWidth((from.current[id] ?? MIN_COLUMN_WIDTH) + delta) }, dragged: id }, true);
	};

	const restore = (id: string): void => {
		const from = latest.current;
		if (from === null || from.natural[id] === undefined) return;
		setSizing({ ...from, current: { ...from.current, [id]: from.natural[id] } }, true);
	};

	const fit = (flexible: readonly string[], leftover: number): void => {
		const from = latest.current;
		if (from === null) return;
		setSizing({ ...from, current: fitWidths(from.current, flexible.filter((id) => id !== from.dragged), leftover) }, true);
	};

	const reset = (): void => setSizing(null, true);

	return { sizing, startDrag, nudge, restore, fit, reset };
}

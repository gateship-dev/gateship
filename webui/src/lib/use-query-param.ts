// webui/src/lib/use-query-param.ts
//
// One named value in the address, `?finding=<id>`: the item a screen has open.
// A link, a reload and the back button all land on it, and closing it leaves
// the address clean. `useTabParam` is the same idea narrowed to a known set of
// tabs; this one carries an id the screen only learns from its data.

import { useCallback, useEffect, useState } from 'react';

interface QueryRuntime {
	location?: { pathname: string; search: string; hash: string };
	history?: { pushState: (data: null, unused: string, url: string) => void };
	addEventListener?: (type: 'popstate', listener: () => void) => void;
	removeEventListener?: (type: 'popstate', listener: () => void) => void;
}

function runtime(): QueryRuntime { return globalThis as unknown as QueryRuntime; }

export function readQueryParam(name: string, source: Pick<QueryRuntime, 'location'> = runtime()): string | null {
	const value = new URLSearchParams(source.location?.search ?? '').get(name);
	return value === null || value === '' ? null : value;
}

/** The value in the address, or `fallback` when the address carries none. Setting null clears it. */
export function useQueryParam(name: string, fallback: string | null = null): [string | null, (next: string | null) => void] {
	const [value, setValue] = useState<string | null>(() => readQueryParam(name) ?? fallback);
	useEffect(() => {
		const onPop = (): void => setValue(readQueryParam(name));
		runtime().addEventListener?.('popstate', onPop);
		return () => runtime().removeEventListener?.('popstate', onPop);
	}, [name]);
	const select = useCallback((next: string | null): void => {
		const { location, history } = runtime();
		if (location !== undefined && history !== undefined) {
			const params = new URLSearchParams(location.search);
			if (next === null) params.delete(name); else params.set(name, next);
			const query = params.toString();
			history.pushState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`);
		}
		setValue(next);
	}, [name]);
	return [value, select];
}

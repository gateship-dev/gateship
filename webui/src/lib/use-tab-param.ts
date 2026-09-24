// webui/src/lib/use-tab-param.ts
//
// The open tab lives in the address as `?tab=`, so a link, a reload and the
// back button all land on it. A value the screen does not know falls back to
// the default, and the default itself leaves the address clean.

import { useEffect, useState } from 'react';

interface TabRuntime {
	location?: { pathname: string; search: string; hash: string };
	history?: { pushState: (data: null, unused: string, url: string) => void };
	addEventListener?: (type: 'popstate', listener: () => void) => void;
	removeEventListener?: (type: 'popstate', listener: () => void) => void;
}

function runtime(): TabRuntime { return globalThis as unknown as TabRuntime; }

export function readTab<T extends string>(allowed: readonly T[], fallback: T, source: Pick<TabRuntime, 'location'> = runtime()): T {
	const value = new URLSearchParams(source.location?.search ?? '').get('tab');
	return allowed.find((tab) => tab === value) ?? fallback;
}

export function useTabParam<T extends string>(allowed: readonly T[], fallback: T): [T, (next: T) => void] {
	const [tab, setTab] = useState<T>(() => readTab(allowed, fallback));
	useEffect(() => {
		const onPop = (): void => setTab(readTab(allowed, fallback));
		runtime().addEventListener?.('popstate', onPop);
		return () => runtime().removeEventListener?.('popstate', onPop);
	}, [allowed, fallback]);
	const select = (next: T): void => {
		const { location, history } = runtime();
		if (location !== undefined && history !== undefined) {
			const params = new URLSearchParams(location.search);
			if (next === fallback) params.delete('tab'); else params.set('tab', next);
			const query = params.toString();
			history.pushState(null, '', `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`);
		}
		setTab(next);
	};
	return [tab, select];
}

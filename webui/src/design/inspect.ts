// webui/src/design/inspect.ts
//
// The scratchpad's inspector: hover names the part under the pointer the way
// the kit names it (`data-slot`, with its variant, size, tone and state
// attributes), measures it, and resolves its colours back to the tokens they
// came from. A click copies that as one line, so a request can point at
// exactly one thing. It attaches to any same-origin document, which is how
// it also works inside the harness frame.

export interface Inspection {
	/** Ancestor slots, outermost first, ending at the hovered part. */
	path: string[];
	/** `variant=outline`, `size=sm`, `state=open`: every data attribute but the slot. */
	attributes: string[];
	width: number;
	height: number;
	font: string;
	color: string;
	background: string;
	radius: string;
	/** One line an operator can paste into a request. */
	reference: string;
}

type View = { getComputedStyle: (element: Element) => CSSStyleDeclaration };

function tokenMap(document: Document, scope: Element, tokens: readonly string[]): Map<string, string[]> {
	const view = document.defaultView as unknown as View;
	const map = new Map<string, string[]>();
	const probe = document.createElement('span');
	probe.style.display = 'none';
	scope.appendChild(probe);
	for (const token of tokens) {
		probe.style.color = `var(--${token})`;
		const resolved = view.getComputedStyle(probe).color;
		map.set(resolved, [...(map.get(resolved) ?? []), token]);
	}
	probe.remove();
	return map;
}

function named(value: string, map: Map<string, string[]>): string {
	const tokens = map.get(value);
	return tokens === undefined ? value : `${tokens.slice(0, 2).map((token) => `--${token}`).join(' | ')} (${value})`;
}

function inspect(target: Element, document: Document, tokens: readonly string[]): Inspection | null {
	const part = target.closest('[data-slot]');
	if (part === null) return null;
	const view = document.defaultView as unknown as View;
	const path: string[] = [];
	for (let current: Element | null = part; current !== null && path.length < 4; current = current.parentElement?.closest('[data-slot]') ?? null) path.unshift(current.getAttribute('data-slot') ?? '');
	const attributes = [...part.attributes].filter((attribute) => attribute.name.startsWith('data-') && attribute.name !== 'data-slot' && attribute.value !== '' && attribute.value.length < 24).map((attribute) => `${attribute.name.slice(5)}=${attribute.value}`);
	const style = view.getComputedStyle(part);
	const rect = part.getBoundingClientRect();
	/* Tokens resolve differently under `.dark`, so the map is built where the part lives. */
	const map = tokenMap(document, part.parentElement ?? document.body, tokens);
	const width = Math.round(rect.width);
	const height = Math.round(rect.height);
	const label = `${path.join(' › ')}${attributes.length === 0 ? '' : `[${attributes.join(',')}]`}`;
	return {
		path, attributes, width, height,
		font: `${style.fontFamily.split(',')[0]?.replaceAll('"', '')} ${style.fontSize}/${style.fontWeight}`,
		color: named(style.color, map),
		background: named(style.backgroundColor, map),
		radius: style.borderRadius,
		reference: `${label} ${width}×${height}`,
	};
}

/**
 * Starts inspecting `document`. `onHover` receives the part under the
 * pointer (or null), `onPick` the part that was clicked; the click is
 * swallowed so inspecting a link or a button does not follow it. Returns the
 * function that stops it and removes the outline.
 */
export function attachInspector(document: Document, tokens: readonly string[], onHover: (inspection: Inspection | null) => void, onPick: (inspection: Inspection) => void): () => void {
	const outline = document.createElement('div');
	outline.setAttribute('data-design-inspector', '');
	Object.assign(outline.style, { position: 'fixed', zIndex: '2147483647', pointerEvents: 'none', border: '1px solid #c8ff00', background: 'rgba(200, 255, 0, 0.12)', borderRadius: '4px', display: 'none' });
	document.body.appendChild(outline);
	const move = (event: Event): void => {
		const target = event.target instanceof document.defaultView!.Element ? event.target : null;
		/* The scratchpad's own controls stay clickable while inspecting. */
		const part = target === null || target.closest('[data-design-chrome]') !== null ? null : target.closest('[data-slot]');
		if (target === null || part === null) { outline.style.display = 'none'; onHover(null); return; }
		const rect = part.getBoundingClientRect();
		Object.assign(outline.style, { display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
		onHover(inspect(target, document, tokens));
	};
	const pick = (event: Event): void => {
		const target = event.target instanceof document.defaultView!.Element ? event.target : null;
		const inspection = target === null || target.closest('[data-design-chrome]') !== null ? null : inspect(target, document, tokens);
		if (inspection === null) return;
		event.preventDefault();
		event.stopPropagation();
		onPick(inspection);
	};
	document.addEventListener('mousemove', move, true);
	document.addEventListener('click', pick, true);
	return () => {
		document.removeEventListener('mousemove', move, true);
		document.removeEventListener('click', pick, true);
		outline.remove();
	};
}

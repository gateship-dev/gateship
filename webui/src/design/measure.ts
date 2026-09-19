// webui/src/design/measure.ts
//
// The design contract's measurable half. Every function reads a rendered
// document and returns numbers, never opinions, so the same code serves the
// design scratchpad (live, while iterating) and the visual gate (as
// assertions). What the contract cannot measure stays in the contract as
// judgment; what it can measure lives here.

export interface ContrastFinding { text: string; ratio: number; color: string; background: string }
export interface OverflowFinding { slot: string; clientWidth: number; scrollWidth: number }
export interface ToolbarFinding { slot: string; heights: number[] }

export interface DesignReport {
	/** Distinct computed font sizes among visible text; a screen should need few. */
	fontSizes: string[];
	/** Distinct computed text colours among visible text. */
	textColors: string[];
	/** Distinct border radii in use. */
	radii: string[];
	/** Class names carrying a Tailwind arbitrary value, the shape of an untokenised choice. */
	arbitraryClasses: string[];
	/** Text below the AA ratio for its size. */
	lowContrast: ContrastFinding[];
	/** Elements wider than their box that are not declared scroll containers. */
	overflow: OverflowFinding[];
	/** Toolbars whose controls do not share one height. */
	unevenToolbars: ToolbarFinding[];
	/** The page's own horizontal overflow: any value above zero is a defect. */
	pageOverflow: number;
}

type Browser = { getComputedStyle: (element: Element) => CSSStyleDeclaration };

function browserOf(document: Document): Browser {
	return document.defaultView as unknown as Browser;
}

function visible(element: Element, browser: Browser): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width === 0 || rect.height === 0) return false;
	const style = browser.getComputedStyle(element);
	return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
}

function ownText(element: Element): string {
	return Array.from(element.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? '').join('').trim();
}

function parseColor(value: string): [number, number, number, number] | null {
	const rgb = /rgba?\(([^)]+)\)/.exec(value);
	if (rgb !== null) {
		const parts = rgb[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
		return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
	}
	return null;
}

/** Resolves a colour through a probe so oklch, color-mix and named values all come back as rgb(). */
export function resolveColor(document: Document, value: string): [number, number, number, number] | null {
	const probe = document.createElement('span');
	probe.style.color = value;
	probe.style.display = 'none';
	document.body.appendChild(probe);
	const resolved = parseColor(browserOf(document).getComputedStyle(probe).color);
	probe.remove();
	return resolved;
}

function luminance([r, g, b]: [number, number, number, number]): number {
	const channel = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colours. */
export function contrastRatio(foreground: [number, number, number, number], background: [number, number, number, number]): number {
	const [l1, l2] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
	return (l1 + 0.05) / (l2 + 0.05);
}

function blend(top: [number, number, number, number], under: [number, number, number, number]): [number, number, number, number] {
	const a = top[3];
	return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

/** The colour a piece of text actually sits on: ancestors' backgrounds composited bottom-up. */
export function effectiveBackground(element: Element, browser: Browser): [number, number, number, number] {
	const layers: [number, number, number, number][] = [];
	let current: Element | null = element;
	while (current !== null) {
		const color = parseColor(browser.getComputedStyle(current).backgroundColor);
		if (color !== null && color[3] > 0) {
			layers.push(color);
			if (color[3] === 1) break;
		}
		current = current.parentElement;
	}
	let result: [number, number, number, number] = [255, 255, 255, 1];
	for (const layer of layers.reverse()) result = blend(layer, result);
	return result;
}

const TEXT_SELECTOR = 'p, span, a, button, td, th, li, label, h1, h2, h3, h4, dt, dd, kbd, code, time, summary, legend, small, strong, em, output';

export function measureContrast(root: ParentNode, document: Document, minimum = 4.5): ContrastFinding[] {
	const browser = browserOf(document);
	const findings: ContrastFinding[] = [];
	for (const element of root.querySelectorAll(TEXT_SELECTOR)) {
		const text = ownText(element);
		if (text === '' || !visible(element, browser)) continue;
		const style = browser.getComputedStyle(element);
		const color = parseColor(style.color);
		if (color === null) continue;
		const background = effectiveBackground(element, browser);
		const ratio = contrastRatio(blend(color, background), background);
		const size = Number.parseFloat(style.fontSize);
		const bold = Number.parseInt(style.fontWeight, 10) >= 600;
		const large = size >= 24 || (size >= 18.66 && bold);
		if (ratio < (large ? 3 : minimum)) findings.push({ text: text.slice(0, 40), ratio: Math.round(ratio * 100) / 100, color: style.color, background: `rgb(${background.slice(0, 3).map(Math.round).join(', ')})` });
	}
	return findings;
}

export function measureOverflow(root: ParentNode, document: Document): OverflowFinding[] {
	const browser = browserOf(document);
	const findings: OverflowFinding[] = [];
	for (const element of root.querySelectorAll<HTMLElement>('*')) {
		if (element.scrollWidth <= element.clientWidth + 1 || !visible(element, browser)) continue;
		const overflowX = browser.getComputedStyle(element).overflowX;
		if (overflowX === 'auto' || overflowX === 'scroll') continue;
		findings.push({ slot: element.getAttribute('data-slot') ?? element.tagName.toLowerCase(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth });
	}
	return findings;
}

export function measureToolbars(root: ParentNode, document: Document, selector = '[data-slot=data-table-toolbar]'): ToolbarFinding[] {
	const browser = browserOf(document);
	const findings: ToolbarFinding[] = [];
	for (const toolbar of root.querySelectorAll(selector)) {
		const heights = new Set<number>();
		for (const control of toolbar.querySelectorAll('button, [data-slot=select-trigger], [data-slot=input-control], [data-slot=toggle-group-item]')) {
			if (!visible(control, browser) || control.closest('[role=menu]') !== null) continue;
			heights.add(Math.round(control.getBoundingClientRect().height));
		}
		if (heights.size > 1) findings.push({ slot: toolbar.getAttribute('data-slot') ?? 'toolbar', heights: [...heights].sort((a, b) => a - b) });
	}
	return findings;
}

export function measureDesign(root: ParentNode, document: Document): DesignReport {
	const browser = browserOf(document);
	const fontSizes = new Set<string>();
	const textColors = new Set<string>();
	const radii = new Set<string>();
	const arbitraryClasses = new Set<string>();
	for (const element of root.querySelectorAll('*')) {
		if (!visible(element, browser)) continue;
		const style = browser.getComputedStyle(element);
		if (ownText(element) !== '') {
			fontSizes.add(style.fontSize);
			textColors.add(style.color);
		}
		if (style.borderRadius !== '0px' && style.borderTopLeftRadius === style.borderBottomRightRadius) radii.add(style.borderRadius);
		for (const name of element.classList) if (name.includes('[') && !name.startsWith('[&') && !name.includes(':[&')) arbitraryClasses.add(name);
	}
	const scrolling = document.scrollingElement ?? document.documentElement;
	return {
		fontSizes: [...fontSizes].sort((a, b) => Number.parseFloat(a) - Number.parseFloat(b)),
		textColors: [...textColors],
		radii: [...radii].sort(),
		arbitraryClasses: [...arbitraryClasses].sort(),
		lowContrast: measureContrast(root, document),
		overflow: measureOverflow(root, document),
		unevenToolbars: measureToolbars(root, document),
		pageOverflow: Math.max(0, scrolling.scrollWidth - scrolling.clientWidth),
	};
}

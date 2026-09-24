// webui/src/design/usage.ts
//
// What the product actually uses, counted from its own source. A scale or a
// variant list says what the system allows; this says what Gateship applies,
// so the scratchpad can tell an option in use from one that only exists, and
// a rule that holds from one that is only claimed.

export interface Usage {
	/** Padding, margin and gap steps in px, e.g. `{ 8: 214, 10: 31 }`. */
	spacing: Record<number, number>;
	/** Fixed heights and square sizes in px: the control rows in use. */
	heights: Record<number, number>;
	/** `text-*` steps, plus any arbitrary `text-[..]` size. */
	text: Record<string, number>;
	weights: Record<string, number>;
	radii: Record<string, number>;
	tokens: Record<string, number>;
	/** Component to axis to option, e.g. `Button.variant.outline`. */
	variants: Record<string, Record<string, Record<string, number>>>;
	/** How many times each component is rendered at all, e.g. `Button: 41`. */
	tags: Record<string, number>;
	files: number;
}

function bump<K extends string | number>(record: Record<K, number>, key: K): void {
	record[key] = (record[key] ?? 0) + 1;
}

const SPACING = /(?<![\w-])-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?)(?![\w.[])/g;
const HEIGHT = /(?<![\w-])(?:h|size|min-h)-(\d+(?:\.\d+)?)(?![\w.[])/g;
const TEXT = /(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl|\[[^\]\s]+\])(?![\w-])/g;
const WEIGHT = /(?<![\w-])font-(normal|medium|semibold|bold|\[[^\]\s]+\])(?![\w-])/g;
const RADIUS = /(?<![\w-])rounded(?:-(?:[trblse]{1,2}))?(?:-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]\s]+\]))?(?![\w-])/g;
const COLOR = /(?:bg|text|border|ring|shadow|fill|stroke|outline|from|to|via|divide|decoration)-([a-z][a-z-]*)/g;
/* `var(--token)` and Tailwind's `bg-(--token)` shorthand name the token outright. */
const VARIABLE = /\(--(?:color-)?([a-z-]+)\)/g;
const TAG = /<([A-Z][A-Za-z]*)\b/g;
const PROP = /<([A-Z][A-Za-z]*)\b([^<]*?)\b(variant|size|tone)="([\w-]+)"/g;

function countClasses(usage: Usage, source: string): void {
	for (const match of source.matchAll(SPACING)) bump(usage.spacing, Number(match[1]) * 4);
	for (const match of source.matchAll(HEIGHT)) bump(usage.heights, Number(match[1]) * 4);
	for (const match of source.matchAll(TEXT)) bump(usage.text, match[1]!);
	for (const match of source.matchAll(WEIGHT)) bump(usage.weights, match[1]!);
	for (const match of source.matchAll(RADIUS)) bump(usage.radii, match[1] ?? 'base');
}

function countTokens(usage: Usage, source: string, byLength: readonly string[]): void {
	for (const match of source.matchAll(COLOR)) {
		const token = byLength.find((candidate) => match[1] === candidate || match[1]!.startsWith(`${candidate}/`));
		if (token !== undefined) bump(usage.tokens, token);
	}
	for (const match of source.matchAll(VARIABLE)) if (byLength.includes(match[1]!)) bump(usage.tokens, match[1]!);
}

function countVariants(usage: Usage, source: string): void {
	for (const match of source.matchAll(TAG)) bump(usage.tags, match[1]!);
	for (const match of source.matchAll(PROP)) {
		const axes = (usage.variants[match[1]!] ??= {});
		bump((axes[match[3]!] ??= {}), match[4]!);
	}
}

export function measureUsage(sources: Record<string, string>, colorTokens: readonly string[]): Usage {
	const usage: Usage = { spacing: {}, heights: {}, text: {}, weights: {}, radii: {}, tokens: {}, variants: {}, tags: {}, files: 0 };
	/* Longest token first, so `muted-foreground` is not counted as `muted`. */
	const byLength = [...colorTokens].sort((a, b) => b.length - a.length);
	for (const raw of Object.values(sources)) {
		usage.files += 1;
		const source = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
		countClasses(usage, source);
		countTokens(usage, source, byLength);
		countVariants(usage, source);
	}
	return usage;
}

export interface SpacingFinding { file: string; className: string; px: number }

const SPACING_CLASS = /(?<![\w-])((?:[\w&\[\]>*=-]+:)*-?(?:p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?))(?![\w.[])/g;

/** Every spacing utility that is not a multiple of `grid` px, with the file it sits in. */
export function findOffGridSpacing(sources: Record<string, string>, grid = 4): SpacingFinding[] {
	const findings: SpacingFinding[] = [];
	for (const [file, raw] of Object.entries(sources)) {
		const source = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
		for (const match of source.matchAll(SPACING_CLASS)) {
			const px = Number(match[2]) * 4;
			if (px % grid !== 0) findings.push({ file: file.replace(/^\.\//, ''), className: match[1]!, px });
		}
	}
	return findings;
}

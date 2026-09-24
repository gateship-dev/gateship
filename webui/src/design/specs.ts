// webui/src/design/specs.ts
//
// A component's sheet, read from its own source so it cannot go stale: the
// axes it varies on (a `cva` variants block, or a `Record<Union, string>`
// class map), the parts it names (`data-slot`), the state it exposes as data
// attributes, and the semantic tokens it consumes. The scratchpad loads every
// kit file as text (`?raw`) and hands it here; nothing is declared twice.

export interface ComponentSpec {
	/** File name without extension, the name an operator asks for. */
	name: string;
	/** Exported component names, in source order. */
	exports: string[];
	/** Axis name to its options, e.g. `variant: [default, outline, ...]`. */
	axes: Record<string, string[]>;
	/** The option an axis takes when the prop is absent. */
	defaults: Record<string, string>;
	/** Every `data-slot` the file renders: the names the inspector reports. */
	parts: string[];
	/** Data attributes that carry state or variant, e.g. `data-variant`. */
	attributes: string[];
	/** Semantic colour tokens referenced by the file's classes. */
	tokens: string[];
	/** Tailwind arbitrary values in the file: choices outside the scale. */
	arbitrary: string[];
}

/** Index of the quote that closes the string literal opening at `open`. */
function stringEnd(text: string, open: number): number {
	const quote = text[open];
	for (let index = open + 1; index < text.length; index++) {
		if (text[index] === '\\') index++;
		else if (text[index] === quote) return index;
	}
	return text.length;
}

/**
 * Walks `text` from `from`, skipping string literals, and reports every other
 * character with the bracket depth it sits at. `visit` returns false to stop.
 */
function walk(text: string, from: number, visit: (char: string, index: number, depth: number) => boolean): void {
	let depth = 0;
	for (let index = from; index < text.length; index++) {
		const char = text[index]!;
		if ('\'"`'.includes(char)) { index = stringEnd(text, index); continue; }
		if ('{(['.includes(char)) depth++;
		if (!visit(char, index, depth)) return;
		if ('})]'.includes(char)) depth--;
	}
}

/** The text between the brace at `open` and its match, exclusive. */
function braceBody(source: string, open: number): string | null {
	let close = -1;
	walk(source, open, (char, index, depth) => {
		if (char === '}' && depth === 1) close = index;
		return close === -1;
	});
	return close === -1 ? null : source.slice(open + 1, close);
}

/**
 * Blanks the inside of every string literal that is a value, keeping the ones
 * that are keys (`'full-verify': ...`). Class strings are full of `name:`
 * sequences that would otherwise read as object keys.
 */
function maskValues(text: string): string {
	let masked = '';
	for (let index = 0; index < text.length; index++) {
		const char = text[index]!;
		if (!'\'"`'.includes(char)) { masked += char; continue; }
		const end = stringEnd(text, index);
		const literal = text.slice(index, end + 1);
		masked += /^\s*:/.test(text.slice(end + 1)) ? literal : `${char}${' '.repeat(Math.max(0, literal.length - 2))}${char}`;
		index = end;
	}
	return masked;
}

/** Keys at the first nesting level of an object body, quoted or bare. */
function topLevelKeys(source: string): string[] {
	const body = maskValues(source);
	const keys: string[] = [];
	for (const match of body.matchAll(/(?:^|[,{\n])\s*['"]?([\w-]+)['"]?\s*:/g)) {
		let depth = 0;
		walk(body, 0, (_char, index, current) => { depth = current; return index < match.index + match[0].length - 1; });
		if (depth === 0) keys.push(match[1]!);
	}
	return keys;
}

function nestedBody(body: string, key: string): string | null {
	const match = new RegExp(`(?:^|[\\s,{])['"]?${key}['"]?\\s*:\\s*\\{`).exec(body);
	return match === null ? null : braceBody(body, match.index + match[0].length - 1);
}

function cvaAxes(source: string): Record<string, string[]> {
	const axes: Record<string, string[]> = {};
	for (const match of source.matchAll(/variants\s*:\s*\{/g)) {
		const body = braceBody(source, match.index + match[0].length - 1);
		if (body === null) continue;
		for (const axis of topLevelKeys(body)) {
			const options = nestedBody(body, axis);
			if (options !== null) axes[axis] = topLevelKeys(options);
		}
	}
	return axes;
}

/** `const VARIANT: Readonly<Record<BadgeVariant, string>> = {...}` reads as the axis `variant`. */
function recordAxes(source: string): Record<string, string[]> {
	const axes: Record<string, string[]> = {};
	for (const match of source.matchAll(/const\s+([A-Z_]+)\s*:\s*(?:Readonly<)?Record<\s*([A-Za-z]+)\s*,\s*string\s*>+\s*=\s*\{/g)) {
		const body = braceBody(source, match.index + match[0].length - 1);
		if (body !== null) axes[match[1]!.toLowerCase()] = topLevelKeys(body);
	}
	return axes;
}

/** `defaultVariants: { variant: 'default' }` and parameter defaults such as `tone = 'neutral'`. */
function axisDefaults(source: string, axes: Record<string, string[]>): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const axis of Object.keys(axes)) {
		const match = new RegExp(`\\b${axis}\\s*[:=]\\s*'([\\w-]+)'`).exec(source);
		if (match !== null && axes[axis]!.includes(match[1]!)) defaults[axis] = match[1]!;
	}
	return defaults;
}

function unique(values: Iterable<string>): string[] {
	return [...new Set(values)].sort();
}

export function parseComponentSpec(path: string, source: string, colorTokens: readonly string[]): ComponentSpec {
	const name = path.replace(/^.*\//, '').replace(/\.tsx$/, '');
	const classy = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
	/* Longest token first, so `muted-foreground` is not reported as `muted`. */
	const byLength = [...colorTokens].sort((a, b) => b.length - a.length);
	const tokens = new Set<string>();
	for (const match of classy.matchAll(/(?:bg|text|border|ring|shadow|fill|stroke|outline|from|to|via|divide|decoration)-([a-z][a-z-]*)/g)) {
		const found = byLength.find((token) => match[1] === token || match[1]!.startsWith(`${token}/`));
		if (found !== undefined) tokens.add(found);
	}
	/* `var(--token)` in a style and Tailwind's `bg-(--token)` shorthand both name the token outright. */
	for (const match of classy.matchAll(/\(--(?:color-)?([a-z-]+)\)/g)) if (colorTokens.includes(match[1]!)) tokens.add(match[1]!);
	const axes = { ...recordAxes(classy), ...cvaAxes(classy) };
	return {
		name,
		defaults: axisDefaults(classy, axes),
		exports: [...source.matchAll(/^export (?:function|const) ([A-Z][A-Za-z]*)/gm)].map((match) => match[1]!),
		/* Parsed from `classy`: an apostrophe in a comment would open a string the scanner never closes. */
		axes,
		parts: unique([...source.matchAll(/data-slot="([^"]+)"/g)].map((match) => match[1]!)),
		attributes: unique([...source.matchAll(/\b(data-(?!slot)[a-z-]+)=\{/g)].map((match) => match[1]!)),
		tokens: unique(tokens),
		arbitrary: unique([...classy.matchAll(/(?<![\w-])((?:[a-z-]+:)*[a-z-]+-\[[^\]\s]+\])/g)].map((match) => match[1]!).filter((value) => !value.startsWith('['))),
	};
}

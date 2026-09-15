/**
 * Deterministic test-integrity guard (GSHIP-895): parses the pass/fail/skip
 * summary a verify command's own output exposes -- `bun test`'s summary is
 * the only shape currently recognized -- and checks whether an approved
 * spec's own text already names a removed test file, the one condition that
 * legitimizes a dropped count. Both functions read only what a command
 * already printed or the operator already approved; neither interprets
 * assertion semantics.
 */

export interface ParsedTestCounts {
	/** `pass + fail + skip` from the same summary, so a dropped total reflects the whole suite shrinking, not one bucket shifting to another. */
	total: number;
	skip: number;
}

const PASS_LINE = /^[ \t]*(\d+)[ \t]+pass[ \t]*$/m;
const FAIL_LINE = /^[ \t]*(\d+)[ \t]+fail[ \t]*$/m;
const SKIP_LINE = /^[ \t]*(\d+)[ \t]+skip[ \t]*$/m;

/**
 * `bun test` prints its summary to stderr, so callers must pass the combined
 * stdout+stderr text. Both a "pass" and a "fail" line are required -- `bun
 * test` always prints both, even when one side is zero -- so a command whose
 * output merely happens to contain an unrelated "N pass" line without the
 * rest of the summary is not mistaken for a real result.
 */
export function parseTestCounts(output: string): ParsedTestCounts | null {
	const pass = PASS_LINE.exec(output);
	const fail = FAIL_LINE.exec(output);
	if (pass === null || fail === null) return null;
	const skip = SKIP_LINE.exec(output);
	const passCount = Number(pass[1]);
	const failCount = Number(fail[1]);
	const skipCount = skip === null ? 0 : Number(skip[1]);
	return { total: passCount + failCount + skipCount, skip: skipCount };
}

const PATH_TOKEN = /[\w./-]+/g;

/**
 * A `PATH_TOKEN` match, stripped of any sentence-ending period a natural-
 * language sentence tacked on (`.` is a valid path character, so "removemos
 * a.test.ts." would otherwise keep that trailing period as part of the
 * token). No other punctuation needs stripping: everything else already
 * falls outside the token's character class and stops the match on its own.
 */
function normalizedPathToken(token: string): string {
	return token.replace(/\.+$/, '');
}

/**
 * Whether the approved spec's own boundaries/acceptance text already cites
 * `filePath` -- the only evidence this guard accepts for a legitimate
 * test-file removal. A citation must name the file exactly: either its full
 * relative path, or its bare filename as its own path token, never as a
 * substring of an unrelated path or a longer filename (`a.test.ts` inside
 * `data.test.ts`, or `foo.test.ts` inside a *different* directory's
 * `test/x/foo.test.ts` when the removed file is `test/y/foo.test.ts`) --
 * both of which name a different file, not this one. `approvedContractJson`
 * is the immutable approved issue record captured at run admission
 * (`RuntimeExecutionInput.approvedContract`); malformed or missing input is
 * never cited, never a reason to loosen the guard.
 */
export function specCitesTestFile(approvedContractJson: string | undefined, filePath: string): boolean {
	if (approvedContractJson === undefined) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(approvedContractJson);
	} catch {
		return false;
	}
	if (parsed === null || typeof parsed !== 'object') return false;
	const spec = (parsed as Record<string, unknown>)['spec'];
	if (spec === null || typeof spec !== 'object') return false;
	const { boundaries, acceptance } = spec as Record<string, unknown>;
	const text = [boundaries, acceptance]
		.flatMap((value) => Array.isArray(value) ? value : [])
		.filter((entry): entry is string => typeof entry === 'string')
		.join('\n');
	const basename = filePath.split('/').pop() ?? filePath;
	const tokens = text.match(PATH_TOKEN) ?? [];
	return tokens.some((token) => {
		const normalized = normalizedPathToken(token);
		return normalized === filePath || normalized === basename;
	});
}

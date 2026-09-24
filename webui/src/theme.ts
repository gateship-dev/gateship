// webui/src/theme.ts
//
// The theme has always had three states, not two: no stored choice means the
// screen follows the operating system, and `main.tsx` re-applies the system's
// preference whenever it changes. The old control was a single button, so it
// could only ever say light or dark, and the first press made following the
// system unreachable for good. Reading and writing the choice lives here, so
// the boot script and the control that offers it agree on one spelling.

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gship-theme';

/** The stored choice, or the system when nothing was chosen or the value is not one of ours. */
export function readThemeChoice(read: () => string | null): ThemeChoice {
	try {
		const stored = read();
		return stored === 'light' || stored === 'dark' ? stored : 'system';
	} catch {
		return 'system';
	}
}

/** Whether the screen is dark under this choice. */
export function themeIsDark(choice: ThemeChoice, prefersDark: boolean): boolean {
	return choice === 'system' ? prefersDark : choice === 'dark';
}

/**
 * Persists the choice and reports whether the screen is now dark. Choosing the
 * system removes the key, which is how "no choice" is spelled: a stored
 * 'system' would look like a choice to the boot script and pin the screen to
 * whatever the system happened to be at that moment.
 */
export function applyThemeChoice(
	choice: ThemeChoice,
	prefersDark: boolean,
	persist: (key: string, value: string | null) => void,
): boolean {
	try {
		persist(THEME_STORAGE_KEY, choice === 'system' ? null : choice);
	} catch {
		// The current screen stays usable when persistence is unavailable.
	}
	return themeIsDark(choice, prefersDark);
}

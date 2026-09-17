export type PresentationPlatform = 'macOS' | 'Windows' | 'Linux' | 'unknown';

export interface PlatformSignals {
	platform?: string;
	userAgentData?: { platform?: string };
}

export function presentationPlatform(signals?: PlatformSignals): PresentationPlatform {
	if (signals === undefined) {
		const runtime = globalThis as unknown as { navigator?: PlatformSignals };
		signals = runtime.navigator ?? {};
	}
	const platform = signals.userAgentData?.platform ?? signals.platform ?? '';
	if (/mac/i.test(platform)) return 'macOS';
	if (/win/i.test(platform)) return 'Windows';
	if (/linux/i.test(platform)) return 'Linux';
	return 'unknown';
}

type Modifier = 'alt' | 'control' | 'meta';

/* The switcher's choices take the digits in menu order, one hand on the
 * left of the row: 1 is every project, the registered projects follow from 2.
 * Eight projects carry a shortcut; the rest stay reachable from the menu. */
export const KEYBOARD_SHORTCUTS = {
	overview: { code: 'Digit1', key: '1', modifiers: ['alt'] as const, aria: 'Alt+1' },
	projects: [
		{ code: 'Digit2', key: '2', modifiers: ['alt'] as const }, { code: 'Digit3', key: '3', modifiers: ['alt'] as const },
		{ code: 'Digit4', key: '4', modifiers: ['alt'] as const }, { code: 'Digit5', key: '5', modifiers: ['alt'] as const },
		{ code: 'Digit6', key: '6', modifiers: ['alt'] as const }, { code: 'Digit7', key: '7', modifiers: ['alt'] as const },
		{ code: 'Digit8', key: '8', modifiers: ['alt'] as const }, { code: 'Digit9', key: '9', modifiers: ['alt'] as const },
	],
} as const;

/** How many registered projects carry a digit (2 to 9). */
export const PROJECT_SHORTCUT_COUNT = KEYBOARD_SHORTCUTS.projects.length;

export type ShortcutEvent = { key: string; code?: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey?: boolean };

function modifierSetMatches(event: ShortcutEvent, modifiers: readonly Modifier[]): boolean {
	return event.altKey === modifiers.includes('alt') && event.metaKey === modifiers.includes('meta') && event.ctrlKey === modifiers.includes('control') && event.shiftKey !== true;
}

export function matchesShortcut(event: ShortcutEvent, shortcut: { code: string; key: string; modifiers: readonly Modifier[] | readonly (readonly Modifier[])[] }): boolean {
	const modifierSets = shortcut.modifiers.length > 0 && Array.isArray(shortcut.modifiers[0])
		? shortcut.modifiers as readonly (readonly Modifier[])[]
		: [shortcut.modifiers as readonly Modifier[]];
	if (!modifierSets.some((modifiers) => modifierSetMatches(event, modifiers))) return false;
	return event.code === shortcut.code || ((event.code === undefined || event.code === '') && event.key === shortcut.key);
}

export function shortcutLabel(kind: 'overview' | 'project', index: number | undefined, platform: PresentationPlatform): string {
	if (kind === 'project' && index !== undefined) return platform === 'macOS' ? `⌥${index + 2}` : `Alt+${index + 2}`;
	return platform === 'macOS' ? '⌥1' : 'Alt+1';
}

export function projectShortcutAria(index: number): string { return `Alt+${index + 2}`; }

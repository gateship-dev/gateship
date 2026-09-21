// webui/src/design/exceptions.ts
//
// The contract's deliberate departures. A rule here is not a cage: it exists
// so the system gets used, and a choice outside it is allowed when it is a
// choice. What is not allowed is an accident. So every departure is written
// down with its reason, the gate fails on any that is not, and it fails on
// an entry nothing uses any more.

export interface DesignException {
	/** Path under webui/src. */
	file: string;
	/** The class as written, variants included. */
	className: string;
	reason: string;
}

/** A `<button>` a screen writes itself instead of the kit's `Button`. One entry per element, in file order. */
export const RAW_BUTTONS: readonly { file: string; reason: string }[] = [
	{
		file: 'screens/shell.tsx',
		reason: 'The tab bar\'s More is a tab, an icon over its name as wide as its share of the bar: the shape of a link tab, not of a Button. It is the render target of the kit\'s DropdownMenuTrigger.',
	},
	{
		file: 'screens/work-screen.tsx',
		reason: 'A backlog row that selects an issue: a full-width, left-aligned, multi-line list item with aria-pressed. It is a row of a list, not an action of a form.',
	},
];

/** Padding, margin and gap that are not a multiple of 4px. */
export const OFF_GRID_SPACING: readonly DesignException[] = [
	{
		file: 'components/ui/button.tsx',
		className: '[&_svg]:-mx-0.5',
		reason: 'Optical: a Hugeicons glyph carries about 2px of its own air, so the ink, not the box, lines up with the button padding. No grid value does this.',
	},
];

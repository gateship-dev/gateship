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

/** Padding, margin and gap that are not a multiple of 4px. */
export const OFF_GRID_SPACING: readonly DesignException[] = [
	{
		file: 'components/ui/button.tsx',
		className: '[&_svg]:-mx-0.5',
		reason: 'Optical: a Hugeicons glyph carries about 2px of its own air, so the ink, not the box, lines up with the button padding. No grid value does this.',
	},
];

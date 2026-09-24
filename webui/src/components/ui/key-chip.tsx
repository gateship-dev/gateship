// webui/src/components/ui/key-chip.tsx
//
// The one chip that says a shortcut. A key is shown in three places -- a menu
// row, a sidebar row and a hint -- and it is the same object in all three: an
// outline in the ink of whatever holds it. It carries no colour of its own,
// because a row changes colour under the pointer and when it is the current
// one, and a muted fill measured 4.31:1 against those tints, under the AA
// floor. Following its surface, the chip stays exactly as legible as the name
// beside it, wherever that name goes. `tooltip` is the same chip on the hint's
// own surface, which is not the app's canvas and carries its own tokens.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

const SURFACE = {
	row: 'border-border',
	tooltip: 'border-tooltip-border bg-tooltip-foreground/10',
} as const;

/* A chip that waits for the pointer keeps its slot while it waits, so pointing
 * at a row moves no text. It listens to the row that holds it, which names
 * itself `group/nav`, and to that row's focus ring as well: a key reached by
 * the keyboard has to be shown to someone who never hovers. */
const REVEAL = {
	always: '',
	hover: 'opacity-0 group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100',
} as const;

export function KeyChip({
	surface = 'row',
	reveal = 'always',
	className,
	...props
}: React.ComponentProps<'kbd'> & { surface?: keyof typeof SURFACE; reveal?: keyof typeof REVEAL }): React.ReactElement {
	return (
		/* The weight is declared, never inherited: a current row and a highlighted
		 * menu row set their own text in medium, and a key that thickens with the
		 * row reads as a different key. It is the same chip in every context. */
		<kbd
			className={cn('shrink-0 whitespace-nowrap rounded border px-1 font-mono font-normal text-xs leading-4', SURFACE[surface], REVEAL[reveal], className)}
			data-slot="key-chip"
			{...props}
		/>
	);
}

// webui/src/components/ui/disclosure-chevron.tsx
//
// The one affordance everything that opens wears: a card's summary, a
// collapsible inside a card, a table row, a list row. Same glyph, same turn,
// two sizes by density, always in a 16px slot so the label after it starts at
// the same place. The chevron does not know who owns it: a native <details>
// turns it with OWNS_CHEVRON (its own summary's chevron, never a descendant's),
// and a control that holds its state in React passes `open`.

import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

/** On a <details>: turn the chevron of its own summary while it is open. A named group would also turn the chevron of every disclosure nested inside an open one. */
export const OWNS_CHEVRON = '[&[open]>summary>[data-slot=disclosure-chevron]]:rotate-90';

export function DisclosureChevron({ dense = false, open = false, className }: { /** A row of a list or a table; a header takes the default. */ dense?: boolean; open?: boolean; className?: string }): React.ReactElement {
	/* The slot is the thing that turns, and it is 16px whatever the glyph's size. The glyph names its own size, so a Button around it does not resize it. */
	return (
		<span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center text-muted-foreground motion-safe:transition-transform', open && 'rotate-90', className)} data-slot="disclosure-chevron">
			<HugeiconsIcon className={dense ? 'size-3.5' : 'size-4'} icon={ArrowRight01Icon} size={dense ? 14 : 16} strokeWidth={dense ? 2.5 : 2.25} />
		</span>
	);
}

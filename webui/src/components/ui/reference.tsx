// webui/src/components/ui/reference.tsx
//
// An identifier: an issue, a run, a revision. Mono, because it is read
// character by character, and a link when there is somewhere to go. Never a
// badge: an id is not a state, and a coloured pill around it says it is.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

const SHAPE = 'type-data w-fit whitespace-nowrap text-xs';
const LINK = 'rounded-sm text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';

export function Reference({ children, href, title }: { children: React.ReactNode; href?: string; title?: string }): React.ReactElement {
	if (href === undefined) return <span className={cn(SHAPE, 'text-muted-foreground')} data-slot="reference" title={title}>{children}</span>;
	return <a className={cn(SHAPE, LINK)} data-slot="reference" href={href} title={title}>{children}</a>;
}

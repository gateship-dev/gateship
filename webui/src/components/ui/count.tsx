// webui/src/components/ui/count.tsx
//
// A number beside a label: a tab, a sidebar row, the bell. Mono and tabular,
// so a column of them lines up. `plain` is a figure with no surface (a sidebar
// row wears its row's colour), `chip` sits in a quiet pill, `strong` is the
// chip that has to be seen over an icon. `warning` says the number counts
// something waiting on the operator. A count says how many, and says nothing
// when there are none: zero renders no element at all.

import type React from 'react';
import { cn } from '../../lib/cn.ts';

const FORM = {
	plain: 'min-w-4 text-center',
	chip: 'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1',
} as const;

const TONE = {
	neutral: { plain: '', chip: 'bg-muted text-muted-foreground' },
	warning: { plain: 'text-warning-foreground', chip: 'bg-warning/16 text-warning-foreground dark:bg-warning/24' },
	strong: { plain: 'text-foreground', chip: 'bg-foreground text-background' },
} as const;

export function Count({
	children,
	form = 'chip',
	tone = 'neutral',
	className,
	...props
}: React.ComponentProps<'span'> & { form?: keyof typeof FORM; tone?: keyof typeof TONE }): React.ReactElement | null {
	if (children === 0 || children === '0') return null;
	return <span className={cn('font-mono text-xs tabular-nums', FORM[form], TONE[tone][form], className)} data-slot="count" {...props}>{children}</span>;
}

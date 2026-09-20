// webui/src/components/ui/tag.tsx
//
// A fixed attribute of the thing beside it, not a state: "This instance", "In
// use", "Read-only", the name of an analyzer, the kind of an event. Neutral
// outline, no hue, because nothing about it changes or asks for anything. It
// is the one short label that may lead with an icon, when the icon says where
// the thing comes from (a provider, a channel).

import type React from 'react';
import { sentenceCase } from './label-text.ts';

export function Tag({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }): React.ReactElement {
	return (
		<span
			className={
				'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-input bg-background font-medium text-foreground dark:bg-input/32 ' +
				'h-5.5 px-[calc(--spacing(1)-1px)] text-sm sm:h-4.5 sm:text-xs [&_svg]:size-3 [&_svg]:shrink-0 [&_svg]:opacity-80'
			}
			data-slot="tag"
		>
			{icon}
			{sentenceCase(children)}
		</span>
	);
}

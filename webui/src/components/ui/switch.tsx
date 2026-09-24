// webui/src/components/ui/switch.tsx
//
// A boolean that takes effect the moment it is flipped: no form, no save. A
// boolean that waits for a save button stays a checkbox (CheckField). The track
// is neutral in both states, ink when on: the brand's acid is the mark's alone.

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

export function Switch({ className, ...props }: Omit<SwitchPrimitive.Root.Props, 'className'> & { className?: string }): React.ReactElement {
	return (
		<SwitchPrimitive.Root
			className={cn(
				'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input outline-none ' +
					'focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-64 motion-safe:transition-colors ' +
					'pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-1/2',
				className,
			)}
			data-slot="switch"
			{...props}
		>
			{/* Off in the dark theme the track is a faint wash, so the thumb turns light to stay the thing the eye finds. */}
			<SwitchPrimitive.Thumb className="block size-4 rounded-full bg-background shadow-sm/10 data-checked:translate-x-4 motion-safe:transition-transform dark:data-unchecked:bg-muted-foreground" data-slot="switch-thumb" />
		</SwitchPrimitive.Root>
	);
}

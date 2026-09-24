// webui/src/components/ui/toggle-group.tsx
//
// shadcn's toggle group (base-nova style, registry fetched 2026-09-19) on
// the Base UI ToggleGroup primitive, with the kit's relative imports. The
// group carries variant, size and spacing down to its items through context
// so a caller styles the group once.

import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import type { VariantProps } from 'class-variance-authority';
import React from 'react';
import { cn } from '../../lib/cn.ts';
import { toggleVariants } from './toggle.tsx';

type GroupStyle = VariantProps<typeof toggleVariants> & { spacing?: number; orientation?: 'horizontal' | 'vertical' };

const ToggleGroupContext = React.createContext<GroupStyle>({ size: 'default', variant: 'default', spacing: 2, orientation: 'horizontal' });

export function ToggleGroup({
	className,
	variant,
	size,
	spacing = 2,
	orientation = 'horizontal',
	children,
	...props
}: Omit<ToggleGroupPrimitive.Props, 'className'> & { className?: string } & GroupStyle): React.ReactElement {
	return (
		<ToggleGroupPrimitive
			className={cn('group/toggle-group flex w-fit flex-row items-center gap-(--gap) rounded-lg data-vertical:flex-col data-vertical:items-stretch', className)}
			data-orientation={orientation}
			data-size={size}
			data-slot="toggle-group"
			data-spacing={spacing}
			data-variant={variant}
			style={{ '--gap': `calc(var(--spacing) * ${spacing})` } as React.CSSProperties}
			{...props}
		>
			<ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>{children}</ToggleGroupContext.Provider>
		</ToggleGroupPrimitive>
	);
}

export function ToggleGroupItem({ className, children, variant = 'default', size = 'default', ...props }: Omit<TogglePrimitive.Props, 'className'> & { className?: string } & VariantProps<typeof toggleVariants>): React.ReactElement {
	const context = React.useContext(ToggleGroupContext);
	return (
		<TogglePrimitive
			className={cn(
				'shrink-0 focus-visible:z-10 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:first:rounded-l-lg group-data-[spacing=0]/toggle-group:last:rounded-r-lg group-data-[spacing=0]/toggle-group:data-[variant=outline]:not-first:border-l-0',
				toggleVariants({ variant: context.variant ?? variant, size: context.size ?? size }),
				className,
			)}
			data-size={context.size ?? size}
			data-slot="toggle-group-item"
			data-spacing={context.spacing}
			data-variant={context.variant ?? variant}
			{...props}
		>
			{children}
		</TogglePrimitive>
	);
}

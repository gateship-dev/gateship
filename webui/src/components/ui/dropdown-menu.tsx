// webui/src/components/ui/dropdown-menu.tsx
//
// shadcn's dropdown menu (base-nova style, registry fetched 2026-09-19) on
// the Base UI Menu primitive, adapted to the kit: relative imports, the
// popup chrome the Select and the project switcher already use (bordered
// popover with its hairline bevel, not the registry's translucent ring),
// Hugeicons glyphs, and `data-highlighted` for the roving highlight, which
// is how the kit already styles menu rows.

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type React from 'react';
import { cn } from '../../lib/cn.ts';

export const POPUP_CHROME =
	'rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 ' +
	'before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] ' +
	'before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

const ITEM =
	'group/dropdown-menu-item relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1 min-h-8 text-sm outline-none ' +
	'data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-64 ' +
	"data-inset:pl-8 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export function DropdownMenu(props: MenuPrimitive.Root.Props): React.ReactElement {
	return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuPortal(props: MenuPrimitive.Portal.Props): React.ReactElement {
	return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

export function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props): React.ReactElement {
	return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
	align = 'start',
	alignOffset = 0,
	side = 'bottom',
	sideOffset = 4,
	className,
	...props
}: Omit<MenuPrimitive.Popup.Props, 'className'> & { className?: string } & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>): React.ReactElement {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner align={align} alignOffset={alignOffset} className="isolate z-50 outline-none" side={side} sideOffset={sideOffset}>
				<MenuPrimitive.Popup
					className={cn(
						'scroll-container relative max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-y-auto p-1 outline-none',
						POPUP_CHROME,
						'motion-safe:duration-100 motion-reduce:animate-none data-open:fade-in-0 data-open:zoom-in-95 data-open:animate-in data-closed:fade-out-0 data-closed:zoom-out-95 data-closed:animate-out',
						className,
					)}
					data-slot="dropdown-menu-content"
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

export function DropdownMenuGroup(props: MenuPrimitive.Group.Props): React.ReactElement {
	return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/** Must sit inside a DropdownMenuGroup: Base UI's GroupLabel reads the group's context. */
export function DropdownMenuLabel({ className, inset, ...props }: Omit<MenuPrimitive.GroupLabel.Props, 'className'> & { className?: string; inset?: boolean }): React.ReactElement {
	return <MenuPrimitive.GroupLabel className={cn('type-eyebrow px-2 pt-2 pb-1 text-muted-foreground data-inset:pl-8', className)} data-inset={inset} data-slot="dropdown-menu-label" {...props} />;
}

export function DropdownMenuItem({
	className,
	inset,
	variant = 'default',
	...props
}: Omit<MenuPrimitive.Item.Props, 'className'> & { className?: string; inset?: boolean; variant?: 'default' | 'destructive' }): React.ReactElement {
	return (
		<MenuPrimitive.Item
			className={cn(ITEM, variant === 'destructive' && 'text-destructive-foreground data-highlighted:bg-destructive/10 data-highlighted:text-destructive-foreground', className)}
			data-inset={inset}
			data-slot="dropdown-menu-item"
			data-variant={variant}
			{...props}
		/>
	);
}

export function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props): React.ReactElement {
	return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />;
}

export function DropdownMenuSubTrigger({ className, inset, children, ...props }: Omit<MenuPrimitive.SubmenuTrigger.Props, 'className'> & { className?: string; inset?: boolean }): React.ReactElement {
	return (
		<MenuPrimitive.SubmenuTrigger className={cn(ITEM, 'data-popup-open:bg-accent data-popup-open:text-accent-foreground', className)} data-inset={inset} data-slot="dropdown-menu-sub-trigger" {...props}>
			{children}
			<HugeiconsIcon className="ml-auto opacity-70" icon={ArrowRight01Icon} size={16} strokeWidth={2.25} />
		</MenuPrimitive.SubmenuTrigger>
	);
}

export function DropdownMenuSubContent({ align = 'start', alignOffset = -3, side = 'right', sideOffset = 0, ...props }: React.ComponentProps<typeof DropdownMenuContent>): React.ReactElement {
	return <DropdownMenuContent align={align} alignOffset={alignOffset} data-slot="dropdown-menu-sub-content" side={side} sideOffset={sideOffset} {...props} />;
}

function Indicator({ children }: { children: React.ReactNode }): React.ReactElement {
	return <span className="pointer-events-none absolute right-2 flex items-center justify-center" data-slot="dropdown-menu-indicator">{children}</span>;
}

export function DropdownMenuCheckboxItem({ className, children, checked, inset, ...props }: Omit<MenuPrimitive.CheckboxItem.Props, 'className'> & { className?: string; inset?: boolean }): React.ReactElement {
	return (
		<MenuPrimitive.CheckboxItem checked={checked} className={cn(ITEM, 'pr-8', className)} data-inset={inset} data-slot="dropdown-menu-checkbox-item" {...props}>
			<Indicator><MenuPrimitive.CheckboxItemIndicator><HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2.5} /></MenuPrimitive.CheckboxItemIndicator></Indicator>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

export function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props): React.ReactElement {
	return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

export function DropdownMenuRadioItem({ className, children, inset, ...props }: Omit<MenuPrimitive.RadioItem.Props, 'className'> & { className?: string; inset?: boolean }): React.ReactElement {
	return (
		<MenuPrimitive.RadioItem className={cn(ITEM, 'pr-8', className)} data-inset={inset} data-slot="dropdown-menu-radio-item" {...props}>
			<Indicator><MenuPrimitive.RadioItemIndicator><HugeiconsIcon icon={Tick02Icon} size={16} strokeWidth={2.5} /></MenuPrimitive.RadioItemIndicator></Indicator>
			{children}
		</MenuPrimitive.RadioItem>
	);
}

export function DropdownMenuSeparator({ className, ...props }: Omit<MenuPrimitive.Separator.Props, 'className'> & { className?: string }): React.ReactElement {
	return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} data-slot="dropdown-menu-separator" {...props} />;
}

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>): React.ReactElement {
	return <span className={cn('ml-auto font-mono text-muted-foreground text-xs group-data-highlighted/dropdown-menu-item:text-accent-foreground', className)} data-slot="dropdown-menu-shortcut" {...props} />;
}

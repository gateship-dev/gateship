import React from 'react';
import { cn } from '../../lib/cn.ts';

export type ChartConfig = Record<string, { label: string; color: string }>;

export function ChartContainer({ config, className, children, ...props }: React.ComponentProps<'div'> & { config: ChartConfig }): React.ReactElement {
	const variables = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]));
	return <div className={cn('h-64 w-full min-w-0', className)} style={variables} data-chart={JSON.stringify(config)} {...props}>{children}</div>;
}

export function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }): React.ReactElement | null {
	if (!active || payload === undefined || payload.length === 0) return null;
	return <div className="rounded-lg border bg-popover p-2 text-xs shadow-lg"><p className="font-mono text-muted-foreground">{label}</p>{payload.map((item) => <p className="mt-1 flex items-center gap-2" key={item.name}><span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}: <strong className="font-mono">{item.value ?? 0}</strong></p>)}</div>;
}

export function ChartLegendContent({ config, label = 'Chart legend', patternIds = {} }: { config: ChartConfig; label?: string; patternIds?: Record<string, string> }): React.ReactElement {
	return <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label={label}>{Object.entries(config).map(([key, item]) => <li className="flex items-center gap-2" key={key}><svg aria-hidden="true" className="size-3" viewBox="0 0 12 12"><rect width="12" height="12" fill={patternIds[key] === undefined ? item.color : `url(#${patternIds[key]})`} /></svg>{item.label}</li>)}</ul>;
}

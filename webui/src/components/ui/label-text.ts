// webui/src/components/ui/label-text.ts
//
// Every short label the kit prints (badge, tag, status) starts with a capital
// and leaves the rest as written: "Aguardando você", never "Aguardando Você".
// The rule lives here so a screen cannot forget it and a catalog entry written
// in lower case still reads right.

import type React from 'react';

export function sentenceCase(children: React.ReactNode): React.ReactNode {
	if (typeof children !== 'string' || children === '') return children;
	return children.charAt(0).toLocaleUpperCase() + children.slice(1);
}

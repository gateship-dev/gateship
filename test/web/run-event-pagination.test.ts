import { describe, expect, test } from 'bun:test';

import { advanceLiveGap, createLiveGap, type LiveGapDescriptor } from '../../webui/src/run-event-pagination.ts';

describe('run event pagination gaps', () => {
	test('recovers a multi-page gap with global interleaving and closes on its anchor', () => {
		let gap: LiveGapDescriptor | undefined = createLiveGap(undefined, 90, 200)!;
		const recovered = new Set<number>();
		const firstPage = [140, 142, 144, 146, 148, 150, 152, 154, 156, 158, 160, 162, 164, 166, 168, 170, 172, 174, 176, 178, 180, 182, 184, 186, 188, 190];
		for (const seq of firstPage.filter((seq) => seq > gap!.afterSeq!)) recovered.add(seq);
		gap = advanceLiveGap(gap, firstPage, firstPage, true)!;
		const secondPage = [90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139];
		for (const seq of secondPage.filter((seq) => seq > gap!.afterSeq!)) recovered.add(seq);
		gap = advanceLiveGap(gap!, secondPage, secondPage.filter((seq) => seq > gap!.afterSeq!), false)!;

		expect([...recovered].sort((a, b) => a - b)).toEqual([...new Set([...firstPage, ...secondPage].filter((seq) => seq > 90))].sort((a, b) => a - b));
		expect(gap).toBeUndefined();
	});

	test('keeps a null anchor and recovers exactly 51 terminal events', () => {
		let gap: LiveGapDescriptor | undefined = createLiveGap(undefined, undefined, 200)!;
		const recovered: number[] = [];
		const firstPage = Array.from({ length: 51 }, (_, index) => 149 + index);
		recovered.push(...firstPage.slice(-50));
		gap = advanceLiveGap(gap!, firstPage, firstPage.slice(-50), false, true)!;
		const secondPage = [149];
		recovered.push(...secondPage);
		gap = advanceLiveGap(gap, secondPage, secondPage, false);

		expect(gap).toBeUndefined();
		expect([...new Set(recovered)].sort((a, b) => a - b)).toEqual(recovered.sort((a, b) => a - b));
		expect(recovered).toHaveLength(51);
	});

	test('does not create an inverted gap while history overlaps the live replay', () => {
		expect(createLiveGap(undefined, 200, 150)).toBeUndefined();
	});
});

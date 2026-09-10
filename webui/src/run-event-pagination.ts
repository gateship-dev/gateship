export interface LiveGapDescriptor {
	beforeSeq: number;
	afterSeq: number | null;
}

export function createLiveGap(
	existing: LiveGapDescriptor | undefined,
	historicalLastSeq: number | undefined,
	beforeSeq: number,
): LiveGapDescriptor | undefined {
	const afterSeq = existing === undefined ? historicalLastSeq ?? null : existing.afterSeq;
	if (afterSeq !== null && afterSeq >= beforeSeq) return undefined;
	return { beforeSeq, afterSeq };
}

export function advanceLiveGap(
	gap: LiveGapDescriptor,
	pageSeqs: number[],
	acceptedSeqs: number[],
	hasPrevious: boolean,
	hasEligibleExcess = false,
): LiveGapDescriptor | undefined {
	const anchorFound = gap.afterSeq !== null && pageSeqs.includes(gap.afterSeq);
	if (anchorFound || (gap.afterSeq === null && !hasPrevious && !hasEligibleExcess)) return undefined;
	if (acceptedSeqs.length === 0) return gap;
	return { ...gap, beforeSeq: acceptedSeqs[0]! };
}

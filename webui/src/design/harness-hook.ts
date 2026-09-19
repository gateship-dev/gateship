// webui/src/design/harness-hook.ts
//
// Loaded by harness.html beside the harness itself, so the visual gate can
// read the contract's measurable half off the same page it photographs:
// contrast, overflow and toolbar heights, on the product alone. It is its own
// entry because it is browser code, and the harness module is also read by
// tests that compile without the DOM library.

import { measureDesign, type DesignReport } from './measure.ts';

declare global {
	interface Window { gateshipMeasureDesign?: () => DesignReport | null }
}

window.gateshipMeasureDesign = () => {
	const app = document.querySelector('[data-harness-app]');
	return app === null ? null : measureDesign(app, document);
};

function fixtureArgument(name: string): string | undefined {
	const prefix = `--fixture-${name}=`;
	return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const mode = fixtureArgument('mode') ?? 'complete';
const input = await Bun.stdin.text();

process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: 'codex-session-1' })}\n`);

if (mode === 'wait') {
	process.on('SIGTERM', () => process.exit(0));
	await new Promise(() => {});
} else if (mode === 'failed') {
	process.stdout.write(`${JSON.stringify({ type: 'turn.failed', error: { message: 'fixture failed' } })}\n`);
} else if (mode === 'error') {
	// Echoes the probed model/effort back in a turn.failed event, so a test can
	// confirm the probe's argv actually carried the chosen slot.
	const modelIndex = process.argv.indexOf('-m');
	const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : undefined;
	const effortArg = process.argv.find((argument) => argument.startsWith('model_reasoning_effort='));
	process.stdout.write(`${JSON.stringify({
		type: 'turn.failed',
		error: { message: `model "${model}" effort ${effortArg ?? '(none)'} not found` },
	})}\n`);
} else if (mode === 'structured-error-exit') {
	process.stdout.write(`${JSON.stringify({ type: 'error', message: 'structured fixture diagnostic' })}\n`);
	process.exitCode = 7;
} else if (mode === 'usage-limit') {
	process.stdout.write(`${JSON.stringify({
		type: 'turn.failed',
		error: { message: 'You have hit your usage limit. Try again later.' },
	})}\n`);
} else if (mode === 'usage-then-invalid') {
	// GSHIP-888: a `turn.completed` carrying usage, but with no `agent_message`
	// item ever reported, so the executor's own missing-summary check throws
	// `protocol-invalid` after usage was already reported for this call.
	process.stdout.write(`${JSON.stringify({
		type: 'turn.completed',
		usage: {
			input_tokens: 400, cached_input_tokens: 40, cache_write_input_tokens: 10,
			output_tokens: 80, reasoning_output_tokens: 20,
		},
	})}\n`);
} else {
	process.stdout.write(`${JSON.stringify({
		type: 'item.completed',
		item: { type: 'command_execution', command: '/not-persisted' },
	})}\n`);
	const status = mode === 'waiting-user' ? 'waiting-user' : 'completed';
	const verdict = fixtureArgument('verdict') ?? 'CLEAN';
	const proposal = fixtureArgument('proposal');
	const outputOutcome = fixtureArgument('outcome')
		?? (status === 'waiting-user' ? 'waiting-user-contract-change-required' : 'completed-unchanged');
	const output = mode === 'review'
		? {
			verdict,
			findings: verdict === 'CLEAN'
				? []
				: [{ file: 'src/reviewed.ts', summary: 'fixture finding' }],
		}
		: mode === 'invalid-reconciliation'
			? {
			status,
			summary: JSON.stringify({ argv: process.argv.slice(2), input }),
			proposals: proposal === undefined
				? []
				: [{ title: proposal, evidence: 'fixture evidence' }],
			reconciliation: {
				outcome: 'contract-change-required',
				summary: 'fixture reconciliation',
			},
			}
			: {
				outcome: outputOutcome,
				summary: JSON.stringify({ argv: process.argv.slice(2), input }),
				proposals: proposal === undefined ? [] : [{ title: proposal, evidence: 'fixture evidence' }],
				reconciliation: { summary: 'fixture reconciliation' },
			};
	process.stdout.write(`${JSON.stringify({
		type: 'item.completed',
		item: {
			type: 'agent_message',
			text: JSON.stringify(output),
		},
	})}\n`);
	// GSHIP-888: --fixture-usage=<full|zero|repeated> controls the reported
	// turn.completed.usage; absent keeps the pre-existing `{}` (nothing
	// measurable), so every test that predates this flag is unaffected.
	const fixtureUsage = fixtureArgument('usage');
	const fullUsage = {
		input_tokens: 1000, cached_input_tokens: 200, cache_write_input_tokens: 50,
		output_tokens: 300, reasoning_output_tokens: 75,
	};
	const zeroUsage = {
		input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0,
		output_tokens: 0, reasoning_output_tokens: 0,
	};
	const usage = fixtureUsage === 'full' || fixtureUsage === 'repeated' ? fullUsage
		: fixtureUsage === 'zero' ? zeroUsage
		: {};
	process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage })}\n`);
	if (fixtureUsage === 'repeated') {
		// A second, distinct turn.completed report within the same call: proves a
		// repeated protocol event is captured on its own, not merged or dropped.
		process.stdout.write(`${JSON.stringify({
			type: 'turn.completed',
			usage: { input_tokens: 5, cached_input_tokens: 1, cache_write_input_tokens: 1, output_tokens: 2, reasoning_output_tokens: 1 },
		})}\n`);
	}
}

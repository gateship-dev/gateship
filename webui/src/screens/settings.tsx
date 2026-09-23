// webui/src/screens/settings.tsx

import React, { useState } from 'react';
import type { AppProps } from '../app-props.ts';
import type { AgentSettingSource, DiagnosticCadenceView, DiagnosticsView, ModelRoleName, ModelSettingsView, ModelSlotView, NotificationChannelId, NotificationChannelView, ProviderStatusView } from '../client.ts';
import { emptyModelSettings, MODEL_PROVIDER_IDS, MODEL_ROLE_NAMES, NOTIFICATION_CHANNEL_IDS } from '../client.ts';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Tag } from '../components/ui/tag.tsx';
import { CardFooter } from '../components/ui/card.tsx';
import { CheckField, FormField, FormStack } from '../components/ui/card-layout.tsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/collapsible.tsx';
import { Input } from '../components/ui/input.tsx';
import { SelectField } from '../components/ui/select.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import type { Locale, SettingsCatalog } from '../locale.ts';
import { applyThemeChoice, readThemeChoice, type ThemeChoice } from '../theme.ts';
import type { ProviderUsageView, ProviderUsageWindowView } from '../run-view.ts';
import { ActionButton, ContextPanel, SectionCard } from './operator-controls.tsx';
import { TEXT_LINK_CLASS } from './operator-links.ts';
import type { ProviderPanelProps } from './runs.tsx';
import { fieldReader, formatCount, formatExactPercent, formatRunTimestamp, formatUsageTime, providerDescription, usageWindowLabel, usageWindowVariant } from './runs.tsx';

export function ProviderUsageWindowRow({ window, locale, catalog }: { window: ProviderUsageWindowView; locale: Locale; catalog: SettingsCatalog }): React.ReactElement {
	const percent = window.usedPercent === undefined ? null : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(window.usedPercent / 100);
	return (
		<li className="flex flex-wrap items-center gap-2">
			<span>{usageWindowLabel(window, locale, catalog)}</span>
			{window.usedPercent === undefined ? null : (
				<Badge variant={usageWindowVariant(window.status)}>{catalog.providers.usedPercent(percent ?? '')}</Badge>
			)}
			{window.resetsAt === undefined ? null : (
				<span>{catalog.providers.resets} <time dateTime={window.resetsAt}>{formatUsageTime(window.resetsAt, locale)}</time></span>
			)}
			<span className="text-muted-foreground">
				{catalog.providers.asOf} <time dateTime={window.observedAt}>{formatUsageTime(window.observedAt, locale)}</time>
			</span>
		</li>
	);
}

/** Compact progressive detail (GSHIP-664): each piece of the source's telemetry renders only when present, never absent as a fabricated zero. */
export function ProviderUsageDetail({ usage, locale, catalog }: { usage: ProviderUsageView | undefined; locale: Locale; catalog: SettingsCatalog }): React.ReactElement | null {
	if (usage === undefined) return null;
	const hasContent = usage.windows.length > 0
		|| usage.credits !== undefined
		|| usage.spendLimit !== undefined
		|| usage.resetCreditCount !== undefined;
	if (!hasContent) return null;
	return (
		<div className="mt-1 flex flex-col gap-1 text-xs">
			{usage.windows.length === 0 ? null : (
				<ul className="flex flex-col gap-1">
					{usage.windows.map((window) => <ProviderUsageWindowRow catalog={catalog} key={window.window} locale={locale} window={window} />)}
				</ul>
			)}
			{usage.credits === undefined ? null : (
				<p className="text-muted-foreground">
					{catalog.providers.credits}: {usage.credits.unlimited
						? catalog.providers.unlimited
						: usage.credits.hasCredits
							? (usage.credits.balance ?? catalog.providers.available)
							: catalog.providers.none}
				</p>
			)}
			{usage.spendLimit === undefined ? null : (
				<p className="text-muted-foreground">
					{catalog.providers.spendLimit(usage.spendLimit.used, usage.spendLimit.limit, formatExactPercent(usage.spendLimit.remainingPercent, locale))}
					{usage.spendLimit.resetsAt === undefined ? null : (
						<> · {catalog.providers.resets} <time dateTime={usage.spendLimit.resetsAt}>{formatUsageTime(usage.spendLimit.resetsAt, locale)}</time></>
					)}
				</p>
			)}
			{usage.resetCreditCount === undefined ? null : (
				<p className="text-muted-foreground">{catalog.providers.resetCredits(usage.resetCreditCount, formatCount(usage.resetCreditCount, locale))}</p>
			)}
		</div>
	);
}

/**
 * Read-only whenever `CLAUDE_CODE_OAUTH_TOKEN` is set in the service's own
 * environment (GSHIP-704): it always wins over the file, so a Settings write
 * here would create or remove a file with no effect on what actually
 * authenticates. The service refuses the write server-side too (PUT/DELETE
 * both answer 409 `env-managed`); this component keeps Ajustes from ever
 * offering an action that route would reject.
 */
export function ClaudeCredentialEnvManagedNotice({
	provider,
	text,
}: {
	provider: ProviderStatusView;
	text: SettingsCatalog['providers']['claudeCredential'];
}): React.ReactElement {
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
			<p>{provider.subscription ? text.connected : text.needsReconnect}</p>
			<p className="text-muted-foreground text-xs">{text.usageGuidance}</p>
			<p className="text-muted-foreground text-xs">{text.envManaged}</p>
		</div>
	);
}

/**
 * The connected card: what a dedicated credential offers once it is in
 * place. Rotating opens the same token form Connect uses, which is itself
 * only offered while `provider.installed`. Gating Rotate the same way means
 * the form the operator is sent to is always actually reachable, so
 * Disconnect -- the one escape from a connected card -- is never left
 * unrenderable with the Claude CLI absent (installed:false plus
 * login:'dedicated' is a real status `claudeStatus` reports on an ENOENT
 * read).
 *
 * That absent-CLI case is also the one where this card, not the form, has to
 * carry a refusal: a single missing `claude` binary both fails the validation
 * closed and makes the very next status read report `installed: false`, and
 * the form -- alert span included -- is gated on `installed`. Showing the
 * service's own words here, beside a Disconnect that stays enabled, is what
 * keeps that combination from stranding the operator with a silent card.
 */
export function ClaudeCredentialConnectedCard({
	provider,
	pending,
	onRotate,
	error,
	onDismissError,
	onDisconnectClaudeCredential,
	text,
}: {
	provider: ProviderStatusView;
	pending: boolean;
	onRotate: () => void;
	error: AppProps['claudeCredentialError'];
	onDismissError: AppProps['onDismissClaudeCredentialError'];
	onDisconnectClaudeCredential: AppProps['onDisconnectClaudeCredential'];
	text: SettingsCatalog['providers']['claudeCredential'];
}): React.ReactElement {
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
			<p>{provider.subscription ? text.connected : text.needsReconnect}</p>
			<p className="text-muted-foreground text-xs">{text.usageGuidance}</p>
			{error === null ? null : <span className="text-destructive text-xs" role="alert">{error}</span>}
			<div className="flex flex-wrap gap-2">
				{provider.installed ? (
					<Button variant="outline" onClick={onRotate} type="button">{text.rotate}</Button>
				) : null}
				{error === null ? null : (
					<Button variant="outline" onClick={onDismissError} type="button">{text.cancel}</Button>
				)}
				<Button className="self-end" variant="destructive"
					disabled={pending}
					onClick={onDisconnectClaudeCredential}
					type="button"
				>{text.disconnect}</Button>
			</div>
		</div>
	);
}

/**
 * Ajustes > Providers universal onboarding for a dedicated Claude
 * subscription (GSHIP-704). `rotating` is local, ephemeral UI state -- never
 * lifted to `AppProps` -- the same "reveal a form behind a button" pattern
 * `IssueReviewForm`'s own confirm gate already uses. Connect, reconnect and
 * rotate all submit through the one `onConnectClaudeCredential` call; the
 * server validates the candidate token before persisting it and never
 * returns it, so this form is write-only exactly like the Resend key field.
 *
 * A refusal (GSHIP-705) keeps the form open with the typed token and its
 * confirmation untouched, and shows the service's own words beside the
 * field: the token was printed once by `claude setup-token`, so clearing it
 * on failure would cost the operator the credential itself. That is why
 * `error` forces the form open even from the connected card -- a rotation
 * that was refused must not collapse back to "connected" with the refusal
 * hidden.
 *
 * `provider.installed` outranks both, because the form is gated on it: with
 * the Claude CLI absent, neither a refusal nor a `rotating` flag set while it
 * was still installed may route a connected operator to a branch that renders
 * no form, no Cancel and no Disconnect. The connected card carries the
 * refusal in that case instead.
 */
export function ClaudeCredentialSection({
	provider,
	pending,
	onConnectClaudeCredential,
	error,
	onDismissError,
	onDisconnectClaudeCredential,
	catalog,
}: {
	provider: ProviderStatusView;
	pending: boolean;
	onConnectClaudeCredential: AppProps['onConnectClaudeCredential'];
	error: AppProps['claudeCredentialError'];
	onDismissError: AppProps['onDismissClaudeCredentialError'];
	onDisconnectClaudeCredential: AppProps['onDisconnectClaudeCredential'];
	catalog: SettingsCatalog;
}): React.ReactElement {
	const text = catalog.providers.claudeCredential;
	const [rotating, setRotating] = useState(false);
	const [token, setToken] = useState('');
	const [confirmed, setConfirmed] = useState(false);
	const connected = provider.login === 'dedicated';

	if (provider.credential?.envManaged === true) {
		return <ClaudeCredentialEnvManagedNotice provider={provider} text={text} />;
	}

	if (connected && (!provider.installed || (!rotating && error === null))) {
		return (
			<ClaudeCredentialConnectedCard
				error={error}
				onDisconnectClaudeCredential={onDisconnectClaudeCredential}
				onDismissError={onDismissError}
				onRotate={() => setRotating(true)}
				pending={pending}
				provider={provider}
				text={text}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-3 rounded-md border border-border p-3 text-sm">
			<p className="font-medium">{text.advancedTitle}</p>
			<p className="text-muted-foreground">{text.explanation}</p>
			<p className="text-muted-foreground text-xs">{text.inferenceOnly}</p>
			{provider.installed ? (
				<div className="flex flex-col gap-1">
					<span className="text-muted-foreground text-xs">{text.setupCommandLabel}</span>
					<div className="flex flex-wrap items-center gap-2">
						<code className="break-all">claude setup-token</code>
						<Button variant="outline"
							onClick={() => {
								const clipboard = (globalThis as unknown as {
									navigator?: { clipboard?: { writeText?: (value: string) => Promise<void> } };
								}).navigator?.clipboard;
								void clipboard?.writeText?.('claude setup-token');
							}}
							type="button"
						>{text.copyCommand}</Button>
					</div>
				</div>
			) : (
				<p className="text-muted-foreground text-xs">{text.cliMissing}</p>
			)}
			{provider.installed ? (
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						// Only a persisted credential clears the field: a refused token is
						// still the one the operator must correct, and the CLI will not
						// print it a second time.
						void onConnectClaudeCredential(token).then((connectedNow) => {
							if (!connectedNow) return;
							setToken('');
							setConfirmed(false);
							setRotating(false);
						});
					}}
				>
					<FormField htmlFor="claude-credential-token">
						<span className="font-medium">{text.tokenLabel}</span>
						<Input
							autoComplete="off"
							disabled={pending}
							id="claude-credential-token"
							name="claude-credential-token"
							onChange={(event) => setToken((event.currentTarget as unknown as { value: string }).value)}
							placeholder={text.tokenPlaceholder}
							type="password"
							value={token}
						/>
						{error === null ? null : <span className="text-destructive text-xs" role="alert">{error}</span>}
					</FormField>
					<CheckField>
						<input
							checked={confirmed}
							name="claude-credential-confirm"
							onChange={(event) => setConfirmed((event.currentTarget as unknown as { checked: boolean }).checked)}
							type="checkbox"
						/>
						<span>{text.confirm}</span>
					</CheckField>
					<div className="flex flex-wrap gap-2">
						<Button className="self-end"
							disabled={pending || token.trim().length === 0 || !confirmed}
							type="submit"
						>{connected ? text.rotate : text.connect}</Button>
						{connected ? (
							<Button variant="outline"
								onClick={() => {
									// Giving up on this attempt: the refusal that forced the form
									// open goes with it, or Cancel would leave the form open.
									onDismissError();
									setToken('');
									setConfirmed(false);
									setRotating(false);
								}}
								type="button"
							>{text.cancel}</Button>
						) : null}
					</div>
				</form>
			) : null}
		</div>
	);
}

export function ClaudeInteractiveLoginNotice({
	provider,
	text,
}: {
	provider: ProviderStatusView;
	text: SettingsCatalog['providers']['claudeCredential'];
}): React.ReactElement {
	return (
		<div className="flex flex-col gap-2 text-sm">
			<p className="font-medium">{text.recommendedTitle}</p>
			<p className="text-muted-foreground">{text.recommendedGuidance}</p>
			<p className="text-muted-foreground text-xs">{text.usageGuidance}</p>
			{provider.installed ? (
				<div className="flex flex-col gap-1">
					<span className="text-muted-foreground text-xs">{text.recommendedCommandLabel}</span>
					<code className="break-all">claude auth login --claudeai</code>
				</div>
			) : <p className="text-muted-foreground text-xs">{text.cliMissing}</p>}
		</div>
	);
}

export function ProviderRow({
	provider,
	catalog,
	locale,
	selectedProvider,
	pending,
	onConnectCodex,
	onConnectClaudeCredential,
	claudeCredentialError,
	onDismissClaudeCredentialError,
	onDisconnectClaudeCredential,
	onSelectProvider,
}: Omit<ProviderPanelProps, 'providers'> & { provider: ProviderStatusView; catalog: SettingsCatalog; locale: Locale }): React.ReactElement {
	return (
		<li className="flex flex-col gap-3 rounded-lg border p-4 text-sm" data-provider={provider.id} data-slot="provider-block">
			{/* State and action on the first line: what it is, whether it is the one in use, what can be done about it. */}
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-1">
					<p className="flex flex-wrap items-center gap-2 font-medium">
						{provider.label}
						{provider.id === selectedProvider ? <Tag>{catalog.providers.inUse}</Tag> : null}
						{provider.id === 'claude' ? <Tag>{catalog.providers.claudeCredential.originLabels[provider.login]}</Tag> : null}
					</p>
					<p className="break-words text-muted-foreground">{providerDescription(provider, catalog)}</p>
				</div>
				{provider.id === 'codex' && !provider.subscription && provider.installed ? (
					<ActionButton enabled={!pending} label={catalog.providers.connectChatGpt} onClick={onConnectCodex} />
				) : null}
				{provider.subscription && provider.id !== selectedProvider ? (
					<ActionButton
						enabled={!pending}
						label={catalog.providers.useProvider(provider.label)}
						onClick={() => onSelectProvider(provider.id)}
					/>
				) : null}
			</div>
			<ProviderUsageDetail catalog={catalog} locale={locale} usage={provider.usage} />
			{provider.id === 'claude' ? (
				<ClaudeCredentialSection
					catalog={catalog}
					error={claudeCredentialError}
					onConnectClaudeCredential={onConnectClaudeCredential}
					onDisconnectClaudeCredential={onDisconnectClaudeCredential}
					onDismissError={onDismissClaudeCredentialError}
					pending={pending}
					provider={provider}
				/>
			) : null}
			{/* How to sign in is reference: open while the provider still needs it, folded once it is connected. */}
			{provider.id === 'claude' && provider.login === 'dedicated' ? null : (
				<Collapsible defaultOpen={!provider.subscription}>
					<CollapsibleTrigger>{catalog.providers.signInHelp}</CollapsibleTrigger>
					<CollapsibleContent>
						<div className="flex flex-col gap-2 p-3">
							{provider.id === 'claude' ? <ClaudeInteractiveLoginNotice provider={provider} text={catalog.providers.claudeCredential} /> : (
								<div className="flex flex-col gap-1 text-muted-foreground text-xs">
									<p>{catalog.providers.codexSubscriptionGuidance}</p>
									<code className="break-all">codex login</code>
									<p>{catalog.providers.codexApiKeyWarning}</p>
									<p>{catalog.providers.codexEnterpriseFuture}</p>
								</div>
							)}
						</div>
					</CollapsibleContent>
				</Collapsible>
			)}
		</li>
	);
}

function AgentSourceNotice({ catalog, source }: { catalog: SettingsCatalog; source: AgentSettingSource }): React.ReactElement {
	return <p className="text-muted-foreground text-sm">{catalog.agentSources[source === 'global' ? 'global' : source === 'project' ? 'project' : 'providerDefault']}</p>;
}

export function ProvidersPanel(props: ProviderPanelProps & Pick<AppProps, 'providerSource' | 'onResetProvider'> & { catalog: SettingsCatalog; locale: Locale }): React.ReactElement {
	return (
		<SectionCard
			description={props.catalog.providers.description}
			title={props.catalog.providers.title}
	>
		<AgentSourceNotice catalog={props.catalog} source={props.providerSource} />
		<ul className="flex flex-col gap-3">
				{props.providers.map((provider) => (
					<ProviderRow
						catalog={props.catalog}
						claudeCredentialError={props.claudeCredentialError}
						key={provider.id}
						locale={props.locale}
						onConnectClaudeCredential={props.onConnectClaudeCredential}
						onConnectCodex={props.onConnectCodex}
						onDisconnectClaudeCredential={props.onDisconnectClaudeCredential}
						onDismissClaudeCredentialError={props.onDismissClaudeCredentialError}
						onSelectProvider={props.onSelectProvider}
						pending={props.pending}
						provider={provider}
						selectedProvider={props.selectedProvider}
					/>
			))}
		</ul>
		{props.providerSource === 'project' ? (
			<CardFooter><Button variant="outline" disabled={props.pending} onClick={props.onResetProvider} type="button">
				{props.catalog.agentSources.resetProvider}
			</Button></CardFooter>
		) : null}
		</SectionCard>
	);
}

export const MODEL_PROVIDER_LABELS: Readonly<Record<ProviderStatusView['id'], string>> = {
	claude: 'Claude',
	codex: 'Codex',
};

/**
 * Each vendor's own model page. Gateship cannot track vendor releases, so it
 * points at the source of truth instead of embedding a list that goes stale:
 * the field stays free text and an unknown value is refused by the CLI itself.
 */
export const MODEL_DOC_URLS: Readonly<Record<ProviderStatusView['id'], string>> = {
	claude: 'https://platform.claude.com/docs/en/about-claude/models/overview',
	codex: 'https://learn.chatgpt.com/docs/models',
};

/** Reads all six slots out of the one form that was just submitted. */
export function readModelSettings(form: EventTarget): ModelSettingsView {
	const value = fieldReader(form);
	const settings = emptyModelSettings();
	for (const providerId of MODEL_PROVIDER_IDS) {
		for (const role of MODEL_ROLE_NAMES) {
			settings[providerId][role] = {
				model: value(`${providerId}-${role}-model`),
				effort: value(`${providerId}-${role}-effort`),
			};
		}
	}
	return settings;
}

/*
 * One role: its name leads the row and each field is labelled by its row and
 * its column. From `sm` the column head says what a field is, once, and the
 * field's own label goes quiet; on a narrow screen the row stacks and the
 * labels are what is left to read.
 */
export function ModelSlotFields({
	providerId,
	role,
	slot,
	catalog,
}: {
	providerId: ProviderStatusView['id'];
	role: ModelRoleName;
	slot: ModelSlotView;
	catalog: SettingsCatalog;
}): React.ReactElement {
	const roleLabel = catalog.models.roleLabels[role];
	/* The model takes two of the row's columns, the effort one. A wrapper carries the span: a static string the design lint can read. */
	const field = (kind: 'model' | 'effort'): React.ReactElement => (
		<FormField measure="full" htmlFor={`${providerId}-${role}-${kind}`}>
			<span className="sr-only">{`${roleLabel} — ${catalog.models[kind]}`}</span>
			<span aria-hidden="true" className="text-muted-foreground text-xs capitalize sm:hidden">{catalog.models[kind]}</span>
			<Input defaultValue={slot[kind]} id={`${providerId}-${role}-${kind}`} mono name={`${providerId}-${role}-${kind}`} placeholder={catalog.models.cliDefault} />
		</FormField>
	);
	return (
		<div className="grid gap-2 border-t py-3 first:border-0 sm:grid-cols-4 sm:items-center sm:gap-3 sm:border-0 sm:py-0" data-slot="model-slot">
			<span className="font-medium text-sm">{roleLabel}</span>
			<div className="min-w-0 sm:col-span-2">{field('model')}</div>
			<div className="min-w-0">{field('effort')}</div>
		</div>
	);
}

/* A provider's slots are a grid, role by (model, effort). */
export function ModelProviderFields({
	providerId,
	modelSettings,
	catalog,
}: Pick<AppProps, 'modelSettings'> & {
	providerId: ProviderStatusView['id'];
	catalog: SettingsCatalog;
}): React.ReactElement {
	return (
		<fieldset className="flex flex-col gap-2" data-slot="model-provider">
			<legend className="font-medium text-sm">{MODEL_PROVIDER_LABELS[providerId]}</legend>
			<a className={TEXT_LINK_CLASS} href={MODEL_DOC_URLS[providerId]} rel="noreferrer noopener" target="_blank">{catalog.models.documentation(MODEL_PROVIDER_LABELS[providerId])}</a>
			<div aria-hidden="true" className="hidden text-muted-foreground text-sm sm:grid sm:grid-cols-4 sm:gap-3" data-slot="model-columns">
				<span>{catalog.models.role}</span><span className="col-span-2 capitalize">{catalog.models.model}</span><span className="capitalize">{catalog.models.effort}</span>
			</div>
			{MODEL_ROLE_NAMES.map((role) => <ModelSlotFields catalog={catalog} key={role} providerId={providerId} role={role} slot={modelSettings[providerId][role]} />)}
		</fieldset>
	);
}

/**
 * The operator's own model choice, one slot per provider and role. Leaving a
 * field empty passes no flag at all, so each CLI keeps deciding exactly as it
 * did before this section existed.
 */
export function ModelSettingsPanel({
	modelSettings,
	modelSettingsSource,
	pending,
	onSaveModelSettings,
	onResetModelSettings,
	catalog,
}: Pick<AppProps, 'modelSettings' | 'modelSettingsSource' | 'pending' | 'onSaveModelSettings' | 'onResetModelSettings'> & { catalog: SettingsCatalog }): React.ReactElement {
	return (
		<SectionCard
			description={catalog.models.description}
			title={catalog.models.title}
	>
		<AgentSourceNotice catalog={catalog} source={modelSettingsSource} />
		<FormStack
				// Re-synced with the server's answer after a save, the only thing that
				// changes this record while the operator is looking at it.
				key={JSON.stringify(modelSettings)}
				onSubmit={(event) => {
					event.preventDefault();
					onSaveModelSettings(readModelSettings(event.currentTarget));
				}}
			>
				{MODEL_PROVIDER_IDS.map((providerId) => (
					<ModelProviderFields
						catalog={catalog}
						key={providerId}
						modelSettings={modelSettings}
						providerId={providerId}
					/>
				))}
				<CardFooter>
					{modelSettingsSource === 'project' ? (
						<Button variant="outline" disabled={pending} onClick={onResetModelSettings} type="button">
							{catalog.agentSources.resetModels}
						</Button>
					) : null}
					<Button disabled={pending} type="submit">
						{catalog.models.save}
					</Button>
				</CardFooter>
			</FormStack>
		</SectionCard>
	);
}

/** Registry-owned defaults use the same free-text fields and CLI validation as project overrides. */
export function AgentDefaultsPanel({
	agentDefaults,
	pending,
	onSaveAgentDefaults,
	catalog,
}: Pick<AppProps, 'agentDefaults' | 'pending' | 'onSaveAgentDefaults'> & { catalog: SettingsCatalog }): React.ReactElement {
	return (
		<SectionCard description={catalog.agentDefaults.description} title={catalog.agentDefaults.title}>
			<FormStack
				key={JSON.stringify(agentDefaults)}
				onSubmit={(event) => {
					event.preventDefault();
					const provider = fieldReader(event.currentTarget)('agent-default-provider');
					onSaveAgentDefaults({
						provider: provider === 'codex' ? 'codex' : 'claude',
						modelSettings: readModelSettings(event.currentTarget),
					});
				}}
			>
				<FormField htmlFor="agent-default-provider">
					<span className="font-medium">{catalog.agentDefaults.provider}</span>
					<SelectField
						defaultValue={agentDefaults.provider}
						id="agent-default-provider"
						className="w-full sm:w-64"
						items={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }]}
						name="agent-default-provider"
					/>
				</FormField>
				{MODEL_PROVIDER_IDS.map((providerId) => (
					<ModelProviderFields catalog={catalog} key={providerId} modelSettings={agentDefaults.modelSettings} providerId={providerId} />
				))}
				<CardFooter><Button disabled={pending} type="submit">
					{catalog.agentDefaults.save}
				</Button></CardFooter>
			</FormStack>
		</SectionCard>
	);
}

/**
 * The switch that lets the runtime start the next admissible issue by itself
 * once a run ends in `done` (GSHIP-638). It creates no new authority: it only
 * starts what the operator already approved, and it never approves, reviews
 * or promotes anything on its own. Off by default, because autonomy never
 * turns itself on. A stopped queue is reported in the shell header instead of
 * here (GSHIP-650): it is a state that asks for attention, not configuration.
 */
export function ChainRunsPanel({
	chainRuns,
	pending,
	onSetChainRuns,
	catalog,
}: Pick<AppProps, 'chainRuns' | 'pending' | 'onSetChainRuns'> & { catalog: SettingsCatalog }): React.ReactElement {
	return (
		<SectionCard
			description={catalog.chain.description}
			title={catalog.chain.title}
		>
			<CheckField className="items-center">
				<Switch checked={chainRuns.enabled} disabled={pending} onCheckedChange={(checked) => onSetChainRuns(checked)} />
				<span className="font-medium">{catalog.chain.label}</span>
			</CheckField>
		</SectionCard>
	);
}

/**
 * The executor handoff opt-in (GSHIP-722): off by default, same shape as
 * `ChainRunsPanel`. Turning it on lets a run transfer only its executor role
 * to the other provider, once, when the primary reports a subscription usage
 * limit or a rate limit while implementing.
 */
export function ExecutorHandoffPanel({
	executorHandoff,
	pending,
	onSetExecutorHandoff,
	catalog,
}: Pick<AppProps, 'executorHandoff' | 'pending' | 'onSetExecutorHandoff'> & { catalog: SettingsCatalog }): React.ReactElement {
	return (
		<SectionCard
			description={catalog.executorHandoff.description}
			title={catalog.executorHandoff.title}
		>
			<CheckField className="items-center">
				<Switch checked={executorHandoff.enabled} disabled={pending} onCheckedChange={(checked) => onSetExecutorHandoff(checked)} />
				<span className="font-medium">{catalog.executorHandoff.label}</span>
			</CheckField>
		</SectionCard>
	);
}

export function SelfUpdatePanel({
	selfUpdate,
	pending,
	onSetSelfUpdate,
	catalog,
	locale,
}: Pick<AppProps, 'selfUpdate' | 'pending' | 'onSetSelfUpdate'> & { catalog: SettingsCatalog; locale: Locale }): React.ReactElement {
	const unavailable = selfUpdate.availability.kind !== 'native';
	return (
		<SectionCard
			description={catalog.updates.description}
			title={catalog.updates.title}
		>
			<CheckField className="items-center">
				<Switch checked={selfUpdate.enabled} disabled={pending || unavailable || selfUpdate.applying} onCheckedChange={(checked) => onSetSelfUpdate(checked)} />
				<span className="font-medium">{catalog.updates.label}</span>
			</CheckField>
			<p className="text-muted-foreground text-xs">
				{catalog.updates.guidance}
			</p>
			{unavailable ? (
				<p className="text-muted-foreground text-sm">{selfUpdate.availability.reason}</p>
			) : null}
			{selfUpdate.available !== null ? (
				<p className="text-sm">{catalog.updates.available}: v{selfUpdate.available.version} ({selfUpdate.available.commit})</p>
			) : null}
			{selfUpdate.result !== null ? (
				<div className="flex flex-col gap-1 text-sm">
					<Badge variant={selfUpdate.result.status === 'success' ? 'success' : 'warning'}>
						{catalog.updates.statusLabels[selfUpdate.result.status]}
					</Badge>
					<p>{selfUpdate.result.reason}</p>
					<p className="text-muted-foreground text-xs">
						{catalog.updates.result(selfUpdate.result.previousVersion, selfUpdate.result.targetVersion ?? catalog.updates.unknown, formatUsageTime(selfUpdate.result.at, locale))}
					</p>
				</div>
			) : null}
		</SectionCard>
	);
}

/**
 * ntfy's own publish docs, and Resend's own API-key and domain-verification
 * pages: DNS verification happens outside Gateship (GSHIP-653), which is the
 * part an operator following this panel actually gets stuck on, so both of
 * Resend's pages are linked, not just the key page.
 */
export const NOTIFICATION_CHANNEL_DOCS: Readonly<Record<NotificationChannelId, ReadonlyArray<{ label: 'ntfy' | 'resendApiKeys' | 'resendDomain'; href: string }>>> = {
	ntfy: [{ label: 'ntfy', href: 'https://docs.ntfy.sh/publish/' }],
	resend: [
		{ label: 'resendApiKeys', href: 'https://resend.com/api-keys' },
		{ label: 'resendDomain', href: 'https://resend.com/domains' },
	],
};

/** Setup instructions text, the one part of the row that differs enough per channel to branch on directly. */
export const NOTIFICATION_INSTRUCTION_VALUES: Readonly<Record<string, string>> = {
	file: '', url: 'GATESHIP_NTFY_URL', key: 'GATESHIP_RESEND_API_KEY', from: 'GATESHIP_RESEND_FROM', to: 'GATESHIP_RESEND_TO',
};

export function NotificationChannelInstructions({ channelId, catalog }: { channelId: NotificationChannelId; catalog: SettingsCatalog }): React.ReactElement {
	const values: Readonly<Record<string, string>> = { ...NOTIFICATION_INSTRUCTION_VALUES, file: channelId === 'resend' ? 'GATESHIP_HOME/.gship/resend-api-key' : 'GATESHIP_HOME/.gship/ntfy-url' };
	return <>{catalog.notifications.instructions[channelId].split(/(\{(?:file|url|key|from|to)\})/).map((part) => {
		const key = part.startsWith('{') ? part.slice(1, -1) : null;
		return key === null ? part : <code className="break-all" key={key}>{values[key]}</code>;
	})}</>;
}

/**
 * One remote channel's status, test button and setup instructions (GSHIP-652,
 * GSHIP-653). Never renders a secret, or any field that could carry one --
 * `channel.configured` is a boolean, `channel.missing` names only which
 * values are absent, and the instructions name files and env vars, not
 * values.
 */
export function NotificationChannelRow({
	channelId,
	channel,
	pending,
	onSendNotificationTest,
	onSaveResendSettings,
	onRemoveResendCredential,
	catalog,
}: {
	channelId: NotificationChannelId;
	channel: NotificationChannelView;
	pending: boolean;
	onSendNotificationTest: (channelId: NotificationChannelId) => void;
	onSaveResendSettings: AppProps['onSaveResendSettings'];
	onRemoveResendCredential: AppProps['onRemoveResendCredential'];
	catalog: SettingsCatalog;
}): React.ReactElement {
	const label = catalog.notifications.channelLabels[channelId];
	const resendForm = channelId === 'resend' ? (
		<form
			className="flex flex-col gap-3"
			key={JSON.stringify(channel)}
			onSubmit={(event) => {
				event.preventDefault();
				const read = fieldReader(event.currentTarget);
				onSaveResendSettings({ from: read('resend-from'), to: read('resend-to'), apiKey: read('resend-api-key') });
			}}
		>
			{/* The fields keep a reading measure; the actions close the block on its own edge, as a card's footer does. */}
			<div className="grid max-w-3xl gap-3 sm:grid-cols-2">
			{(['from', 'to'] as const).map((field) => (
				<FormField measure="full" key={field}>
					<span className="font-medium">
						{catalog.notifications.resendFields[field]}
						{channel.externallyManaged[field] ? ` · ${catalog.notifications.externallyManaged}` : null}
					</span>
					<Input
						defaultValue={channel[field] ?? ''}
						disabled={pending}
						maxLength={512}
						name={`resend-${field}`}
						placeholder={catalog.notifications.resendPlaceholders[field]}
						required
					/>
				</FormField>
			))}
			<FormField className="sm:col-span-2" measure="full">
				<span className="font-medium">
					{catalog.notifications.resendFields.apiKey}
					{channel.externallyManaged.apiKey ? ` · ${catalog.notifications.externallyManaged}` : null}
				</span>
				<Input
					autoComplete="new-password"
					disabled={pending}
					name="resend-api-key"
					placeholder={catalog.notifications.resendPlaceholders.apiKey}
					type="password"
				/>
			</FormField>
			<p className="text-muted-foreground text-xs sm:col-span-2">
				{channel.fileCredentialExists ? catalog.notifications.fileCredentialPresent : catalog.notifications.fileCredentialAbsent}
			</p>
			</div>
			<div className="flex flex-col gap-2 sm:flex-row sm:justify-end" data-slot="channel-actions">
				<Button variant="destructive"
					disabled={pending || !channel.fileCredentialExists}
					onClick={onRemoveResendCredential}
					type="button"
				>
					{catalog.notifications.removeResendCredential}
				</Button>
				<Button disabled={pending} type="submit">
					{catalog.notifications.saveResend}
				</Button>
			</div>
		</form>
	) : null;
	return (
		<li className="flex flex-col gap-3 rounded-lg border p-4 text-sm" data-channel={channelId} data-slot="notification-channel">
			{/* State and action on the first line, as a provider block reads: what it is, whether it works, how to try it. */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="flex flex-wrap items-center gap-2 font-medium">
					{label}
					<Badge variant={channel.configured ? 'success' : 'neutral'}>{channel.configured ? catalog.notifications.configured : catalog.notifications.notConfigured}</Badge>
					{!channel.configured && channel.missing.length > 0 ? <span className="font-normal text-muted-foreground">{catalog.notifications.missing(channel.missing.join(', '))}</span> : null}
				</p>
				<ActionButton
					enabled={channel.configured && !pending}
					label={catalog.notifications.sendTest}
					onClick={() => onSendNotificationTest(channelId)}
				/>
			</div>
			{resendForm}
			{/* Files and variables are reference: open while the channel still needs them, folded once it works. */}
			<Collapsible defaultOpen={!channel.configured}>
				<CollapsibleTrigger>{catalog.notifications.setupHelp}</CollapsibleTrigger>
				<CollapsibleContent>
					<p className="p-3 text-muted-foreground">
						<NotificationChannelInstructions catalog={catalog} channelId={channelId} />
						{NOTIFICATION_CHANNEL_DOCS[channelId].map((doc) => (
							<React.Fragment key={doc.href}>
								{' '}
								<a className={TEXT_LINK_CLASS} href={doc.href} rel="noreferrer noopener" target="_blank">
									{catalog.notifications.docLabels[doc.label]}
								</a>
							</React.Fragment>
						))}
					</p>
				</CollapsibleContent>
			</Collapsible>
		</li>
	);
}

export function NotificationsPanel({
	notificationChannels,
	notificationPermission,
	onEnableNotifications,
	onSendNotificationTest,
	onSaveResendSettings,
	onRemoveResendCredential,
	pending,
	catalog,
}: Pick<
	AppProps,
	'notificationChannels' | 'notificationPermission' | 'onEnableNotifications' | 'onSendNotificationTest' | 'onSaveResendSettings' | 'onRemoveResendCredential' | 'pending'
> & { catalog: SettingsCatalog }): React.ReactElement {
	const actionLabel = catalog.notifications.actionLabels[notificationPermission];
	return (
		<SectionCard
			description={catalog.notifications.description}
			title={catalog.notifications.title}
		>
			<ul className="flex flex-col gap-3">
				<li className="flex flex-col gap-1 rounded-lg border p-4 text-sm" data-channel="browser" data-slot="notification-channel">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="font-medium">{catalog.notifications.browserLabel}</p>
						<ActionButton
							enabled={notificationPermission === 'default'}
							label={actionLabel}
							onClick={onEnableNotifications}
						/>
					</div>
					<p className="text-muted-foreground">{catalog.notifications.permissionStates[notificationPermission]}</p>
				</li>
					{NOTIFICATION_CHANNEL_IDS.map((channelId) => (
						<NotificationChannelRow
							catalog={catalog}
							channel={notificationChannels[channelId]}
							channelId={channelId}
							key={channelId}
							onSendNotificationTest={onSendNotificationTest}
							onSaveResendSettings={onSaveResendSettings}
							onRemoveResendCredential={onRemoveResendCredential}
							pending={pending}
						/>
					))}
			</ul>
		</SectionCard>
	);
}

/**
 * The transcript: one scroll region, announced as a log and reachable by the
 * keyboard, that opens at the newest turn and follows later ones only while the
 * operator stands at the live edge (./live-edge.ts). The empty state lives
 * inside the same region so the region -- and its label -- never moves.
 */
/*
 * The transcript follows the chat-primitive grammar: system entries render as
 * markers (a quiet centered status line between rules), the operator's turns
 * are compact bubbles on the right, and the orchestrator's turns are
 * documents, no bubble, because prose reads better as a page than as a
 * terminal dump. Every header datum (provider, time) speaks mono.
 */

export const BRIEF_LISTS: readonly {
	name: 'decisions' | 'constraints' | 'openItems';
}[] = [
	{ name: 'decisions' },
	{ name: 'constraints' },
	{ name: 'openItems' },
];

/** One item per line; blank lines are what an operator leaves while typing. */
export function briefLines(value: string): string[] {
	return value
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * The durable context the operator owns between external agent sessions.
 */
export function ProjectBriefPanel({
	brief,
	pending,
	onSaveBrief,
	catalog,
}: Pick<AppProps, 'brief' | 'pending' | 'onSaveBrief'> & { catalog: SettingsCatalog }): React.ReactElement {
	return (
		<SectionCard
			description={catalog.brief.description}
			title={catalog.brief.title}
		>
			<FormStack
				key={JSON.stringify(brief)}
				onSubmit={(event) => {
					event.preventDefault();
					const value = fieldReader(event.currentTarget);
					onSaveBrief({
						objective: value('objective'),
						decisions: briefLines(value('decisions')),
						constraints: briefLines(value('constraints')),
						openItems: briefLines(value('openItems')),
					});
				}}
			>
				<FormField measure="prose" htmlFor="brief-objective">
					<span className="font-medium">{catalog.brief.fieldLabels.objective}</span>
					<Textarea
						className="min-h-16"
						defaultValue={brief.objective}
						id="brief-objective"
						name="objective"
					/>
				</FormField>
				{BRIEF_LISTS.map((field) => (
					<FormField measure="prose" htmlFor={`brief-${field.name}`} key={field.name}>
						<span className="font-medium">{catalog.brief.fieldLabels[field.name]}</span>
						<Textarea
							className="min-h-20"
							defaultValue={brief[field.name].join('\n')}
							id={`brief-${field.name}`}
							name={field.name}
							placeholder={catalog.brief.linePlaceholder}
						/>
					</FormField>
				))}
				{/* The brief runs to screens of text: the way to save it stays in reach. */}
				<CardFooter sticky><Button disabled={pending} type="submit">
					{catalog.brief.save}
				</Button></CardFooter>
			</FormStack>
		</SectionCard>
	);
}

/**
 * The service is older than the code it reads from, said where the shell
 * already carries global state so it is on every surface and stays there until
 * the restart clears it. It is a statement, not a decision: no button, no
 * dismissal, nothing held back.
 */

export function ProjectPanel({ project, catalog }: Pick<AppProps, 'project'> & { catalog: SettingsCatalog }): React.ReactElement {
	const ready = project.state === 'ready';
	return (
		<SectionCard
			description={catalog.project.description}
			title={catalog.project.title}
		>
			<div className="flex flex-col gap-3 text-sm">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant={ready ? 'success' : project.state === 'checking' ? 'neutral' : 'warning'}>
						{ready ? catalog.project.stateLabels.ready : project.state === 'checking' ? catalog.project.stateLabels.checking : catalog.project.stateLabels.attention}
					</Badge>
					<span className="font-medium">{project.name === '' ? catalog.project.localProject : project.name}</span>
				</div>
				{ready ? (
					<dl className="grid gap-2 sm:grid-cols-facts">
						<dt className="text-muted-foreground">{catalog.project.repository}</dt>
						<dd><code className="break-all">{project.repository}</code></dd>
						<dt className="text-muted-foreground">{catalog.project.runSource}</dt>
						<dd><code className="break-all">{project.sourceRef}</code></dd>
					</dl>
				) : (
					<p className="text-muted-foreground">{project.detail}</p>
				)}
			</div>
		</SectionCard>
	);
}

/**
 * How this screen looks and which language it speaks. Both were buttons in the
 * shell's top row, where an operational console should carry the work and not
 * the preferences that are set once. Neither reaches the service: they live in
 * this browser, so they apply the moment they are chosen and have no save.
 *
 * The theme offers the system as a choice because it always was one -- no
 * stored value means the screen follows the operating system, and the boot
 * script keeps following it as the system changes. The single button could
 * only say light or dark, so the first press took that state away for good.
 */
export function InterfacePanel({
	locale,
	onSelectLocale,
	catalog,
}: Pick<AppProps, 'locale' | 'onSelectLocale'> & { catalog: SettingsCatalog }): React.ReactElement {
	const browser = globalThis as unknown as {
		localStorage?: { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; removeItem: (key: string) => void };
		matchMedia?: (query: string) => { matches: boolean };
		document?: { documentElement: { classList: { toggle: (token: string, force: boolean) => void } } };
	};
	const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice(() => browser.localStorage?.getItem('gship-theme') ?? null));
	const [width, setWidth] = useState<'centered' | 'wide'>(() => browser.localStorage?.getItem('gship-width') === 'wide' ? 'wide' : 'centered');
	const chooseTheme = (choice: ThemeChoice): void => {
		const dark = applyThemeChoice(choice, browser.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false, (key, value) => {
			if (value === null) browser.localStorage?.removeItem(key);
			else browser.localStorage?.setItem(key, value);
		});
		browser.document?.documentElement.classList.toggle('dark', dark);
		setTheme(choice);
	};
	const chooseWidth = (choice: 'centered' | 'wide'): void => {
		browser.localStorage?.setItem('gship-width', choice);
		browser.document?.documentElement.classList.toggle('gship-wide', choice === 'wide');
		setWidth(choice);
	};
	return (
		<SectionCard description={catalog.interface.description} title={catalog.interface.title}>
			<FormField htmlFor="interface-theme">
				<span className="font-medium">{catalog.interface.theme}</span>
				<SelectField
					className="w-full sm:w-64"
					id="interface-theme"
					items={[
						{ value: 'system', label: catalog.interface.themeChoices.system },
						{ value: 'light', label: catalog.interface.themeChoices.light },
						{ value: 'dark', label: catalog.interface.themeChoices.dark },
					]}
					onValueChange={(value) => chooseTheme(value as ThemeChoice)}
					value={theme}
				/>
			</FormField>
			{/* The measure the screen is read at: a preference like the other two, and the last control that was still a button in the row at the top. */}
			<FormField htmlFor="interface-width">
				<span className="font-medium">{catalog.interface.width}</span>
				<SelectField
					className="w-full sm:w-64"
					id="interface-width"
					items={[
						{ value: 'centered', label: catalog.interface.widthChoices.centered },
						{ value: 'wide', label: catalog.interface.widthChoices.wide },
					]}
					onValueChange={(value) => chooseWidth(value as 'centered' | 'wide')}
					value={width}
				/>
			</FormField>
			<FormField htmlFor="interface-language">
				<span className="font-medium">{catalog.interface.language}</span>
				<SelectField
					className="w-full sm:w-64"
					id="interface-language"
					items={[{ value: 'en-US', label: 'English (US)' }, { value: 'pt-BR', label: 'Português (Brasil)' }]}
					onValueChange={(value) => onSelectLocale(value as Locale)}
					value={locale}
				/>
			</FormField>
		</SectionCard>
	);
}

export function OperatorProfilePanel({
	operatorProfile,
	pending,
	suggestedTimezone,
	onSaveOperatorProfile,
	catalog,
}: Pick<
	AppProps,
	'operatorProfile' | 'pending' | 'suggestedTimezone' | 'onSaveOperatorProfile'
> & { catalog: SettingsCatalog }): React.ReactElement {
	const initialTimezone = operatorProfile.timezone || suggestedTimezone;
	return (
		<SectionCard
			description={catalog.operator.description}
			title={catalog.operator.title}
		>
			<FormStack
				key={JSON.stringify([operatorProfile, suggestedTimezone])}
				onSubmit={(event) => {
					event.preventDefault();
					const value = fieldReader(event.currentTarget);
					onSaveOperatorProfile({
						name: value('operator-name'),
						timezone: value('operator-timezone'),
					});
				}}
			>
				<FormField htmlFor="operator-name">
					<span className="font-medium">{catalog.operator.name}</span>
					<Input
						defaultValue={operatorProfile.name}
						id="operator-name"
						name="operator-name"
						placeholder={catalog.operator.namePlaceholder}
					/>
				</FormField>
				<FormField htmlFor="operator-timezone">
					<span className="font-medium">{catalog.operator.timezone}</span>
					<Input
						defaultValue={initialTimezone}
						id="operator-timezone"
						name="operator-timezone"
						placeholder={catalog.operator.timezonePlaceholder}
					/>
					<span className="text-muted-foreground text-xs">
						{catalog.operator.timezoneGuidance}
					</span>
				</FormField>
				<CardFooter><Button disabled={pending} type="submit">
					{catalog.operator.save}
				</Button></CardFooter>
			</FormStack>
		</SectionCard>
	);
}

export function DiagnosticSchedulePanel({
	catalog,
	diagnostics,
	locale,
	pending,
	onSave,
}: {
	catalog: SettingsCatalog;
	diagnostics: DiagnosticsView;
	locale: Locale;
	pending: boolean;
	onSave: AppProps['onSaveDiagnosticSchedule'];
}): React.ReactElement {
	const active = diagnostics.scan?.state === 'queued' || diagnostics.scan?.state === 'running';
	const schedule = diagnostics.schedule;
	return (
		<ContextPanel
			description={catalog.diagnostics.description}
			title={catalog.diagnostics.title}
		>
			<FormStack
				aria-busy={active}
				key={JSON.stringify(schedule)}
				onSubmit={(event) => {
					event.preventDefault();
					const fields = (event.currentTarget as unknown as {
						elements: { namedItem: (name: string) => unknown };
					}).elements;
					const enabled = (fields.namedItem('diagnostic-enabled') as { checked: boolean }).checked;
					const cadence = (fields.namedItem('diagnostic-cadence') as { value: string }).value as DiagnosticCadenceView;
					onSave(enabled, cadence);
				}}
			>
				<CheckField className="items-center" htmlFor="diagnostic-enabled">
					<input defaultChecked={schedule.enabled} id="diagnostic-enabled" name="diagnostic-enabled" type="checkbox" />
					<span className="font-medium">{catalog.diagnostics.label}</span>
				</CheckField>
				<FormField htmlFor="diagnostic-cadence">
					<span className="font-medium">{catalog.diagnostics.cadence}</span>
					<SelectField
						defaultValue={schedule.cadence}
						id="diagnostic-cadence"
						items={[
							{ value: 'daily', label: catalog.diagnostics.cadenceLabels.daily },
							{ value: 'weekly', label: catalog.diagnostics.cadenceLabels.weekly },
						]}
						name="diagnostic-cadence"
					/>
				</FormField>
				<p className="text-muted-foreground text-xs">
					{active
						? catalog.diagnostics.calculating
						: !schedule.enabled
							? catalog.diagnostics.disabled
							: schedule.overdue
								? catalog.diagnostics.overdue
								: schedule.nextRunAt === null
									? catalog.diagnostics.calculating
									: catalog.diagnostics.nextRun(formatRunTimestamp(schedule.nextRunAt, locale))}

				</p>
				<p className="text-muted-foreground text-xs">{catalog.diagnostics.guidance}</p>
				<CardFooter><Button disabled={pending} type="submit">
					{catalog.diagnostics.save}
				</Button></CardFooter>
			</FormStack>
		</ContextPanel>
	);
}

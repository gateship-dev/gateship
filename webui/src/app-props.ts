import type {
	ChainRunsView,
	AgentDefaultsView,
	AgentSettingSource,
	CreateProjectInput,
	DiagnosticCadenceView,
	DiagnosticsView,
	ExecutorHandoffSettingView,
	GitIdentityView,
	IssueReviewDraft,
	ModelSettingsView,
	NotificationChannelId,
	NotificationChannelsView,
	OperatorIssueDraft,
	OperatorProfileView,
	OperatorSpecDraft,
	ProjectBriefView,
	ProjectOperationalOverviewView,
	ProjectStatusView,
	ProposalView,
	ProviderStatusView,
	RegisteredProjectView,
	ResolvedProposalView,
	SelfUpdateView,
	StaleServiceView,
	WorkspaceNoticeView,
} from './client.ts';
import type { Locale } from './locale.ts';
import type { BrowserNotificationPermission } from './notifications.ts';
import type { OperatorRoute } from './routes.ts';
import type { PlannableIssue, RunEventView, RunView } from './run-view.ts';
import type { OperationalFailures, OperationalLoaded, OperationalPending } from './operational-snapshot.ts';

/** Complete pure-render contract for the operator application. */
/**
 * What an action on several rows did to each. It is not a transaction and
 * does not pretend to be one: some rows can settle while others are refused,
 * and the operator is told which, with the service's own reason.
 */
export interface BulkOutcome { settled: string[]; failed: { id: string; reason: string }[] }

/** Reads what each row's own request did, in the order the rows were asked. A refusal keeps the service's message as its reason. */
export function bulkOutcome(ids: readonly string[], results: readonly PromiseSettledResult<unknown>[]): BulkOutcome {
	const outcome: BulkOutcome = { settled: [], failed: [] };
	results.forEach((result, index) => {
		const id = ids[index] ?? '';
		if (result.status === 'fulfilled') outcome.settled.push(id);
		else outcome.failed.push({ id, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
	});
	return outcome;
}

export interface AppProps {
	operationalBoundary?: { state: 'loading' } | { state: 'failure'; detail: string; onRetry: () => void };
	operationalRefreshFailure?: { detail: string; onRetry: () => void };
	operationalFailures?: OperationalFailures;
	operationalLoaded?: OperationalLoaded;
	operationalPending?: OperationalPending;
	onNavigate?: (destination: string) => void;
	/** Clears the persisted project filter when the operator picks every project. */
	onSelectAllProjects?: () => void;
	route: OperatorRoute;
	surfaceRoute?: OperatorRoute;
	/** Persisted context for overview navigation; it never scopes operational reads. */
	selectedProjectId?: string | null;
	locale: Locale;
	backlog: readonly PlannableIssue[];
	ideas: readonly PlannableIssue[];
	drafts: readonly IssueReviewDraft[];
	proposals: readonly ProposalView[];
	diagnostics: DiagnosticsView;
	resolvedProposals: readonly ResolvedProposalView[];
	resolvedProposalsOmittedCount: number;
	events: readonly RunEventView[];
	runEventsHasPrevious?: boolean;
	runEventsLoading?: boolean;
	onLoadPreviousRunEvents?: () => Promise<void>;
	workspaceNotices: readonly WorkspaceNoticeView[];
	providers: readonly ProviderStatusView[];
	brief: ProjectBriefView;
	project: ProjectStatusView;
	projects: readonly RegisteredProjectView[];
	overview?: ProjectOperationalOverviewView | null;
	overviewLoading?: boolean;
	overviewError?: string | null;
	operatorProfile: OperatorProfileView;
	suggestedTimezone: string;
	modelSettings: ModelSettingsView;
	modelSettingsSource: AgentSettingSource;
	agentDefaults: AgentDefaultsView;
	chainRuns: ChainRunsView;
	executorHandoff: ExecutorHandoffSettingView;
	selectedProvider: ProviderStatusView['id'];
	providerSource: AgentSettingSource;
	notificationPermission: BrowserNotificationPermission;
	notificationChannels: NotificationChannelsView;
	selfUpdate: SelfUpdateView;
	runs: readonly RunView[];
	/** The address names a run, and neither the recent list nor the service knows it. */
	requestedRunMissing?: boolean;
	selectedIssueId: string | null;
	version: string;
	staleService: StaleServiceView | null;
	gitIdentity: GitIdentityView | null;
	status: string | null;
	pending: boolean;
	projectOnboardingPending: 'create' | 'import' | null;
	claudeCredentialError: string | null;
	onSelectIssue: (issueId: string) => void;
	onSelectLocale: (locale: Locale) => void;
	onCreateIssue: (input: OperatorIssueDraft) => void;
	onSpecifyIssue: (issueId: string, input: OperatorSpecDraft) => void;
	onReviewIssue: (issueId: string, input: OperatorSpecDraft) => void;
	onApproveIssue: (issueId: string) => void;
	onAbandonIssue: (issueId: string, reason: string) => void;
	onDismissProposal: (proposalId: string) => void;
	/** Dismisses several proposals, each on its own. Absent, the list offers no selection. */
	onDismissProposals?: (proposalIds: readonly string[]) => Promise<BulkOutcome>;
	onPromoteProposal: (proposalId: string, input: OperatorIssueDraft) => void;
	onStartDiagnostic: (analyzer: string) => void;
	onCancelDiagnostic: (scanId: string) => void;
	onDismissDiagnosticFinding: (findingId: string) => void;
	/** Dismisses several findings, each on its own. Absent, the list offers no selection. */
	onDismissDiagnosticFindings?: (findingIds: readonly string[]) => Promise<BulkOutcome>;
	onPromoteDiagnosticFinding: (findingId: string, input: OperatorIssueDraft) => void;
	onSaveDiagnosticSchedule: (enabled: boolean, cadence: DiagnosticCadenceView) => void;
	onStart: () => void;
	onResume: (operatorGuidance?: string) => void;
	onAbandon: () => void;
	onCancel: () => void;
	onShip: () => void;
	onConnectCodex: () => void;
	onConnectClaudeCredential: (token: string) => Promise<boolean>;
	onDismissClaudeCredentialError: () => void;
	onDisconnectClaudeCredential: () => void;
	onEnableNotifications: () => void;
	onSendNotificationTest: (channelId: NotificationChannelId) => void;
	onSaveResendSettings: (input: { from: string; to: string; apiKey: string }) => void;
	onRemoveResendCredential: () => void;
	onSelectProvider: (providerId: ProviderStatusView['id']) => void;
	onResetProvider: () => void;
	onSaveBrief: (brief: ProjectBriefView) => void;
	onSaveModelSettings: (settings: ModelSettingsView) => void;
	onResetModelSettings: () => void;
	onSaveAgentDefaults: (defaults: AgentDefaultsView) => void;
	onSaveOperatorProfile: (profile: OperatorProfileView) => void;
	onSetChainRuns: (enabled: boolean) => void;
	onSetExecutorHandoff: (enabled: boolean) => void;
	onSetSelfUpdate: (enabled: boolean) => void;
	onImportProject: (repository: string) => void;
	onCreateProject: (input: CreateProjectInput) => void;
	onRegisterProject: (root: string) => void;
	onUnregisterProject: (projectId: string) => void;
}

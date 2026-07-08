// Auth
export const AUTH_PROVIDERS = ["github", "google"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

// Deep link protocol schemes (used for desktop OAuth callbacks)
export const PROTOCOL_SCHEMES = {
	DEV: "ade-dev",
	PROD: "christina",
} as const;

// Company
const GITHUB_REPOSITORY =
	process.env.NEXT_PUBLIC_GITHUB_REPOSITORY || "YOUR_GITHUB_USERNAME/christina";
const GITHUB_URL = `https://github.com/${GITHUB_REPOSITORY}`;

export const COMPANY = {
	NAME: "CHRISTINA",
	DOMAIN: "christina.local",
	EMAIL_DOMAIN: "@christina.local",
	GITHUB_URL,
	DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL || `${GITHUB_URL}/tree/main/docs`,
	MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL || GITHUB_URL,
	TERMS_URL: `${GITHUB_URL}/blob/main/LICENSE.md`,
	PRIVACY_URL: `${GITHUB_URL}/blob/main/SECURITY.md`,
	CHANGELOG_URL: `${GITHUB_URL}/blob/main/CHANGELOG.md`,
	X_URL: GITHUB_URL,
	MAIL_TO: GITHUB_URL,
	REPORT_ISSUE_URL: `${GITHUB_URL}/issues/new/choose`,
	DISCORD_URL: `${GITHUB_URL}/discussions`,
} as const;

// Theme
export const THEME_STORAGE_KEY = "ade-theme";

// Download URLs
export const DOWNLOAD_URL_MAC_ARM64 = `${COMPANY.GITHUB_URL}/releases/latest/download/CHRISTINA-arm64.dmg`;

// Auth token configuration
export const TOKEN_CONFIG = {
	/** Access token lifetime in seconds (1 hour) */
	ACCESS_TOKEN_EXPIRY: 60 * 60,
	/** Refresh token lifetime in seconds (30 days) */
	REFRESH_TOKEN_EXPIRY: 30 * 24 * 60 * 60,
	/** Refresh access token when this many seconds remain (5 minutes) */
	REFRESH_THRESHOLD: 5 * 60,
} as const;

// PostHog
export const POSTHOG_COOKIE_NAME = "ade";

export const FEATURE_FLAGS = {
	/** Gates access to experimental Electric SQL tasks feature. */
	ELECTRIC_TASKS_ACCESS: "electric-tasks-access",
	/** Gates access to GitHub integration (currently buggy, internal only). */
	GITHUB_INTEGRATION_ACCESS: "github-integration-access",
	/** Gates access to the inherited experimental AI chat surface. */
	AI_CHAT: "ai-chat",
	/** Gates access to Slack integration (internal only). */
	SLACK_INTEGRATION_ACCESS: "slack-integration-access",
	/** Gates access to Cloud features (environment variables, sandboxes). */
	CLOUD_ACCESS: "cloud-access",
} as const;

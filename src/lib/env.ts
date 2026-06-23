import "server-only";

// Centralized env access. Throws clear errors so we never silently
// fall back to a missing Plaid client or unencrypted token storage.
//
// Note: getServerEnv() caches its result for the lifetime of the process.
// Rotating any of these values (TOKEN_ENCRYPTION_KEY, PLAID_SECRET, etc.)
// requires a server restart to take effect.

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it in .env (see .env.example).`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export type PlaidEnv = "sandbox" | "development" | "production";

export interface ServerEnv {
  databaseUrl: string;
  tokenEncryptionKey: string;
  tokenEncryptionKeyVersion: number;
  plaidClientId: string;
  plaidSecret: string;
  plaidEnv: PlaidEnv;
  plaidRedirectUri?: string;
  plaidWebhookUrl?: string;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const plaidEnv = (optional("PLAID_ENV") ?? "sandbox") as PlaidEnv;
  if (
    plaidEnv !== "sandbox" &&
    plaidEnv !== "development" &&
    plaidEnv !== "production"
  ) {
    throw new Error(
      `PLAID_ENV must be "sandbox", "development", or "production" (got "${plaidEnv}").`,
    );
  }

  cached = {
    databaseUrl: required("DATABASE_URL"),
    tokenEncryptionKey: required("TOKEN_ENCRYPTION_KEY"),
    tokenEncryptionKeyVersion: Number(
      optional("TOKEN_ENCRYPTION_KEY_VERSION") ?? "1",
    ),
    plaidClientId: required("PLAID_CLIENT_ID"),
    plaidSecret: required("PLAID_SECRET"),
    plaidEnv,
    plaidRedirectUri: optional("PLAID_REDIRECT_URI"),
    plaidWebhookUrl: optional("PLAID_WEBHOOK_URL"),
  };
  return cached;
}

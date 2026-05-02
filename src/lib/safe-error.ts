import "server-only";

// Sanitize errors before logging or returning them.
//
// The Plaid SDK is axios-based. An axios `Error` carries `.config.headers`
// (which contains `PLAID-SECRET`) and `.config.data` (the serialized request
// body, which on /transactions/sync etc. contains the plaintext access_token).
// Calling `console.error(err)` serializes the whole tree and dumps both into
// the log stream, defeating the encrypted-at-rest guarantee via the error
// path. Always go through these helpers.

interface PlaidErrorPayload {
  error_code?: string;
  error_type?: string;
  display_message?: string;
  request_id?: string;
}

interface AxiosLikeError {
  response?: {
    status?: number;
    data?: PlaidErrorPayload;
  };
}

function asAxiosLike(err: unknown): AxiosLikeError | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  const resp = e.response;
  if (typeof resp !== "object" || resp === null) return null;
  const respData = (resp as Record<string, unknown>).data;
  if (typeof respData !== "object" || respData === null) return null;
  if (!("error_code" in (respData as Record<string, unknown>))) return null;
  return err as AxiosLikeError;
}

export function safeLogError(scope: string, err: unknown): void {
  const plaid = asAxiosLike(err);
  if (plaid) {
    // Plaid's response.data is safe to log: it's the API's structured error,
    // not request inputs. Everything in `err.config` (headers + body) is
    // intentionally dropped here.
    console.error(`[${scope}] plaid_error`, {
      status: plaid.response?.status,
      error_code: plaid.response?.data?.error_code,
      error_type: plaid.response?.data?.error_type,
      request_id: plaid.response?.data?.request_id,
    });
    return;
  }

  if (err instanceof Error) {
    // Just name + message, never the stack — stacks for native crypto/db
    // errors can include argument values.
    console.error(`[${scope}] ${err.name}: ${err.message}`);
    return;
  }
  console.error(`[${scope}] unknown_error`);
}

export interface ClientError {
  status: number;
  message: string;
}

export function clientErrorMessage(err: unknown): ClientError {
  if (err instanceof Error && err.name === "AuthRequiredError") {
    return { status: 401, message: "Unauthorized" };
  }
  if (
    err instanceof Error &&
    (err.message.startsWith("Missing SERPER_API_KEY") ||
      err.message.startsWith("Serper request failed"))
  ) {
    return { status: 400, message: err.message };
  }

  const plaid = asAxiosLike(err);
  if (plaid) {
    const code = plaid.response?.data?.error_code;
    return {
      status: 502,
      message: code ? `Plaid error: ${code}` : "Plaid error",
    };
  }
  return { status: 500, message: "Internal error" };
}

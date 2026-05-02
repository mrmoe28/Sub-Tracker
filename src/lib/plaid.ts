import "server-only";

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} from "plaid";

import { getServerEnv } from "./env";

let cached: PlaidApi | undefined;

export function getPlaidClient(): PlaidApi {
  if (cached) return cached;

  const env = getServerEnv();
  const config = new Configuration({
    basePath: PlaidEnvironments[env.plaidEnv],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.plaidClientId,
        "PLAID-SECRET": env.plaidSecret,
        "Plaid-Version": "2020-09-14",
      },
    },
  });

  cached = new PlaidApi(config);
  return cached;
}

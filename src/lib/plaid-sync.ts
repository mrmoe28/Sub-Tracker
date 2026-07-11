import "server-only";

import type {
  RemovedTransaction,
  Transaction as PlaidTransaction,
} from "plaid";

import { prisma } from "./prisma";
import { getPlaidClient } from "./plaid";
import { ensureMerchant } from "./merchant";
import {
  computeSuggestedFields,
  loadCategoryIdByName,
} from "./apply-category-suggestion";
import { decryptToken } from "./token-encryption";

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  cursor: string;
}

// Plaid date strings are "YYYY-MM-DD". Parse to a UTC midnight Date so
// the value lands on the intended calendar day regardless of server TZ.
function parsePlaidDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  return new Date(`${value}T00:00:00Z`);
}

async function upsertTransaction(
  userId: string,
  txn: PlaidTransaction,
  accountIdByPlaidId: Map<string, string>,
  categoryIdByName: Map<string, string>,
) {
  const merchant = await ensureMerchant(txn.merchant_name ?? txn.name);
  const accountDbId = accountIdByPlaidId.get(txn.account_id) ?? null;

  const data = {
    userId,
    accountId: accountDbId,
    merchantId: merchant?.id ?? null,
    plaidAccountId: txn.account_id,
    name: txn.name,
    merchantName: txn.merchant_name ?? null,
    amount: txn.amount.toString(),
    isoCurrencyCode: txn.iso_currency_code ?? null,
    date: parsePlaidDate(txn.date)!,
    authorizedDate: parsePlaidDate(txn.authorized_date),
    pending: txn.pending,
    category: txn.category ?? [],
    categoryId: txn.category_id ?? null,
    pfcPrimary: txn.personal_finance_category?.primary ?? null,
    pfcDetailed: txn.personal_finance_category?.detailed ?? null,
    pfcConfidenceLevel:
      txn.personal_finance_category?.confidence_level ?? null,
    paymentChannel: txn.payment_channel ?? null,
    raw: txn as unknown as object,
  };

  // Best-effort suggestion. recurringStreamId is not known at sync time
  // (recurring detection runs separately); the backfill route fills that in.
  // A failure here must never abort the sync.
  let suggested: ReturnType<typeof computeSuggestedFields> = null;
  try {
    suggested = computeSuggestedFields(
      {
        merchantName: data.merchantName,
        name: data.name,
        pfcPrimary: data.pfcPrimary,
        pfcDetailed: data.pfcDetailed,
        pfcConfidenceLevel: data.pfcConfidenceLevel,
        recurringStreamId: null,
      },
      categoryIdByName,
    );
  } catch {
    suggested = null;
  }

  const suggestionData = suggested ?? {
    suggestedCategoryId: null,
    suggestedCategoryName: null,
    suggestedConfidence: null,
    suggestedSource: null,
    suggestedAt: null,
  };

  await prisma.transaction.upsert({
    where: { plaidTransactionId: txn.transaction_id },
    update: { ...data, ...suggestionData },
    create: { ...data, ...suggestionData, plaidTransactionId: txn.transaction_id },
  });
}

export async function syncPlaidItemTransactions(
  plaidItemId: string,
  userId: string,
): Promise<SyncResult> {
  // SECURITY: scope by userId here even though the route already filters.
  // Belt + suspenders so a future caller (cron, webhook) can't accidentally
  // pull another user's access token.
  const item = await prisma.plaidItem.findFirstOrThrow({
    where: { id: plaidItemId, userId },
    include: { accounts: true },
  });

  const accessToken = decryptToken({
    accessTokenCiphertext: item.accessTokenCiphertext,
    accessTokenIv: item.accessTokenIv,
    accessTokenAuthTag: item.accessTokenAuthTag,
    encryptionKeyVersion: item.encryptionKeyVersion,
  });

  const accountIdByPlaidId = new Map(
    item.accounts.map((a) => [a.plaidAccountId, a.id]),
  );

  const plaid = getPlaidClient();

  const categoryIdByName = await loadCategoryIdByName(item.userId);

  let cursor = item.transactionsCursor ?? undefined;
  let hasMore = true;
  let added = 0;
  let modified = 0;
  let removed = 0;

  while (hasMore) {
    const response = await plaid.transactionsSync({
      access_token: accessToken,
      cursor,
      count: 500,
    });

    const data = response.data;

    for (const txn of data.added) {
      await upsertTransaction(item.userId, txn, accountIdByPlaidId, categoryIdByName);
      added += 1;
    }
    for (const txn of data.modified) {
      await upsertTransaction(item.userId, txn, accountIdByPlaidId, categoryIdByName);
      modified += 1;
    }
    if (data.removed.length > 0) {
      const ids = data.removed
        .map((r: RemovedTransaction) => r.transaction_id)
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        const result = await prisma.transaction.deleteMany({
          where: {
            userId: item.userId,
            plaidTransactionId: { in: ids },
          },
        });
        removed += result.count;
      }
    }

    cursor = data.next_cursor;
    hasMore = data.has_more;
  }

  await prisma.plaidItem.update({
    where: { id: item.id },
    data: {
      transactionsCursor: cursor ?? null,
      lastSyncedAt: new Date(),
    },
  });

  return { added, modified, removed, cursor: cursor ?? "" };
}

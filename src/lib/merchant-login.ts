import "server-only";

import { prisma } from "./prisma";
import { decryptToken, encryptToken } from "./token-encryption";

export interface MerchantLoginInput {
  userId: string;
  merchantId: string;
  username: string;
  password: string;
  loginUrl?: string | null;
}

export async function saveMerchantLogin(input: MerchantLoginInput) {
  const enc = encryptToken(input.password);
  const data = {
    username: input.username,
    passwordCiphertext: enc.ciphertext,
    passwordIv: enc.iv,
    passwordAuthTag: enc.authTag,
    encryptionKeyVersion: enc.keyVersion,
    loginUrl: input.loginUrl || null,
    lastAttemptAt: null,
    lastAttemptStatus: null,
    lastAttemptNote: null,
    lastFoundUrl: null,
  };
  return prisma.merchantLogin.upsert({
    where: {
      userId_merchantId: { userId: input.userId, merchantId: input.merchantId },
    },
    update: data,
    create: { userId: input.userId, merchantId: input.merchantId, ...data },
    select: { id: true, username: true, loginUrl: true },
  });
}

export async function deleteMerchantLogin(userId: string, merchantId: string) {
  await prisma.merchantLogin.deleteMany({ where: { userId, merchantId } });
}

export interface DecryptedMerchantLogin {
  id: string;
  username: string;
  password: string;
  loginUrl: string | null;
}

// Decrypts in memory only; never log or persist the returned password.
export async function loadMerchantLogin(
  userId: string,
  merchantId: string,
): Promise<DecryptedMerchantLogin | null> {
  const row = await prisma.merchantLogin.findUnique({
    where: { userId_merchantId: { userId, merchantId } },
  });
  if (!row) return null;
  const password = decryptToken({
    accessTokenCiphertext: row.passwordCiphertext,
    accessTokenIv: row.passwordIv,
    accessTokenAuthTag: row.passwordAuthTag,
    encryptionKeyVersion: row.encryptionKeyVersion,
  });
  return { id: row.id, username: row.username, password, loginUrl: row.loginUrl };
}

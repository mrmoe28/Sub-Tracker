import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import { requireSameOrigin } from "@/lib/origin-check";
import { prisma } from "@/lib/prisma";
import { clientErrorMessage, safeLogError } from "@/lib/safe-error";

export const runtime = "nodejs";

interface Body {
  categoryId?: string | null;
  notes?: string | null;
}

const NOTES_MAX_LENGTH = 2000;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireSameOrigin(req);
  if (denied) return denied;

  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as Body;
    const user = await getCurrentUser();

    const transaction = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!transaction) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 },
      );
    }

    if (
      typeof body.notes === "string" &&
      body.notes.length > NOTES_MAX_LENGTH
    ) {
      return NextResponse.json(
        { error: `notes must be ${NOTES_MAX_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    if (!body.categoryId) {
      const updated = await prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          userCategoryId: null,
          userCategoryName: null,
          userCategoryNotes: body.notes?.trim() || null,
          categorizedAt: null,
        },
        select: { id: true },
      });
      return NextResponse.json(updated);
    }

    const category = await prisma.transactionCategory.findFirst({
      where: {
        id: body.categoryId,
        OR: [{ userId: null }, { userId: user.id }],
      },
      select: { id: true, name: true },
    });
    if (!category) {
      return NextResponse.json(
        { error: "Category not found" },
        { status: 404 },
      );
    }

    const updated = await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        userCategoryId: category.id,
        userCategoryName: category.name,
        userCategoryNotes: body.notes?.trim() || null,
        categorizedAt: new Date(),
      },
      select: {
        id: true,
        userCategoryId: true,
        userCategoryName: true,
        userCategoryNotes: true,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    safeLogError("transactions/categorize", err);
    const ce = clientErrorMessage(err);
    return NextResponse.json({ error: ce.message }, { status: ce.status });
  }
}

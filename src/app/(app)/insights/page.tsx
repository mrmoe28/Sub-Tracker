import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentUser } from "@/lib/current-user";
import {
  getInsights,
  type Insight,
  type InsightKind,
  type InsightSeverity,
} from "@/lib/spend-insights";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  high: "bg-amber-500",
  medium: "bg-brand",
  low: "bg-muted-foreground/40",
};

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const KIND_REASON: Record<InsightKind, string> = {
  "category-mover":
    "We compare each Plaid category's spend month-over-month and surface the biggest swing (≥15%, ≥$25 on each side).",
  "spend-drift":
    "Your current month's recurring outflow is compared to the trailing 3-month average; ≥10% drift fires.",
  "price-hike":
    "Each recurring stream's most recent charge is compared against its prior amounts; ≥15% jump fires.",
  "review-pileup":
    "Counts subscription candidates still in PENDING_REVIEW. Fires at 3 or more.",
  concentration:
    "Looks at what share of total recurring spend each confirmed subscription represents. Fires at ≥25%.",
};

const RULE_NAMES: { kind: InsightKind; name: string }[] = [
  { kind: "category-mover", name: "Top category mover (MoM)" },
  { kind: "spend-drift", name: "Recurring spend drift" },
  { kind: "price-hike", name: "Price hike on a recurring sub" },
  { kind: "review-pileup", name: "Pending review pile-up" },
  { kind: "concentration", name: "Subscription concentration" },
];

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className="rounded-lg border bg-background p-5">
      <div className="flex items-start gap-4">
        <span
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
            SEVERITY_DOT[insight.severity],
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-sm font-medium leading-snug">
              {insight.title}
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {SEVERITY_LABEL[insight.severity]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{insight.body}</p>
          <div className="mt-3 border-t pt-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Why this surfaced
            </div>
            <p className="mt-1 text-xs text-muted-foreground/90">
              {KIND_REASON[insight.kind]}
            </p>
          </div>
        </div>
        {insight.actionHref ? (
          <Link
            href={insight.actionHref}
            className="shrink-0 self-start rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
          >
            {insight.actionLabel ?? "View"} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default async function InsightsPage() {
  const user = await getCurrentUser();
  const insights = await getInsights(user.id);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted-foreground">
          Patterns and outliers in your recurring spend, computed fresh each
          time you load the page.
        </p>
      </div>

      {insights.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing notable yet</CardTitle>
            <CardDescription>
              No rules fired against your current data. As your transaction
              history grows, we&apos;ll surface things here automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              What we look for
            </div>
            <ul className="space-y-2">
              {RULE_NAMES.map(({ kind, name }) => (
                <li
                  key={kind}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/30" />
                  <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {KIND_REASON[kind]}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Insights run server-side on every page load. None are persisted.
      </p>
    </div>
  );
}

import Link from "next/link";

import type { Insight, InsightSeverity } from "@/lib/spend-insights";
import { cn } from "@/lib/utils";

const SEVERITY_DOT: Record<InsightSeverity, string> = {
  high: "bg-amber-500",
  medium: "bg-brand",
  low: "bg-muted-foreground/40",
};

export function InsightStrip({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  const top = insights.slice(0, 3);
  return (
    <div className="space-y-2">
      {top.map((insight) => (
        <div
          key={insight.id}
          className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3"
        >
          <span
            className={cn(
              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
              SEVERITY_DOT[insight.severity],
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-snug">
              {insight.title}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {insight.body}
            </div>
          </div>
          {insight.actionHref ? (
            <Link
              href={insight.actionHref}
              className="shrink-0 self-center text-xs font-medium text-foreground transition-colors hover:text-brand"
            >
              {insight.actionLabel ?? "View"} →
            </Link>
          ) : null}
        </div>
      ))}
    </div>
  );
}

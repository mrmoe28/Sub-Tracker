import type { SpendBucket } from "@/lib/spend-history";

const W = 600;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 24, left: 48 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

const BRAND = "oklch(0.65 0.18 30)";
const GRID = "oklch(0.94 0 0)";
const AXIS = "oklch(0.7 0 0)";

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  const norm = value / mag;
  let nice;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(
      2,
    )},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

export function SpendChart({ data }: { data: SpendBucket[] }) {
  const allZero = data.every((d) => d.total === 0);

  if (allZero) {
    return (
      <div className="flex h-[220px] items-center justify-center px-6 text-sm text-muted-foreground">
        Not enough recurring transaction history yet. Sync more transactions to
        build the trend.
      </div>
    );
  }

  const peak = Math.max(...data.map((d) => d.total));
  const max = niceMax(peak * 1.15);

  const points = data.map((d, i) => ({
    x: PAD.left + (i / (data.length - 1)) * PLOT_W,
    y: PAD.top + PLOT_H * (1 - d.total / max),
  }));

  const linePath = smoothPath(points);
  const baseline = PAD.top + PLOT_H;
  const last = points[points.length - 1];
  const areaPath = `${linePath} L ${last.x.toFixed(2)},${baseline} L ${points[0].x.toFixed(2)},${baseline} Z`;

  const yTicks = [1, 0.66, 0.33, 0].map((t) => ({
    value: max * t,
    y: PAD.top + PLOT_H * (1 - t),
  }));

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="spendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity="0.22" />
            <stop offset="100%" stopColor={BRAND} stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <line
            key={`g${i}`}
            x1={PAD.left}
            y1={t.y}
            x2={W - PAD.right}
            y2={t.y}
            stroke={GRID}
            strokeWidth="1"
          />
        ))}
        {yTicks.map((t, i) => (
          <text
            key={`y${i}`}
            x={PAD.left - 8}
            y={t.y + 3}
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={AXIS}
            textAnchor="end"
          >
            ${Math.round(t.value)}
          </text>
        ))}

        <path d={areaPath} fill="url(#spendArea)" />
        <path
          d={linePath}
          fill="none"
          stroke={BRAND}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <circle cx={last.x} cy={last.y} r="6" fill={BRAND} fillOpacity="0.18" />
        <circle cx={last.x} cy={last.y} r="3.5" fill={BRAND} />
      </svg>

      <div
        className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground"
        style={{
          paddingLeft: `${(PAD.left / W) * 100}%`,
          paddingRight: `${(PAD.right / W) * 100}%`,
        }}
      >
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

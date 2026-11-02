"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortDate } from "@/lib/time";

/** Fixed colour per branch, never by rank (validated: categorical slots 1-3). */
export const BRANCH_COLORS: Record<string, string> = { IDR: "#2a78d6", PTP: "#eb6834", DWS: "#1baf7a" };

type Point = { endDate: string; byBranch: Record<string, { cohort: number; rolled: number; rate: number | null }>; overall: { rate: number | null; cohort: number; rolled: number } };

export function RollRateChart({ points, branches, target }: { points: Point[]; branches: { id: string; name: string }[]; target: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const figRef = useRef<HTMLElement>(null);
  // Draw at the real width so text stays 12px on a phone instead of shrinking with the chart.
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = figRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = W < 520;
  const H = narrow ? 240 : 290;
  const PAD = { l: 40, r: narrow ? 92 : 118, t: 18, b: 30 };

  const series = branches.map((b) => ({ ...b, color: BRANCH_COLORS[b.id] ?? "#2a78d6", values: points.map((p) => p.byBranch[b.id]?.rate ?? null) }));
  const maxVal = Math.max(target, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)));
  const yMax = Math.max(0.3, Math.ceil((maxVal + 0.04) * 10) / 10);
  const x = (i: number) => PAD.l + (points.length <= 1 ? 0 : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const ticks = Array.from({ length: Math.round(yMax / 0.1) + 1 }, (_, i) => i * 0.1);

  // Direct labels at the last point, nudged apart so they never collide.
  const labels = useMemo(() => {
    const last = points.length - 1;
    const items = series
      .map((s) => ({ id: s.id, name: s.name, color: s.color, v: s.values[last], y: s.values[last] === null ? null : y(s.values[last]!) }))
      .filter((l): l is typeof l & { y: number; v: number } => l.y !== null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 30) items[i].y = items[i - 1].y + 30;
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, branches, yMax, W]);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  }

  if (points.length === 0) {
    return <p className="py-10 text-center text-ink-2">Roll rates need 30 days of imported files. They will appear after the first month.</p>;
  }

  const hp = hover !== null ? points[hover] : null;
  return (
    <figure ref={figRef} className="relative">
      <figcaption className="sr-only">Roll rate from 1-30 DPD to 31+ DPD over 30 days, by branch, weekly. Target {Math.round(target * 100)}%.</figcaption>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-5 rounded" style={{ background: s.color }} aria-hidden />
              {s.name}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <span className="inline-block w-5 border-t-2 border-dashed border-ink-3" aria-hidden />
            Target {Math.round(target * 100)}%
          </li>
        </ul>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block h-auto max-w-full overflow-visible" role="img" aria-label="Roll rate trend by branch">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12} fill="var(--color-ink-3)">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % (narrow || points.length > 8 ? 2 : 1) === (points.length - 1) % (narrow || points.length > 8 ? 2 : 1) ? (
            <text key={p.endDate} x={x(i)} y={H - 8} textAnchor="middle" fontSize={12} fill="var(--color-ink-3)">
              {formatShortDate(p.endDate)}
            </text>
          ) : null,
        )}
        <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--color-ink-2)" strokeWidth={1.5} strokeDasharray="5 5" />
        <text x={PAD.l + 6} y={y(target) - 7} fontSize={12} fill="var(--color-ink-2)">
          Target {Math.round(target * 100)}%
        </text>

        {series.map((s) => {
          const d = s.values
            .map((v, i) => (v === null ? null : `${x(i)},${y(v)}`))
            .filter(Boolean)
            .join(" L ");
          return d ? <path key={s.id} d={`M ${d}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /> : null;
        })}
        {series.map((s) =>
          s.values.map((v, i) =>
            v === null || (i !== points.length - 1 && i !== hover) ? null : (
              <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(v)} r={4.5} fill={s.color} stroke="var(--color-surface)" strokeWidth={2} />
            ),
          ),
        )}
        {labels.map((l) => (
          <g key={l.id}>
            <text x={W - PAD.r + 12} y={l.y} dy="-0.1em" fontSize={13} fontWeight={600} fill="var(--color-ink)">
              {(l.v * 100).toFixed(1)}%
            </text>
            <text x={W - PAD.r + 12} y={l.y} dy="1.05em" fontSize={12} fill="var(--color-ink-2)">
              {l.name}
            </text>
          </g>
        ))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-ink-3)" strokeWidth={1} />}
        <rect
          x={PAD.l - 10}
          y={PAD.t}
          width={W - PAD.l - PAD.r + 20}
          height={H - PAD.t - PAD.b}
          fill="transparent"
          tabIndex={0}
          aria-label="Move through weeks with arrow keys"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(points.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(points.length - 1, (h ?? -1) + 1));
          }}
          style={{ outline: "none" }}
        />
      </svg>
      {hp && hover !== null && (
        <div
          className="pointer-events-none absolute top-8 z-10 min-w-44 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm shadow-lg"
          style={{ left: `clamp(0px, calc(${(x(hover) / W) * 100}% + 12px), calc(100% - 190px))` }}
        >
          <p className="mb-1 text-2xs text-ink-2">30 days to {formatShortDate(hp.endDate)}</p>
          {series.map((s) => {
            const b = hp.byBranch[s.id];
            return (
              <p key={s.id} className="flex items-center gap-2">
                <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: s.color }} aria-hidden />
                <span className="figure w-12 font-semibold">{b?.rate == null ? "–" : `${(b.rate * 100).toFixed(1)}%`}</span>
                <span className="text-ink-2">{s.name}</span>
                <span className="ml-auto text-2xs text-ink-3">{b ? `${b.rolled}/${b.cohort}` : ""}</span>
              </p>
            );
          })}
        </div>
      )}
    </figure>
  );
}

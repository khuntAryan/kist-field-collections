"use client";
import { useState } from "react";

type Band = { label: string; n: number; predicted: number; notPaid: number };

/** Paired bars per score band: actual share not paid (ink-blue) and the model's estimate (light). */
export function BandChart({ bands }: { bands: Band[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 230;
  const P = { l: 40, r: 10, t: 12, b: 40 };
  const bw = (W - P.l - P.r) / bands.length;
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const bar = Math.min(34, bw / 3);
  return (
    <figure className="relative">
      <ul className="mb-2 flex gap-5 text-sm text-ink-2" aria-label="Legend">
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-[#2340a0]" aria-hidden /> Not paid after 7 days
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-[#9fb0e3]" aria-hidden /> Model&rsquo;s estimate of rolling in 30 days
        </li>
      </ul>
      <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="Share not paid by score band">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--color-rule)" />
            <text x={P.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-3)">
              {t * 100}%
            </text>
          </g>
        ))}
        {bands.map((b, i) => {
          const cx = P.l + bw * i + bw / 2;
          return (
            <g key={b.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} style={{ outline: "none" }}>
              <rect x={P.l + bw * i} y={P.t} width={bw} height={H - P.t - P.b} fill={hover === i ? "var(--color-paper)" : "transparent"} />
              {b.n > 0 && (
                <>
                  <rect x={cx - bar - 1} y={y(b.notPaid)} width={bar} height={Math.max(0, y(0) - y(b.notPaid))} rx={3} fill="#2340a0" />
                  <rect x={cx + 1} y={y(b.predicted)} width={bar} height={Math.max(0, y(0) - y(b.predicted))} rx={3} fill="#9fb0e3" />
                </>
              )}
              <text x={cx} y={H - P.b + 16} textAnchor="middle" fontSize={12} fill="var(--color-ink-2)">
                Score {b.label}
              </text>
              <text x={cx} y={H - P.b + 31} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                {b.n} loans
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      {hover !== null && bands[hover].n > 0 && (
        <div className="pointer-events-none absolute top-8 rounded-[var(--radius-control)] border border-rule bg-surface px-3 py-2 text-sm shadow-lg" style={{ left: `clamp(0px, ${((P.l + bw * hover + bw) / W) * 100}%, calc(100% - 200px))` }}>
          <p className="text-2xs text-ink-2">Score {bands[hover].label}, {bands[hover].n} loans</p>
          <p>
            <span className="figure font-semibold">{Math.round(bands[hover].notPaid * 100)}%</span> <span className="text-ink-2">not paid</span>
          </p>
          <p>
            <span className="figure font-semibold">{Math.round(bands[hover].predicted * 100)}%</span> <span className="text-ink-2">model estimate of rolling</span>
          </p>
        </div>
      )}
    </figure>
  );
}

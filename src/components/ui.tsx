import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  busy?: boolean;
};

const variants = {
  primary: "bg-accent text-white hover:bg-accent-strong disabled:bg-ink-3",
  secondary: "bg-surface text-ink border border-rule-strong hover:border-ink-3 disabled:text-ink-3",
  ghost: "text-accent hover:bg-accent-soft disabled:text-ink-3",
  danger: "bg-surface text-late border border-late/40 hover:bg-late-soft",
};
const sizes = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-[0.95rem] gap-2",
  lg: "h-14 px-5 text-base gap-2",
};

export function Button({ variant = "primary", size = "md", icon, busy, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center rounded-[var(--radius-control)] font-semibold transition-colors select-none disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
    />
  );
}

type Tone = "neutral" | "late" | "due" | "ok" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-paper text-ink-2 border-rule",
  late: "bg-late-soft text-late border-late/20",
  due: "bg-due-soft text-due border-due/20",
  ok: "bg-ok-soft text-ok border-ok/20",
  accent: "bg-accent-soft text-accent border-accent/20",
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-[var(--radius-chip)] border px-1.5 py-px text-2xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Banner({ tone = "neutral", icon, children, action }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className={cx("flex items-start gap-2.5 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm", tones[tone])}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-sm px-6 py-14 text-center">
      <p className="text-lg font-semibold">{title}</p>
      {body && <p className="mt-1.5 text-ink-2">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden />;
}

/** DPD colour: 1-15 neutral, 16-30 due, 31+ late. */
export function dpdTone(dpd: number): Tone {
  return dpd >= 31 ? "late" : dpd >= 16 ? "due" : "neutral";
}

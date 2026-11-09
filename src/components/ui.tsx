"use client";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, Check, ChevronRight, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { LABELS } from "@/lib/domain";

/* Primitif UI — token dari globals.css (rencana desain v1, bab 05). */

const EASE = [0.22, 1, 0.36, 1] as const;

export function Button({ children, variant = "primary", size = "md", loading, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "lime"; size?: "sm" | "md" | "lg"; loading?: boolean }) {
  const variants = {
    primary: "border-ink bg-ink text-white hover:border-ink-700 hover:bg-ink-700",
    secondary: "border-line-strong bg-surface text-ink hover:border-ink-500 hover:bg-paper-2",
    ghost: "border-transparent bg-transparent text-muted hover:bg-paper-2 hover:text-ink",
    danger: "border-danger-line bg-danger-bg text-danger hover:border-danger/40 hover:bg-[#f7ddd9]",
    lime: "border-lime-bright bg-lime text-ink hover:border-lime hover:bg-[#b0ea55]",
  };
  const sizes = {
    sm: "h-8 px-3 text-[12.5px]",
    md: "h-10 px-4 text-[13.5px]",
    lg: "h-12 px-5 text-sm",
  };
  return (
    <button
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] border font-semibold tracking-[-.005em] transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle size={15} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

const TONES = {
  ok: "border-ok-line bg-ok-bg text-ok",
  warn: "border-warn-line bg-warn-bg text-warn",
  danger: "border-danger-line bg-danger-bg text-danger",
  info: "border-info-line bg-info-bg text-info",
  neutral: "border-neutral-line bg-neutral-bg text-neutral",
  risk: "border-risk-line bg-risk-bg text-risk",
} as const;

export function toneFor(value: string): keyof typeof TONES {
  if (["APPROVED", "PAID", "DONE", "BASELINE", "SETTLED", "FINAL", "IMPLEMENTED", "COMPLETED", "ACTIVE", "CLOSED"].includes(value)) return "ok";
  if (["REJECTED", "VOIDED", "OVERDUE", "CANCELLED", "BLOCKED"].includes(value)) return "danger";
  if (["AT_RISK", "OVER_BUDGET"].includes(value)) return "risk";
  if (["SUBMITTED", "PENDING", "PARTIALLY_PAID", "NEEDS_CORRECTION", "PARTIAL", "REVIEW", "INTERNAL_REVIEW"].includes(value)) return "warn";
  if (["IN_PROGRESS", "RUNNING", "SUBMITTED_FOR_APPROVAL"].includes(value)) return "info";
  return "neutral";
}

export function Badge({ value, label, dot = true, tone }: { value: string; label?: string; dot?: boolean; tone?: keyof typeof TONES }) {
  return (
    <span className={`inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-semibold tracking-[-.005em] ${TONES[tone || toneFor(value)]}`}>
      {dot ? <span className="h-[5px] w-[5px] rounded-full bg-current" /> : null}
      {label || LABELS[value] || value.replaceAll("_", " ")}
    </span>
  );
}

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold text-ink-700">{label}</span>
      {children}
      {error ? <span className="mt-1.5 flex items-center gap-1 text-[11.5px] font-medium text-danger">{error}</span> : hint ? <span className="mt-1.5 block text-[11.5px] leading-relaxed text-muted">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "min-h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-surface px-3 text-[13.5px] text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-subtle hover:border-ink-500 focus:border-ink focus:shadow-[0_0_0_3px_rgba(198,242,78,.45)] focus:outline-none disabled:cursor-not-allowed disabled:bg-paper-2 disabled:text-subtle";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={`${inputClass} ${props.className || ""}`} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={`${inputClass} ${props.className || ""}`} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={`${inputClass} min-h-24 resize-y py-2.5 ${props.className || ""}`} />; }

export function Modal({ open, onClose, title, eyebrow, children, wide = false, footer }: { open: boolean; onClose: () => void; title: string; eyebrow?: string; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  /* Fokus dikurung di dalam dialog, Escape menutup, dan fokus kembali ke pemicu saat ditutup.
     Latar di belakang tidak bisa digulir selama dialog terbuka. */
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () => Array.from(panel?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter((el) => el.offsetParent !== null);
    const timer = window.setTimeout(() => {
      const target = panel?.querySelector<HTMLElement>("[data-autofocus]") || focusables()[0];
      target?.focus({ preventScroll: true });
    }, 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (active === first || !panel?.contains(active))) { event.preventDefault(); last.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-ink-900/50 p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: .16 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.section
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[var(--radius-overlay)] bg-surface shadow-[var(--shadow-e3)] sm:rounded-[var(--radius-overlay)] ${wide ? "max-w-5xl" : "max-w-2xl"}`}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: .2, ease: EASE }}
          >
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div>
                {eyebrow ? <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.12em] text-muted">{eyebrow}</p> : null}
                <h2 id={titleId} className="text-[19px] font-semibold tracking-[-.02em] text-ink">{title}</h2>
              </div>
              <button onClick={onClose} aria-label="Tutup dialog" title="Tutup (Esc)" className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-muted hover:bg-paper-2 hover:text-ink">
                <X size={16} />
              </button>
            </header>
            <div className="overflow-y-auto overscroll-contain p-5 sm:p-6">{children}</div>
            {footer ? <div className="border-t border-line bg-sunken px-5 py-3 sm:px-6">{footer}</div> : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Toast({ toast, onClose }: { toast: { type: "success" | "error"; message: string } | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: .18, ease: EASE }}
          className={`fixed inset-x-4 bottom-4 z-[100] mx-auto flex max-w-md items-start gap-3 rounded-[var(--radius-card)] border p-3.5 shadow-[var(--shadow-e3)] sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 ${toast.type === "success" ? "border-ok-line bg-ok-bg text-ok" : "border-danger-line bg-danger-bg text-danger"}`}
        >
          {toast.type === "success" ? <Check size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}
          <p className="flex-1 text-[13px] font-medium leading-relaxed">{toast.message}</p>
          <button onClick={onClose} aria-label="Tutup notifikasi" className="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-control)] opacity-70 hover:bg-black/5 hover:opacity-100"><X size={14} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-8 text-center">
      {icon ? <div className="mb-3 grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-paper-2 text-muted">{icon}</div> : null}
      <h3 className="text-[13.5px] font-semibold tracking-[-.015em] text-ink">{title}</h3>
      <p className="mt-1.5 max-w-[40ch] text-[12px] leading-relaxed text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}


export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-hidden>
      <div className="flex gap-4 border-b border-line bg-sunken px-4 py-2.5">
        {Array.from({ length: cols }).map((_, i) => <div key={i} className="skeleton h-[11px]" style={{ width: i === 0 ? "32%" : `${14}%` }} />)}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-hairline px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => <div key={c} className="skeleton h-[12px]" style={{ width: c === 0 ? "32%" : "14%" }} />)}
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface" aria-hidden>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="skeleton h-[13px] w-28" />
        <div className="skeleton h-[11px] w-14" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
          <div className="skeleton h-7 w-7 shrink-0" />
          <div className="flex-1">
            <div className="skeleton h-[12px] w-3/5" />
            <div className="skeleton mt-1.5 h-[11px] w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[.16em] text-subtle">{eyebrow || "Ruang kerja"}</p>
        <h1 className="text-[22px] font-semibold tracking-[-.028em] text-ink sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-[74ch] text-[12px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink hover:text-ink-500">
      {children}<ChevronRight size={14} />
    </button>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-[var(--radius-control)] border border-line bg-paper-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-7 whitespace-nowrap rounded-[var(--radius-control-sm)] px-2.5 text-[11.5px] font-semibold transition-[background-color,color,box-shadow] ${value === o.value ? "bg-surface text-ink shadow-[var(--shadow-e1)]" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

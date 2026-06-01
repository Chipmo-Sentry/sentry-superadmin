import type { ReactNode } from "react";

/** Labeled form field wrapper — mirrors sentry-frontend's Field component. */
export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-[var(--color-danger)]"> *</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-[var(--color-muted-foreground)]">
          {hint}
        </span>
      )}
    </label>
  );
}

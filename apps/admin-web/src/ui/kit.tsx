// Shared components (docs/DESIGN_SYSTEM.md §6, §8): labelled fields, buttons
// that say what they do, and the view states every data view implements.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";
import { ApiError } from "../api/client.ts";

export function Button({
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "quiet" }) {
  return <button type="button" {...props} className={`btn btn-${variant} ${props.className ?? ""}`} />;
}

export function Field({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} aria-invalid={error ? true : undefined} aria-describedby={`${id}-hint`} {...input} />
      {(error ?? hint) && (
        <span id={`${id}-hint`} className={error ? "field-error" : "field-hint"}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

export function Select({
  label,
  children,
  ...select
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select id={id} {...select}>
        {children}
      </select>
    </label>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: "info" | "danger" | "success" | "warning";
  children: ReactNode;
}) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** The error view state: the server's message and the request ID to quote. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error instanceof ApiError && error.status === 403)
    return (
      <div className="state" role="status">
        <h2>You do not have access to this</h2>
        <p>Ask an administrator of your organization if you need it.</p>
      </div>
    );
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div className="state" role="alert">
      <h2>This could not be loaded</h2>
      <p>{message}</p>
      {requestId && <p className="muted">Reference {requestId}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

/** Human words for an UPPER_SNAKE value. */
export function words(value: string): string {
  const lower = value.toLowerCase().replaceAll("_", " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    const fieldErrors = (error.details?.fieldErrors as { message: string }[] | undefined) ?? [];
    return fieldErrors.length > 0 ? fieldErrors.map((f) => f.message).join(" ") : error.message;
  }
  // WebAuthn: the person cancelled the passkey prompt, or it timed out.
  if (error instanceof Error && error.name === "NotAllowedError")
    return "The passkey request was cancelled or timed out. Try again.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

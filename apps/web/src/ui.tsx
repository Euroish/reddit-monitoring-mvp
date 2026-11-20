import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { OpenAuthFn } from "./types";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {hint && <small className="field-hint">{hint}</small>}
      </span>
      {children}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Heading({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div className="page-heading-copy">
        <h1>{title}</h1>
        {note && <p className="page-note">{note}</p>}
      </div>
      {children && <div className="page-heading-actions">{children}</div>}
    </header>
  );
}

export function AuthPromptCard({
  title,
  description,
  openAuth,
  publicRegistration,
}: {
  title: string;
  description: string;
  openAuth: OpenAuthFn;
  publicRegistration: boolean;
}) {
  return (
    <section className="auth-prompt-card">
      <div className="auth-prompt-icon" aria-hidden="true">
        <Lock size={18} />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      <div className="auth-prompt-actions">
        <button type="button" className="primary" onClick={() => openAuth("login", description)}>
          登录账户
        </button>
        {publicRegistration && (
          <button type="button" onClick={() => openAuth("register", description)}>
            免费注册
          </button>
        )}
      </div>
    </section>
  );
}

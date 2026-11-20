import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Radar, X } from "lucide-react";
import { api } from "../api";
import { Field } from "../ui";
import type { AuthMode } from "../types";

function AuthForm({
  mode,
  publicRegistration,
  onModeChange,
  onSuccess,
}: {
  mode: AuthMode;
  publicRegistration: boolean;
  onModeChange: (next: AuthMode) => void;
  onSuccess?: () => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isRegister = mode === "register" && publicRegistration;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const invite = String(form.get("invite") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      if (isRegister) {
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            ...(invite ? { invite } : {}),
          }),
        });
      } else {
        await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
      }
      await client.invalidateQueries();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作未完成，请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-form-wrap">
      {publicRegistration && (
        <div className="segmented auth-tabs" role="tablist" aria-label="认证方式">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? "is-active" : ""}
            onClick={() => { setError(""); onModeChange("login"); }}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? "is-active" : ""}
            onClick={() => { setError(""); onModeChange("register"); }}
          >
            注册
          </button>
        </div>
      )}
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <Field label="邮箱">
          <input
            name="email"
            type="email"
            autoComplete={isRegister ? "email" : "username"}
            placeholder="name@example.com"
            required
          />
        </Field>
        <Field label="密码" hint={isRegister ? "至少 12 位字符" : undefined}>
          <input
            name="password"
            type="password"
            minLength={isRegister ? 12 : 1}
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
          />
        </Field>
        {error && <p role="alert" className="auth-error">{error}</p>}
        <button className="primary auth-submit" disabled={busy}>
          {busy ? (isRegister ? "正在注册…" : "正在登录…") : (isRegister ? "注册并进入" : "登录")}
        </button>
      </form>
    </div>
  );
}

export function AuthModal({
  open,
  mode,
  reason,
  publicRegistration,
  onModeChange,
  onClose,
}: {
  open: boolean;
  mode: AuthMode;
  reason?: string;
  publicRegistration: boolean;
  onModeChange: (next: AuthMode) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const input = panelRef.current?.querySelector<HTMLInputElement>('input[name="email"]');
    input?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const isRegister = mode === "register" && publicRegistration;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isRegister ? "注册账户" : "登录账户"}
      >
        <header className="auth-modal-header">
          <div className="auth-modal-brand">
            <Radar size={18} />
            <h2>{isRegister ? "创建研究账户" : "登录信号研究"}</h2>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭登录窗口" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {reason && <p className="auth-reason">{reason}</p>}
        <AuthForm
          mode={mode}
          publicRegistration={publicRegistration}
          onModeChange={onModeChange}
          onSuccess={onClose}
        />
      </section>
    </div>
  );
}

export function PrivateLoginScreen({ publicRegistration }: { publicRegistration: boolean }) {
  const [mode, setMode] = useState<AuthMode>("login");
  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <Radar size={22} />
          <span>信号研究</span>
        </div>
        <h1>{mode === "register" && publicRegistration ? "创建研究账户" : "登录工作台"}</h1>
        <p className="login-sub">继续追踪多源信号、阅读原始报道与整理批注。</p>
        <AuthForm mode={mode} publicRegistration={publicRegistration} onModeChange={setMode} />
      </section>
    </main>
  );
}

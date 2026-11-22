import { formatApiError, useBrowserSessionsQuery, useDeviceSignOutMutation } from "../api/hooks";
import { useI18n } from "../i18n/translations";

export function BrowserSessionsCard({ userId }: { userId: string }) {
  const { lang, t } = useI18n();
  const list = useBrowserSessionsQuery(userId);
  const signOut = useDeviceSignOutMutation(userId);
  const format = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" });
  const revoke = (current: boolean, id?: string) => {
    const prompt = id ? t("Sign out of this browser session?", "退出此浏览器会话？")
      : t("Sign out of every browser session, including this one?", "退出所有浏览器会话，包括当前浏览器？");
    if (window.confirm(prompt)) signOut.mutate({ current, id });
  };
  return (
    <section className="ds-card" aria-labelledby="browser-sessions-heading" style={{ marginTop: 12 }}>
      <div className="ds-card-hd">
        <h2 id="browser-sessions-heading" className="ds-card-title">{t("Signed-in browsers", "已登录的浏览器")}</h2>
      </div>
      <div className="ds-card-bd">
        {list.isPending && <p role="status">{t("Loading browser sessions…", "正在加载浏览器会话…")}</p>}
        {(list.error || signOut.error) && <p role="alert">{formatApiError(list.error ?? signOut.error)}</p>}
        {signOut.isSuccess && !signOut.variables.current && <p role="status">{t("Browser signed out.", "浏览器已退出。")}</p>}
        {list.data?.sessions.map((session) => (
          <div key={session.id} className="toggle-line" style={{ flexWrap: "wrap", gap: 8 }}>
            <div>
              <strong>{session.current ? t("This browser", "当前浏览器") : t("Browser", "浏览器")}</strong>
              <div>{t("Last active", "上次活动")} <time dateTime={session.lastSeenAt}>{format.format(new Date(session.lastSeenAt))}</time></div>
            </div>
            <button type="button" className="ds-btn ds-btn--ghost" style={{ minHeight: 44 }}
              disabled={signOut.isPending} onClick={() => revoke(session.current, session.id)}>
              {t("Sign out this browser", "退出此浏览器")}
            </button>
          </div>
        ))}
      </div>
      <div className="ds-card-ft">
        <button type="button" className="ds-btn ds-btn--danger" style={{ minHeight: 44 }}
          disabled={!list.data?.sessions.length || signOut.isPending} onClick={() => revoke(true)}>
          {t("Sign out all browsers", "退出所有浏览器")}
        </button>
      </div>
    </section>
  );
}

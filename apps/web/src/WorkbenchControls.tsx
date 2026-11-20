import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CollectionSource } from "../../../packages/contracts/src/source-content";
import { api } from "./api";
import { providerBudgetQuery, quotaFields } from "./budgets";

type Route = { path: string; label: string };

export default function WorkbenchControls({ routes, collapsed, onToggle, admin }: {
  routes: readonly Route[];
  collapsed: boolean;
  onToggle: () => void;
  admin: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
    staleTime: 60_000,
  });
  const budgets = useQuery({
    ...providerBudgetQuery,
    enabled: admin && sources.data?.sources.some(source => source.deliveryMode === "pull") === true,
  });
  const blocked = sources.data?.sources.filter(source => source.automaticCollectionBlocked).length ?? 0;
  const pullProviders = new Set(sources.data?.sources.filter(source => source.deliveryMode === "pull").map(source => source.primaryProvider));
  const zero = budgets.data?.budgets.filter(budget => budget.enabled && pullProviders.has(budget.provider) &&
    quotaFields.some(([limit, used]) => (budget[used] ?? 0) >= budget[limit])).length ?? 0;
  const open = () => {
    setSearch("");
    if (!dialog.current?.open) dialog.current?.showModal();
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat ||
        document.querySelector('[role="dialog"], dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      } else if (event.key === "[" && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))) {
        onToggle();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [onToggle]);
  const matches = routes.filter(route => `${route.label} ${route.path}`.includes(search.trim()));
  return <div className="workbench-controls">
    {blocked + zero > 0 && <Link to="/sources" aria-label={`${blocked} 个来源阻塞，${zero} 个渠道额度已用尽`}>采集告警 {blocked + zero}</Link>}
    <button type="button" onClick={onToggle} aria-pressed={collapsed} className="sidebar-toggle">{collapsed ? "展开侧栏" : "折叠侧栏"}</button>
    <button type="button" onClick={open} aria-keyshortcuts="Control+K Meta+K">快速导航</button>
    <dialog ref={dialog} className="command-menu" aria-label="快速导航">
      <form method="dialog"><button aria-label="关闭快速导航">关闭</button></form>
      <label>查找页面 <input value={search} onChange={event => setSearch(event.target.value)} /></label>
      <ul>{matches.map(route => <li key={route.path}>
        <Link to={route.path} onClick={() => dialog.current?.close()}>{route.label}</Link>
      </li>)}</ul>
      {!matches.length && <p>没有匹配页面。</p>}
    </dialog>
  </div>;
}

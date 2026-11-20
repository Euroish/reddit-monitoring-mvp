import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Command, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { CollectionSource } from "../../../packages/contracts/src/source-content";
import { api } from "./api";
import { providerBudgetQuery, quotaFields } from "./budgets";

export type CommandRoute = {
  path: string;
  label: string;
  group?: string;
};

export default function WorkbenchControls({
  routes,
  collapsed,
  onToggle,
  admin,
}: {
  routes: readonly CommandRoute[];
  collapsed: boolean;
  onToggle: () => void;
  admin: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");

  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: () => api<{ sources: CollectionSource[] }>("/sources"),
    enabled: admin,
    staleTime: 60_000,
  });

  const budgets = useQuery({
    ...providerBudgetQuery,
    enabled: admin && sources.data?.sources.some((source) => source.deliveryMode === "pull") === true,
  });

  const blocked = admin
    ? (sources.data?.sources.filter((source) => source.automaticCollectionBlocked).length ?? 0)
    : 0;
  const pullProviders = new Set(
    sources.data?.sources
      .filter((source) => source.deliveryMode === "pull")
      .map((source) => source.primaryProvider),
  );
  const zero = admin
    ? (budgets.data?.budgets.filter(
        (budget) =>
          budget.enabled &&
          pullProviders.has(budget.provider) &&
          quotaFields.some(([limit, used]) => (budget[used] ?? 0) >= budget[limit]),
      ).length ?? 0)
    : 0;

  const open = () => {
    setSearch("");
    if (!dialog.current?.open) {
      dialog.current?.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        document.querySelector('[role="dialog"], dialog[open]')
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      } else if (
        event.key === "[" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !(event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]"))
      ) {
        onToggle();
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [onToggle]);

  const term = search.trim().toLowerCase();
  const matches = routes.filter((route) =>
    `${route.label} ${route.path} ${route.group ?? ""}`.toLowerCase().includes(term),
  );

  return (
    <div className="workbench-controls">
      {admin && blocked + zero > 0 && (
        <Link
          to="/sources"
          className="alert-pill"
          aria-label={`${blocked} 个来源阻塞，${zero} 个渠道额度已用尽`}
        >
          <AlertTriangle size={13} />
          <span>采集告警 {blocked + zero}</span>
        </Link>
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={collapsed}
        className="topbar-btn sidebar-toggle"
        aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}
        title={collapsed ? "展开侧栏 ([)" : "折叠侧栏 ([)"}
      >
        {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <button
        type="button"
        onClick={open}
        className="topbar-btn cmd-trigger"
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="快速导航"
      >
        <Command size={14} />
        <span className="cmd-label">快速导航</span>
        <kbd>⌘K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="command-menu"
        aria-label="快速导航"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="command-header">
          <label className="command-search">
            <span className="sr-only">查找页面</span>
            <input
              ref={inputRef}
              aria-label="查找页面"
              placeholder="跳转视图、主题频道或工作区页面…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <form method="dialog">
            <button className="icon-btn" aria-label="关闭快速导航">
              <X size={16} />
            </button>
          </form>
        </div>
        <ul className="command-list">
          {matches.map((route) => (
            <li key={route.path}>
              <Link to={route.path} onClick={() => dialog.current?.close()}>
                <span>{route.label}</span>
                {route.group && <small>{route.group}</small>}
              </Link>
            </li>
          ))}
        </ul>
        {!matches.length && <p className="command-empty">没有匹配页面。</p>}
      </dialog>
    </div>
  );
}

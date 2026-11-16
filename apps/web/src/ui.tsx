import type { ReactNode } from "react";
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
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
  note: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">研究工作台</p>
        <h1>{title}</h1>
        <p>{note}</p>
      </div>
      {children}
    </header>
  );
}

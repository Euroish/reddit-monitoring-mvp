import type { ReactNode } from 'react';
import { Card } from '../ui/card';

export function KpiCard({ label, value, badge, detail, trend }: {
  label: ReactNode;
  value: ReactNode;
  badge?: ReactNode;
  detail: ReactNode;
  trend?: ReactNode;
}) {
  return <Card className="kpi">
    <div className="kpi-top"><span className="kpi-label">{label}</span>{badge}</div>
    <div className="kpi-val">{value}</div>
    <div className="kpi-foot"><span className="kpi-sub">{detail}</span>{trend}</div>
  </Card>;
}

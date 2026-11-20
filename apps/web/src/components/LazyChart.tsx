import { lazy, Suspense, type ComponentProps } from "react";
const Chart = lazy(() => import("./AnalysisChart"));

export default function LazyChart(props: ComponentProps<typeof Chart>) {
  return <Suspense fallback={<p role="status">正在加载图表…</p>}><Chart {...props} /></Suspense>;
}

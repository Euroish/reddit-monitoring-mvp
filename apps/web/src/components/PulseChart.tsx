import type { ComponentProps } from "react";
import LazyChart from "./LazyChart";

type Props = Omit<Extract<ComponentProps<typeof LazyChart>, { kind: "pulse" }>, "kind">;

export default function PulseChart({ buckets, onPick }: Props) {
  const choices = buckets.flatMap(({ from, byPlatform }) =>
    byPlatform.map(({ platform, count }) => ({ from, platform, count })),
  );
  return <>
    <LazyChart kind="pulse" buckets={buckets} onPick={onPick} />
    {choices.length > 0 && <label className="facet-picker">按日期与平台查看内容
      <select value="" onChange={event => {
        if (event.target.value !== "") onPick(choices[Number(event.target.value)]);
      }}>
        <option value="">选择分面</option>
        {choices.map(({ from, platform, count }, index) =>
          <option key={`${from}/${platform}`} value={index}>{from.slice(0, 10)} · {platform} · {count}</option>,
        )}
      </select>
    </label>}
  </>;
}

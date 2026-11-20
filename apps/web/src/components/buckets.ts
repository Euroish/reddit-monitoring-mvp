const day = 86_400_000;
export function dailyBuckets(from: number, to: number, rows: { bucket: string; byPlatform: { platform: string; count: number }[] }[]) {
  const byDay = new Map(rows.map(row => [row.bucket.slice(0, 10), row.byPlatform]));
  return Array.from({ length: Math.max(0, Math.ceil((to - from) / day)) }, (_, index) => {
    const bucket = new Date(from + index * day).toISOString();
    return { from: bucket, byPlatform: byDay.get(bucket.slice(0, 10)) ?? [] };
  });
}

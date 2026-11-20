import { api } from "./api.js";

export const quotaFields = [
  ["daily_requests", "requests_today", "今日请求"],
  ["monthly_requests", "requests_month", "本月请求"],
  ["daily_resources", "resources_today", "今日预留记录数"],
  ["monthly_resources", "resources_month", "本月预留记录数"],
] as const;

export type Budget = {
  provider: string;
  enabled: boolean;
  revision: number;
  minimum_interval_ms: number;
} & Record<typeof quotaFields[number][0], number> &
Partial<Record<typeof quotaFields[number][1], number>>;

export const providerBudgetQuery = {
  queryKey: ["provider-budgets"],
  queryFn: () => api<{ budgets: Budget[] }>("/sources/budgets"),
  staleTime: 60_000,
};

import type { CollectionSource, SourceCollectionJob, SourceProviderBudget, SourceSchedule, SourceRefresh } from "../../packages/contracts/src/source-content";
export const defaultSourceSchedule = (): SourceSchedule => ({ enabled:false,cadenceSeconds:3600,overlapSeconds:300,initialLookbackHours:24,maxCatchupHours:6,pageSize:25,maxPages:5 });
export const defaultSourceRefresh = (): SourceRefresh => ({ enabled:false,afterHours:36,minIntervalHours:12,maxAttempts:3,batchSize:25 });
export function defaultProviderBudget(provider: string): SourceProviderBudget { const free=["arctic_shift","demo_reddit","demo_x"].includes(provider); return {provider,enabled:free,dailyRequests:free?1000:0,monthlyRequests:free?30000:0,dailyResources:free?100000:0,monthlyResources:free?3000000:0}; }
export function nextUsageDay(now: string) { return new Date(Date.parse(now.slice(0,10)+"T00:00:00.000Z")+86400000).toISOString(); }
export function activeJob(job: SourceCollectionJob) { return ["queued","running","retrying"].includes(job.status); }
/** Use elapsed UTC windows. A completed high-water mark advances only after exhaustion. */
export function scheduledWindow(source: CollectionSource, now: string) {
  const start=source.incrementalTo ?? new Date(Date.parse(now)-source.schedule.initialLookbackHours*3600000).toISOString();
  return { from:new Date(Date.parse(start)-source.schedule.overlapSeconds*1000).toISOString(),to:new Date(Math.min(Date.parse(now),Date.parse(start)+source.schedule.maxCatchupHours*3600000)).toISOString() };
}

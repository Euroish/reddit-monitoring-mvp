import type {SourceCollectionReadiness} from "../../../packages/contracts/src/http";
import type {SourceContentService} from "../../../src/application/services/source-content.service";

export async function buildSourceReadiness(service:SourceContentService,now:string):Promise<SourceCollectionReadiness> {
  const empty:SourceCollectionReadiness={status:"not_ready",activeSources:0,activeJobs:0,workerRequired:false,liveWorkers:0,oldestPendingAgeSeconds:null,sampleScope:"latest_100_jobs",recentFailures:[],requestTiming:{registeredRequests:0,durationMs:0,meanMs:null},reasons:[]};
  try {
    const [ops,sources,jobs]=await Promise.all([service.ops(),service.repository.listSources(),service.listJobs({limit:100})]);
    const enabled=new Set(service.capabilities().filter(cap=>cap.enabled).map(cap=>`${cap.platform}:${cap.provider}`));
    const active=sources.filter(source=>source.state==="active"&&enabled.has(`${source.platform}:${source.provider}`));
    const runnable=active.filter(source=>!source.automaticCollectionBlocked);
    const runnableIds=new Set(runnable.map(source=>source.id));
    const runnableOps=ops.sources.filter(source=>runnableIds.has(source.sourceId));
    const activeJobs=runnableOps.reduce((sum,source)=>sum+source.activeJobs,0);
    const scheduled=runnable.filter(source=>source.schedule.enabled||source.refresh.enabled);
    const workerRequired=activeJobs>0||scheduled.length>0;
    const liveWorkers=ops.workers.filter(worker=>worker.state==="active"&&!worker.stale).length;
    const reasons:string[]=[];
    if(active.some(source=>source.automaticCollectionBlocked))reasons.push("source_automatic_collection_blocked");
    if(workerRequired&&liveWorkers===0)reasons.push("source_worker_unavailable");
    const age=(time:string|null)=>time?Math.max(0,(Date.parse(now)-Date.parse(time))/1000):null;
    const pendingTimes=runnableOps.map(source=>source.oldestPendingAt).filter((time):time is string=>typeof time==="string").sort();
    const oldestPendingAgeSeconds=activeJobs>0?age(pendingTimes[0]??(active.some(source=>source.automaticCollectionBlocked)?null:ops.oldestQueuedAt)):null;
    if(oldestPendingAgeSeconds!==null&&oldestPendingAgeSeconds>3600)reasons.push("source_queue_age_elevated");
    if(scheduled.some(source=>source.lastSuccessAt===null))reasons.push("source_schedule_unproven");
    if(scheduled.some(source=>source.lastSuccessAt!==null&&age(source.lastSuccessAt)!>12*3600))reasons.push("source_last_success_stale");
    const recentFailures=jobs.filter(job=>job.status==="failed"&&age(job.finishedAt)!<=86400).slice(0,20).map(job=>({jobId:job.id,sourceId:job.sourceId,finishedAt:job.finishedAt,error:job.error}));
    if(recentFailures.length)reasons.push("source_recent_failures");
    const registeredRequests=jobs.reduce((sum,job)=>sum+(job.requestCount??0),0),durationMs=jobs.reduce((sum,job)=>sum+(job.requestDurationMs??0),0);
    const status=workerRequired&&liveWorkers===0?"not_ready":reasons.length?"degraded":workerRequired?"ready":"idle";
    return {status,activeSources:active.length,activeJobs,workerRequired,liveWorkers,oldestPendingAgeSeconds,sampleScope:"latest_100_jobs",recentFailures,requestTiming:{registeredRequests,durationMs,meanMs:registeredRequests?durationMs/registeredRequests:null},reasons};
  }catch{return {...empty,reasons:["source_observability_unavailable"]};}
}

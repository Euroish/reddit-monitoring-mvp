import { randomUUID } from "node:crypto";
import type { AppAuditRecord } from "../../../domain/entities/app-audit";
import type { AppAuditRepository, AppAuditQuery, BeginAppAudit } from "../../../domain/repositories/app-audit-repository";
import { auditChanges, auditCursor, auditQuery } from "../../app-audit";
export class InMemoryAppAuditRepository implements AppAuditRepository {
  private readonly records = new Map<string,AppAuditRecord>();
  async begin(entry:BeginAppAudit):Promise<AppAuditRecord> {
    auditQuery({action:entry.action,actorId:entry.actorUserId??undefined});
    const row:AppAuditRecord={id:entry.id??randomUUID(),actorUserId:entry.actorUserId,actorType:entry.actorType,action:entry.action,resourceType:entry.resourceType,resourceId:entry.resourceId??null,requestId:entry.requestId?.slice(0,200)??null,outcome:"attempted",changes:auditChanges(entry.changes),createdAt:entry.createdAt,completedAt:null};
    if(this.records.has(row.id))throw new Error("Audit ID already exists");this.records.set(row.id,row);return structuredClone(row);
  }
  async complete(id:string,outcome:"succeeded"|"failed",resourceId?:string|null,changes?:Record<string,unknown>):Promise<AppAuditRecord|null> {
    const row=this.records.get(id);if(!row||row.outcome!=="attempted")return null;
    const updated={...row,outcome,resourceId:resourceId??row.resourceId,changes:{...row.changes,...auditChanges(changes)},completedAt:new Date().toISOString()};this.records.set(id,updated);return structuredClone(updated);
  }
  async list(input:AppAuditQuery={}):Promise<{items:AppAuditRecord[];nextCursor:string|null}> {
    const q=auditQuery(input),rows=Array.from(this.records.values()).filter(row=>(!q.actorId||row.actorUserId===q.actorId)&&(!q.action||row.action===q.action)&&(!q.outcome||row.outcome===q.outcome)&&(!q.after||row.createdAt<q.after.createdAt||(row.createdAt===q.after.createdAt&&row.id<q.after.id))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    const items=rows.slice(0,q.limit).map(row=>structuredClone(row));return {items,nextCursor:rows.length>q.limit?auditCursor(items[items.length-1]):null};
  }
}

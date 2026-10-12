import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { AppAuditRecord } from "../../../domain/entities/app-audit";
import type { AppAuditRepository, AppAuditQuery, BeginAppAudit } from "../../../domain/repositories/app-audit-repository";
import type { PostgresClient } from "../../postgres/postgres-client";
import { auditChanges, auditCursor, auditQuery } from "../../app-audit";
interface Row extends QueryResultRow { id:string; actor_user_id:string|null; actor_type:AppAuditRecord["actorType"]; action:string; resource_type:string|null; resource_id:string|null; request_id:string|null; outcome:AppAuditRecord["outcome"]; meta_json:Record<string,unknown>; created_at:Date; completed_at:Date|null }
function map(row:Row):AppAuditRecord { return {id:row.id,actorUserId:row.actor_user_id,actorType:row.actor_type,action:row.action,resourceType:row.resource_type,resourceId:row.resource_id,requestId:row.request_id,outcome:row.outcome,changes:auditChanges(row.meta_json),createdAt:row.created_at.toISOString(),completedAt:row.completed_at?.toISOString()??null}; }
export class PostgresAppAuditRepository implements AppAuditRepository {
  constructor(private readonly db:PostgresClient) {}
  async begin(entry:BeginAppAudit):Promise<AppAuditRecord> {
    auditQuery({action:entry.action,actorId:entry.actorUserId??undefined});
    const result=await this.db.query<Row>("INSERT INTO app_audit_log(id,actor_user_id,actor_type,action,resource_type,resource_id,request_id,outcome,meta_json,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'attempted',$8,$9) RETURNING *",[entry.id??randomUUID(),entry.actorUserId,entry.actorType,entry.action,entry.resourceType,entry.resourceId??null,entry.requestId?.slice(0,200)??null,JSON.stringify(auditChanges(entry.changes)),entry.createdAt]);
    return map(result.rows[0]);
  }
  async complete(id:string,outcome:"succeeded"|"failed",resourceId?:string|null,changes?:Record<string,unknown>):Promise<AppAuditRecord|null> {
    const result=await this.db.query<Row>("UPDATE app_audit_log SET outcome=$2,resource_id=COALESCE($3,resource_id),meta_json=meta_json||$4::jsonb,completed_at=NOW() WHERE id=$1 AND outcome='attempted' RETURNING *",[id,outcome,resourceId??null,JSON.stringify(auditChanges(changes))]);
    return result.rows[0]?map(result.rows[0]):null;
  }
  async list(input:AppAuditQuery={}):Promise<{items:AppAuditRecord[];nextCursor:string|null}> {
    const q=auditQuery(input),result=await this.db.query<Row>("SELECT * FROM app_audit_log WHERE ($1::uuid IS NULL OR actor_user_id=$1) AND ($2::text IS NULL OR action=$2) AND ($3::text IS NULL OR outcome=$3) AND ($4::timestamptz IS NULL OR (created_at,id)<($4::timestamptz,$5::uuid)) ORDER BY created_at DESC,id DESC LIMIT $6",[q.actorId??null,q.action??null,q.outcome??null,q.after?.createdAt??null,q.after?.id??null,q.limit+1]);
    const items=result.rows.slice(0,q.limit).map(map);return {items,nextCursor:result.rows.length>q.limit?auditCursor(items[items.length-1]):null};
  }
}

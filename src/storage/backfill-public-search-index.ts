import type { PostgresClient } from "./postgres/postgres-client";
import { writePublicSearchDocument } from "./public-content-search";
export async function backfillPublicSearchIndex(db:Pick<PostgresClient,"query"|"withTransaction">,input:{limit?:number;after?:string;dryRun?:boolean;now?:string}={}){
  const limit=input.limit??100;if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error("Backfill limit must be 1–1000");if(input.after!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.after))throw new Error("Invalid backfill cursor");
  return db.withTransaction(async client=>{
    const rows=(await client.query(`SELECT c.id,c.title,c.body_text FROM content c LEFT JOIN public_content_search_document d ON d.content_id=c.id WHERE c.platform_details IS NOT NULL AND d.content_id IS NULL AND ($1::uuid IS NULL OR c.id>$1) ORDER BY c.id LIMIT $2 ${input.dryRun?"":"FOR UPDATE OF c"}`,[input.after??null,limit])).rows;
    if(!input.dryRun)for(const row of rows)await writePublicSearchDocument(client,row.id,row.title,row.body_text,input.now??new Date().toISOString());
    const last=rows.at(-1)?.id??input.after??null,remaining=(await client.query(`SELECT COUNT(*)::integer AS count,COUNT(*) FILTER(WHERE $1::uuid IS NULL OR c.id>$1)::integer AS ahead FROM content c LEFT JOIN public_content_search_document d ON d.content_id=c.id WHERE c.platform_details IS NOT NULL AND d.content_id IS NULL`,[last])).rows[0];
    return {formatVersion:1 as const,scanned:rows.length,written:input.dryRun?0:rows.length,dryRun:Boolean(input.dryRun),remaining:remaining.count,nextCursor:remaining.ahead&&last?last:null,requiresRescan:remaining.count>0&&!remaining.ahead};
  });
}

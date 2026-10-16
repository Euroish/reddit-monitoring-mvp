import "../src/runtime/load-local-env";
import { PostgresClient } from "../src/storage/postgres/postgres-client";
import { backfillPublicSearchIndex } from "../src/storage/backfill-public-search-index";
export async function main(){const args=process.argv.slice(2);if(args.some(arg=>arg!=="--dry-run"&&!/^--(limit|after)=/.test(arg)))throw new Error("Usage: backfill-public-search-index.ts [--limit=1..1000] [--after=UUID] [--dry-run]");const value=(key:string)=>args.find(arg=>arg.startsWith(`--${key}=`))?.slice(key.length+3),db=new PostgresClient();try{const result=await backfillPublicSearchIndex(db,{limit:value("limit")?Number(value("limit")):100,after:value("after"),dryRun:args.includes("--dry-run")});process.stdout.write(JSON.stringify(result)+"\n");}finally{await db.close();}}
if(require.main===module)main().catch(error=>{process.stderr.write((error instanceof Error?error.message:"Public-index backfill failed")+"\n");process.exitCode=1;});

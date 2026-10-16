import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir,mkdtemp,writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("native migration lock serializes independent clients and failed DDL/ledger rollback permits an unapplied-file repair",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* connection");
  const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1});
  const database=`source_validation_migration_${randomUUID().replaceAll("-","").slice(0,12)}`;try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;
  const dbA=new PostgresClient({connectionString:url.href,max:1}),dbB=new PostgresClient({connectionString:url.href,max:1});
  await mkdir(join(process.cwd(),"output","validation"),{recursive:true});const fixtureRoot=await mkdtemp(join(process.cwd(),"output","validation","migration-fixtures-")),schemaDir=join(fixtureRoot,"schema");await mkdir(schemaDir);
  try{
    const path=join(schemaDir,"001_atomic_fixture.sql"),broken="BEGIN;\nCREATE TABLE migration_atomic_fixture(id INTEGER PRIMARY KEY);\nINSERT INTO migration_atomic_fixture VALUES(1);\nSELECT deliberately_missing_column FROM migration_atomic_fixture;\nCOMMIT;\n";
    await writeFile(path,broken,"utf8");await assert.rejects(runMigrations({db:dbA,schemaDir}),/does not exist/);
    assert.equal((await dbA.query("SELECT to_regclass('public.migration_atomic_fixture') AS table_name,to_regclass('public.schema_migration') AS ledger_name")).rows[0].table_name,null);assert.equal((await dbA.query("SELECT to_regclass('public.schema_migration') AS ledger_name")).rows[0].ledger_name,null);
    const repaired="BEGIN;\nCREATE TABLE migration_atomic_fixture(id INTEGER PRIMARY KEY);\nINSERT INTO migration_atomic_fixture VALUES(1);\nSELECT pg_sleep(0.15);\nCOMMIT;\n";await writeFile(path,repaired,"utf8");
    const runs=await Promise.all([runMigrations({db:dbA,schemaDir}),runMigrations({db:dbB,schemaDir})]);assert.deepEqual(runs.map(value=>value.length).sort(),[0,1]);assert.equal((await dbA.query("SELECT COUNT(*)::integer AS n FROM migration_atomic_fixture")).rows[0].n,1);assert.equal((await dbA.query("SELECT COUNT(*)::integer AS n FROM schema_migration")).rows[0].n,1);
    // Existing successfully recorded SQL cannot be changed, including after concurrent startup.
    await writeFile(path,repaired+"-- changed applied fixture\n","utf8");await assert.rejects(runMigrations({db:dbA,schemaDir}),/checksum mismatch/);assert.equal((await dbB.query("SELECT COUNT(*)::integer AS n FROM migration_atomic_fixture")).rows[0].n,1);
    await writeFile(join(fixtureRoot,"result.json"),JSON.stringify({database,port:Number(url.port),scope:"isolated fixture migrations",concurrentRuns:runs,failedDdlAndLedgerRolledBack:true,repairedUnappliedFileSucceeded:true,appliedChecksumProtected:true},null,2),"utf8");
  }finally{await dbA.close();await dbB.close();}
});

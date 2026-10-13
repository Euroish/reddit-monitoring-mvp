import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { PostgresContentPersonalRepository } from "../../src/storage/repositories/postgres/postgres-content-personal.repository";
import { verifyPublicWorkspace,verifyPersonalWorkspace,WORKSPACE_USER_A,WORKSPACE_USER_B } from "../helpers/content-workspace-cases";
const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
async function isolated(run:(db:PostgresClient)=>Promise<unknown>){const url=new URL(connectionString!);assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname));const adminUrl=new URL(url);adminUrl.pathname="/postgres";const admin=new PostgresClient({connectionString:adminUrl.href,max:1}),database=`source_validation_workspace_${randomUUID().replaceAll("-","").slice(0,12)}`;try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;const db=new PostgresClient({connectionString:url.href,max:4});try{assert.ok((await runMigrations({db})).includes("036_content_personal_workspace.sql"));assert.deepEqual(await runMigrations({db}),[]);await db.query(`INSERT INTO app_user(id,email,role,status) VALUES($1,'workspace-a@example.test','viewer','active'),($2,'workspace-b@example.test','viewer','active')`,[WORKSPACE_USER_A,WORKSPACE_USER_B]);await run(db);}finally{await db.close();}}
test("PostgreSQL public detail, heterogeneous identities and advanced filters retain a single stored scope",{skip:!connectionString},()=>isolated(db=>verifyPublicWorkspace(new PostgresSourceContentRepository(db))));
test("PostgreSQL personal workspace revisions, account isolation, pagination and deletion round-trip",{skip:!connectionString},()=>isolated(db=>verifyPersonalWorkspace(new PostgresSourceContentRepository(db),new PostgresContentPersonalRepository(db))));

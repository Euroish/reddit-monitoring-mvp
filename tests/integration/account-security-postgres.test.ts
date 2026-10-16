import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresAppUserRepository } from "../../src/storage/repositories/postgres/postgres-app-user.repository";
import { PostgresAppSessionRepository } from "../../src/storage/repositories/postgres/postgres-app-session.repository";
import { PostgresAppAuditRepository } from "../../src/storage/repositories/postgres/postgres-app-audit.repository";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { AccountSecurityService } from "../../src/application/services/account-security.service";
import { loginAppUser } from "../../src/application/use-cases/login-app-user.use-case";
import { getCurrentAppUser } from "../../src/application/use-cases/get-current-app-user.use-case";
import type { AppUser } from "../../src/domain/entities/app-user";
import type { AppSession } from "../../src/domain/entities/app-session";

const connectionString=process.env.TEST_SOURCE_DATABASE_URL;
test("native account transactions fence stale login/passwords, serialize last-owner changes, revoke sessions and persist bounded secret-free audit intents",{skip:!connectionString},async()=>{
  const url=new URL(connectionString!);assert.ok(["127.0.0.1","localhost"].includes(url.hostname)&&/^\/source_validation_[a-z0-9_]+$/.test(url.pathname),"Use a dedicated loopback source_validation_* database");
  const database=`source_validation_account_${randomUUID().replaceAll("-","").slice(0,12)}`,adminUrl=new URL(url);adminUrl.pathname="/postgres";
  const admin=new PostgresClient({connectionString:adminUrl.href,max:1});try{await admin.query(`CREATE DATABASE "${database}"`);}finally{await admin.close();}url.pathname=`/${database}`;
  const dbA=new PostgresClient({connectionString:url.href,max:2}),dbB=new PostgresClient({connectionString:url.href,max:2});
  const usersA=new PostgresAppUserRepository(dbA),usersB=new PostgresAppUserRepository(dbB),sessionsA=new PostgresAppSessionRepository(dbA),sessionsB=new PostgresAppSessionRepository(dbB),hashes=new PasswordHashingService();
  const now="2026-10-13T01:00:00.000Z",password="Original-local-password-12",newPassword="Changed-local-password-12";
  const security=new AccountSecurityService({appUserRepository:usersA,appSessionRepository:sessionsA},hashes,()=>now);
  try {
    await runMigrations({db:dbA});
    const user:AppUser={id:randomUUID(),email:"native-viewer@example.test",role:"viewer",status:"active",createdAt:now,updatedAt:now};
    await usersA.create(user,{userId:user.id,passwordHash:await hashes.hashPassword(password),passwordAlgo:"scrypt",updatedAt:now});
    const a=await loginAppUser({appUserRepository:usersA,appSessionRepository:sessionsA,now:()=>now},{email:user.email,password});
    const b=await loginAppUser({appUserRepository:usersB,appSessionRepository:sessionsB,now:()=>now},{email:user.email,password});
    assert.equal(a.session.credentialVersion,0);assert.equal((await security.listSessions(user.id,a.session.id)).filter(row=>row.current).length,1);
    const old=await usersA.findByEmailWithPassword(user.email);assert.ok(old);
    const changes=await Promise.all([usersA.replacePasswordAndRevokeSessions(user.id,0,old.password.passwordHash,{userId:user.id,passwordHash:await hashes.hashPassword(newPassword),passwordAlgo:"scrypt",updatedAt:now}),usersB.replacePasswordAndRevokeSessions(user.id,0,old.password.passwordHash,{userId:user.id,passwordHash:await hashes.hashPassword("Competing-password-12"),passwordAlgo:"scrypt",updatedAt:now})]);
    assert.deepEqual(changes.sort(),[false,true]);assert.equal((await usersA.findById(user.id))!.credentialVersion,1);
    for(const tokenHash of [a.session.tokenHash,b.session.tokenHash])assert.equal(await getCurrentAppUser({appUserRepository:usersA,appSessionRepository:sessionsA,tokenHash,nowIso:now}),null);
    assert.equal(await sessionsB.createIfCurrent({...a.session,id:randomUUID(),tokenHash:randomUUID()},0),false);
    const latest=await usersA.findByEmailWithPassword(user.email);assert.ok(latest);
    assert.equal(await usersB.replacePasswordAndRevokeSessions(user.id,1,"different-old-hash",{...latest.password,passwordHash:"must-not-be-written"}),false);assert.equal((await usersA.findByEmailWithPassword(user.email))!.password.passwordHash,latest.password.passwordHash);

    // Hold a user update open. A concurrent session insert must wait for the lock and recheck the version.
    let locked!:()=>void,release!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
    const mutation=dbA.withTransaction(async client=>{await client.query("UPDATE app_user SET credential_version=credential_version+1 WHERE id=$1",[user.id]);locked();await hold;});
    await ready;
    const stale:AppSession={...a.session,id:randomUUID(),tokenHash:randomUUID(),credentialVersion:1};
    const insertion=sessionsB.createIfCurrent(stale,1);
    try { assert.equal(await Promise.race([insertion.then(()=>"finished"),delay(50).then(()=>"blocked")]),"blocked"); }
    finally { release();await mutation; }
    assert.equal(await insertion,false);
    await security.changeStatus({role:"machine"},user.id,"disabled");await security.changeStatus({role:"machine"},user.id,"active");assert.equal(await sessionsA.createIfCurrent({...stale,id:randomUUID()},2),false);

    const owners:AppUser[]=[{...user,id:randomUUID(),email:"native-owner-a@example.test",role:"owner"},{...user,id:randomUUID(),email:"native-owner-b@example.test",role:"owner"}];
    for(const owner of owners)await usersA.create(owner,{userId:owner.id,passwordHash:"unused-fixture",passwordAlgo:"scrypt",updatedAt:now});
    const ownerChanges=await Promise.all([usersA.updateAccess(owners[0].id,{status:"disabled"},now,{role:"machine"}),usersB.updateAccess(owners[1].id,{role:"viewer"},now,{role:"machine"})]);
    assert.deepEqual(ownerChanges.map(row=>row.outcome).sort(),["last_owner","updated"]);
    assert.equal(Number((await dbA.query("SELECT COUNT(*) AS n FROM app_user WHERE role='owner' AND status='active'")).rows[0].n),1);

    const auditA=new PostgresAppAuditRepository(dbA),auditB=new PostgresAppAuditRepository(dbB);
    const pending=await auditA.begin({actorUserId:user.id,actorType:"session",action:"account.password.change",resourceType:"user",resourceId:user.id,createdAt:now,changes:{password:"NEVER_STORE_SECRET",before:{status:"active",tokenHash:"NEVER_STORE_SECRET"},after:{revoked:true}}});
    assert.equal((await auditB.list({outcome:"attempted"})).items[0].id,pending.id,"Intent must be durable on an independent connection before mutation");
    assert.equal(JSON.stringify((await dbA.query("SELECT meta_json FROM app_audit_log WHERE id=$1",[pending.id])).rows[0]).includes("NEVER_STORE_SECRET"),false);
    await auditA.begin({actorUserId:null,actorType:"machine",action:"source.update",resourceType:"source",createdAt:now});
    await auditA.begin({actorUserId:user.id,actorType:"session",action:"source.update",resourceType:"source",createdAt:now});
    const first=await auditB.list({limit:1}),second=await auditB.list({limit:2,cursor:first.nextCursor});assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,3);assert.equal(second.nextCursor,null);
    assert.equal((await auditA.complete(pending.id,"succeeded",user.id,{after:{revoked:true},rawPayload:"NEVER_STORE_SECRET"}))!.outcome,"succeeded");
    assert.equal(await auditB.complete(pending.id,"failed"),null);assert.equal((await auditB.list({actorId:user.id,outcome:"succeeded"})).items.length,1);
    console.log(JSON.stringify({scope:"native isolated synthetic accounts and audit",database,staleLoginFenced:true,ownerInvariantSerialized:true,auditIntentCommitted:true,realSourceRequests:0}));
  } finally {await dbA.close();await dbB.close();}
});

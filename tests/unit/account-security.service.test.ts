import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { InMemoryAppUserRepository, InMemoryAppSessionRepository, InMemoryAppInviteRepository } from "../../src/storage/repositories/in-memory/auth.repositories";
import { InMemoryAppAuditRepository } from "../../src/storage/repositories/in-memory/app-audit.repository";
import { AccountSecurityService, AccountSecurityError } from "../../src/application/services/account-security.service";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { loginAppUser, AuthError } from "../../src/application/use-cases/login-app-user.use-case";
import { getCurrentAppUser } from "../../src/application/use-cases/get-current-app-user.use-case";
import { createAppInvite } from "../../src/application/use-cases/create-app-invite.use-case";
import type { AppUser } from "../../src/domain/entities/app-user";

const now="2026-10-13T01:00:00.000Z", newPassword="Updated-local-password-12", oldPassword="legacy";
async function fixture(role:AppUser["role"]="viewer") {
  const users=new InMemoryAppUserRepository(),sessions=new InMemoryAppSessionRepository(users),passwords=new PasswordHashingService();
  const user:AppUser={id:randomUUID(),email:`${randomUUID()}@example.test`,role,status:"active",createdAt:now,updatedAt:now};
  await users.create(user,{userId:user.id,passwordHash:await passwords.hashPassword(oldPassword),passwordAlgo:passwords.passwordAlgo,updatedAt:now});
  const service=new AccountSecurityService({appUserRepository:users,appSessionRepository:sessions},passwords,()=>now);
  const login=()=>loginAppUser({appUserRepository:users,appSessionRepository:sessions,now:()=>now},{email:user.email,password:oldPassword});
  return {users,sessions,passwords,user,service,login};
}
const errorCode=(code:string)=>(error:unknown)=>error instanceof AccountSecurityError&&error.code===code;

test("password change verifies existing short password, bounds new password, invalidates all sessions and never exposes token hashes",async()=>{
  const f=await fixture(),a=await f.login(),b=await f.login();
  const views=await f.service.listSessions(f.user.id,a.session.id);assert.equal(views.length,2);assert.equal(views.filter(row=>row.current).length,1);assert.ok(views.every(row=>!("tokenHash" in row)&&!("credentialVersion" in row)));
  await assert.rejects(f.service.changePassword(f.user.id,{currentPassword:"wrong",newPassword}),errorCode("invalid_credentials"));
  for(const password of ["x".repeat(11),"x".repeat(129)])await assert.rejects(f.service.changePassword(f.user.id,{currentPassword:oldPassword,newPassword:password}),errorCode("invalid_request"));
  assert.equal((await f.service.listSessions(f.user.id)).length,2);
  await f.service.changePassword(f.user.id,{currentPassword:oldPassword,newPassword});
  assert.equal((await f.service.listSessions(f.user.id)).length,0);
  for(const tokenHash of [a.session.tokenHash,b.session.tokenHash])assert.equal(await getCurrentAppUser({appUserRepository:f.users,appSessionRepository:f.sessions,tokenHash,nowIso:now}),null);
  await assert.rejects(f.login(),error=>error instanceof AuthError&&error.code==="invalid_credentials");
  const next=await loginAppUser({appUserRepository:f.users,appSessionRepository:f.sessions,now:()=>now},{email:f.user.email,password:newPassword});assert.equal(next.session.credentialVersion,1);
});

test("single session revoke is owner-scoped, expired sessions stay hidden, and revoke-all fences old session creation",async()=>{
  const f=await fixture(),a=await f.login(),b=await f.login();
  assert.equal(await f.service.revokeSession(randomUUID(),a.session.id),false);
  assert.equal(await f.service.revokeSession(f.user.id,a.session.id),true);assert.equal(await f.service.revokeSession(f.user.id,a.session.id),false);
  await f.sessions.create({...b.session,id:randomUUID(),tokenHash:randomUUID(),expiresAt:"2026-10-12T00:00:00.000Z"});
  assert.equal((await f.service.listSessions(f.user.id)).length,1);
  await f.service.revokeAllSessions(f.user.id);
  assert.equal(await f.sessions.createIfCurrent({...a.session,id:randomUUID(),tokenHash:randomUUID()},0),false);
  assert.equal((await f.service.listSessions(f.user.id)).length,0);
});

test("a password verified before disable/reactivate cannot create a resurrected session",async()=>{
  const f=await fixture();let release!:()=>void,verified!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{verified=resolve;});
  class DelayedPasswords extends PasswordHashingService {override async verifyPassword(password:string,hash:string){const result=await super.verifyPassword(password,hash);verified();await hold;return result;}}
  const pending=loginAppUser({appUserRepository:f.users,appSessionRepository:f.sessions,passwordHashingService:new DelayedPasswords(),now:()=>now},{email:f.user.email,password:oldPassword});
  const rejected=assert.rejects(pending,error=>error instanceof AuthError&&error.code==="invalid_credentials");
  await ready;await f.service.changeStatus({role:"machine"},f.user.id,"disabled");await f.service.changeStatus({role:"machine"},f.user.id,"active");release();await rejected;
  assert.equal(f.sessions.all().length,0);assert.equal((await f.users.findById(f.user.id))!.credentialVersion,2);
});

test("two concurrent password changes cannot overwrite each other after verifying the same credential snapshot",async()=>{
  const f=await fixture();let arrived=0,release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;});
  class BarrierPasswords extends PasswordHashingService {override async verifyPassword(password:string,hash:string){const valid=await super.verifyPassword(password,hash);arrived++;if(arrived===2)release();await hold;return valid;}}
  const service=new AccountSecurityService({appUserRepository:f.users,appSessionRepository:f.sessions},new BarrierPasswords(),()=>now);
  const results=await Promise.allSettled([service.changePassword(f.user.id,{currentPassword:oldPassword,newPassword}),service.changePassword(f.user.id,{currentPassword:oldPassword,newPassword:"Another-new-password-12"})]);
  assert.equal(results.filter(row=>row.status==="fulfilled").length,1);assert.equal((await f.users.findById(f.user.id))!.credentialVersion,1);
  const failed=results.find(row=>row.status==="rejected");assert.ok(failed?.status==="rejected"&&failed.reason instanceof AccountSecurityError&&failed.reason.code==="account_changed");
});

test("last active owner survives concurrent changes; admin restrictions, self-protection and refreshed actor privileges hold",async()=>{
  const f=await fixture("owner"),other:AppUser={...f.user,id:randomUUID(),email:"owner2@example.test"};
  await f.users.create(other,{userId:other.id,passwordHash:await f.passwords.hashPassword(oldPassword),passwordAlgo:"scrypt",updatedAt:now});
  await assert.rejects(f.service.changeStatus({role:"owner",userId:f.user.id},f.user.id,"disabled"),errorCode("self_change"));
  await assert.rejects(f.service.changeRole({role:"owner",userId:f.user.id},f.user.id,"admin"),errorCode("self_change"));
  const results=await Promise.allSettled([f.service.changeStatus({role:"machine"},f.user.id,"disabled"),f.service.changeRole({role:"machine"},other.id,"viewer")]);
  assert.equal(results.filter(row=>row.status==="fulfilled").length,1);assert.equal((await f.users.list()).filter(user=>user.role==="owner"&&user.status==="active").length,1);
  const owner=(await f.users.list()).find(user=>user.role==="owner"&&user.status==="active")!;
  const admin:AppUser={...f.user,id:randomUUID(),email:"admin@example.test",role:"admin"};
  const viewer:AppUser={...f.user,id:randomUUID(),email:"viewer@example.test",role:"viewer"};
  for(const user of [admin,viewer])await f.users.create(user,{userId:user.id,passwordHash:"unused",passwordAlgo:"scrypt",updatedAt:now});
  const actor={role:"admin" as const,userId:admin.id};
  await f.service.changeStatus(actor,viewer.id,"disabled");
  await assert.rejects(f.service.changeStatus(actor,owner.id,"disabled"),errorCode("forbidden"));
  await assert.rejects(f.service.changeRole(actor,viewer.id,"admin"),errorCode("forbidden"));
  await f.service.changeRole({role:"machine"},admin.id,"viewer");
  await assert.rejects(f.service.changeStatus(actor,viewer.id,"active"),errorCode("forbidden"));
});

test("durable audit intent retains unknown attempts, strips secret/raw keys, has stable bounded cursor pages and terminal outcomes",async()=>{
  const repo=new InMemoryAppAuditRepository(),actor=randomUUID();
  const row=await repo.begin({actorUserId:actor,actorType:"session",action:"source.update",resourceType:"source",createdAt:now,changes:{before:{status:"active",password:"secret1"},after:{status:"paused",tokenHash:"secret2"},headers:{authorization:"secret3"},rawPayload:"secret4"}});
  assert.equal(row.outcome,"attempted");assert.equal(row.completedAt,null);assert.equal(JSON.stringify(row).includes("secret"),false);
  await repo.begin({actorUserId:null,actorType:"machine",action:"budget.update",resourceType:"provider",createdAt:now});
  await repo.begin({actorUserId:actor,actorType:"session",action:"source.update",resourceType:"source",createdAt:now});
  const first=await repo.list({limit:1});assert.ok(first.nextCursor);const second=await repo.list({limit:2,cursor:first.nextCursor});assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,3);assert.equal(second.nextCursor,null);
  const completed=await repo.complete(row.id,"failed",null,{errorCode:"fixture_failure",passwordHash:"secret5"});assert.equal(completed!.outcome,"failed");assert.ok(completed!.completedAt);
  assert.equal(await repo.complete(row.id,"succeeded"),null);assert.equal((await repo.list({actorId:actor,action:"source.update",outcome:"failed"})).items.length,1);
  assert.equal((await repo.list({outcome:"attempted"})).items.length,2);
  await assert.rejects(repo.list({limit:101}),/limit/);await assert.rejects(repo.list({cursor:"broken"}),/cursor/);
});

test("generated invitation codes use cryptographic randomInt while preserving the six-digit contract",async()=>{
  const previous=Math.random;Math.random=()=>{throw new Error("Weak random generator must not be used");};
  try { const result=await createAppInvite({appInviteRepository:new InMemoryAppInviteRepository(),now:()=>now},{roleOnAccept:"viewer",maxUses:1});assert.match(result.code,/^\d{6}$/); }
  finally { Math.random=previous; }
});

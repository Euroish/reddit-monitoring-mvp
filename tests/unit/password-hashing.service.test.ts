import assert from "node:assert/strict";
import test from "node:test";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";

test("stored scrypt hashes round-trip and malformed/truncated/oversized hex never authenticates a password",async()=>{
  const service=new PasswordHashingService(),hash=await service.hashPassword("existing-legacy-password");
  assert.equal(await service.verifyPassword("existing-legacy-password",hash),true);
  assert.equal(await service.verifyPassword("different",hash),false);
  for(const bad of ["scrypt:01:zz","scrypt:"+"01".repeat(16)+":"+"zz".repeat(64),hash.slice(0,-1),hash+"00",hash+"\n","scrypt:0g:"+"01".repeat(64),"unsupported:"+hash])assert.equal(await service.verifyPassword("arbitrary",bad),false);
});

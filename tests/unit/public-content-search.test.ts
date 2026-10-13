import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { normalizePublicSearchText } from "../../src/storage/public-content-search";
import { verifyPublicSearch } from "../helpers/public-search-cases";
test("public search retains full stored Unicode, AND terms, literal phrase/exclusions and explicit missing-text coverage",async()=>{assert.equal(normalizePublicSearchText(" ＣＡＦÉ\t🙂\n资本市场 % "),"café 🙂 资本市场 %");await verifyPublicSearch(new InMemorySourceContentRepository());});
test("research memory snapshots synchronously freeze projection coverage and canonical text",async()=>{const repo=new InMemorySourceContentRepository(),fixture=await verifyPublicSearch(repo),snapshot=repo.snapshotForResearch(),before=await snapshot.contentStats({query:"needle"});await fixture.commit([{...fixture.records[0],title:"Changed now",text:null,observation:{...fixture.records[0].observation,sourceObservedAt:"2026-10-12T09:59:00.000Z",evidenceKey:"new"}}]);assert.equal((await snapshot.contentStats({query:"needle"})).total,before.total);assert.equal((await snapshot.searchCoverage(fixture.records.map(item=>item.id))).textMissing,1);assert.equal((await repo.searchCoverage(fixture.records.map(item=>item.id))).textMissing,2);});

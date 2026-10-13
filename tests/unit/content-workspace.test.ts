import test from "node:test";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryContentPersonalRepository } from "../../src/storage/repositories/in-memory/content-personal.repository";
import { verifyPublicWorkspace,verifyPersonalWorkspace } from "../helpers/content-workspace-cases";
test("public content details and advanced filters share stored scope, latest metrics and stable bound cursors",async()=>{await verifyPublicWorkspace(new InMemorySourceContentRepository());});
test("personal saved queries and annotations isolate accounts and enforce revisions, limits and bound pagination",async()=>{await verifyPersonalWorkspace(new InMemorySourceContentRepository(),new InMemoryContentPersonalRepository());});

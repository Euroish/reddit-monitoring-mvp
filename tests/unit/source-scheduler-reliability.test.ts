import test from "node:test";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { schedulerReliabilityCases } from "../helpers/source-scheduler-reliability-cases";
for(const item of schedulerReliabilityCases)test(item.name,()=>item.run(new InMemorySourceContentRepository()));

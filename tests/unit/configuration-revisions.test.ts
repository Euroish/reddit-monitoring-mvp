import test from "node:test";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryMonitorTargetRepository } from "../../src/storage/repositories/in-memory/raw-target-trend.repositories";
import { configurationRevisionCases } from "../helpers/configuration-revision-cases";
for(const item of configurationRevisionCases)test(item.name,()=>item.run(new InMemorySourceContentRepository(),new InMemoryMonitorTargetRepository()));

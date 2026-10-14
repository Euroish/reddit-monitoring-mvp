import test from "node:test";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { sourceFailurePolicyCases } from "../helpers/source-failure-policy-cases";
for (const item of sourceFailurePolicyCases) test(item.name, () => item.run(new InMemorySourceContentRepository()));

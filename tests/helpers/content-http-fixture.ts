import { randomUUID } from "node:crypto";
import { createApiServer, type CreateApiServerOptions } from "../../apps/api/src/create-api-server";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { ContentPersonalService } from "../../src/application/services/content-personal.service";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { InMemorySourceContentRepository } from "../../src/storage/repositories/in-memory/source-content.repository";
import { InMemoryContentPersonalRepository } from "../../src/storage/repositories/in-memory/content-personal.repository";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { createApiTestRepositories, startServer } from "../integration/api-server.helpers";
import { commitResearchItems, createResearchSource, RESEARCH_NOW, researchItem } from "./research-export-fixtures";

export async function contentHttpFixture(addOptions?: (source: InMemorySourceContentRepository, content: SourceContentService) => Partial<CreateApiServerOptions>) {
  const repos = createApiTestRepositories(), source = new InMemorySourceContentRepository(), origin = await createResearchSource(source), items = Array.from({ length: 5 }, (_, index) => researchItem(origin, index));
  await commitResearchItems(source, origin, items);
  const content = new SourceContentService(source, new DemoContentProvider("reddit", () => RESEARCH_NOW), () => RESEARCH_NOW);
  const personal = new ContentPersonalService(new InMemoryContentPersonalRepository(), content, () => RESEARCH_NOW);
  const passwords = new PasswordHashingService(), password = "Synthetic-http-password-12", users = [];
  for (const name of ["A", "B"]) {
    const user = { id: randomUUID(), email: `content-${name}@example.test`, role: "viewer" as const, status: "active" as const, createdAt: RESEARCH_NOW, updatedAt: RESEARCH_NOW };
    await repos.appUserRepository.create(user, { userId: user.id, passwordHash: await passwords.hashPassword(password), passwordAlgo: passwords.passwordAlgo, updatedAt: RESEARCH_NOW }); users.push(user);
  }
  const server = createApiServer({ repositories: repos, sourceContent: content, contentPersonal: personal, createConnector: () => new RedditMockConnector(), now: () => RESEARCH_NOW, auth: { bearerToken: "content-synthetic-machine" }, logger: () => {}, ...addOptions?.(source, content) });
  const base = await startServer(server);
  const request = async (path: string, method = "GET", body?: unknown, cookie?: string, machine = false) => {
    const response = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(machine ? { authorization: "Bearer content-synthetic-machine" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const a = await request("/auth/login", "POST", { email: users[0].email, password }), b = await request("/auth/login", "POST", { email: users[1].email, password });
  return { server, repos, source, origin, items, content, personal, base, request, a, b, users };
}

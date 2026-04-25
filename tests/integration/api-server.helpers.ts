import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  InMemoryAccountRepository,
  InMemoryAppInviteRepository,
  InMemoryAppSessionRepository,
  InMemoryAppUserRepository,
  InMemoryAnomalyEventRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryKeywordQuerySessionRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryPostGrowthFactRepository,
  InMemoryPostSearchDocumentRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
  InMemorySavedWorkbenchViewRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
  InMemoryStorageObservabilityRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

export interface JsonResponse<T> {
  status: number;
  body: T;
  requestId: string | null;
}

export function createApiTestRepositories() {
  const appInviteRepository = new InMemoryAppInviteRepository();
  const appUserRepository = new InMemoryAppUserRepository();
  appUserRepository.attachInviteRepository(appInviteRepository);

  return {
    monitorTargetRepository: new InMemoryMonitorTargetRepository(),
    collectionJobRepository: new InMemoryCollectionJobRepository(),
    crawlCursorRepository: new InMemoryCrawlCursorRepository(),
    rawEventRepository: new InMemoryRawEventRepository(),
    accountRepository: new InMemoryAccountRepository(),
    appUserRepository,
    appInviteRepository,
    appSessionRepository: new InMemoryAppSessionRepository(),
    anomalyEventRepository: new InMemoryAnomalyEventRepository(),
    contentRepository: new InMemoryContentRepository(),
    keywordTrendDailyRepository: new InMemoryKeywordTrendDailyRepository(),
    keywordQuerySessionRepository: new InMemoryKeywordQuerySessionRepository(),
    postSearchDocumentRepository: new InMemoryPostSearchDocumentRepository(),
    postGrowthFactRepository: new InMemoryPostGrowthFactRepository(),
    metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
    subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
    subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
    savedWorkbenchViewRepository: new InMemorySavedWorkbenchViewRepository(),
    storageObservabilityRepository: new InMemoryStorageObservabilityRepository(),
  };
}

export async function startServer(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

export async function stopServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

export async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    headers,
  });
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
  };
}

export async function postJson<T>(
  url: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;
  return {
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id"),
  };
}

export async function optionsRequest(
  url: string,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method: "OPTIONS",
    headers,
  });
}

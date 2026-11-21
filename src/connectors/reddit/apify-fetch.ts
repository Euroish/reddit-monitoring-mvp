const APIFY_ORIGIN = "https://api.apify.com";

export function createApifyFetch(
  env: NodeJS.ProcessEnv,
  fetchPage: typeof fetch = fetch,
): typeof fetch {
  const configured = env.APIFY_RELAY_ORIGIN?.trim();
  if (!configured) return fetchPage;
  const relay = new URL(configured);
  if (relay.protocol !== "http:" || relay.username || relay.password || relay.href !== relay.origin + "/") {
    throw new Error("APIFY_RELAY_ORIGIN must be a private HTTP origin");
  }

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (input instanceof Request || url.origin !== APIFY_ORIGIN || url.username || url.password) {
      throw new Error("Apify relay requires a canonical API URL");
    }
    const headers = new Headers(init?.headers);
    headers.delete("Authorization");
    const target = new URL(relay.origin);
    target.pathname = url.pathname;
    target.search = url.search;
    return fetchPage(target, { ...init, headers, redirect: "error" });
  };
}

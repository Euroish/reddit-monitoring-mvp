import assert from "node:assert/strict";
import test from "node:test";
import { advanceAuthEpoch, fetchApi, getAuthEpoch, UNAUTHORIZED_EVENT } from "../../apps/web/src/api/client";

// Ignore abort in the fake transport to prove the post-response epoch guard as well.
test("a late successful response cannot cross an authentication boundary", async () => {
  const nativeFetch = globalThis.fetch;
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => { await gate; return Response.json({ owner: "previous-user" }); };
  try {
    const oldResponse = fetchApi<{ owner: string }>("/v1/workbench/saved-views");
    advanceAuthEpoch();
    release();
    await assert.rejects(oldResponse, { name: "AbortError" });
    globalThis.fetch = async () => Response.json({ owner: "next-user" });
    assert.deepEqual(await fetchApi("/v1/workbench/saved-views"), { owner: "next-user" });
  } finally { globalThis.fetch = nativeFetch; advanceAuthEpoch(); }
});

test("a late 401 cannot expire the new identity, but a current 401 carries its epoch", async () => {
  const nativeFetch = globalThis.fetch;
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: events, configurable: true });
  const received: number[] = [];
  events.addEventListener(UNAUTHORIZED_EVENT, event => { received.push((event as CustomEvent<{ epoch: number }>).detail.epoch); });
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async () => { await gate; return Response.json({ errorCode: "unauthorized" }, { status: 401 }); };
  try {
    const oldResponse = fetchApi("/v1/private");
    advanceAuthEpoch(); release();
    await assert.rejects(oldResponse, { name: "AbortError" });
    assert.deepEqual(received, []);
    globalThis.fetch = async () => Response.json({ errorCode: "unauthorized", error: "Session expired" }, { status: 401 });
    await assert.rejects(fetchApi("/v1/private"), { name: "ApiError", message: "Session expired" });
    assert.deepEqual(received, [getAuthEpoch()]);
    await assert.rejects(fetchApi("/auth/login"), { name: "ApiError" });
    assert.equal(received.length, 1, "a failed login must remain a form error");
  } finally {
    globalThis.fetch = nativeFetch; advanceAuthEpoch();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

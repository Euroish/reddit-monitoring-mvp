import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import {
  bootstrapOwner,
  createSession,
  hashPassword,
} from "../../src/modules/access/sql";
import { transaction } from "../../src/storage/db";
import {
  commitContentBatch,
  prepareContentBatch,
} from "../../src/modules/content/sql";
import { batchItem, BATCH_NOW } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";
import { runMigrations } from "../../src/storage/schema/run-migrations";

const origin = "http://workbench.test";
test("PG16 HTTP workbench: auth, mixed ingest, permissions, replay, NULL cursors, search, workspace and streaming", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const app = await buildApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    rateLimitMax: 10000,
  });
  await app.ready();
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" },
  });
  assert.equal(login.statusCode, 200, login.body);
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const headers = { cookie, origin };
  const source = async (label: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sources",
      headers,
      payload: {
        platform: "reddit",
        primaryProvider: "external_ingest",
        deliveryMode: "push",
        label,
        contentKind: "post",
        target: { type: "search", query: label },
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().source;
  };
  const a = await source("Allowed"),
    b = await source("Other");
  const item = batchItem(a.id);
  item.observation.provider = "external_ingest";
  item.observation.evidenceKey = "snapshot-a";
  const known = batchItem(a.id, {
    externalId: "t3_known123",
    publishedAt: "2026-11-16T10:00:00.123456Z",
    title: "Hello",
    text: "World 100%_ 中文内容",
    observation: { ...item.observation, evidenceKey: "known" },
  });
  const comments = Array.from({ length: 30 }, (_, i) =>
    batchItem(a.id, {
      kind: "comment",
      externalId: `t1_19riqx8r${i.toString().padStart(5, "0")}`,
      title: null,
      references: [
        { kind: "post", externalId: item.externalId, relation: "thread_root" },
        { kind: "post", externalId: item.externalId, relation: "reply_to" },
      ],
      observation: { ...item.observation, evidenceKey: `comment-${i}` },
    }),
  );
  const payload = { items: [item, known, ...comments] };
  const ingest = (data = payload, key = "receipt-1") =>
    app.inject({
      method: "POST",
      url: `/v1/sources/${a.id}/ingest`,
      headers: { ...headers, "idempotency-key": key },
      payload: data,
    });
  await t.test(
    "default deny, CSRF, invalid invitations, machine scopes and viewer RBAC",
    async () => {
      assert.equal((await app.inject("/healthz")).statusCode, 200);
      assert.equal((await app.inject("/v1/content")).statusCode, 401);
      assert.equal((await app.inject("/v1/not-registered")).statusCode, 401);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/auth/login",
            payload: {
              email: "owner@example.test",
              password: "fixture-password-123",
            },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/auth/register",
            headers: { origin },
            payload: {
              email: "new@example.test",
              password: "fixture-password-123",
              invite: "invalid",
            },
          })
        ).statusCode,
        403,
      );
      const id = randomUUID();
      await db.pool.query(
        "INSERT INTO app_user(id,email,role,status) VALUES($1,'viewer@example.test','viewer','active')",
        [id],
      );
      await db.pool.query(
        "INSERT INTO app_user_password(user_id,password_hash,password_algo) VALUES($1,$2,'scrypt')",
        [id, await hashPassword("fixture-password-123")],
      );
      const viewerLogin = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        headers: { origin },
        payload: {
          email: "viewer@example.test",
          password: "fixture-password-123",
        },
      });
      const viewerCookie =
        viewerLogin.headers["set-cookie"]!.toString().split(";")[0];
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/v1/sources",
            headers: { cookie: viewerCookie, origin },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (await app.inject({ method: "GET", url: "/v1/openapi.json", headers }))
          .statusCode,
        200,
      );
      const schema = (
        await app.inject({ method: "GET", url: "/v1/openapi.json", headers })
      ).json();
      assert.ok(schema.paths["/v1/sources/{id}/ingest"]);
    },
  );
  await t.test(
    "expired, disabled and credential-changed sessions are rejected; forwarded headers cannot bypass rate limits",
    async () => {
      const viewer = (
        await db.pool.query(
          "SELECT id FROM app_user WHERE email='viewer@example.test'",
        )
      ).rows[0].id;
      const session = await createSession(
        db.pool,
        viewer,
        "machine",
        ["read"],
        [a.id],
        1,
      );
      const auth = { authorization: `Bearer ${session.token}` };
      const read = () => app.inject({ url: "/v1/content", headers: auth });
      assert.equal((await read()).statusCode, 200);
      await db.pool.query(
        "UPDATE app_session SET expires_at=NOW()-interval '1 second' WHERE id=$1",
        [session.id],
      );
      assert.equal((await read()).statusCode, 401);
      await db.pool.query(
        "UPDATE app_session SET expires_at=NOW()+interval '1 day' WHERE id=$1",
        [session.id],
      );
      await db.pool.query("UPDATE app_user SET status='disabled' WHERE id=$1", [
        viewer,
      ]);
      assert.equal((await read()).statusCode, 401);
      await db.pool.query(
        "UPDATE app_user SET status='active',credential_version=credential_version+1 WHERE id=$1",
        [viewer],
      );
      assert.equal((await read()).statusCode, 401);
      const limited = await buildApp({
        pool: db.pool,
        sessionSecret: "synthetic-limit-secret".repeat(2),
        origin,
        rateLimitMax: 2,
      });
      try {
        for (let index = 0; index < 3; index++) {
          const response = await limited.inject({
            url: "/v1/auth/session",
            headers: { "x-forwarded-for": `192.0.2.${index + 1}` },
          });
          assert.equal(response.statusCode, index < 2 ? 200 : 429);
        }
      } finally {
        await limited.close();
      }
      await db.pool.query(
        "UPDATE collection_source SET primary_provider='arctic_shift',state='archived' WHERE id=$1",
        [b.id],
      );
      const sources = await app.inject({ url: "/v1/sources", headers });
      assert.equal(sources.statusCode, 200, sources.body);
      assert.equal(
        sources
          .json()
          .sources.find((source: { id: string }) => source.id === b.id)
          .primaryProvider,
        "arctic_shift",
      );
      await db.pool.query(
        "UPDATE collection_source SET primary_provider='external_ingest',state='active' WHERE id=$1",
        [b.id],
      );
    },
  );
  await t.test(
    "concurrent ingest replays one receipt; different bodies conflict and malformed batches roll back",
    async () => {
      const responses = await Promise.all([ingest(), ingest()]);
      assert.deepEqual(
        responses.map((response) => response.statusCode),
        [201, 200],
      );
      assert.equal(responses[0].json().jobId, responses[1].json().jobId);
      assert.equal(responses[0].json().added, 32);
      assert.equal((await ingest({ items: [item] })).statusCode, 409);
      assert.equal(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM content_observation WHERE collection_source_id=$1",
            [a.id],
          )
        ).rows[0].count,
        "32",
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/v1/sources/${a.id}/ingest`,
            headers,
            payload,
          })
        ).statusCode,
        400,
      );
      assert.equal(
        (
          await ingest(
            { items: [{ ...item, text: "x".repeat(1048576) }] },
            "large",
          )
        ).statusCode,
        413,
      );
      const malformed = {
        ...item,
        observation: { ...item.observation, sourceId: b.id },
      };
      assert.equal(
        (
          await ingest(
            {
              items: [
                batchItem(a.id, {
                  externalId: "t3_mustrollback",
                  observation: { ...item.observation, evidenceKey: "rollback" },
                }),
                malformed,
              ],
            },
            "bad-source",
          )
        ).statusCode,
        422,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT id FROM content WHERE external_id='t3_mustrollback'",
          )
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    "machine keys restrict listing, content IDs, ingest, export and personal workspace",
    async () => {
      const issued = await app.inject({
        method: "POST",
        url: "/v1/access/keys",
        headers,
        payload: {
          label: "Research tool",
          scopes: [
            "read",
            "export",
            "ingest",
          ],
          allowedSourceIds: [a.id],
          expiresInDays: 1,
        },
      });
      assert.equal(issued.statusCode, 200, issued.body);
      const machine = { authorization: `Bearer ${issued.json().token}` };
      assert.equal(
        (await app.inject({ url: "/v1/sources", headers: machine })).json()
          .sources.length,
        1,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/v1/sources/${b.id}/ingest`,
            headers: { ...machine, "idempotency-key": "forbidden" },
            payload,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (await app.inject({ url: "/v1/workspace/queries", headers: machine }))
          .statusCode,
        403,
      );
      const other = batchItem(b.id, {
        externalId: "t3_other123",
        observation: {
          ...item.observation,
          sourceId: b.id,
          evidenceKey: "other",
        },
      });
      await app.inject({
        method: "POST",
        url: `/v1/sources/${b.id}/ingest`,
        headers: { ...headers, "idempotency-key": "other" },
        payload: { items: [other] },
      });
      assert.equal(
        (await app.inject({ url: `/v1/content/${other.id}`, headers: machine }))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await app.inject({
            url: `/v1/content?sourceId=${b.id}`,
            headers: machine,
          })
        ).json().items.length,
        0,
      );
      const scopedExport = await app.inject({
        url: `/v1/content/export?sourceId=${b.id}`,
        headers: machine,
      });
      assert.deepEqual(scopedExport.json().items, []);
      assert.equal(scopedExport.json().result.complete, true);
      await app.inject({
        method: "DELETE",
        url: `/v1/access/keys/${issued.json().id}`,
        headers,
      });
      assert.equal(
        (await app.inject({ url: "/v1/content", headers: machine })).statusCode,
        401,
      );
    },
  );
  await t.test(
    "keyset crosses NULL boundary without duplicates and binds cursors to query scope",
    async () => {
      const seen = new Set<string>();
      let cursor = "";
      do {
        const response = await app.inject({
          url: `/v1/content?sourceId=${a.id}&limit=7${cursor ? `&cursor=${cursor}` : ""}`,
          headers,
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().totalMatching, null);
        for (const row of response.json().items) {
          assert.ok(!seen.has(row.id));
          seen.add(row.id);
        }
        cursor = response.json().nextCursor;
        if (cursor)
          assert.equal(
            (
              await app.inject({
                url: `/v1/content?sourceId=${b.id}&cursor=${cursor}`,
                headers,
              })
            ).statusCode,
            409,
          );
      } while (cursor);
      assert.equal(seen.size, 32);
      const rows = (
        await app.inject({ url: `/v1/content?sourceId=${a.id}`, headers })
      ).json().items;
      assert.equal(rows[0].id, known.id);
      assert.equal(rows[1].publishedAt, null);
    },
  );
  await t.test(
    "single projection searches literal wildcard characters and cannot bridge title/body",
    async () => {
      for (const [query, count] of [
        ["Hello World", 0],
        ["100%_", 1],
        ["中文内容", 1],
      ] as const) {
        const response = await app.inject({
          url: `/v1/content?sourceId=${a.id}&query=${encodeURIComponent(query)}`,
          headers,
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().items.length, count);
      }
      for (const [query, scope, count] of [["中文", "text", 1], ["中文", "title", 0], ["el", "title", 1]] as const) {
        const response = await app.inject({
          url: `/v1/content?sourceId=${a.id}&query=${encodeURIComponent(query)}&searchScope=${scope}`, headers,
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().items.some((entry: { externalId: string }) => entry.externalId === known.externalId), !!count);
      }
      const excluded = await app.inject({ url: `/v1/content?sourceId=${a.id}&exclusions=%E4%B8%AD%E6%96%87`, headers });
      assert.equal(excluded.statusCode, 200, excluded.body);
      assert.ok(!excluded.json().items.some((entry: { externalId: string }) => entry.externalId === known.externalId));
      assert.equal(
        (
          await app.inject({
            url: `/v1/content?sourceId=${a.id}&query=World&searchScope=title`,
            headers,
          })
        ).json().items.length,
        0,
      );
      const missing = (
        await db.pool.query(
          "SELECT COUNT(*) FROM content c LEFT JOIN public_content_search_document d ON d.content_id=c.id WHERE d.content_id IS NULL",
        )
      ).rows[0].count;
      assert.equal(missing, "0");
    },
  );
  await t.test(
    "deterministic versions, four set writes, retained observations and deletion prevent resurrection",
    async () => {
      const next = {
        ...item,
        title: "Accepted title",
        observation: {
          ...item.observation,
          evidenceKey: "z",
          metrics: { "reddit.score": 2 },
        },
      };
      await ingest({ items: [next] }, "next");
      await ingest(
        {
          items: [
            {
              ...item,
              title: null,
              text: null,
              observation: { ...item.observation, evidenceKey: "zz" },
            },
          ],
        },
        "sparse",
      );
      assert.equal(
        (await app.inject({ url: `/v1/content/${item.id}`, headers })).json()
          .content.title,
        "Accepted title",
      );
      await transaction(db.pool, async (client) => {
        const original = client.query.bind(client);
        let count = 0;
        client.query = ((...args: unknown[]) => {
          count++;
          return Reflect.apply(original, client, args);
        }) as typeof client.query;
        try {
          await commitContentBatch(
            client,
            {
              id: a.id,
              platformId: "11111111-1111-1111-1111-111111111111",
              platform: "reddit",
              provider: "external_ingest",
              contentKinds: ["post", "comment"],
            },
            prepareContentBatch([item, ...comments]),
            BATCH_NOW,
          );
          assert.equal(count, 4);
        } finally {
          client.query = original;
        }
      });
      const deleted = {
        ...item,
        availability: "deleted" as const,
        observation: { ...item.observation, evidenceKey: "zzz" },
      };
      await ingest({ items: [deleted] }, "deleted");
      await ingest({ items: [next] }, "older");
      const stored = (
        await app.inject({ url: `/v1/content/${item.id}`, headers })
      ).json().content;
      assert.equal(stored.availability, "deleted");
      assert.equal(stored.title, null);
      assert.equal(stored.text, null);
      const evidence = (
        await db.pool.query(
          "SELECT fetched_at FROM content_observation WHERE content_id=$1 AND evidence_key='z'",
          [item.id],
        )
      ).rows[0].fetched_at.toISOString();
      await ingest(
        {
          items: [
            {
              ...next,
              fetchedAt: "2026-11-17T00:00:00Z",
              observation: {
                ...next.observation,
                fetchedAt: "2026-11-17T00:00:00Z",
              },
            },
          ],
        },
        "reread",
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT fetched_at FROM content_observation WHERE content_id=$1 AND evidence_key='z'",
            [item.id],
          )
        ).rows[0].fetched_at.toISOString(),
        evidence,
      );
      const rollback = batchItem(a.id, {
        externalId: "t3_rollback",
        observation: { ...item.observation, evidenceKey: "rollback" },
      });
      assert.equal(
        (
          await ingest(
            { items: [rollback, { ...next, title: "Conflicting evidence" }] },
            "conflict",
          )
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await db.pool.query("SELECT id FROM content WHERE id=$1", [
            rollback.id,
          ])
        ).rowCount,
        0,
      );
    },
  );
  await t.test(
    "personal assets stay isolated, annotation revisions reject stale writes, project reads share filters",
    async () => {
      const annotationUrl = `/v1/workspace/annotations/${known.id}`;
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: annotationUrl,
            headers,
            payload: { favorite: true, note: "Evidence", revision: 0 },
          })
        ).json().revision,
        1,
      );
      assert.equal(
        (
          await app.inject({
            method: "PUT",
            url: annotationUrl,
            headers,
            payload: { favorite: false, note: "Stale", revision: 0 },
          })
        ).statusCode,
        409,
      );
      await app.inject({
        method: "POST",
        url: "/v1/workspace/queries",
        headers,
        payload: {
          name: "Research",
          filter: { sourceId: a.id, query: "World" },
        },
      });
      const viewer = (
        await db.pool.query(
          "SELECT id FROM app_user WHERE email='viewer@example.test'",
        )
      ).rows[0];
      const other = await createSession(
        db.pool,
        viewer.id,
        "machine",
        ["read"],
        [a.id],
        1,
      );
      assert.equal(
        (
          await app.inject({
            url: "/v1/workspace/annotations",
            headers: { authorization: `Bearer ${other.token}` },
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await db.pool.query(
            "SELECT COUNT(*) FROM content_annotation WHERE user_id=$1",
            [viewer.id],
          )
        ).rows[0].count,
        "0",
      );
      const project = await app.inject({
        method: "POST",
        url: "/v1/projects",
        headers,
        payload: {
          name: "Topic",
          includePushInTrends: true,
          sourceIds: [a.id],
          filter: { anyTerms: ["World"], exclusions: ["missing"] },
        },
      });
      assert.equal(project.statusCode, 200, project.body);
      const overview = await app.inject({
        url: `/v1/projects/${project.json().id}/overview`,
        headers,
      });
      assert.equal(overview.statusCode, 200, overview.body);
      assert.equal(
        overview
          .json()
          .facets.find(
            (facet: {
              day_group: number;
              platform_group: number;
              kind_group: number;
            }) =>
              facet.day_group === 1 &&
              facet.platform_group === 1 &&
              facet.kind_group === 1,
          ).count,
        1,
      );
    },
  );
  await t.test(
    "stream downloads use the same visible slice and migrations remain immutable",
    async () => {
      const response = await app.inject({
        url: `/v1/content/export?sourceId=${a.id}`,
        headers,
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.headers["x-accel-buffering"], "no");
      assert.equal(response.json().items.length, 32);
      const csv = await app.inject({
        url: `/v1/content/export?sourceId=${a.id}&format=csv`,
        headers,
      });
      assert.equal(csv.statusCode, 200);
      assert.match(csv.body, /t3_known123/);
      assert.deepEqual(await runMigrations({ pool: db.pool }), []);
      await db.pool.query(
        "UPDATE schema_migration SET checksum='bad' WHERE filename='041_content_batch.sql'",
      );
      await assert.rejects(
        runMigrations({ pool: db.pool }),
        /checksum mismatch/,
      );
    },
  );
  await t.test(
    "disconnect destroys export cursor and releases the database transaction",
    async () => {
      const exportSource = await source("Export cancellation fixture");
      const items = Array.from({ length: 1000 }, (_, i) =>
        batchItem(exportSource.id, {
          externalId: `t3_export${i}`,
          text: "x".repeat(10000),
          observation: {
            ...item.observation,
            sourceId: exportSource.id,
            evidenceKey: `export-${i}`,
          },
        }),
      );
      await transaction(db.pool, (client) =>
        commitContentBatch(
          client,
          {
            id: exportSource.id,
            platformId: "11111111-1111-1111-1111-111111111111",
            platform: "reddit",
            provider: "external_ingest",
            contentKinds: ["post"],
          },
          prepareContentBatch(items),
          BATCH_NOW,
        ),
      );
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const response = await fetch(
        `${address}/v1/content/export?sourceId=${exportSource.id}`,
        { headers: { cookie } },
      );
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      assert.equal((await reader.read()).done, false);
      const concurrent = await fetch(`${address}/v1/content/export`, { headers: { cookie } });
      assert.equal(concurrent.status, 429);
      assert.equal(concurrent.headers.get("retry-after"), "5");
      assert.match((await concurrent.json()).error.message, /export is in progress/);
      await reader.cancel();
      let active = 1;
      for (let attempt = 0; attempt < 50 && active; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        active = Number(
          (
            await db.pool.query(
              "SELECT COUNT(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid()",
            )
          ).rows[0].count,
        );
      }
      assert.equal(active, 0);
      assert.equal(db.pool.waitingCount, 0);
    },
  );
  await t.test("thread resolves a visible nested reply without an explicit thread root", async () => {
    const nested = batchItem(a.id, {
      kind: "comment", externalId: "t1_nestedshort",
      references: [{ kind: "comment", externalId: comments[0].externalId, relation: "reply_to" }],
      observation: { ...item.observation, evidenceKey: "nested-reply" },
    });
    const inserted = await ingest({ items: [nested] }, "nested-reply");
    assert.equal(inserted.statusCode, 201, inserted.body);
    const row = (await db.pool.query("SELECT id FROM content WHERE external_id=$1", [nested.externalId])).rows[0];
    const response = await app.inject({ url: `/v1/content/${row.id}/thread`, headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().root.externalId, item.externalId);
    const node = response.json().nodes.find(({ item }: { item: { id: string } }) => item.id === row.id);
    assert.equal(node?.depth, 2);
    assert.equal(node.contextMissing, false);
  });
});

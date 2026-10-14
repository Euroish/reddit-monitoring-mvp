import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
for (const zone of ["UTC", "Asia/Shanghai", "America/New_York"]) {
  test(`PostgreSQL provider quotas and reported usage use UTC day/month boundaries under ${zone}`, { skip: !connectionString }, async () => {
    const url = new URL(connectionString!);
    assert.ok(["postgres:", "postgresql:"].includes(url.protocol) && ["127.0.0.1", "localhost"].includes(url.hostname)
      && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname) && !url.search && !url.hash,
    "Use a dedicated loopback source_validation_* database");
    const database = `source_validation_budget_utc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
    const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
    try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
    url.pathname = `/${database}`;
    // A single connection retains the explicit session TimeZone for every repository call.
    const db = new PostgresClient({ connectionString: url.href, max: 1 });
    try {
      await runMigrations({ db });
      await db.query("SELECT set_config('TimeZone',$1,false)", [zone]);
      const repository = new PostgresSourceContentRepository(db);
      const beforeMonth = "2026-10-31T23:59:59.000Z", afterMonth = "2026-11-01T00:00:00.000Z";
      const monthlyProvider = "utc_monthly_fixture", dailyProvider = "utc_daily_fixture";
      await repository.setProviderBudget({ provider: monthlyProvider, enabled: true, dailyRequests: 1, monthlyRequests: 1,
        dailyResources: 10, monthlyResources: 10, minimumIntervalMs: 0 }, beforeMonth);
      assert.equal((await repository.reserveUsage(monthlyProvider, 10, beforeMonth)).allowed, true);
      let usage = (await repository.providerUsage(afterMonth)).find(row => row.provider === monthlyProvider)!;
      assert.equal(usage.day, "2026-11-01"); assert.equal(usage.month, "2026-11");
      assert.equal(usage.dailyRequests, 0); assert.equal(usage.monthlyRequests, 0);
      assert.equal(usage.dailyResources, 0); assert.equal(usage.monthlyResources, 0);
      assert.equal((await repository.reserveUsage(monthlyProvider, 10, afterMonth)).allowed, true,
        "Prior UTC month usage must not consume the new month's budget");
      usage = (await repository.providerUsage(afterMonth)).find(row => row.provider === monthlyProvider)!;
      assert.equal(usage.dailyRequests, 1); assert.equal(usage.monthlyRequests, 1);
      assert.equal(usage.dailyResources, 10); assert.equal(usage.monthlyResources, 10);
      const monthDenied = await repository.reserveUsage(monthlyProvider, 1, afterMonth);
      assert.equal(monthDenied.allowed, false); assert.equal(monthDenied.reason, "budget");
      assert.equal(monthDenied.retryAt, "2026-12-01T00:00:00.000Z");

      await repository.setProviderBudget({ provider: dailyProvider, enabled: true, dailyRequests: 1, monthlyRequests: 10,
        dailyResources: 10, monthlyResources: 100, minimumIntervalMs: 0 }, beforeMonth);
      assert.equal((await repository.reserveUsage(dailyProvider, 10, beforeMonth)).allowed, true);
      const dayDenied = await repository.reserveUsage(dailyProvider, 1, beforeMonth);
      assert.equal(dayDenied.allowed, false); assert.equal(dayDenied.reason, "budget");
      assert.equal(dayDenied.retryAt, afterMonth);
      assert.equal((await repository.reserveUsage(dailyProvider, 10, afterMonth)).allowed, true);
      const firstDayDenied = await repository.reserveUsage(dailyProvider, 1, "2026-11-01T23:59:59.000Z");
      assert.equal(firstDayDenied.allowed, false); assert.equal(firstDayDenied.retryAt, "2026-11-02T00:00:00.000Z");
      const secondDay = "2026-11-02T00:00:00.000Z";
      assert.equal((await repository.reserveUsage(dailyProvider, 10, secondDay)).allowed, true);
      usage = (await repository.providerUsage(secondDay)).find(row => row.provider === dailyProvider)!;
      assert.equal(usage.day, "2026-11-02"); assert.equal(usage.month, "2026-11");
      assert.equal(usage.dailyRequests, 1); assert.equal(usage.monthlyRequests, 2);
      assert.equal(usage.dailyResources, 10); assert.equal(usage.monthlyResources, 20);
      assert.equal((await repository.providerUsage(secondDay)).find(row => row.provider === monthlyProvider)!.monthlyRequests, 1,
        "Rejected reservations must not add usage");
    } finally { await db.close(); }
  });
}

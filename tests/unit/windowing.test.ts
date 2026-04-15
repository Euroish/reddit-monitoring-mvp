import test from "node:test";
import assert from "node:assert/strict";
import { floorToWindow } from "../../src/shared/time/windowing";

test("floorToWindow aligns 15-minute windows", () => {
  assert.equal(
    floorToWindow("2026-04-10T13:14:59.000Z", 15),
    "2026-04-10T13:00:00.000Z",
  );
  assert.equal(
    floorToWindow("2026-04-10T13:15:00.000Z", 15),
    "2026-04-10T13:15:00.000Z",
  );
});

test("floorToWindow aligns 6-hour windows", () => {
  assert.equal(
    floorToWindow("2026-04-10T13:14:59.000Z", 360),
    "2026-04-10T12:00:00.000Z",
  );
  assert.equal(
    floorToWindow("2026-04-10T05:59:59.000Z", 360),
    "2026-04-10T00:00:00.000Z",
  );
});

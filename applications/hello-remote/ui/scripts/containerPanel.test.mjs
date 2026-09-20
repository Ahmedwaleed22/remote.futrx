import assert from "node:assert/strict";
import test from "node:test";

import { formatBytes, formatDuration } from "./containerPanel.js";

test("formats container memory in GiB", () => {
  assert.equal(formatBytes(8 * 1024 ** 3), "8.0 GiB");
  assert.equal(formatBytes(16 * 1024 ** 3), "16 GiB");
  assert.equal(formatBytes(-1), "Unknown");
});

test("formats container uptime in days, hours, and minutes", () => {
  assert.equal(formatDuration(2 * 86400 + 3 * 3600), "2d 3h");
  assert.equal(formatDuration(2 * 3600 + 15 * 60), "2h 15m");
  assert.equal(formatDuration(Number.NaN), "Unknown");
});

import assert from "node:assert/strict";
import test from "node:test";

import { portSummary } from "./servicePanel.js";

test("describes the host-to-container port mapping", () => {
  assert.equal(
    portSummary(4781, 4780),
    "127.0.0.1:4781 → container:4780/tcp"
  );
  assert.equal(portSummary(undefined, 4780), "Unknown");
});

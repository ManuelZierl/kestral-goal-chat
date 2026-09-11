import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
async function source(path) { return readFile(new URL(path, root), "utf8"); }

test("Goal Chat is an ordinary backend-free Kestral app", async () => {
  const manifest = JSON.parse(await source("dist/app.json"));
  assert.equal(manifest.backend.kind, "none");
  assert.equal(manifest.data.kind, "host-managed");
  assert.deepEqual(manifest.manifest.surfaces[0].intents, [{ provider: "llm-provider", capability: "llm.generate" }]);
  assert.equal(manifest.manifest.grant_requests[0].scope.capability, "llm.generate");
  assert.equal(manifest.manifest.grant_requests[0].condition, "requires-approval");
  assert.ok(manifest.data.collections.state.operations.includes("transaction"));
  assert.ok(manifest.data.collections.messages.operations.includes("transaction"));
});

test("surface makes working state explicit and model output structured", async () => {
  const html = await source("dist/ui/index.html");
  for (const id of ["user-goal", "goal-interpretation", "working-solution", "open-questions", "decisions", "constraints", "assumptions"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /response_format:\s*outputSchema/);
  assert.match(html, /user_goal:\s*before\.user_goal/);
  assert.match(html, /recent_transcript/);
  assert.match(html, /MAX_CONTEXT_MESSAGES\s*=\s*30/);
});

test("provider failure preserves the user's persisted message before invocation", async () => {
  const html = await source("dist/ui/index.html");
  const persist = html.indexOf('await createMessage("user", content)');
  const invoke = html.indexOf("await window.appHost.invoke(");
  assert.ok(persist >= 0 && invoke > persist, "user message must be durable before model invocation");
  assert.match(html, /send the same message again to retry without duplicating it/i);
});

test("state and assistant reply commit in one host-managed transaction", async () => {
  const html = await source("dist/ui/index.html");
  assert.match(html, /data\.v1\.transaction\(\[\s*stateOperation,/);
  assert.doesNotMatch(html, /await persistState\(nextState\)/);
  assert.doesNotMatch(html, /await createMessage\("assistant"/);
});

test("user-owned goal cannot be overwritten by model state", async () => {
  const html = await source("dist/ui/index.html");
  assert.doesNotMatch(html, /user_goal:\s*result\./);
  assert.match(html, /user_goal:\s*before\.user_goal/);
  assert.match(html, /model never overwrites this field automatically/i);
});

test("package integrity describes exact generated UI bytes", async () => {
  const manifest = JSON.parse(await source("dist/app.json"));
  const bytes = await readFile(new URL("dist/ui/index.html", root));
  const expected = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(manifest.integrity.assets["ui/index.html"], expected);
});

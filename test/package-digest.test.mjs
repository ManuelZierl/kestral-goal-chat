import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageDigest } from "../scripts/package-digest.mjs";

async function fixture(t, assetPath = "ui/index.html") {
  const root = await mkdtemp(join(tmpdir(), "goal-chat-digest-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ui"));
  await writeFile(join(root, "app.json"), JSON.stringify({ integrity: { algorithm: "sha256", assets: { [assetPath]: "sha256-unused" } } }));
  return root;
}

test("matches an expected digest for the checked-in package when requested", async () => {
  if (!process.env.EXPECTED_PACKAGE_DIGEST) return;
  assert.equal(await packageDigest(fileURLToPath(new URL("../dist/", import.meta.url))), process.env.EXPECTED_PACKAGE_DIGEST);
});

test("matches the Kestral canonical package digest stream", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "ui", "index.html"), "hello\n");
  assert.equal(await packageDigest(root), "sha256-5ae5327290f9bf9d505adf750175c96dde6a2382f25682b369f3b128e1f09daa");
});

test("allows a detached signature but rejects undeclared payload", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "ui", "index.html"), "hello\n");
  await writeFile(join(root, "app.signature.json"), "{}");
  await writeFile(join(root, "ui", "extra.txt"), "undeclared");
  await assert.rejects(() => packageDigest(root), /declaration mismatch/);
});

test("rejects symlinked package entries", async (t) => {
  const root = await fixture(t);
  await symlink(fileURLToPath(import.meta.url), join(root, "ui", "index.html"));
  await assert.rejects(() => packageDigest(root), /symlink|regular file/);
});

for (const path of ["ui//index.html", "./ui/index.html", "ui/./index.html", "ui/../ui/index.html"]) {
  test(`rejects non-canonical asset path ${path}`, async (t) => {
    const root = await fixture(t, path);
    await writeFile(join(root, "ui", "index.html"), "hello\n");
    await assert.rejects(() => packageDigest(root), /unsafe package path/);
  });
}

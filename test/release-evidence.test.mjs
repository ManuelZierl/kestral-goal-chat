import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { packageDigest } from "../scripts/package-digest.mjs";
import {
  APP_ID,
  LIFECYCLE_CHECKS,
  REPOSITORY,
  createEvidence,
  validateObservations,
  workflowUrl,
} from "../scripts/release-evidence.mjs";

const HEAD = "0123456789abcdef0123456789abcdef01234567";

function observations() {
  return {
    tested_at: "2026-08-06T12:00:00Z",
    platforms: ["windows-x86_64", "linux-x86_64"],
    lifecycle: Object.fromEntries(LIFECYCLE_CHECKS.map((check) => [check, {
      status: "passed",
      observation: `Manual host observation for ${check}.`,
    }])),
  };
}

async function packageFixture() {
  const root = await mkdtemp(join(tmpdir(), "goal-chat-evidence-"));
  await mkdir(join(root, "dist", "ui"), { recursive: true });
  const [manifest, html, packageMetadata] = await Promise.all([
    readFile(new URL("../dist/app.json", import.meta.url), "utf8"),
    readFile(new URL("../dist/ui/index.html", import.meta.url)),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  await Promise.all([
    writeFile(join(root, "dist", "app.json"), manifest),
    writeFile(join(root, "dist", "ui", "index.html"), html),
    writeFile(join(root, "package.json"), packageMetadata),
  ]);
  return root;
}

function context(root, digest) {
  return {
    root,
    observations: observations(),
    expectedPackageDigest: digest,
    hostVersion: "0.1.0-alpha.1",
    hostCommit: HEAD,
    env: {
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "ManuelZierl/kestral-goal-chat",
      GITHUB_RUN_ID: "12345",
      GITHUB_SHA: HEAD,
    },
    git: (args) => args[0] === "rev-parse" ? HEAD : "",
  };
}

test("derives the workflow URL from the GitHub run environment", () => {
  assert.equal(workflowUrl({
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_REPOSITORY: "ManuelZierl/kestral-goal-chat",
    GITHUB_RUN_ID: "12345",
  }), `${REPOSITORY}/actions/runs/12345`);
  assert.throws(() => workflowUrl({ GITHUB_REPOSITORY: "owner/repo", GITHUB_RUN_ID: "1" }), /GITHUB_SERVER_URL/);
});

test("rejects incomplete, unknown, failed, or blank lifecycle observations", () => {
  const value = observations();
  assert.throws(() => validateObservations({ ...value, unexpected: true }), /fields differ/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, extra: { status: "passed", observation: "x" } } }), /fields differ/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, activation: { status: "failed", observation: "x" } } }), /must be 'passed'/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, restart: undefined } }), /must be an object/);
  assert.throws(() => validateObservations({ ...value, lifecycle: { ...value.lifecycle, restart: { status: "passed", observation: "  " } } }), /non-empty string/);
  assert.throws(() => validateObservations({ ...value, platforms: [" "] }), /non-empty strings/);
});

test("rejects impossible lifecycle dates instead of normalizing them", () => {
  for (const tested_at of ["2026-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-08-06T24:00:00Z", "2026-08-06T12:60:00Z"]) {
    assert.throws(() => validateObservations({ ...observations(), tested_at }), /ISO date-time/);
  }
  assert.equal(validateObservations({ ...observations(), tested_at: "2024-02-29T23:59:59.123Z" }).tested_at, "2024-02-29T23:59:59.123Z");
});

test("creates evidence only for the clean exact Goal Chat package", async () => {
  const root = await packageFixture();
  const digest = await packageDigest(join(root, "dist"));
  const evidence = await createEvidence(context(root, digest));
  assert.deepEqual(evidence.app, { id: APP_ID, version: "0.1.1" });
  assert.equal(evidence.source.repository, REPOSITORY);
  assert.equal(evidence.source.clean, true);
  assert.equal(evidence.package.digest, digest);
  assert.deepEqual(evidence.extension_contributions, []);

  await assert.rejects(() => createEvidence({ ...context(root, digest), expectedAppId: "com.example.other" }), /expected app ID/);
  await assert.rejects(() => createEvidence({ ...context(root, digest), expectedRepository: "https://github.com/ManuelZierl/other" }), /expected repository/);
  await assert.rejects(() => createEvidence({ ...context(root, digest), expectedPackageDigest: "sha256-0000000000000000000000000000000000000000000000000000000000000000" }), /package digest mismatch/);
  await assert.rejects(() => createEvidence({ ...context(root, digest), hostVersion: "not-semver" }), /host version must be strict semver/);
  await assert.rejects(() => createEvidence({ ...context(root, digest), git: (args) => args[0] === "rev-parse" ? HEAD : " M package.json" }), /source checkout is not clean/);
});

test("rejects authority drift and payload tampering", async () => {
  const root = await packageFixture();
  const manifestPath = join(root, "dist", "app.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.manifest.grant_requests[0].scope.capability = "other.capability";
  await writeFile(manifestPath, JSON.stringify(manifest));
  let digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence(context(root, digest)), /Goal Chat grant/);

  manifest.manifest.grant_requests[0].scope.capability = "llm.generate";
  manifest.manifest.grant_requests[0].condition = "silent";
  await writeFile(manifestPath, JSON.stringify(manifest));
  digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence(context(root, digest)), /approval-required/);

  manifest.manifest.grant_requests[0].condition = "requires-approval";
  manifest.data.limits.transaction_operations = 1;
  await writeFile(manifestPath, JSON.stringify(manifest));
  digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence(context(root, digest)), /at least two transaction operations/);

  manifest.data.limits.transaction_operations = 32;
  manifest.data.proposals = [];
  await writeFile(manifestPath, JSON.stringify(manifest));
  digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence(context(root, digest)), /data contract fields differ/);

  const cleanManifest = JSON.parse(await readFile(new URL("../dist/app.json", import.meta.url), "utf8"));
  await writeFile(manifestPath, JSON.stringify(cleanManifest));
  await writeFile(join(root, "dist", "ui", "index.html"), "tampered\n");
  digest = await packageDigest(join(root, "dist"));
  await assert.rejects(() => createEvidence(context(root, digest)), /integrity checksum mismatch/);
});

test("release workflow pins source and contract commits and refuses overwrite", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release-evidence.yml", import.meta.url), "utf8");
  assert.match(workflow, /source_commit:/);
  assert.match(workflow, /ref: \$\{\{ inputs\.source_commit \}\}/);
  assert.match(workflow, /test "\$head" = "\$GITHUB_SHA"/);
  assert.match(workflow, /82a983a268911e7a1958b4c6eab06dde334070b1/);
  assert.match(workflow, /tauri_tested:/);
  assert.match(workflow, /git diff --exit-code -- dist/);
  assert.match(workflow, /git status --porcelain --untracked-files=all/);
  assert.match(workflow, /gh release view "\$RELEASE_TAG"/);
  assert.match(workflow, /git ls-remote --exit-code --refs origin/);
  assert.doesNotMatch(workflow, /--clobber/);
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageDigest } from "./package-digest.mjs";

export const APP_ID = "dev.kestral.goal-chat";
export const REPOSITORY = "https://github.com/ManuelZierl/kestral-goal-chat";
export const LIFECYCLE_CHECKS = [
  "package_inspection",
  "permission_denial",
  "activation",
  "representative_action",
  "restart",
  "update_data_preservation",
  "disable_enable",
  "keep_data_uninstall",
  "purge_data_uninstall",
];

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256-[0-9a-f]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const PACKAGE_PATH = /^(?:ui|backend)\/[^\\:*?"<>|]+$/;

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

export function exactKeys(value, expected, label) {
  const actual = Object.keys(object(value, label)).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} fields differ: expected ${wanted.join(", ")}; found ${actual.join(", ")}`);
  }
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
}

function commit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) throw new Error(`${label} must be a lowercase full Git commit`);
}

function semver(value, label) {
  if (typeof value !== "string" || !SEMVER.test(value)) throw new Error(`${label} must be strict semver`);
}

function validateDate(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`${label} must be an ISO date-time`);
  const date = value.slice(0, 10);
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new Error(`${label} must be an ISO date-time`);
  }
}

function validateLifecycle(lifecycle) {
  exactKeys(lifecycle, LIFECYCLE_CHECKS, "observations.lifecycle");
  for (const check of LIFECYCLE_CHECKS) {
    const result = lifecycle[check];
    exactKeys(result, ["status", "observation"], `observations.lifecycle.${check}`);
    if (result.status !== "passed") throw new Error(`observations.lifecycle.${check}.status must be 'passed'`);
    nonEmpty(result.observation, `observations.lifecycle.${check}.observation`);
  }
}

export function validateObservations(value) {
  exactKeys(value, ["tested_at", "platforms", "lifecycle"], "observations");
  validateDate(value.tested_at, "observations.tested_at");
  if (!Array.isArray(value.platforms) || value.platforms.length === 0) throw new Error("observations.platforms must contain at least one platform");
  if (value.platforms.some((platform) => typeof platform !== "string" || platform.trim().length === 0)) throw new Error("observations.platforms must contain non-empty strings");
  if (new Set(value.platforms).size !== value.platforms.length) throw new Error("observations.platforms must not contain duplicates");
  validateLifecycle(value.lifecycle);
  return value;
}

export function workflowUrl(env) {
  if (env.GITHUB_SERVER_URL !== "https://github.com") throw new Error("GITHUB_SERVER_URL must be https://github.com");
  if (typeof env.GITHUB_REPOSITORY !== "string" || !/^[^/]+\/[^/]+$/.test(env.GITHUB_REPOSITORY)) throw new Error("GITHUB_REPOSITORY must be owner/repository");
  if (typeof env.GITHUB_RUN_ID !== "string" || !/^\d+$/.test(env.GITHUB_RUN_ID)) throw new Error("GITHUB_RUN_ID must be a numeric workflow run ID");
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function validateGoalChatContract(manifest, packageMetadata) {
  if (manifest.id !== APP_ID) throw new Error(`dist/app.json app identity must be ${APP_ID}`);
  semver(manifest.version, "dist/app.json version");
  semver(packageMetadata.version, "package.json version");
  if (manifest.version !== packageMetadata.version) throw new Error("dist/app.json version does not match package.json");
  if (manifest.backend?.kind !== "none") throw new Error("Goal Chat backend.kind must be none");
  if (manifest.data?.kind !== "host-managed" || manifest.data.contract_version !== 1) throw new Error("Goal Chat data contract must be host-managed v1");
  exactKeys(manifest.data, ["kind", "contract_version", "collections", "limits", "exports"], "Goal Chat data contract");
  if (JSON.stringify(Object.keys(manifest.data.collections || {}).sort()) !== JSON.stringify(["messages", "state"])) {
    throw new Error("Goal Chat must declare exactly the messages and state collections");
  }
  const requiredOperations = ["create", "delete", "get", "list", "replace", "transaction"];
  for (const collection of ["state", "messages"]) {
    const operations = manifest.data.collections[collection]?.operations;
    if (!Array.isArray(operations) || JSON.stringify([...operations].sort()) !== JSON.stringify(requiredOperations)) {
      throw new Error(`Goal Chat ${collection} collection operations do not match its runtime contract`);
    }
  }
  exactKeys(manifest.data.limits, ["total_bytes", "transaction_operations"], "Goal Chat data limits");
  if (!Number.isSafeInteger(manifest.data.limits.transaction_operations) || manifest.data.limits.transaction_operations < 2) {
    throw new Error("Goal Chat requires at least two transaction operations");
  }
  exactKeys(manifest.manifest, ["surfaces", "grant_requests"], "dist/app.json manifest");
  const surfaces = manifest.manifest.surfaces;
  if (!Array.isArray(surfaces) || surfaces.length !== 1) throw new Error("Goal Chat must declare exactly one workspace surface");
  const surface = surfaces[0];
  exactKeys(surface, ["name", "kind", "title", "description", "intents", "ui"], "Goal Chat workspace surface");
  if (surface.name !== "workspace" || surface.kind !== "dashboard" || JSON.stringify(surface.intents) !== JSON.stringify([{ provider: "llm-provider", capability: "llm.generate" }])) {
    throw new Error("Goal Chat workspace must be a dashboard with exactly the llm-provider/llm.generate intent");
  }
  exactKeys(surface.ui, ["entry", "connect_src"], "Goal Chat workspace UI");
  if (surface.ui.entry !== "ui/index.html" || !Array.isArray(surface.ui.connect_src) || surface.ui.connect_src.length !== 0) {
    throw new Error("Goal Chat workspace UI must use ui/index.html without network destinations");
  }
  const grants = manifest.manifest?.grant_requests;
  if (!Array.isArray(grants) || grants.length !== 1) throw new Error("Goal Chat must declare exactly one grant request");
  const grant = grants[0];
  exactKeys(grant, ["scope", "data_scope", "condition", "reason", "duration"], "Goal Chat grant");
  if (JSON.stringify(grant.scope) !== JSON.stringify({ kind: "exact-capability", provider: "llm-provider", capability: "llm.generate" }) ||
    JSON.stringify(grant.data_scope) !== JSON.stringify({ kind: "none" }) || grant.condition !== "requires-approval" ||
    JSON.stringify(grant.duration) !== JSON.stringify({ kind: "non-expiring" })) {
    throw new Error("Goal Chat grant must be approval-required llm-provider/llm.generate with no delegated data scope and non-expiring duration");
  }
  nonEmpty(grant.reason, "Goal Chat grant reason");
  if (!Array.isArray(manifest.data.exports) || manifest.data.exports.length !== 0) throw new Error("Goal Chat must not export host-managed data");
  if (manifest.integrity?.algorithm !== "sha256" || !manifest.integrity.assets || Array.isArray(manifest.integrity.assets)) {
    throw new Error("dist/app.json integrity must declare sha256 assets");
  }
}

async function validateAssetDigests(packageRoot, manifest) {
  for (const [path, expected] of Object.entries(manifest.integrity.assets)) {
    if (!PACKAGE_PATH.test(path) || path.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`unsafe package asset '${path}'`);
    if (typeof expected !== "string" || !SHA256.test(expected)) throw new Error(`package asset '${path}' must declare a sha256 digest`);
    const actual = `sha256-${createHash("sha256").update(await readFile(join(packageRoot, ...path.split("/")))).digest("hex")}`;
    if (actual !== expected) throw new Error(`integrity checksum mismatch for '${path}'`);
  }
}

function gitCommands(root) {
  return (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

export async function createEvidence({
  root,
  observations,
  expectedPackageDigest,
  hostVersion,
  hostCommit,
  expectedAppId = APP_ID,
  expectedRepository = REPOSITORY,
  env = process.env,
  git = gitCommands(root),
}) {
  validateObservations(observations);
  if (expectedAppId !== APP_ID) throw new Error(`expected app ID must be ${APP_ID}`);
  if (expectedRepository !== REPOSITORY) throw new Error(`expected repository must be ${REPOSITORY}`);
  semver(hostVersion, "host version");
  commit(hostCommit, "host commit");
  if (typeof expectedPackageDigest !== "string" || !SHA256.test(expectedPackageDigest)) throw new Error("expected package digest must be a sha256 digest");

  const head = git(["rev-parse", "HEAD"]);
  commit(head, "source HEAD");
  if (env.GITHUB_SHA !== head) throw new Error(`GITHUB_SHA ${env.GITHUB_SHA || "<missing>"} does not match source HEAD ${head}`);
  if (git(["status", "--porcelain", "--untracked-files=all"]) !== "") throw new Error("source checkout is not clean");
  if (`https://github.com/${env.GITHUB_REPOSITORY || ""}` !== expectedRepository) throw new Error("source repository does not match expected repository");

  const packageRoot = join(root, "dist");
  const [manifest, packageMetadata] = await Promise.all([
    readFile(join(packageRoot, "app.json"), "utf8").then(JSON.parse),
    readFile(join(root, "package.json"), "utf8").then(JSON.parse),
  ]);
  validateGoalChatContract(manifest, packageMetadata);
  await validateAssetDigests(packageRoot, manifest);
  const actualDigest = await packageDigest(packageRoot);
  if (actualDigest !== expectedPackageDigest) throw new Error(`package digest mismatch: expected ${expectedPackageDigest}, got ${actualDigest}`);

  return {
    format_version: 1,
    app: { id: manifest.id, version: manifest.version },
    source: { repository: expectedRepository, commit: head, clean: true },
    package: { digest: actualDigest },
    host: { version: hostVersion, commit: hostCommit },
    run: { workflow_url: workflowUrl(env), tested_at: observations.tested_at, platforms: observations.platforms },
    extension_contributions: [],
    lifecycle: observations.lifecycle,
  };
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function readObservations(args) {
  const file = optionValue(args, "--observations-file") || optionValue(args, "--observations");
  const envName = optionValue(args, "--observations-env");
  const inline = optionValue(args, "--observations-json") || (envName && process.env[envName]);
  if (!file && !inline) throw new Error("required manual observations are missing");
  if (file && inline) throw new Error("provide one observations file or observations JSON value");
  const raw = file ? await readFile(resolve(file), "utf8") : inline;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`manual observations are not valid JSON: ${error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const observations = await readObservations(args);
  const root = resolve(optionValue(args, "--source") || dirname(dirname(fileURLToPath(import.meta.url))));
  const expectedPackageDigest = optionValue(args, "--expected-package-digest") || process.env.EXPECTED_PACKAGE_DIGEST;
  const hostVersion = optionValue(args, "--host-version") || process.env.HOST_VERSION;
  const hostCommit = optionValue(args, "--host-commit") || process.env.HOST_COMMIT;
  const output = optionValue(args, "--output") || process.env.RELEASE_EVIDENCE_OUTPUT;
  if (!expectedPackageDigest || !hostVersion || !hostCommit || !output) throw new Error("package digest, host version, host commit, and output are required");
  const evidence = await createEvidence({ root, observations, expectedPackageDigest, hostVersion, hostCommit });
  await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  console.log(`wrote ${resolve(output)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const stagedDist = join(root, "dist.next");
const previousDist = join(root, "dist.previous");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (await exists(previousDist) && !(await exists(dist))) await rename(previousDist, dist);

const [html, sourceManifestText, packageText] = await Promise.all([
  readFile(join(root, "src", "index.html"), "utf8"),
  readFile(join(root, "src", "app.json"), "utf8"),
  readFile(join(root, "package.json"), "utf8"),
]);
const sourceManifest = JSON.parse(sourceManifestText);
const packageMetadata = JSON.parse(packageText);
if (sourceManifest.version !== packageMetadata.version) {
  throw new Error(`src/app.json version ${sourceManifest.version} does not match package.json version ${packageMetadata.version}`);
}
if (sourceManifest.integrity !== undefined) throw new Error("src/app.json must not contain generated integrity metadata");

const manifest = {
  ...sourceManifest,
  integrity: {
    algorithm: "sha256",
    assets: {
      "ui/index.html": `sha256-${createHash("sha256").update(html).digest("hex")}`,
    },
  },
};

await rm(stagedDist, { recursive: true, force: true });
await mkdir(join(stagedDist, "ui"), { recursive: true });
await Promise.all([
  writeFile(join(stagedDist, "ui", "index.html"), html),
  writeFile(join(stagedDist, "app.json"), `${JSON.stringify(manifest, null, 2)}\n`),
]);

const hadPreviousDist = await exists(dist);
if (hadPreviousDist) {
  await rm(previousDist, { recursive: true, force: true });
  await rename(dist, previousDist);
}
try {
  await rename(stagedDist, dist);
} catch (error) {
  if (hadPreviousDist) {
    try {
      await rename(previousDist, dist);
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], "replace dist failed and the previous package could not be restored");
    }
  }
  throw error;
}
await rm(previousDist, { recursive: true, force: true });

console.log("Built Goal Chat package -> dist/");

# Goal Chat

Goal Chat is an independently installed, backend-free [Kestral](https://github.com/ManuelZierl/kestral) app for conversations organized around an evolving goal rather than only a chronological transcript.

Each model turn receives the user-owned goal, the model's current goal interpretation, the consolidated working solution, open questions, decisions, constraints, assumptions, and the 30 most recent messages. It returns a visible reply plus a JSON-schema-structured replacement for the model-owned working state.

The distinction between **your stated goal** and **model interpretation** is deliberate: the first user turn seeds the user-owned field, after which only the user can edit it. The model may revise its interpretation but cannot silently rewrite the user's stated intent.

## Architecture and authority

- `backend.kind = none`: no app process, server, or worker.
- The sandboxed surface invokes only `llm-provider/llm.generate`; it does not contact a model endpoint directly or handle credentials.
- The exact capability grant uses `data_scope: none` and requires Kestral approval.
- Conversation messages and working state use private Kestral host-managed app data.
- The package declares no network destinations, secrets, extension contributions, or exported data capabilities.
- App identity remains `dev.kestral.goal-chat`; moving the repository does not change the app's data identity.

Model requests include this app's working state and recent transcript. Depending on the provider configured in Kestral, those contents may be sent to a remote model service. Kestral's host-managed store remains local unless the user invokes the model action.

## Install

Goal Chat 0.1.1 requires Kestral `0.1.0-alpha.1` or newer. Configure an LLM provider in Kestral before using the app.

In Kestral, open **Apps → Install an app → Public Git URL** and enter:

```text
https://github.com/ManuelZierl/kestral-goal-chat
```

Choose **Review app**, inspect the requested `llm.generate` permission, and complete installation. Kestral discovers the checked-in `dist/app.json`; repository source, tests, and development metadata are not part of the installable package.

For a local package, clone this repository, run `npm ci && npm run build`, and select `dist/` in Kestral. Node.js is required only to build and verify the package, not to run the installed app.

## Data and lifecycle

Goal Chat keeps one active conversation rather than named threads or a goal tree. Messages and working state persist across app disable/enable and Kestral restarts. A completed model turn atomically stores its state replacement and assistant reply. If the model or final transaction fails, the user's message remains and the prior model-owned state remains unchanged; sending the same message again retries without adding another copy.

**New conversation** is destructive and asks for confirmation. Kestral transactions are limited to 32 operations, so large histories clear in atomic batches. If a later batch fails, Goal Chat reloads the remaining records, reports that clearing stopped, and lets the user repeat the action to finish. It never presents a partially cleared in-memory view as a successful new conversation.

Package updates preserve compatible host-managed records. Disable and ordinary uninstall retain the store. During uninstall, choose **Keep data** to retain it for reinstall or **Purge app data** to remove messages and working state. Goal Chat has no app config or secrets to retain or purge.

Only the most recent 30 messages are supplied to the model; older messages remain stored and visible. State updates replace model-owned fields rather than applying incremental patches.

## Development and verification

Use Node.js 22.19.x:

```sh
npm ci
npm run check
npm test
npm run test:package-schema -- /path/to/kestral/schemas/app.schema.json
npm run package:digest
npm run test:reproducible
npm audit --audit-level=high
git diff --exit-code -- dist
```

`npm run build` deterministically creates the complete installable package in `dist/`, derives its version from the matching source/package metadata, and recomputes the UI integrity digest. `scripts/package-digest.mjs` implements Kestral's canonical package framing and rejects undeclared files, unsafe paths, and symlinks.

CI runs package, behavior, schema, digest, reproducibility, audit, and clean-source checks on Linux and Windows. Runtime tests use a fake host-managed-data boundary; they do not claim to replace real Kestral/Tauri lifecycle testing. See [RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md) for the required manual release process.

## Maintenance and support

Manuel Zierl maintains this repository. Report ordinary defects through [GitHub Issues](https://github.com/ManuelZierl/kestral-goal-chat/issues) and security-sensitive defects through [private vulnerability reporting](https://github.com/ManuelZierl/kestral-goal-chat/security/advisories/new).

## Origin and license

Extracted from [Kestral PR #3](https://github.com/ManuelZierl/kestral/pull/3), directory `reference-apps/goal-chat`, at source commit `ce1c6dc1f77f89c14d742f24482aed633931f640`.

MIT licensed; see [LICENSE](LICENSE). Original copyright attribution is retained.

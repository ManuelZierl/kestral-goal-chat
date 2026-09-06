# Goal Chat

Goal Chat is an independently installed, backend-free [Kestral](https://github.com/ManuelZierl/kestral) app for conversations organized around an evolving goal rather than only a chronological transcript.

Each model turn receives the user-owned goal, the model's current goal interpretation, the consolidated working solution, open questions, decisions, constraints, assumptions, and the 30 most recent messages. It returns a visible reply plus a JSON-schema-structured replacement for the model-owned working state.

The distinction between **your stated goal** and **model interpretation** is deliberate: the first user turn seeds the user-owned field, after which only the user can edit it. The model may revise its interpretation but cannot silently rewrite the user's stated intent.

## Architecture

- `backend.kind = none`: no app process, server, or worker.
- The sandboxed surface invokes the ordinary `llm-provider/llm.generate` capability; it does not contact a model endpoint directly or handle credentials.
- Conversation messages and working state use Kestral host-managed app data.
- Model calls request JSON-schema structured output.
- App identity remains `dev.kestral.goal-chat`; moving the repository does not change the app's data identity.

This repository owns the app source, package, tests, and CI. It does not require a checkout of Kestral's source or any changes to the host or kernel.

## Install

The manifest declares Kestral `0.1.0-alpha.1` as its minimum host version. Configure an LLM provider in Kestral before using the app.

In Kestral, open **Apps → Install an app → Public Git URL** and enter:

```text
https://github.com/ManuelZierl/kestral-goal-chat
```

Choose **Review app**, review the requested `llm.generate` permission, and complete installation. Model requests include this app's working state and recent transcript, and may send those contents to a remote provider depending on your Kestral configuration.

Alternatively, clone this repository and install its root directory as a local Kestral app package. The root already contains `app.json` and the checksummed `ui/index.html` payload. There is no compilation or dependency-installation step and no additional runtime required by this app. Node.js is needed only to run development checks, not to use the installed app.

## Development and verification

Use Node.js 22 to run the dependency-free checks:

```sh
npm test
```

The independent GitHub Actions workflow runs these checks on Linux and Windows. The existing five tests check manifest declarations, source structure, and the exact UI SHA-256. They are **not end-to-end tests** of storage failures, model behavior, or installation inside Kestral.

After editing `ui/index.html`, update its SHA-256 entry in `app.json` and run the tests. `.gitattributes` keeps package line endings LF on both platforms so checkout conversion does not invalidate the checksum.

## Current scope

The app currently keeps one active goal-oriented conversation, not a collection of named threads or a goal tree. State updates replace model-owned fields rather than applying incremental patches. Only the recent 30 messages are supplied to the model; older messages remain stored but are not retrieved automatically. A live Kestral lifecycle test is still required before treating this as release-verified.

## Origin and license

Extracted from [Kestral PR #3](https://github.com/ManuelZierl/kestral/pull/3), directory `reference-apps/goal-chat`, at source commit `ce1c6dc1f77f89c14d742f24482aed633931f640`. The UI implementation, app ID, data contract, and test suite were preserved. The source package's stale UI integrity checksum was corrected during extraction.

MIT licensed; see [LICENSE](LICENSE). Original copyright attribution is retained.

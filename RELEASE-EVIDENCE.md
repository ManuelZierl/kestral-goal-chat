# Lifecycle Evidence

This repository publishes the format-1 evidence document required for a promoted external Kestral app. The document is an attestation produced after a real manual host run. The workflow validates the attestation and package identity; it does not run Kestral or Tauri tests. Dispatch requires the exact app `source_commit` and an explicit `tauri_tested: true` manual attestation.

## Two-Commit Boundary

Use the clean Goal Chat source commit that produced `dist/` as the evidence source commit. The Kestral release record is filled in by a later metadata-only core commit, so the tested core commit is not changed to record its own hash or evidence URL. Do not combine those two core commits.

## Manual Observations

Before dispatching **Release evidence**, run all checks against the exact package, lowercase 40-hex app `source_commit`, and exact Kestral host commit named in the dispatch inputs. Set `tauri_tested` to `true` only after the real Tauri run. Supply this exact JSON shape. Every check must have `status: "passed"` and a concrete retained observation.

```json
{
  "tested_at": "2026-08-06T12:00:00Z",
  "platforms": ["windows-x86_64", "linux-x86_64"],
  "lifecycle": {
    "package_inspection": { "status": "passed", "observation": "..." },
    "permission_denial": { "status": "passed", "observation": "..." },
    "activation": { "status": "passed", "observation": "..." },
    "representative_action": { "status": "passed", "observation": "..." },
    "restart": { "status": "passed", "observation": "..." },
    "update_data_preservation": { "status": "passed", "observation": "..." },
    "disable_enable": { "status": "passed", "observation": "..." },
    "keep_data_uninstall": { "status": "passed", "observation": "..." },
    "purge_data_uninstall": { "status": "passed", "observation": "..." }
  }
}
```

The checks must cover these Goal Chat cases:

1. Inspect `dist/` without executing package code. Confirm app ID `dev.kestral.goal-chat`, backend-free execution, host-managed `state` and `messages`, no network/secrets/extensions, and only the declared model intent and grant.
2. Deny the `llm-provider/llm.generate` permission. Confirm installation/activation does not leave a denied grant or permit a model action.
3. Approve and activate the app. Open **Goal Chat** and confirm the expected empty first-run state.
4. Send a representative message. Confirm the user message, assistant reply, explicit working state, and attributable model Run. Exercise a failed model call and confirm the user message remains while model-owned state does not change.
5. Restart Kestral. Confirm the transcript and working state are restored from host-managed data.
6. Update from the predecessor package to the exact package under test. Confirm existing messages and working state remain valid without widened authority or migration.
7. Disable the app and confirm its surface and model authority are unavailable. Re-enable it and confirm retained data returns.
8. Uninstall with **Keep data**, reinstall the exact package, and confirm the transcript and working state return.
9. Uninstall with **Purge app data** and confirm the `state` and `messages` records are absent. Confirm no Goal Chat config or secrets exist.

The observations input rejects unknown fields, missing checks, duplicate/blank platforms, malformed or impossible timestamps, failed statuses, and blank observations. `workflow_url` is derived from GitHub Actions and is not accepted as manual input.

## Dispatch Gates

The workflow checks out Kestral's public package schema at pinned commit `82a983a268911e7a1958b4c6eab06dde334070b1`. It verifies the clean checked-out app HEAD, exact Goal Chat identity and authority contract, source/package version agreement, declared asset hashes, canonical package digest, generated evidence shape, and reproducible checked-in `dist/`.

Dispatch with a new `release_tag` matching the workflow's conservative syntax. The tag must not already exist as a GitHub release or remote Git tag. Publication creates a new GitHub release containing only the evidence JSON and never overwrites an existing release. Start the dispatch from a ref whose `GITHUB_SHA` exactly matches `source_commit`.

Kestral pins both the evidence URL and its SHA-256 bytes because a GitHub release URL alone is not immutable evidence. This attestation does not bundle the app or grant it special authority.

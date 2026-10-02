# Joy Home — local release candidate

A warm, ambient dashboard for seeing the day, chatting with a connected assistant, and reviewing proposed actions. This history-free export preserves the current Joy Home orb and interface. It is a **portable subset**, not the owner's complete private installation or a hosted AI service.

## Run locally

Requires Python 3.9+; no pip packages, Node build, accounts or keys required.

```sh
python3 server.py
```

Open http://127.0.0.1:8765/joy-home/#home. To use another port, prefix the command with `JOY_HOME_PORT=8878`.

Fresh startup shows empty or unavailable panels. Optional, clearly fictional sample data:

```sh
python3 scripts/load_samples.py
```

Samples go into ignored `data/`; never copy personal runtime data into a release. `JOY_HOME_DATA` can select an isolated data directory. The server binds only to loopback and rejects cross-origin browser writes. This local prototype is not designed for Internet exposure or untrusted multiuser access.

## What actually works

- Current orb interface, Home, Chat, Tasks, Calendar, Approvals and Activity.
- Atomic persisted panel updates through `POST /api/panels/<name>` with JSON data.
- Chat submission persists a real pending message; it stays pending without a connected bridge.
- `GET /api/joy/pending` returns pending messages. An explicitly connected local bridge can submit `POST /api/joy/reply` with `{ "id": "message-id", "text": "actual reply" }`. The UI displays the reply. This export does not supply an AI worker or impersonate one.
- Sample approval records a local review decision; it never sends email or creates a calendar event. Executable approvals fail closed.

Voice inference, live OpenClaw session controls, email/calendar account integrations, diary, native apps, personal memory, background workers and education features are excluded. Voice controls are disabled or report unavailable. No end-to-end voice success is claimed: the prior single approved transcription attempt failed before agent or speech generation.

No credentials are read at startup, no provider calls are made, and no automatic simulated assistant replies exist. Sample rows are labeled `[Sample]` with source `fictional-sample`.

## Five-minute walkthrough

1. **0:00–0:45:** Explain the problem: scattered tasks, calendar and assistant decisions require switching interfaces. Show the warm orb and message composer; point out the sample banner.
2. **0:45–1:45:** Show `[Sample]` calendar check-in and task outline. Explain that real panels accept connected-agent updates; these displayed items are fictional.
3. **1:45–2:45:** Type a neutral project-preparation message in Chat. Show its queued state. Say explicitly that this release has no AI bridge connected.
4. **2:45–3:45:** Open Approvals, approve the sample outline, and show the recorded review receipt. Explain that no external action occurs.
5. **3:45–5:00:** Describe the full private prototype's optional agent/voice integrations and the remaining live-voice validation. Show local API contract and next milestone.

Network failure fallback: the same local interface, samples, queue and review flow work without network access. Never present a prepared answer as live model output. For the actual November 6 demo, validate an explicitly approved neutral voice cycle and a real connected bridge in advance or keep this local walkthrough.

## Verification and release status

```sh
python3 scripts/check_release.py
```

This checks real persisted panels, queue/reply correlation, review decisions, rejected executable approvals, traversal rejection and audio multipart byte preservation, without any paid calls. Optional JavaScript syntax checking uses `node --check joy-home/*.js` one file at a time.

See `PROVENANCE.json` for selected source files and transformations. No source git history, personal data, credentials, media assets, diary records, account defaults or internal agent prompts are included. Publication was approved by the owner; license selection still requires the owner's decision. **No new license has been granted by this export.**

The original GitHub repositories remain private. This sanitized demonstration is published at https://github.com/HelloLilMXxx/joy-home-demo and can be viewed or downloaded without signing in. It runs locally; hosting and complete live voice readiness remain pending.

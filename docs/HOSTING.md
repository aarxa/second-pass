# Hosting: Netlify in front, Cloud Run behind, Neon underneath

Three pieces, each on the free tier of something that is good at it:

| Piece | Where | Why there |
|---|---|---|
| The web app (pages, runs, replays, frames) | **Netlify** | Static files from a CDN: pages open instantly and never wake anything up. |
| The server (`/api/*` and live editing over WebSockets) | **Google Cloud Run** | Scales to zero when idle like Render's free tier, but wakes in a second or two instead of ~50. |
| The database | **Neon** | Already there (docs/MOVE_DB.md). |

```
browser ──► Netlify CDN ── /, /agent, /agent/<run>, /gallery, /s/<id>, frames   (static, instant)
   │            └── /api/*  ──forwarded──► Cloud Run (server) ──► Neon (Postgres)
   └── wss://…run.app/collab/<id> ────────► Cloud Run           (live editing, direct)
```

Netlify can forward ordinary requests but not WebSockets, so the editor connects to the server
directly. Its address is baked into the site at build time as `VITE_COLLAB_URL` (netlify.toml).
The server checks nothing about where a WebSocket comes from, so connecting across sites just works.

The Docker image still serves the web app too, so Render (or the Cloud Run URL on its own) remains
a complete copy of the site.

## Limits worth knowing

- **One server instance at most** (`--max-instances 1`). Live rooms live in the server's memory, so
  everyone editing a shader must reach the same process. Load tests put one instance (1 CPU,
  512 MB) at about 1,000 editors (README, Performance).
- **What costs money.** Cloud Run bills while the server is handling something, and an open editor
  tab is an open WebSocket. The free tier covers about 50 hours a month of "someone has an editor
  open"; after that it is about 9 cents an hour. Background tabs drop their connection after
  5 minutes and reconnect when looked at, so a forgotten tab doesn't run up hours. Runs, replays
  and the gallery pages cost nothing (Netlify). Set a budget alert anyway (step 2).
- **WebSockets last up to an hour** (`--timeout 3600`); the editor reconnects on its own and
  catches up.

## Setting it up

### 1. Netlify (the site)
1. app.netlify.com → **Add new project → Import an existing project → GitHub → aarxa/second-pass**.
2. Leave the build settings as they are: Netlify reads them from `netlify.toml`.
3. Deploy. Optionally rename the site (Project configuration → Change project name), e.g.
   `second-pass` → `second-pass.netlify.app`.

### 2. Google Cloud (once)
```bash
brew install --cask google-cloud-sdk
gcloud auth login
gcloud projects create <a-unique-id> --name "Second Pass"   # or use an existing project
gcloud config set project <that-id>
```
Link a billing account to the project (console → Billing). Cloud Run needs one even on the free
tier. Then add a budget alert (Billing → Budgets & alerts), e.g. $5 a month.

### 3. Store the database address as a secret
In your own terminal (it never goes in a file, a chat or your shell history). Paste Neon's
**direct** connection string when the cursor waits, and press Enter:
```bash
read -rs DB && printf %s "$DB" | gcloud secrets create database-url --data-file=- && unset DB
```
To change it later, the same line with `gcloud secrets versions add database-url --data-file=-`.

### 4. Deploy the server
```bash
./scripts/deploy-cloud-run.sh
```
It turns on the APIs it needs, creates a service account that can read only that one secret,
builds the Dockerfile in Cloud Build and prints the server's URL (`https://second-pass-….run.app`).

### 5. Point the site at the server
In `netlify.toml`, replace `shaderlab.onrender.com` with the Cloud Run host in both places
(`VITE_COLLAB_URL` and the `/api/*` redirect), merge, and Netlify rebuilds.

### Live agent runs with the site on Netlify
`--room` takes the editor link you are looking at; add `--collab` so the agent connects where the
editor does:
```bash
npm run agent -- --room https://<site>.netlify.app/s/<id> --collab wss://second-pass-….run.app/collab "a lava lamp"
```
(Or pass the Cloud Run link to `--room` and leave out `--collab`: it serves the same page.)

#!/usr/bin/env bash
# Builds the server from this folder and runs it on Google Cloud Run (docs/HOSTING.md).
# Needs: `gcloud auth login`, a project with billing (`gcloud config set project <id>`), and the
# database address stored as the secret "database-url" (docs/HOSTING.md, step 3).
#
#   ./scripts/deploy-cloud-run.sh            # REGION defaults to us-west1 (Oregon, next to Neon)
set -euo pipefail
cd "$(dirname "$0")/.."

REGION="${REGION:-us-west1}"
SERVICE=second-pass
PROJECT="$(gcloud config get-value project 2>/dev/null)"
[ -n "$PROJECT" ] || { echo "No project set: run gcloud config set project <id>"; exit 1; }
RUNNER="second-pass-server@${PROJECT}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud secrets describe database-url >/dev/null 2>&1 || { echo "Store the database address first (docs/HOSTING.md, step 3)."; exit 1; }

# The server runs as its own account that can read that one secret and nothing else.
gcloud iam service-accounts describe "$RUNNER" >/dev/null 2>&1 \
  || gcloud iam service-accounts create second-pass-server --display-name "Second Pass server"
gcloud secrets add-iam-policy-binding database-url \
  --member "serviceAccount:${RUNNER}" --role roles/secretmanager.secretAccessor >/dev/null

# One instance at most: live rooms live in the server's memory, so every editor of a shader has
# to reach the same process. It scales to zero when nobody is connected (that is what keeps it
# free); a cold start takes a second or two. WebSockets stay open up to an hour, then reconnect.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --service-account "$RUNNER" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1000 \
  --cpu 1 \
  --memory 512Mi \
  --cpu-boost \
  --timeout 3600 \
  --session-affinity \
  --set-secrets DATABASE_URL=database-url:latest \
  --quiet

gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)'

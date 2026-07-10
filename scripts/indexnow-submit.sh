#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# INDEXNOW SUBMITTER — ScriptMasterLabs
#
# Pushes every URL in sitemap.xml to the IndexNow API. IndexNow is a shared
# protocol (Bing, Yandex, Seznam, Naver participate) — one POST to
# api.indexnow.org fans out to all of them. Google does not participate in
# IndexNow; it still needs Search Console submission separately.
#
# Requires a key file at the site root: <key>.txt containing exactly <key>.
# That file must already be deployed and reachable at keyLocation below
# before this script runs, or the submission will be rejected.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HOST="www.scriptmasterlabs.com"
KEY="6610d7442dde5ebae1ef221f57885e9b"
KEY_LOCATION="https://${HOST}/${KEY}.txt"
SITEMAP="$(dirname "$0")/../sitemap.xml"

if [ ! -f "$SITEMAP" ]; then
  echo "sitemap.xml not found at $SITEMAP" >&2
  exit 1
fi

# Extract each <loc> URL, drop ones IndexNow shouldn't bother with (dirs w/o
# extension still fine — IndexNow just wants the URL a search engine would visit).
mapfile -t urls < <(grep -o '<loc>[^<]*</loc>' "$SITEMAP" | sed -e 's/<loc>//' -e 's/<\/loc>//')

if [ "${#urls[@]}" -eq 0 ]; then
  echo "No URLs found in sitemap.xml — nothing to submit" >&2
  exit 1
fi

url_list_json=$(printf '"%s",' "${urls[@]}")
url_list_json="[${url_list_json%,}]"

payload=$(cat <<EOF
{
  "host": "${HOST}",
  "key": "${KEY}",
  "keyLocation": "${KEY_LOCATION}",
  "urlList": ${url_list_json}
}
EOF
)

echo "Submitting ${#urls[@]} URLs to IndexNow…"

http_code=$(curl -sS -o /tmp/indexnow-response.txt -w "%{http_code}" \
  -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d "$payload")

echo "IndexNow response: HTTP $http_code"
cat /tmp/indexnow-response.txt 2>/dev/null || true

# 200 = processed, 202 = accepted (key not yet verified but queued)
if [ "$http_code" != "200" ] && [ "$http_code" != "202" ]; then
  echo "IndexNow submission failed" >&2
  exit 1
fi

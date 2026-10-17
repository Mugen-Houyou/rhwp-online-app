#!/usr/bin/env bash
# CI 릴리스 워크플로 감시 — 무인증 GitHub API(60회/시간) 대신 Actions 페이지에 박힌 상태 JSON을 읽는다.
# usage: watch-ci.sh <owner/repo> <tag> [max_minutes=30]
# exit: 0 = SUCCESS, 1 = 실패/취소, 2 = 시간 초과. 상태가 바뀔 때마다 한 줄 출력.
set -u
REPO="${1:?owner/repo}"; TAG="${2:?tag}"; MAX="${3:-30}"
prev=""
for ((i = 0; i < MAX; i++)); do
  page=$(curl -sL -A 'Mozilla/5.0' "https://github.com/$REPO/actions?query=branch%3A$TAG" || true)
  status=$(printf '%s' "$page" | grep -oE '"status":"WORKFLOW_RUN_STATUS_[A-Z_]*"' | head -1 | sed -E 's/.*STATUS_//; s/"//')
  concl=$(printf '%s' "$page" | grep -oE '"conclusion":"WORKFLOW_RUN_CONCLUSION_[A-Z_]*"' | head -1 | sed -E 's/.*CONCLUSION_//; s/"//')
  run=$(printf '%s' "$page" | grep -oE '/actions/runs/[0-9]+' | head -1)
  state="status=${status:-not-started} conclusion=${concl:-none} run=https://github.com/$REPO${run:-/actions}"
  if [ "$state" != "$prev" ]; then echo "CI $TAG: $state"; prev="$state"; fi
  if [ "$status" = "COMPLETED" ]; then
    [ "$concl" = "SUCCESS" ] && exit 0 || exit 1
  fi
  sleep 60
done
echo "CI $TAG: timeout after $MAX min"
exit 2

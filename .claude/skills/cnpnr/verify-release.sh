#!/usr/bin/env bash
# 게시된 릴리스 검증 — 자동 업데이트 피드(latest.yml)의 버전, Assets 4종, releases/latest 리다이렉트를 확인한다.
# usage: verify-release.sh <owner/repo> <tag>
# exit: 0 = 정상, 1 = 불일치/미게시
set -u
REPO="${1:?owner/repo}"; TAG="${2:?tag}"; VER="${TAG#v}"
U="https://github.com/$REPO/releases/download/$TAG/latest.yml"
code=""
for i in 1 2 3 4 5 6 7 8 9; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -I "$U" || echo "000")
  [ "$code" = "302" ] && break
  sleep 10
done
echo "latest.yml HTTP $code"
if [ "$code" != "302" ]; then echo "NOT PUBLISHED (draft or missing)"; exit 1; fi
feed=$(curl -sL "$U")
echo "$feed" | grep -E '^(version|path|releaseDate):|^sha512:' | head -4
assets=$(curl -sL -A 'Mozilla/5.0' "https://github.com/$REPO/releases/expanded_assets/$TAG" | grep -oE "/releases/download/$TAG/[^\"]+" | sed 's|.*/||' | sort -u)
echo "== assets =="; echo "$assets"
latest=$(curl -s -o /dev/null -w '%{redirect_url}' "https://github.com/$REPO/releases/latest")
echo "== releases/latest -> $latest"
ok=0
echo "$feed" | grep -q "^version: $VER$" || { echo "FAIL: feed version != $VER"; ok=1; }
for a in "RHWP-Setup-$VER.exe" "RHWP-Setup-$VER.exe.blockmap" "RHWP-Portable-$VER.exe" "latest.yml"; do
  echo "$assets" | grep -qx "$a" || { echo "FAIL: missing asset $a"; ok=1; }
done
case "$latest" in */tag/$TAG) ;; *) echo "FAIL: releases/latest is not $TAG"; ok=1;; esac
[ $ok -eq 0 ] && echo "OK: $TAG published and consistent"
exit $ok

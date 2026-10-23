---
name: sync-app
description: 이 Mac에 설치된 RHWP Online(/Applications/RHWP.app)을 현재 체크아웃의 코드로 교체 — arm64 패키징(ad-hoc 서명) → 실행 중 인스턴스 종료 → /Applications 교체 → 검증까지 한 번에. 사용자가 /sync-app 을 치거나 "앱 동기화", "앱 최신화", "설치된 앱 업데이트", "빌드해서 /Applications에 넣어"라고 할 때 사용. macOS Apple Silicon 전용이며 앱을 실행하지는 않는다.
allowed-tools: Bash
---

# /sync-app — 설치된 macOS 앱을 현재 코드로 교체

끝 상태: `/Applications/RHWP.app`이 현재 작업 트리의 빌드(arm64, ad-hoc 서명)로 바뀌어 있고 사용자가 Finder/Dock에서
실행할 수 있다. `/sync-app`을 친 것이 승인이다 — "교체할까요?"라고 묻지 않는다. **앱을 실행하지는 않는다** — 실행은 사용자 몫.

범위: macOS Apple Silicon. git 동작(fetch/pull/commit)은 하지 않는다 — 지금 체크아웃된 그대로 빌드한다.
로컬 빌드라 Gatekeeper 격리가 붙지 않으므로 서명 없이도 바로 열린다. 공개 릴리스는 `/cnpnr`(CI 빌드)가 맡는다.

## 1. 사전 확인 — 멈춤 조건
- `uname -s` ≠ `Darwin` 또는 `uname -m` ≠ `arm64` → 중단.
- `node_modules/electron`이 없으면 `npm install --no-audit --no-fund` 먼저(`package-lock.json`의 루트 version은 건드리지 않는다 —
  설치 뒤 `git checkout -- package-lock.json`으로 되돌린다).
- `git status --short`로 어떤 변경이 들어가는지 한 줄로 알린다(더러운 트리여도 진행 — 로컬 설치용이다).

## 2. 검증 + 빌드
```bash
node --check main.js && for f in src/main/*.js src/preload/*.js; do node --check "$f"; done
rm -rf dist/mac-arm64
npm run build:mac:dir      # → dist/mac-arm64/RHWP.app (dmg/zip 없이 번들만, 1–2분)
```
빌드가 0이 아닌 코드로 끝나면 중단하고 보고한다. 번들 확인:
```bash
codesign -dv --verbose=2 dist/mac-arm64/RHWP.app 2>&1 | grep -E 'Signature|Identifier'   # Signature=adhoc 또는 Developer ID
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' dist/mac-arm64/RHWP.app/Contents/Info.plist
file dist/mac-arm64/RHWP.app/Contents/MacOS/RHWP | grep -q arm64 && echo arch ok
```

## 3. /Applications 교체
실행 중이면 먼저 끝낸다 — 실행 중인 번들은 깨끗이 바꿀 수 없고 옛 코드가 계속 돈다:
```bash
if pgrep -f '/Applications/RHWP.app/Contents/MacOS/RHWP' >/dev/null; then
  osascript -e 'tell application id "com.rhwp.online-app" to quit'   # 저장 확인 대화상자가 뜨면 사용자가 처리한다
  for i in 1 2 3 4 5 6 7 8 9 10; do pgrep -f '/Applications/RHWP.app/Contents/MacOS/RHWP' >/dev/null || break; sleep 1; done
fi
pgrep -f '/Applications/RHWP.app/Contents/MacOS/RHWP' >/dev/null && { echo "still running — 중단"; exit 1; }
rm -rf /Applications/RHWP.app
ditto dist/mac-arm64/RHWP.app /Applications/RHWP.app
xattr -dr com.apple.quarantine /Applications/RHWP.app 2>/dev/null
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/RHWP.app 2>/dev/null
```
종료시켜야 했으면 보고에 적는다(사용자가 쓰고 있었을 수 있다). 확인 대화상자에서 사용자가 "취소"를 누르면 앱이 살아 있으므로 중단한다.

## 4. 검증 + 보고
설치본이 방금 빌드인지 증명한다 — 앱 코드가 든 asar의 해시를 비교한다:
```bash
shasum -a 256 dist/mac-arm64/RHWP.app/Contents/Resources/app.asar /Applications/RHWP.app/Contents/Resources/app.asar   # 같아야 한다
```
보고(짧게): 빌드한 커밋(`git log -1 --format='%h %s'`)과 작업 트리 변경 유무, 번들 버전·서명 종류, 해시 일치, 실행 중 인스턴스를 종료했는지.
**실행하지 않았다**고 적는다 — 사용자가 Finder에서 연다.

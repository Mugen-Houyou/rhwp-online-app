---
name: cnpnr
description: Commit and push and release — RHWP Online(이 저장소)의 현재 변경을 버전 범프 → 커밋 → main·태그 푸시 → CI 릴리스 빌드 감시 → 초안 릴리스 게시 → 자동 업데이트 피드 검증까지 한 번에 진행하고, 마지막에 릴리스 노트 본문(한국어, 저장소 관례 형식)을 제시한다. 사용자가 /cnpnr 을 치거나 "커밋하고 릴리스해", "배포해", "올려서 릴리스까지"라고 할 때 사용.
argument-hint: "[X.Y.Z | patch(기본) | minor | major] [--draft] [--notes-only]"
---

# /cnpnr — commit · push · release

인자: `$ARGUMENTS`
- 버전: `X.Y.Z`를 직접 주거나 `patch`(기본)/`minor`/`major`. `package.json`의 현재 `version`에서 올린다.
- `--draft`: CI가 만든 초안 릴리스를 **게시하지 않고** 남겨 둔다(소유자가 GitHub에서 직접 Publish). 노트는 그대로 제시.
- `--notes-only`: git 동작 없이, 현재 변경(작업 트리 + 직전 태그 이후 커밋)으로 릴리스 노트만 작성해 제시.

## 이 저장소의 전제 (바뀌면 여기부터 고친다)
- Node/npm/gh가 없는 PC가 있다 — JS 실행은 항상 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe <script.js>`
  (`npm install`로 받은 Electron이 Node 런타임을 겸한다). 릴리스 산출물은 **CI만** 만든다(`.github/workflows/release.yml`,
  `v*` 태그 푸시 → windows-latest) — 로컬 `electron-builder` 빌드는 하지 않는다.
- 브랜치는 `main`, 원격 이름은 `git config branch.main.remote`로 확인한다(클론마다 다르다: `origin`, `mainremote` 등).
  태그는 **lightweight** `vX.Y.Z`.
- 커밋 작성자는 PC의 git 설정과 무관하게 저장소 이력의 작성자로 고정:
  커밋마다 `-c user.name="Mugen-Houyou" -c user.email="opnstk@hotmail.com"`.
- 커밋 메시지 관례: 영어 제목 `<Summary> (vX.Y.Z)` + 영어 본문(왜/무엇, 72자 줄바꿈) + `Co-Authored-By:` 트레일러(세션 안내에 있는 것).
- `package-lock.json`의 루트 version은 건드리지 않는다(관례).
- CI는 electron-builder 기본값대로 **초안(draft)** 릴리스를 만든다. 게시는 `publish-release.js`가 Git Credential Manager에
  저장된 GitHub 자격증명으로 한다 — 초안이 보이는(푸시 권한 있는) 항목을 골라 쓰고, 토큰은 절대 출력하지 않는다.
- GitHub 무인증 API는 60회/시간이라 CI 감시는 Actions HTML 페이지의 상태 JSON으로 한다(`watch-ci.sh`).
- 산출물 이름: `RHWP-Setup-X.Y.Z.exe`(+`.blockmap`), `RHWP-Portable-X.Y.Z.exe`, `latest.yml`. 릴리스 제목은 직전 릴리스 형식을 따른다(현재 `1.0.24` 식).

## 절차

### 0. 사전 확인
```bash
git status --short && git branch --show-current && git log -1 --format='%h %s' && git describe --tags --abbrev=0
```
- `main`이 아니면 중단. 커밋할 변경이 없으면 사용자에게 묻는다(이미 커밋된 HEAD를 릴리스할지).
- 다음 버전을 정하고 태그 `vX.Y.Z`가 원격에 없는지 `git ls-remote --tags "$(git config branch.main.remote)" vX.Y.Z`로 확인.
- 변경 파일을 훑어 **무엇이 바뀌었는지**(사용자 관점) 정리해 둔다 — 커밋 본문과 릴리스 노트의 재료.

### 1. 검증
```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe --check main.js
for f in src/main/*.js src/preload/*.js; do ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe --check "$f"; done
# 주입용 표현식 파일(파일 전체가 화살표 함수)은 --check가 안 되므로 파싱만:
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e "const fs=require('fs'); for (const f of ['src/renderer-inject/titlebar.js','src/renderer-inject/wasm-recovery.js']) { new Function('return (' + fs.readFileSync(f,'utf8') + ')'); console.log('parse ok', f); }"
```
라이브 스모크 하네스가 있으면(세션 스크래치패드 또는 사용자가 지정) 먼저 돌리고, 실패하면 여기서 멈추고 보고한다.

### 2. 버전 범프 + 커밋
- `package.json`의 `"version"`만 X.Y.Z로 수정.
- 메시지는 파일로 써서 `git commit -F`로. 제목은 변경의 핵심 하나, 본문은 "왜 → 무엇" 순서.
```bash
git add -A <변경 파일들> package.json
git -c user.name="Mugen-Houyou" -c user.email="opnstk@hotmail.com" commit -q -F <msgfile> && git log -1 --format='%h %an %s'
```

### 3. 태그 + 푸시
```bash
R=$(git config branch.main.remote) && git tag vX.Y.Z && git push "$R" main && git push "$R" vX.Y.Z && git ls-remote --heads --tags "$R" main vX.Y.Z
```
- 푸시가 **403 `Permission ... denied`** 이면 GCM 계정 선택 창에서 푸시 권한 없는 항목을 고른 것 — 다시 푸시하며 올바른 계정을
  고르게 하고, 반복되면 `git config credential.https://github.com.username <계정>`으로 이 저장소의 계정을 고정한다.

### 4. CI 감시 (백그라운드, 보통 5–8분)
```bash
bash .claude/skills/cnpnr/watch-ci.sh Mugen-Houyou/rhwp-online-app vX.Y.Z 30
```
종료 코드 0 = SUCCESS. 실패(1)면 run URL을 보고하고 멈춘다(태그는 남겨 두고, 고친 뒤 태그를 옮길지 사용자에게 묻는다).

### 5. 릴리스 노트 작성 (아래 형식 그대로, 파일로 저장)
### 6. 초안 게시 (`--draft`가 아니면)
```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe .claude/skills/cnpnr/publish-release.js Mugen-Houyou/rhwp-online-app vX.Y.Z <notes.md>
```
종료 코드 0 = 게시됨, 3 = 이미 게시됨, 2 = 쓸 수 있는 자격증명 없음(초안으로 두고 노트를 제시해 사용자가 직접 Publish).

### 7. 검증
```bash
bash .claude/skills/cnpnr/verify-release.sh Mugen-Houyou/rhwp-online-app vX.Y.Z
```
`latest.yml`의 version이 X.Y.Z이고 Assets 4종이 있으며 `releases/latest`가 새 태그를 가리켜야 한다. `--draft`면 초안이라 404가 정상 — 건너뛴다.

### 8. 마무리 보고
커밋 해시·태그·CI run URL·릴리스 URL·검증 결과를 짧게 적고, **마지막에 릴리스 노트 본문을 코드 블록으로** 붙인다(게시했더라도 — 사용자가 GitHub에서 다듬을 수 있게).

## 릴리스 노트 형식 (저장소 관례 — 그대로 지킨다)
- 한국어, 사용자 관점. 내부 용어(서비스 워커, DOM, IPC 등) 금지. 사용자가 화면에서 보는 문구(오류 메시지·탭 이름 등)는 큰따옴표로 인용한다.
- 섹션 순서: 변경 묶음들 → `## 상세 변경 내역` → `## 다운로드`.
- 변경 묶음마다 `## <묶음 이름>` 하나. 지금까지 쓴 이름: `원본 RHWP x.y.z 반영`, `동작 변경`, `안정성`, `일부 UI 수정`. 필요하면 같은 결로 새로 짓는다.
- 항목은 두 칸 들여쓴 `  - `로, 한 항목 = 한 변경. **명사형으로 짧게** 끝내고 마침표를 찍지 않는다("~ 수정", "~ 통일", "~ 축약").
  동작 설명·이유·"(이전에는 …)" 같은 부연은 붙이지 않는다 — 자세한 내용은 상세 변경 내역 링크가 맡는다.
- 굵게(`**`)는 다운로드 섹션의 **"Assets" 섹션**과 권장 파일 **RHWP-Setup-X.Y.Z.exe** 두 곳에만. 항목 본문과 포터블 파일명은 굵게 하지 않는다.
- 상세 변경 내역·다운로드 블록은 고정 문구. 비교 링크는 직전 태그 → 새 태그.

```markdown
## 안정성

  - 오랜만에 구동 시 발생하는 "WASM 초기화 실패" 관련 오류 수정

## 일부 UI 수정

  - 일부 문구를 원본 RHWP의 말투에 맞춰 통일
  - 환경 설정의 "외관 및 UI" 탭 이름을 "외관"으로 축약

## 상세 변경 내역

https://github.com/Mugen-Houyou/rhwp-online-app/compare/v<직전>...vX.Y.Z

## 다운로드

아래 **"Assets" 섹션**에서 받아주세요.

 - 포터블: RHWP-Portable-X.Y.Z.exe
 - 설치형 (권장): **RHWP-Setup-X.Y.Z.exe**
```

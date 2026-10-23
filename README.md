# RHWP Online

[edwardkim/rhwp](https://github.com/edwardkim/rhwp)님의 [RHWP 프로젝트](https://github.com/edwardkim/rhwp)의 [웹버전](https://edwardkim.github.io/rhwp/)을 감싸는 Windows·macOS 프로그램입니다.

## 설치

[Releases](https://github.com/Mugen-Houyou/rhwp-online-app/releases/latest)에서 받습니다.

- Windows: `RHWP-Setup-x.y.z.exe`(설치형, 권장) 또는 `RHWP-Portable-x.y.z.exe`(포터블)
- macOS (Apple Silicon, macOS 12 이상): `RHWP-x.y.z-arm64.dmg`를 열어 RHWP를 응용 프로그램 폴더로 옮깁니다.

macOS 빌드는 Apple 공증을 받지 않아 처음 열 때 "확인할 수 없는 개발자" 안내가 뜹니다. 시스템 설정 → 개인정보 보호 및 보안으로 가서 아래쪽의 "그래도 열기"를 누르면 그 뒤로는 바로 열립니다. 터미널을 쓴다면 아래 한 줄로 같은 효과를 냅니다.

```bash
xattr -d com.apple.quarantine /Applications/RHWP.app
```

새 버전이 나오면 Windows는 종료할 때 자동으로 설치되고, macOS는 앱이 안내만 하므로 dmg를 다시 받아 덮어씁니다.

## 개발

```bash
npm install
npm start                       # 앱 실행 (Windows·macOS)
npm start -- --dev-show-topbar  # 네이티브 메뉴/타이틀바 표시 (디버그용)
```

## 빌드

```bash
npm run build           # Windows: NSIS 설치본 + portable
npm run build:portable  # Windows: portable 단독
npm run build:mac       # macOS: dmg + zip (Apple Silicon)
npm run build:mac:dir   # macOS: dist/mac-arm64/RHWP.app 만 (설치 없이 실행해 볼 때)
```

산출물은 `dist/`에 생성됩니다. 공식 릴리스는 GitHub Actions가 `v*` 태그 푸시 때 Windows와 macOS를 차례로 빌드합니다. macOS 빌드는 저장소 secrets에 Developer ID 인증서(`CSC_LINK`, `CSC_KEY_PASSWORD`)와 공증 자격증명(`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)이 있으면 서명·공증하고 자동 업데이트를 켜며, 없으면 ad-hoc 서명으로 만들어집니다.

## 구성

엔트리는 [main.js](main.js)(창 생성·권한·메뉴·자동 업데이트)이고, 앱 설정과 빌드 구성은 [package.json](package.json)에 있습니다. 나머지는 `src/` 아래에 있습니다.

- `src/main/shell-policy.js` — 팝업·네비게이션 가드와 타이틀바 오버레이 색 (메인 프로세스)
- `src/main/mac-shell.js` — macOS 전용: 애플리케이션 메뉴·Dock 메뉴, 네이티브 UI 테마 동기화, 새 버전 안내
- `src/preload/theme-bridge.js` — 웹앱 메뉴바 색과 테마 모드를 실측해 메인에 전달하는 preload
- `src/renderer-inject/titlebar.js`, `titlebar.css` (+ `titlebar-win.css`, `titlebar-mac.css`) — 페이지 로드 후 주입: 타이틀 표시, "RHWP Online 정보" 메뉴, 환경 설정의 "외관" 탭. 창 컨트롤과 겹치지 않기 위한 메뉴바 여백은 플랫폼 파일이 정합니다(Windows는 오른쪽 오버레이, macOS는 왼쪽 트래픽 라이트)
- `src/dialogs/update-progress.html` — 종료 시 업데이트 설치 진행 창 (Windows)

## 크레딧

- 래핑 대상 웹앱 및 로고: [edwardkim/rhwp](https://github.com/edwardkim/rhwp) (MIT License, © 2025-2026 Edward Kim)
- macOS 앱 아이콘(`build/icon-mac.png`)은 같은 저장소의 Safari 확장 앱 아이콘을 그대로 사용합니다.

## 라이센스

원본 [RHWP 웹앱](https://github.com/edwardkim/rhwp)와 동일하게 MIT License로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.

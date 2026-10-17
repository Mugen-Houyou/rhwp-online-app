# RHWP Online

[edwardkim/rhwp](https://github.com/edwardkim/rhwp)님의 [RHWP 프로젝트](https://github.com/edwardkim/rhwp)의 [웹버전](https://edwardkim.github.io/rhwp/)을 감싸는 Windows 프로그램입니다.

## 개발

```bash
npm install
npm start                       # 앱 실행
npm start -- --dev-show-topbar  # 네이티브 메뉴/타이틀바 표시 (디버그용)
```

## 빌드

```bash
npm run build           # NSIS 설치본 + portable
npm run build:portable  # portable 단독
```

산출물은 `dist/`에 생성됩니다.

## 구성

엔트리는 [main.js](main.js)(창 생성·권한·자동 업데이트)이고, 앱 설정과 빌드 구성은 [package.json](package.json)에 있습니다. 나머지는 `src/` 아래에 있습니다.

- `src/main/shell-policy.js` — 팝업·네비게이션 가드와 타이틀바 오버레이 색 (메인 프로세스)
- `src/preload/theme-bridge.js` — 웹앱 메뉴바 색을 실측해 메인에 전달하는 preload
- `src/renderer-inject/titlebar.js`, `titlebar.css` — 페이지 로드 후 주입: 타이틀 표시, "RHWP Online 정보" 메뉴, 환경 설정의 "외관 및 UI" 탭
- `src/dialogs/update-progress.html` — 종료 시 업데이트 설치 진행 창

## 크레딧

- 래핑 대상 웹앱 및 로고: [edwardkim/rhwp](https://github.com/edwardkim/rhwp) (MIT License, © 2025-2026 Edward Kim)

## 라이센스

원본 [RHWP 웹앱](https://github.com/edwardkim/rhwp)와 동일하게 MIT License로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.

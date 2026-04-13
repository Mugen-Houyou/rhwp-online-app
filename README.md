# RHWP Online

[edwardkim/rhwp](https://github.com/edwardkim/rhwp)님의 [RHWP 프로젝트](https://github.com/edwardkim/rhwp)의 [웹앱](https://edwardkim.github.io/rhwp/)을 감싸는 Windows 데스크톱 셸입니다.

## 기능

- 커스텀 타이틀바: 기본 Windows 타이틀바를 숨기고 웹앱 메뉴바에 창 컨트롤 오버레이를 통합
- 데스크톱 권한 선승인: 클립보드, 파일 시스템, 알림, 전체 화면, 유휴 감지 등
- File System Access API 허용으로 문서 열기/저장 지원
- 외부 링크는 기본 브라우저로, 같은 출처 팝업은 앱 내 새 창으로 처리

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

단일 파일 Electron 앱입니다. 엔트리는 [main.js](main.js)이며, 앱 설정과 빌드 구성은 [package.json](package.json)에 있습니다.

## 크레딧

- 래핑 대상 웹앱 및 로고: [edwardkim/rhwp](https://github.com/edwardkim/rhwp) (MIT License, © 2025-2026 Edward Kim)

## 라이센스

원본 [RHWP 웹앱](https://github.com/edwardkim/rhwp)와 동일하게 MIT License로 배포됩니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요.

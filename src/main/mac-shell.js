// macOS 전용 셸 — 애플리케이션 메뉴·Dock 메뉴·네이티브 테마 소스·새 버전 안내. main.js가 darwin에서만 require한다.
//
// 메뉴를 두는 이유: macOS는 메뉴 막대가 화면 상단에 있어 창 공간을 쓰지 않고, ⌘Q·⌘W·⌘M·⌘H와 입력 상자의
// ⌘C/⌘V/⌘A/⌘Z 같은 표준 단축키가 메뉴 항목(role)을 통해 공급된다. 메뉴를 비우면(Windows처럼 null) 이것들이
// 모두 사라진다. 편집기 본문의 단축키는 업스트림이 keydown에서 직접 처리하고 preventDefault하므로, 렌더러가
// 먼저 받는 macOS 키 처리 순서상 메뉴 role과 겹쳐 두 번 실행되지 않는다. 업스트림의 새 문서는 ⌥N이라 ⌘N은
// 비어 있어 "새 창"에 쓴다.
//
// 문구는 한국어 고정 — main.js의 닫기 확인 대화상자와 같은 수준이며, 업스트림 웹앱도 언어 선택 UI 없이 ko가 기본이다.
// 문구 규칙은 src/renderer-inject/titlebar.js 상단 참조.
const { app, dialog, Menu, BrowserWindow } = require("electron");
const { RHWP_URL, openExternal } = require("./shell-policy.js");

const REPO_URL = "https://github.com/Mugen-Houyou/rhwp-online-app";

// 애플리케이션 메뉴. devMenu는 --dev-show-topbar(새로고침·개발자 도구). onNewWindow/onAbout은 main.js의 함수
function buildAppMenu({ devMenu, onNewWindow, onAbout }) {
  const view = [{ role: "togglefullscreen", label: "전체 화면 시작/종료" }];
  if (devMenu) {
    view.push(
      { type: "separator" },
      { role: "reload", label: "새로고침" },
      { role: "forceReload", label: "강제 새로고침" },
      { role: "toggleDevTools", label: "개발자 도구" },
    );
  }
  return Menu.buildFromTemplate([
    {
      label: app.name, // 첫 메뉴는 macOS가 앱 이름으로 표시한다
      submenu: [
        { label: "RHWP Online 정보", click: () => onAbout() },
        { type: "separator" },
        { role: "services", label: "서비스" },
        { type: "separator" },
        { role: "hide", label: "RHWP 가리기" },
        { role: "hideOthers", label: "기타 가리기" },
        { role: "unhide", label: "모두 보기" },
        { type: "separator" },
        { role: "quit", label: "RHWP 종료" },
      ],
    },
    {
      label: "파일",
      submenu: [
        { label: "새 창", accelerator: "CmdOrCtrl+N", click: () => onNewWindow() },
        { type: "separator" },
        { role: "close", label: "창 닫기" },
      ],
    },
    {
      label: "편집",
      submenu: [
        { role: "undo", label: "실행 취소" },
        { role: "redo", label: "다시 실행" },
        { type: "separator" },
        { role: "cut", label: "잘라내기" },
        { role: "copy", label: "복사" },
        { role: "paste", label: "붙여넣기" },
        { role: "delete", label: "삭제" },
        { role: "selectAll", label: "모두 선택" },
      ],
    },
    { label: "보기", submenu: view },
    {
      role: "window", // 열린 창 목록이 자동으로 뒤에 붙는다
      label: "윈도우",
      submenu: [
        { role: "minimize", label: "최소화" },
        { role: "zoom", label: "확대/축소" },
        { type: "separator" },
        { role: "front", label: "모두 앞으로 가져오기" },
      ],
    },
    {
      role: "help",
      label: "도움말",
      submenu: [
        { label: "RHWP Online 저장소 (GitHub)", click: () => openExternal(REPO_URL) },
        { label: "원본 RHWP 웹 앱", click: () => openExternal(RHWP_URL) },
      ],
    },
  ]);
}

// Dock 아이콘 우클릭 메뉴 — 창을 모두 닫은 뒤에도 새 창을 열 수 있게
function buildDockMenu({ onNewWindow }) {
  return Menu.buildFromTemplate([{ label: "새 창", click: () => onNewWindow() }]);
}

// preload 보고값 { mode } → nativeTheme.themeSource. 앱이 "시스템 설정"이면 OS를 따르고, 밝게/어둡게를 고르면
// 네이티브 메뉴·시트·대화상자도 그 밝기로 그린다(트래픽 라이트 색은 바뀌지 않는다)
const THEME_SOURCES = new Set(["system", "light", "dark"]);
const themeSourceFor = (p) => (p && THEME_SOURCES.has(p.mode) ? p.mode : "system");

// 서명 없는 빌드의 새 버전 안내 — 한 실행에 한 번. 설치는 사용자가 릴리스 페이지에서 직접 받아서 한다
let noticeShown = false;
function showUpdateNotice(info, currentVersion) {
  if (noticeShown || !info || !info.version) return;
  noticeShown = true;
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const opts = {
    type: "info",
    message: "RHWP Online 새 버전이 있습니다.",
    detail: `현재 버전 ${currentVersion}, 새 버전 ${info.version}.\n다운로드 페이지에서 새 버전을 받아 설치하세요.`,
    buttons: ["다운로드 페이지 열기", "나중에"],
    defaultId: 0,
    cancelId: 1,
  };
  const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
  shown
    .then(({ response }) => { if (response === 0) openExternal(`${REPO_URL}/releases/tag/v${info.version}`); })
    .catch(() => {});
}

module.exports = { REPO_URL, buildAppMenu, buildDockMenu, themeSourceFor, showUpdateNotice };

const { app, BrowserWindow, dialog, Menu, session, ipcMain, nativeTheme } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const APP_ICON_URI = require("./icon.js");
const PKG = require("./package.json");
const APP_VERSION = PKG.version;
const IS_MAC = process.platform === "darwin";
// macOS의 자동 설치 업데이트(Squirrel.Mac)는 서명된 앱에서만 동작한다. CI가 Developer ID로 서명할 때만
// extraMetadata로 macSigned=true를 심고, 서명 없는 빌드는 새 버전 안내만 띄운다(src/main/mac-shell.js)
const MAC_AUTO_INSTALL = IS_MAC && PKG.macSigned === true;
// 창 정책(팝업·네비게이션 가드, 오버레이 색) — 스모크 테스트가 같은 모듈을 require해 실물을 시험한다
const { RHWP_URL, overlayFor, attachShellPolicy } = require("./src/main/shell-policy.js");
// macOS 전용: 애플리케이션 메뉴·Dock 메뉴·네이티브 테마·새 버전 안내
const macShell = IS_MAC ? require("./src/main/mac-shell.js") : null;

// 렌더러에 주입할 코드/마크업 — 모듈 로드 시 한 번 읽어 캐시 (다중 창마다 재읽기 불필요)
const TITLEBAR_JS  = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.js"), "utf8");
// 메뉴바 여백은 창 컨트롤 위치가 플랫폼마다 달라 공통부 + 플랫폼부(Windows: 오른쪽 오버레이, macOS: 왼쪽 트래픽 라이트)
const TITLEBAR_CSS = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.css"), "utf8")
  + "\n" + fs.readFileSync(path.join(__dirname, IS_MAC ? "src/renderer-inject/titlebar-mac.css" : "src/renderer-inject/titlebar-win.css"), "utf8");
const WASM_RECOVERY_JS = fs.readFileSync(path.join(__dirname, "src/renderer-inject/wasm-recovery.js"), "utf8");
const UPDATE_HTML  = fs.readFileSync(path.join(__dirname, "src/dialogs/update-progress.html"), "utf8");

// 단일 프로세스 다중 창: 이미 실행 중이면 기존 인스턴스에 위임
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  process.exit(0);
} else {
  app.on("second-instance", () => {
    const win = createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });
}

// --dev-show-topbar: electron . --dev-show-topbar 또는 앱.exe --dev-show-topbar
const showTopbar = process.argv.includes("--dev-show-topbar");

// 데스크톱 앱으로서 허용해야 할 권한 목록
const GRANTED_PERMISSIONS = new Set([
  "clipboard-read",              // 클립보드 붙여넣기
  "clipboard-sanitized-write",   // 클립보드 복사
  "fileSystem",                  // 파일 열기/저장 (File System Access API)
  "fullscreen",                  // 전체 화면
  "notifications",               // 알림
  "pointerLock",                 // UI 드래그 조작
  "window-management",           // 다중 모니터 창 배치
  "storage-access",              // 로컬 스토리지
  "top-level-storage-access",    // 로컬 스토리지 (최상위)
  "idle-detection",              // 유휴 감지
  "local-fonts",                 // 로컬 글꼴 감지 (Local Font Access API)
]);

function setupPermissions() {
  const ses = session.defaultSession;

  // 권한 요청 — 허용 목록이면 즉시 승인
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(GRANTED_PERMISSIONS.has(permission));
  });

  // 권한 체크 — 허용 목록이면 true 반환
  ses.setPermissionCheckHandler((webContents, permission) => {
    return GRANTED_PERMISSIONS.has(permission);
  });
}

// createWindow가 만든 메인 창. 오버레이가 없는 자식 창(인쇄 미리보기 등)의 테마 보고를 걸러내기 위한 집합
// (Electron 41 실측으로 자식 창은 preload를 상속하지 않지만, 방어적으로 둔다)
const shellWindows = new WeakSet();

function createWindow() {
  const winOptions = {
    width: 1280,
    height: 900,
    title: "RHWP",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "src/preload/theme-bridge.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  };

  // 타이틀바 통합: 시스템 타이틀바를 숨기고 웹앱 메뉴바(28px) 위에 창 컨트롤을 얹는다
  //  - Windows: 메뉴바 우측에 창 컨트롤 오버레이(색은 preload가 보고하는 메뉴바 실측 색)
  //  - macOS: 메뉴바 좌측에 트래픽 라이트. 색은 바꿀 수 없고 위치만 정한다 — 버튼 영역 높이가 2·y + 14라
  //    y:7이면 28px 메뉴바의 세로 중앙. titleBarOverlay는 색을 받지 않지만 켜 두어야 렌더러에
  //    env(titlebar-area-*)가 공급된다(titlebar-mac.css가 왼쪽 여백에 쓴다)
  if (!showTopbar) {
    winOptions.titleBarStyle = "hidden";
    if (IS_MAC) {
      winOptions.trafficLightPosition = { x: 12, y: 7 };
      winOptions.titleBarOverlay = true;
    } else {
      // 초기값은 OS 다크 여부로 추정(앱 기본 모드가 system) → preload가 메뉴바 실측 색으로 보정
      winOptions.titleBarOverlay = overlayFor({ effective: nativeTheme.shouldUseDarkColors ? "dark" : "light" });
    }
  }

  const win = new BrowserWindow(winOptions);
  shellWindows.add(win);

  // WASM 초기화 완료 감지 + 1초 안정화 지연 → 타이틀 바를 로딩 상태에서
  // 정상 상태로 전환. 모든 신호가 모인 뒤 추가로 READY_HOLD_MS만큼
  // "로딩 중..." 텍스트를 더 노출. 10초 안전망도 함께 설치.
  const READY_DELAY_MS = 1000;
  const READY_HOLD_MS = 1000;
  const READY_FALLBACK_MS = 10000;
  let wasmReady = false;
  let injectionDone = false;
  const markReady = () => {
    if (wasmReady && injectionDone) {
      setTimeout(() => {
        win.webContents
          .executeJavaScript("window.__rhwpSetReady && window.__rhwpSetReady()")
          .catch(() => {});
      }, READY_HOLD_MS);
    }
  };
  const scheduleReady = () => {
    if (wasmReady) return;
    setTimeout(() => {
      wasmReady = true;
      markReady();
    }, READY_DELAY_MS);
  };
  // WASM 404 자동 복구: 업스트림 재배포 직후 서비스 워커가 옛 앱 셸을 띄우면 옛 해시의 wasm이 서버에
  // 없어 "WASM 초기화 실패: …"가 난다. 새 SW는 페이지를 다시 불러오지 않으므로 시작 단계에서 대신 한다.
  //  - 1차: SW 갱신(느린 망에서는 설치 완료)을 기다렸다가 재로드
  //  - 2차: 그래도 실패하면 렌더러가 controllerchange를 구독해 새 SW가 넘겨받는 순간 스스로 재로드
  //  - 3차 이후는 손대지 않는다(루프 방지). 재로드는 창당 최대 3회.
  // 실패 문구는 옛 셸의 wasm 로더 버전에 따라 다르므로("… HTTP status code is not ok" /
  // "failed to fetch Wasm: 404 …") 특정 문구에 묶지 않고, 재로드가 소용없는 순수 네트워크 단절(fetch의
  // "Failed to fetch")만 제외한다. 배경과 렌더러 쪽 동작은 src/renderer-inject/wasm-recovery.js 참조
  const isRecoverableWasmFailure = (msg) => /WASM 초기화 실패/.test(msg) && !/Failed to fetch/.test(msg);
  let wasmInitDone = false; // 실제 "초기화 완료" 로그에만 세운다 — 10초 안전망(wasmReady)과는 별개
  let wasmRecoveryAttempts = 0;
  const recoverFromWasmFetchFailure = async () => {
    if (wasmInitDone || wasmRecoveryAttempts >= 2) return;
    const attempt = ++wasmRecoveryAttempts;
    let outcome = "error";
    try {
      outcome = await win.webContents.executeJavaScript(`(${WASM_RECOVERY_JS})(${JSON.stringify({ attempt })})`);
    } catch {}
    if (win.isDestroyed() || outcome === "has-document" || outcome === "armed") return;
    win.webContents.reload(); // "updated" | "timeout" | "no-sw" | "reload-now" | "error"
  };
  win.webContents.on("console-message", (e) => {
    if (/WasmBridge.*초기화\s*완료/.test(e.message)) {
      wasmInitDone = true;
      scheduleReady();
    } else if (isRecoverableWasmFailure(e.message)) {
      recoverFromWasmFetchFailure();
    }
  });
  // 안전망: 콘솔 신호가 안 오면 강제로 ready 전환
  setTimeout(() => {
    if (!wasmReady) {
      wasmReady = true;
      markReady();
    }
  }, READY_FALLBACK_MS);

  // macOS의 애플리케이션 메뉴는 앱 전역이라 app.whenReady에서 한 번만 설치한다(src/main/mac-shell.js)
  if (!IS_MAC) {
    if (showTopbar) {
      const menu = Menu.buildFromTemplate([
        {
          label: "파일",
          submenu: [{ role: "quit", label: "종료" }],
        },
        {
          label: "보기",
          submenu: [
            { role: "reload", label: "새로고침" },
            { role: "forceReload", label: "강제 새로고침" },
            { role: "togglefullscreen", label: "전체 화면" },
          ],
        },
        {
          label: "개발",
          submenu: [
            { role: "toggleDevTools", label: "개발자 도구" },
          ],
        },
      ]);
      Menu.setApplicationMenu(menu);
    } else {
      Menu.setApplicationMenu(null);
    }
  }

  // 팝업·네비게이션 정책: 같은 출처 팝업(인쇄 미리보기)만 앱 안에, 외부 링크는 기본 브라우저로.
  // 문서 하이퍼링크의 about:blank 팝업 처리 포함 — src/main/shell-policy.js 참조
  attachShellPolicy(win);

  // 창 제목: 업스트림 document-title.ts가 "파일명 - rhwp-studio" | "rhwp-studio" |
  // (PDF 인쇄 중 잠깐) 확장자 없는 basename을 쓴다 → 브랜드만 RHWP로 바꾼다
  win.on("page-title-updated", (event, title) => {
    event.preventDefault();
    const t = (title || "").trim();
    win.setTitle(
      !t || t === "rhwp-studio" ? "RHWP"
        : / - rhwp-studio$/.test(t) ? t.replace(/ - rhwp-studio$/, " - RHWP")
        : `${t} - RHWP`
    );
  });

  // beforeunload가 창 닫기를 막을 때 확인 대화상자 표시.
  // macOS는 NSAlert가 buttons[0]을 오른쪽(기본 자리)에 두므로 순서를 뒤집어 안전한 "취소"를 기본으로 하고,
  // title 대신 message가 굵은 제목이 되므로 질문은 detail로 나눈다. ⌘W(창 닫기)와 ⌘Q(종료)도 구분한다
  win.webContents.on("will-prevent-unload", (event) => {
    let proceed;
    if (IS_MAC) {
      const choice = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["취소", quitting ? "종료" : "닫기"],
        defaultId: 0,
        cancelId: 0,
        message: "저장하지 않은 변경사항이 있을 수 있습니다.",
        detail: quitting ? "종료하시겠습니까?" : "창을 닫으시겠습니까?",
      });
      proceed = choice === 1;
      if (!proceed) quitting = false; // 닫기를 취소하면 진행 중이던 ⌘Q도 여기서 멈춘다
    } else {
      const choice = dialog.showMessageBoxSync(win, {
        type: "question",
        buttons: ["종료", "취소"],
        defaultId: 1,
        cancelId: 1,
        title: "RHWP",
        message: "저장하지 않은 변경사항이 있을 수 있습니다.\n종료하시겠습니까?",
      });
      proceed = choice === 0;
    }
    if (proceed) event.preventDefault();
  });

  // 파일 시스템 접근 제한 해제
  win.webContents.on("file-system-access-restricted", (event, details, callback) => {
    callback("allow");
  });

  // 페이지 로드 후 메뉴바에 창 컨트롤 공간 확보 + 드래그 영역 설정
  win.webContents.on("did-finish-load", () => {
    if (!showTopbar) {
      win.webContents.insertCSS(TITLEBAR_CSS);
    }

    // 타이틀바·About 메뉴 항목·외관 탭 주입 — 자세한 동작은
    // src/renderer-inject/titlebar.js 참조
    const cfg = JSON.stringify({ injectTitleBar: !showTopbar, version: APP_VERSION, platform: process.platform });
    win.webContents
      .executeJavaScript(`(${TITLEBAR_JS})(${cfg})`)
      .then(() => {
        injectionDone = true;
        markReady();
      })
      .catch(() => {});
  });

  win.loadURL(RHWP_URL);
  return win;
}

// macOS 앱 메뉴의 "RHWP Online 정보" — 앞 창의 렌더러에 주입된 다이얼로그(titlebar.js)를 연다
function openAboutInWindow() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows().find((w) => shellWindows.has(w));
  if (!win) return createWindow();
  win.webContents.executeJavaScript("window.__rhwpOpenAbout && window.__rhwpOpenAbout()").catch(() => {});
}

let updateDownloaded = false;
let quitting = false; // macOS: ⌘Q 진행 중 표시(닫기 확인 문구용). 창 닫기를 취소하면 종료도 멈추므로 되돌린다

app.whenReady().then(() => {
  setupPermissions();

  if (IS_MAC) {
    // 메뉴 막대는 화면 상단에 있어 창 공간을 쓰지 않고, ⌘Q·⌘W·⌘C/⌘V 같은 표준 단축키가 메뉴를 통해 공급되므로
    // 항상 네이티브 메뉴를 둔다(--dev-show-topbar는 개발 항목만 더한다). 웹앱의 자체 메뉴바는 그대로
    Menu.setApplicationMenu(macShell.buildAppMenu({ devMenu: showTopbar, onNewWindow: createWindow, onAbout: openAboutInWindow }));
    app.dock.setMenu(macShell.buildDockMenu({ onNewWindow: createWindow }));
    if (!app.isPackaged) app.dock.setIcon(path.join(__dirname, "build", "icon-mac.png")); // 개발 실행용(패키징은 번들 아이콘)
    app.on("before-quit", () => { quitting = true; });
  }

  // 렌더러(preload)가 실측한 메뉴바 색 { effective, mode, color, symbolColor }로
  //  - Windows: 네이티브 타이틀바 오버레이 색 갱신
  //  - macOS: 트래픽 라이트는 색을 바꿀 수 없으므로(setTitleBarOverlay 자체가 없다) 네이티브 UI(메뉴·시트·
  //    대화상자)의 밝기만 앱 테마 모드에 맞춘다
  ipcMain.on("rhwp-theme", (event, payload) => {
    if (showTopbar) return; // 네이티브 메뉴 모드는 오버레이 없음
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !shellWindows.has(win)) return; // 메인 창이 아닌 창의 보고는 무시
    if (IS_MAC) {
      nativeTheme.themeSource = macShell.themeSourceFor(payload);
      return;
    }
    try { win.setTitleBarOverlay(overlayFor(payload)); } catch {}
  });

  createWindow();

  if (IS_MAC && !MAC_AUTO_INSTALL) {
    // 서명 없는 macOS 빌드: 받아도 설치할 수 없으니 내려받지 않고 새 버전 안내만 띄운다
    autoUpdater.autoDownload = false;
    autoUpdater.on("update-available", (info) => macShell.showUpdateNotice(info, APP_VERSION));
    autoUpdater.checkForUpdates().catch(() => {});
  } else {
    // Windows: 받아 두었다가 종료 시 설치(아래 window-all-closed). 서명된 macOS: 종료 시 Squirrel.Mac이 설치
    autoUpdater.on("update-downloaded", () => {
      updateDownloaded = true;
    });

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }
});

app.on("window-all-closed", () => {
  if (IS_MAC) return; // 창을 다 닫아도 Dock에 남고 activate(Dock 클릭)로 다시 연다. 업데이트도 종료 시점에 처리
  if (updateDownloaded) {
    const win = new BrowserWindow({
      width: 360,
      height: 140,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      frame: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    const html = UPDATE_HTML.replace("__APP_ICON_URI__", APP_ICON_URI);
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    win.once("ready-to-show", () => {
      win.show();
      autoUpdater.quitAndInstall(true, false);
    });
  } else {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

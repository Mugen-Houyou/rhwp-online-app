const { app, BrowserWindow, dialog, Menu, session, ipcMain, nativeTheme } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const APP_ICON_URI = require("./icon.js");
const APP_VERSION = require("./package.json").version;
// 창 정책(팝업·네비게이션 가드, 오버레이 색) — 스모크 테스트가 같은 모듈을 require해 실물을 시험한다
const { RHWP_URL, overlayFor, attachShellPolicy } = require("./src/main/shell-policy.js");

// 렌더러에 주입할 코드/마크업 — 모듈 로드 시 한 번 읽어 캐시 (다중 창마다 재읽기 불필요)
const TITLEBAR_JS  = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.js"), "utf8");
const TITLEBAR_CSS = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.css"), "utf8");
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

  // 타이틀바 통합: Windows 타이틀바 숨기고 메뉴바 우측에 창 컨트롤 오버레이
  if (!showTopbar) {
    winOptions.titleBarStyle = "hidden";
    // 초기값은 OS 다크 여부로 추정(앱 기본 모드가 system) → preload가 메뉴바 실측 색으로 보정
    winOptions.titleBarOverlay = overlayFor({ effective: nativeTheme.shouldUseDarkColors ? "dark" : "light" });
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

  // beforeunload가 창 닫기를 막을 때 확인 대화상자 표시
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["종료", "취소"],
      defaultId: 1,
      cancelId: 1,
      title: "RHWP",
      message: "저장하지 않은 변경사항이 있을 수 있습니다.\n종료하시겠습니까?",
    });
    if (choice === 0) event.preventDefault();
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
    const cfg = JSON.stringify({ injectTitleBar: !showTopbar, version: APP_VERSION });
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

let updateDownloaded = false;

app.whenReady().then(() => {
  setupPermissions();

  // 렌더러(preload)가 실측한 메뉴바 색 { effective, color, symbolColor }로 네이티브 타이틀바 오버레이 갱신
  ipcMain.on("rhwp-theme", (event, payload) => {
    if (showTopbar) return; // 네이티브 메뉴 모드는 오버레이 없음
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !shellWindows.has(win)) return; // 메인 창이 아닌 창의 보고는 무시
    try { win.setTitleBarOverlay(overlayFor(payload)); } catch {}
  });

  createWindow();

  autoUpdater.on("update-downloaded", () => {
    updateDownloaded = true;
  });

  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("window-all-closed", () => {
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

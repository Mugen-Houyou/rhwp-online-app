const { app, BrowserWindow, dialog, shell, Menu, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

const APP_ICON_URI = require("./icon.js");
const APP_VERSION = require("./package.json").version;

// 렌더러에 주입할 코드/마크업 — 모듈 로드 시 한 번 읽어 캐시 (다중 창마다 재읽기 불필요)
const TITLEBAR_JS  = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.js"), "utf8");
const TITLEBAR_CSS = fs.readFileSync(path.join(__dirname, "src/renderer-inject/titlebar.css"), "utf8");
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

const RHWP_URL = "https://edwardkim.github.io/rhwp/";
const RHWP_ORIGIN = "https://edwardkim.github.io";

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

function createWindow() {
  const winOptions = {
    width: 1280,
    height: 900,
    title: "RHWP",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  };

  // 타이틀바 통합: Windows 타이틀바 숨기고 메뉴바 우측에 창 컨트롤 오버레이
  if (!showTopbar) {
    winOptions.titleBarStyle = "hidden";
    winOptions.titleBarOverlay = {
      color: "#f5f5f5",       // 메뉴바 배경색 (--color-bg-light)
      symbolColor: "#333333", // 메뉴바 텍스트색 (--color-text)
      height: 27,             // 메뉴바 높이(28px) - border(1px)
    };
  }

  const win = new BrowserWindow(winOptions);

  // WASM 초기화 완료 감지 + 1초 안정화 지연 → 타이틀 바를 로딩 상태에서
  // 정상 상태로 전환. 모든 신호가 모인 뒤 추가로 READY_HOLD_MS만큼
  // "로드 중..." 텍스트를 더 노출. 10초 안전망도 함께 설치.
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
  win.webContents.on("console-message", (e) => {
    if (/WasmBridge.*초기화\s*완료/.test(e.message)) {
      scheduleReady();
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

  // 같은 출처 팝업은 앱 내 새 창으로, 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // 셸의 "새 창" 요청 (titlebar.js의 "새로 만들기" 가로채기) — 풀스택 새 창 생성
    if (frameName === "rhwp-shell-new-window") {
      setImmediate(() => {
        const newWin = createWindow();
        if (newWin.isMinimized()) newWin.restore();
        newWin.focus();
      });
      return { action: "deny" };
    }
    if (url.startsWith(RHWP_URL) || url.startsWith("about:blank")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 앱 내 네비게이션도 RHWP 출처로만 제한 — 외부 URL은 기본 브라우저로
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(RHWP_ORIGIN)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // 창 제목: "rhwp-studio" → "RHWP", 파일 열면 "파일명 - RHWP"
  win.on("page-title-updated", (event, title) => {
    event.preventDefault();
    win.setTitle(title.replace("rhwp-studio", "RHWP"));
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

  // 파일 다운로드(내보내기/저장) — 저장 대화상자 표시
  session.defaultSession.on("will-download", (event, item) => {
    // Electron 기본 동작: 저장 대화상자 표시 후 다운로드
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

    // 타이틀바·파일명 반영·About 메뉴 주입 — 자세한 동작은
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

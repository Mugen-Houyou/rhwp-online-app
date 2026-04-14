const { app, BrowserWindow, shell, Menu, session } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

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
  win.webContents.setWindowOpenHandler(({ url }) => {
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
      win.webContents.insertCSS(`
        /* 창 컨트롤 오버레이(최소화/최대화/닫기)와 겹치지 않도록 여백 확보 */
        #menu-bar {
          padding-right: 140px !important;
          -webkit-app-region: drag;
          position: relative !important;
        }
        /* 메뉴 항목은 클릭 가능해야 하므로 드래그 제외 */
        #menu-bar .menu-item {
          -webkit-app-region: no-drag;
        }
        /* VS Code 스타일 중앙 타이틀 표시 — left/right는 JS가
           메뉴 항목 실측 폭에 따라 동적으로 설정 */
        #rhwp-title-bar {
          position: absolute;
          top: 0;
          height: 27px;
          line-height: 27px;
          font-size: 12px;
          color: #555;
          text-align: center;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          pointer-events: none;
          -webkit-app-region: drag;
        }
      `);
    }

    // 상태바(#sb-message)를 감시해 파일명을 document.title과 메뉴바 중앙에 반영
    // — rhwp-studio가 자체적으로 document.title을 갱신하지 않기 때문
    const injectTitleBar = !showTopbar;
    win.webContents.executeJavaScript(`
      (() => {
        const sb = document.getElementById("sb-message");
        if (!sb) return;
        const DEFAULT = "HWP 파일을 선택해주세요.";
        const SEPARATOR = " \u2014 "; // " — "

        let titleEl = null;
        let menuBar = null;
        if (${injectTitleBar}) {
          menuBar = document.getElementById("menu-bar");
          if (menuBar) {
            titleEl = document.createElement("div");
            titleEl.id = "rhwp-title-bar";
            menuBar.appendChild(titleEl);
          }
        }

        // 메뉴 항목의 실제 우측 끝을 측정해 타이틀 바를 그 다음에 배치
        // 가용 폭이 부족하면 숨김
        const RESERVED_RIGHT = 160; // 창 컨트롤(140) + 여백(20)
        const MIN_GAP = 20;
        const MIN_WIDTH = 80;
        const reposition = () => {
          if (!titleEl || !menuBar) return;
          const menuBarRect = menuBar.getBoundingClientRect();
          const items = menuBar.querySelectorAll(".menu-item");
          let menuRight = menuBarRect.left;
          items.forEach((item) => {
            if (item === titleEl || titleEl.contains(item)) return;
            const r = item.getBoundingClientRect();
            if (r.right > menuRight) menuRight = r.right;
          });
          const leftPx = menuRight - menuBarRect.left + MIN_GAP;
          const availableWidth = menuBarRect.width - leftPx - RESERVED_RIGHT;
          if (availableWidth < MIN_WIDTH) {
            titleEl.style.display = "none";
          } else {
            titleEl.style.display = "";
            titleEl.style.left = leftPx + "px";
            titleEl.style.right = RESERVED_RIGHT + "px";
          }
        };

        const update = () => {
          const text = (sb.textContent || "").trim();
          let filename = "";
          if (text && text !== DEFAULT) {
            filename = text.split(SEPARATOR)[0].trim();
          }
          document.title = filename ? filename + " - rhwp-studio" : "rhwp-studio";
          if (titleEl) titleEl.textContent = filename;
        };
        update();
        reposition();
        new MutationObserver(update).observe(sb, {
          childList: true,
          characterData: true,
          subtree: true,
        });
        if (menuBar) {
          new ResizeObserver(reposition).observe(menuBar);
        }
      })();
    `);
  });

  win.loadURL(RHWP_URL);
}

app.whenReady().then(() => {
  setupPermissions();
  createWindow();
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

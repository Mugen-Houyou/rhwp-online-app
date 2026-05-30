// 렌더러 주입용 — main.js가 fs.readFileSync로 읽어 executeJavaScript로 호출한다.
// 단독 테스트: DevTools에 파일 내용을 그대로 붙여넣고
//   f({ injectTitleBar: true, version: "1.0.14" })
// 처럼 호출하면 동일하게 동작한다.
(cfg) => {
  const { injectTitleBar, version } = cfg;
  const LOADING_TEXT = "RHWP 로드 중...";
  const DEFAULT = "HWP 파일을 선택해주세요.";
  const SEPARATOR = " — "; // " — "

  let titleEl = null;
  let menuBar = null;
  if (injectTitleBar) {
    menuBar = document.getElementById("menu-bar");
    if (menuBar) {
      titleEl = document.createElement("div");
      titleEl.id = "rhwp-title-bar";
      titleEl.textContent = LOADING_TEXT;
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

  let ready = false;
  let lastFilename = "";
  const HWP_EXT = /\.(?:hwp|hwpx|hwt|hml|hwpml)$/i;
  const update = () => {
    if (!ready) {
      if (titleEl) titleEl.textContent = LOADING_TEXT;
      reposition();
      return;
    }
    const sb = document.getElementById("sb-message");
    const text = ((sb && sb.textContent) || "").trim();
    let filename = "";
    if (text && text !== DEFAULT) {
      const candidate = text.split(SEPARATOR)[0].trim();
      if (HWP_EXT.test(candidate)) {
        lastFilename = candidate;
      }
      filename = lastFilename;
    }
    document.title = filename ? filename + " - rhwp-studio" : "rhwp-studio";
    if (titleEl) titleEl.textContent = filename;
    reposition();
  };

  window.__rhwpSetReady = () => {
    if (ready) return;
    ready = true;
    const sb = document.getElementById("sb-message");
    if (sb) {
      new MutationObserver(update).observe(sb, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }
    update();
  };

  update();
  if (menuBar) {
    new ResizeObserver(reposition).observe(menuBar);
  }

  // "새로 만들기" 가로채기 — 이미 파일이 열린 상태라면 새 창에서 열기.
  // 파일이 없으면 그대로 통과시켜 업스트림이 현재 창에서 새 문서를 만들게 둔다.
  // HWPX 변환 중 #sb-message가 파일명이 아닌 상태 메시지를 표시하므로
  // 직접 조회 대신 update()가 관리하는 lastFilename 캐시를 사용한다.
  document.addEventListener("click", (e) => {
    const item = e.target.closest('.md-item[data-cmd="file:new-doc"]:not(.disabled)');
    if (!item) return;
    if (!lastFilename) return;
    // 파일 열림 → 업스트림 동작 차단 + 새 창
    e.stopImmediatePropagation();
    e.preventDefault();
    document.querySelectorAll("#menu-bar > .menu-item.open").forEach(m => m.classList.remove("open"));
    window.open(window.location.href, "rhwp-shell-new-window");
  }, true);

  // "제품 정보" 항목 뒤에 "RHWP Online 정보" 삽입
  if (!document.getElementById("rhwp-online-about")) {
    const aboutItem = document.querySelector('.md-item[data-cmd="file:about"]');
    if (aboutItem) {
      const onlineAbout = document.createElement("div");
      onlineAbout.id = "rhwp-online-about";
      onlineAbout.className = "md-item";
      onlineAbout.innerHTML = '<span class="md-icon icon-help"></span><span class="md-label">RHWP Online 정보</span>';
      aboutItem.after(onlineAbout);

      onlineAbout.addEventListener("click", (e) => {
        // 문서 레벨 메뉴 자동닫기 핸들러를 막고, 수동으로 닫는다.
        // (RHWP 커맨드 핸들러는 [data-cmd] 선택자라 우리 항목엔 매치되지 않음)
        e.stopPropagation();
        document.querySelectorAll("#menu-bar > .menu-item.open").forEach(m => m.classList.remove("open"));

        // 기존 다이얼로그가 열려 있으면 무시
        if (document.getElementById("rhwp-online-about-dialog")) return;

        const overlay = document.createElement("div");
        overlay.id = "rhwp-online-about-dialog";
        overlay.className = "modal-overlay";
        overlay.innerHTML = `
          <div class="dialog-wrap" style="width:400px">
            <div class="dialog-title">
              <span>RHWP Online 정보</span>
              <button class="dialog-close" id="rhwp-online-about-close">&times;</button>
            </div>
            <div class="about-body">
              <div class="about-product-name">RHWP Online</div>
              <div class="about-version">Version ${version}</div>
              <div class="about-notice" style="text-align:center">
                <div style="margin-bottom:8px"><strong>제작자</strong></div>
                <a href="#" id="rhwp-online-about-author"
                  style="color:#2c3e6b;text-decoration:underline">Mugen-Houyou</a>
              </div>
              <div class="about-notice" style="text-align:center">
                <div style="margin-bottom:8px"><strong>저장소</strong></div>
                <a href="#" id="rhwp-online-about-repo"
                  style="color:#2c3e6b;text-decoration:underline">
                  github.com/Mugen-Houyou/rhwp-online-app</a>
              </div>
              <div class="about-notice" style="text-align:left">
                <div style="margin-bottom:8px"><strong>라이선스</strong></div>
                <div>MIT License</div>
                <div style="margin-top:6px;font-size:12px;color:#888">
                  이 프로그램은 <a href="#" id="rhwp-online-about-upstream"
                    style="color:#2c3e6b;text-decoration:underline">edwardkim/rhwp</a>
                  웹 앱을 Electron으로 감싼 데스크톱 클라이언트입니다.
                </div>
              </div>
              <div class="about-copyright">&copy; ${new Date().getFullYear() > 2026 ? "2026-" + new Date().getFullYear() : "2026"} Mugen-Houyou</div>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        // 닫기
        const close = () => overlay.remove();
        overlay.querySelector("#rhwp-online-about-close").addEventListener("click", close);
        overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });

        // 링크 → 외부 브라우저 (Electron이 shell.openExternal로 처리)
        overlay.querySelector("#rhwp-online-about-author").addEventListener("click", (ev) => {
          ev.preventDefault();
          window.open("https://github.com/Mugen-Houyou", "_blank");
        });
        overlay.querySelector("#rhwp-online-about-repo").addEventListener("click", (ev) => {
          ev.preventDefault();
          window.open("https://github.com/Mugen-Houyou/rhwp-online-app", "_blank");
        });
        overlay.querySelector("#rhwp-online-about-upstream").addEventListener("click", (ev) => {
          ev.preventDefault();
          window.open("https://github.com/edwardkim/rhwp", "_blank");
        });
      });
    }
  }
}

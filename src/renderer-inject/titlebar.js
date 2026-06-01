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

  // ── 로컬 글꼴: 감지 결과를 창 간 공유(localStorage) + #font-name에 주입 ──
  // 업스트림은 "로컬 글꼴 감지하기"가 모듈 캐시(창 로컬·비영속)만 채우고
  // 드롭다운을 다시 그리지 않으며, 그 캐시는 새 창으로 전파되지 않는다.
  // 우리는 감지 결과를 localStorage(창 간 공유 세션)에 저장해두고, 각 창이
  // 읽어 #font-name에 "로컬 글꼴" optgroup을 주입한다. 표준 queryLocalFonts()
  // 는 사용자 제스처를 요구하므로 최초 1회는 감지 버튼 클릭이 필요하지만,
  // 이후 다른 창은 저장된 목록을 제스처 없이 재사용한다.
  const FONTS_KEY = "__rhwpShellLocalFonts";

  const getStoredFonts = () => {
    try {
      const a = JSON.parse(localStorage.getItem(FONTS_KEY) || "[]");
      return Array.isArray(a) ? a : [];
    } catch {
      return [];
    }
  };

  // #font-name에 "로컬 글꼴" optgroup 주입. 멱등 — 이미 있으면 no-op이라
  // MutationObserver 콜백에서 반복 호출해도 안전(루프 방지).
  const ensureLocalFonts = () => {
    const sel = document.getElementById("font-name");
    if (!sel || sel.querySelector('optgroup[label="로컬 글꼴"]')) return;
    // 대표 글꼴(value="__fontset__<이름>")과 동명인 항목은 제외(화면 중복 방지)
    const repNames = new Set(
      Array.from(sel.querySelectorAll('optgroup[label="대표 글꼴"] option'))
        .map((o) => o.value.replace(/^__fontset__/, ""))
    );
    const families = getStoredFonts().filter((f) => !repNames.has(f));
    if (!families.length) return;
    const group = document.createElement("optgroup");
    group.label = "로컬 글꼴";
    families.forEach((fam) => {
      const opt = document.createElement("option");
      opt.value = fam;       // populateLocalFontOptions와 동일 형식
      opt.textContent = fam; // → 선택 시 업스트림 change 핸들러가 동일 처리
      group.appendChild(opt);
    });
    // 업스트림과 동일하게 "대표 글꼴" optgroup 다음에 삽입(없으면 끝에)
    const rep = sel.querySelector('optgroup[label="대표 글꼴"]');
    sel.insertBefore(group, rep ? rep.nextSibling : null);
  };

  // ① 감지 버튼 클릭 → queryLocalFonts()로 조회해 localStorage 저장 후 주입.
  document.addEventListener("click", (e) => {
    // opt-fontset-btn 클래스는 "대표 글꼴 등록하기" 버튼과 공유되므로
    // 버튼 텍스트로 "로컬 글꼴 감지하기"를 구분한다(\s* 로 띄어쓰기 변형 허용).
    const btn = e.target.closest(".opt-fontset-btn");
    if (!btn || !/로컬\s*글꼴\s*감지/.test(btn.textContent || "")) return;
    if (typeof window.queryLocalFonts !== "function") return;
    // stopPropagation 금지: 업스트림 핸들러도 실행되어 자체 캐시·상태 라벨을
    // 갱신하게 둔다. queryLocalFonts()는 이 클릭 제스처 안에서 호출해야
    // 권한(user activation)이 유지되므로 setTimeout 등으로 지연하지 말 것.
    window.queryLocalFonts().then((fonts) => {
      const families = Array.from(
        new Set(fonts.map((f) => f.family).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b, "ko"));
      try {
        localStorage.setItem(FONTS_KEY, JSON.stringify(families));
      } catch {}
      // 갱신: 기존 optgroup 제거 후 저장 목록으로 다시 채움
      const sel = document.getElementById("font-name");
      if (sel) sel.querySelectorAll('optgroup[label="로컬 글꼴"]').forEach((g) => g.remove());
      ensureLocalFonts();
    }).catch(() => {}); // 권한 거부/취소 등 — 업스트림 핸들러가 상태 라벨로 피드백
  }, true);

  // ② #font-name은 정적 노드. initFontDropdown이 문서 열기 시 replaceChildren로
  // 드롭다운을 비우므로, childList를 감시해 우리 optgroup을 재주입한다.
  // 업스트림 초기화 연쇄(replaceChildren→대표 글꼴 주입→…)가 안정된 뒤
  // 1회만 채우도록 짧게 debounce — 대표 글꼴 제외 정확도 + 옵저버 루프 방지.
  const fontSel = document.getElementById("font-name");
  if (fontSel) {
    let pending = false;
    const schedule = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        ensureLocalFonts();
      }, 50);
    };
    new MutationObserver(schedule).observe(fontSel, { childList: true });
    schedule(); // ③ 시작 시: 다른 창이 저장해둔 목록이 있으면 즉시 반영
    // 이미 열린 다른 창에서 감지 시 실시간 반영(Electron 다중 창에서 발동 시)
    window.addEventListener("storage", (ev) => {
      if (ev.key === FONTS_KEY) ensureLocalFonts();
    });
  }

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
                <div>이 프로그램은 MIT License로 배포됩니다.</div>
                <div style="margin-top:6px;font-size:12px;color:#888">
                  <a href="#" id="rhwp-online-about-upstream"
                    style="color:#2c3e6b;text-decoration:underline">edwardkim/rhwp</a>
                  웹 앱을 Electron으로 감싼 데스크톱 클라이언트입니다.
                  원본 웹 앱과 로고의 저작권은 Edward Kim(&copy; ${new Date().getFullYear() > 2025 ? "2025-" + new Date().getFullYear() : "2025"})에게 있으며,
                  원본 또한 MIT License로 제공됩니다.
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

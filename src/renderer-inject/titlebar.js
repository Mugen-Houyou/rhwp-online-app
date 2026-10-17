// 렌더러 주입용 — main.js가 fs.readFileSync로 읽어 executeJavaScript로 호출한다.
// 단독 테스트: DevTools에 파일 내용을 그대로 붙여넣고
//   f({ injectTitleBar: true, version: "1.0.23" })
// 처럼 호출하면 동일하게 동작한다.
(cfg) => {
  const { injectTitleBar, version } = cfg;

  // 표시 문자열 — 업스트림이 <html lang>을 유효 로케일(ko|en)로 맞춘다(locale-init.js / i18n/dom.ts).
  // 현재 업스트림엔 언어 선택 UI가 없어 기본은 ko. 테마·스킨 라벨은 업스트림 레지스트리 라벨을 우선 쓰고
  // 아래 값은 폴백(업스트림 ko/en 카탈로그와 같은 단어).
  const lang = (document.documentElement.lang || "ko").toLowerCase().startsWith("en") ? "en" : "ko";
  const T = {
    ko: {
      loading: "RHWP 로드 중...",
      about: "RHWP Online 정보",
      author: "제작자",
      repo: "저장소",
      license: "라이선스",
      licenseText: "이 프로그램은 MIT License로 배포됩니다.",
      upstreamNote: "웹 앱을 Electron으로 감싼 데스크톱 클라이언트입니다. 원본 웹 앱과 로고의 저작권은 Edward Kim에게 있으며, 원본 또한 MIT License로 제공됩니다.",
      tab: "외관 및 UI",
      theme: "테마",
      themeDesc: "앱 전체의 밝기 테마입니다. 선택 즉시 적용되며 창 컨트롤 색도 함께 바뀝니다.",
      skin: "스킨",
      skinDesc: "메뉴·도구 상자 등 UI의 모양새입니다. 선택 즉시 적용됩니다.",
      modes: { system: "시스템 설정", light: "밝게", dark: "어둡게" },
      skins: { default: "클래식", flat: "모던", oldschool: "올드스쿨" },
    },
    en: {
      loading: "Loading RHWP...",
      about: "About RHWP Online",
      author: "Author",
      repo: "Repository",
      license: "License",
      licenseText: "This program is distributed under the MIT License.",
      upstreamNote: "is the web app this desktop client wraps with Electron. The original web app and logo are copyright Edward Kim and are also provided under the MIT License.",
      tab: "Appearance",
      theme: "Theme",
      themeDesc: "Color theme for the whole app. Applied immediately; the window controls follow.",
      skin: "Skin",
      skinDesc: "Look of the menus and toolbars. Applied immediately.",
      modes: { system: "System", light: "Light", dark: "Dark" },
      skins: { default: "Classic", flat: "Modern", oldschool: "Old School" },
    },
  }[lang];

  let titleEl = null;
  let menuBar = null;
  if (injectTitleBar) {
    menuBar = document.getElementById("menu-bar");
    if (menuBar) {
      titleEl = document.createElement("div");
      titleEl.id = "rhwp-title-bar";
      titleEl.textContent = T.loading;
      menuBar.appendChild(titleEl);
    }
  }

  // 메뉴 항목의 실제 우측 끝을 측정해 타이틀 바를 그 다음에 배치. 우측 한계는 메뉴바 우측 명령 버튼
  // (#toolbox-basic-toggle 등 .menu-command) 중 가장 왼쪽 가장자리, 없으면 창 컨트롤 예약 폭.
  // 가용 폭이 부족하면 숨김
  const CONTROLS_RESERVED = 160; // 창 컨트롤(140) + 여백(20)
  const MIN_GAP = 20;
  const MIN_WIDTH = 80;
  const reposition = () => {
    if (!titleEl || !menuBar) return;
    const bar = menuBar.getBoundingClientRect();
    let menuRight = bar.left;
    menuBar.querySelectorAll(":scope > .menu-item").forEach((item) => {
      const r = item.getBoundingClientRect();
      if (r.right > menuRight) menuRight = r.right;
    });
    let rightLimit = bar.right - CONTROLS_RESERVED;
    menuBar.querySelectorAll(":scope > .menu-command").forEach((btn) => {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.left < rightLimit) rightLimit = r.left; // 숨겨진(폭 0) 버튼은 무시
    });
    const leftPx = menuRight - bar.left + MIN_GAP;
    const rightPx = bar.right - rightLimit + MIN_GAP;
    const availableWidth = bar.width - leftPx - rightPx;
    if (availableWidth < MIN_WIDTH) {
      titleEl.style.display = "none";
    } else {
      titleEl.style.display = "";
      titleEl.style.left = leftPx + "px";
      titleEl.style.right = rightPx + "px";
    }
  };

  // 타이틀 바 텍스트는 <title>에서 뽑는다. 업스트림 document-title.ts가 파일명 기준으로 직접 관리하므로
  // (저장 이름 변경 포함) 래퍼는 document.title을 쓰지 않고, main.js가 창 제목의 "rhwp-studio"만 "RHWP"로 바꾼다.
  let ready = false;
  let lastFilename = "";
  const HWP_EXT = /\.(?:hwp|hwpx|hwt|hml|hwpml)$/i;
  // 업스트림 제목: 문서 있음 → "파일명 - rhwp-studio", 없음 → "rhwp-studio",
  // PDF 인쇄 중엔 확장자 없는 basename을 잠시 노출(설치형 표시 모드면 접미사 없는 파일명도 가능)
  const filenameFromTitle = (title) => {
    const t = (title || "").trim();
    if (!t || t === "rhwp-studio") return "";
    const m = /^(.*) - rhwp-studio$/.exec(t);
    if (m) return m[1].trim();
    return HWP_EXT.test(t) ? t : lastFilename; // 인쇄용 basename 등 과도기 제목은 무시 → 마지막 값 유지
  };
  const update = () => {
    if (!titleEl) return;
    if (!ready) {
      titleEl.textContent = T.loading;
      reposition();
      return;
    }
    const next = filenameFromTitle(document.title);
    if (next === lastFilename && titleEl.textContent === next) return; // 변화 없으면 레이아웃 읽기 생략
    lastFilename = next;
    titleEl.textContent = next;
    reposition();
  };

  window.__rhwpSetReady = () => {
    if (ready) return;
    ready = true;
    const titleNode = document.querySelector("head > title") || document.head;
    new MutationObserver(update).observe(titleNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    update();
  };

  update();
  if (menuBar) {
    new ResizeObserver(reposition).observe(menuBar);
  }

  // v1.0.19–22가 쓰던 로컬 글꼴 공유 키 정리. 업스트림 0.8.x가 감지 결과를 직접 영속(rhwp-local-fonts)하고
  // #font-name 셀렉트 대신 자체 글꼴 메뉴를 쓰므로 래퍼 쪽 공유 코드는 제거됐다. (한 릴리스 뒤 삭제 가능)
  try { localStorage.removeItem("__rhwpShellLocalFonts"); } catch {}

  // ── 업스트림 호스트 API(window.rhwpStudio.automation) ──
  // main.ts 모듈 최상위에서 동기 할당되어 did-finish-load 시점엔 보통 존재한다.
  // 지연 초기화로 바뀌는 경우를 대비해 짧게 폴링한다.
  const automation = () => (window.rhwpStudio && window.rhwpStudio.automation) || null;
  const whenAutomationReady = (cb, timeoutMs = 15000) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const api = automation();
      if (api && typeof api.registerCommand === "function") {
        try { cb(api); } catch (e) { console.warn("[rhwp-shell] automation 연동 실패:", e); }
        return;
      }
      if (Date.now() > deadline) {
        console.warn("[rhwp-shell] rhwpStudio.automation 을 찾지 못했습니다.");
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  };

  // ── "RHWP Online 정보" — 커맨드 등록 + 파일 메뉴 항목(업스트림 "제품 정보" 바로 뒤) ──
  const ABOUT_CMD = "ext:rhwp-online:about";
  const year = new Date().getFullYear();
  const copyrightYears = year > 2026 ? "2026-" + year : "2026";

  const openAboutDialog = () => {
    // 기존 다이얼로그가 열려 있으면 무시
    if (document.getElementById("rhwp-online-about-dialog")) return;

    const overlay = document.createElement("div");
    overlay.id = "rhwp-online-about-dialog";
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <style>
        /* 링크색은 업스트림 테마 토큰을 사용 — 라이트(#2563eb)/다크(#8bb8ff)를
           data-theme-effective에 따라 자동 적용. 업스트림도 다이얼로그 링크에 동일 토큰을 쓴다. */
        #rhwp-online-about-dialog a {
          color: var(--ui-link, #2563eb);
          text-decoration: underline;
        }
      </style>
      <div class="dialog-wrap" style="width:400px">
        <div class="dialog-title">
          <span>${T.about}</span>
          <button class="dialog-close" id="rhwp-online-about-close">&times;</button>
        </div>
        <div class="about-body">
          <div class="about-product-name">RHWP Online</div>
          <div class="about-version">Version ${version}</div>
          <div class="about-notice" style="text-align:center">
            <div style="margin-bottom:8px"><strong>${T.author}</strong></div>
            <a href="https://github.com/Mugen-Houyou" target="_blank" rel="noopener noreferrer">Mugen-Houyou</a>
          </div>
          <div class="about-notice" style="text-align:center">
            <div style="margin-bottom:8px"><strong>${T.repo}</strong></div>
            <a href="https://github.com/Mugen-Houyou/rhwp-online-app" target="_blank" rel="noopener noreferrer">
              github.com/Mugen-Houyou/rhwp-online-app</a>
          </div>
          <div class="about-notice" style="text-align:left">
            <div style="margin-bottom:8px;text-align:center"><strong>${T.license}</strong></div>
            <div>${T.licenseText}</div>
            <div style="margin-top:6px;font-size:12px;color:var(--ui-text-muted, #888)">
              <a href="https://github.com/edwardkim/rhwp" target="_blank" rel="noopener noreferrer">edwardkim/rhwp</a>
              ${T.upstreamNote}
            </div>
          </div>
          <div class="about-copyright">&copy; ${copyrightYears} Mugen-Houyou</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // 업스트림 dialog.ts와 같은 방식: document 캡처 단계에서 키를 가로채 편집기 도달을 막고,
    // Escape/Enter로 닫는다. 닫히면 리스너를 해제하고, 마지막 모달이면 편집기 포커스 복원 이벤트를
    // 발행한다(업스트림 main.ts가 rhwp-modal-dialog-closed를 받아 inputHandler.focus()).
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        close();
        return;
      }
      e.stopPropagation();
      const editable = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (!editable) e.preventDefault();
    };
    const close = () => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (!document.querySelector(".modal-overlay")) {
        document.dispatchEvent(new Event("rhwp-modal-dialog-closed"));
      }
    };
    document.addEventListener("keydown", onKey, true);
    const closeBtn = overlay.querySelector("#rhwp-online-about-close");
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    closeBtn.focus(); // 포커스를 다이얼로그로 — 타이핑이 편집기로 새지 않게
    // 링크(<a target="_blank">)는 main.js의 창 정책이 외부 URL로 판정해 기본 브라우저로 보낸다
  };

  whenAutomationReady((api) => {
    api.registerCommand({
      id: ABOUT_CMD,
      label: T.about,
      icon: "icon-help",
      // 외부 자동화의 실행은 기본 거절(needs-dialog). 메뉴 클릭·커맨드 팔레트는 dispatcher 직행이라 영향 없음
      opensDialog: true,
      execute: () => openAboutDialog(),
    });
    // 파일 메뉴 마지막 항목이 "제품 정보" → bottom = 그 바로 뒤. 클릭·메뉴 닫기는 업스트림 MenuBar가 처리한다.
    api.addMenuItem({ menuId: "file", commandId: ABOUT_CMD, position: "bottom" });
    // 업스트림 insertMenuItem은 .md-icon을 그리지 않는다 — "제품 정보"와 같은 아이콘을 장식으로 앞에 붙인다
    // (.md-icon은 absolute 배치라 정렬엔 영향 없음)
    const item = document.querySelector(`#menu-bar .md-item[data-cmd="${ABOUT_CMD}"]`);
    if (item && !item.querySelector(".md-icon")) {
      const icon = document.createElement("span");
      icon.className = "md-icon icon-help";
      item.prepend(icon);
    }
  });

  // ── 환경 설정 다이얼로그에 "외관 및 UI" 탭 주입 ──
  // 업스트림 옵션 다이얼로그의 탭바 클릭 핸들러는 위임식("향후 탭 추가 대비", options-dialog.ts)이라
  // .dialog-tab / .dialog-tab-panel[data-tab]만 추가하면 탭 전환은 업스트림이 처리한다.
  // 테마·스킨 적용은 보기 메뉴와 같은 커맨드(view:theme-*, view:skin-*)를 automation.execute로 실행해
  // 업스트림 setThemeMode/setThemeSkin(적용+영속+메뉴 라디오 동기화)을 그대로 태운다 —
  // localStorage(rhwp-settings) 직접 수정은 업스트림 인메모리 설정과 어긋나 다음 저장 때 덮어써지므로 금지.
  const THEME_MODES = ["system", "light", "dark"];
  const THEME_SKINS = ["default", "flat", "oldschool"];

  // 라디오 라벨은 업스트림 레지스트리에서 가져와 보기 메뉴와 항상 같은 말을 쓴다(ko/en 자동). 없으면 폴백
  const commandLabel = (id, fallback) => {
    try {
      const api = automation();
      const cmd = api && api.listCommands().find((c) => c.id === id);
      return (cmd && cmd.label) || fallback;
    } catch {
      return fallback;
    }
  };
  const runCommand = (id) => {
    const api = automation();
    const r = api ? api.execute(id) : { ok: false, reason: "no-automation" };
    if (!r || !r.ok) console.warn("[rhwp-shell] 커맨드 실행 실패:", id, r);
  };

  const buildSection = (title, desc) => {
    const section = document.createElement("div");
    section.className = "dialog-section";
    const heading = document.createElement("div");
    heading.className = "dialog-section-title";
    heading.textContent = title;
    section.appendChild(heading);
    const p = document.createElement("p");
    p.className = "opt-desc";
    p.textContent = desc;
    section.appendChild(p);
    return section;
  };
  const addRadioGroup = (section, name, values, current, cmdPrefix, labels) => {
    values.forEach((value) => {
      const row = document.createElement("div");
      row.className = "dialog-row opt-row";
      const lab = document.createElement("label");
      lab.style.cursor = "pointer";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = name;
      radio.value = value;
      radio.checked = value === current;
      radio.addEventListener("change", () => runCommand(cmdPrefix + value));
      lab.appendChild(radio);
      lab.appendChild(document.createTextNode(" " + commandLabel(cmdPrefix + value, labels[value])));
      row.appendChild(lab);
      section.appendChild(row);
    });
  };

  const injectAppearanceTab = (optBody) => {
    const tabs = optBody.querySelector(".dialog-tabs");
    if (!tabs || tabs.querySelector('.dialog-tab[data-tab="rhwp-shell-appearance"]')) return;

    const tab = document.createElement("button");
    tab.className = "dialog-tab";
    tab.textContent = T.tab;
    tab.dataset.tab = "rhwp-shell-appearance";
    tabs.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "dialog-tab-panel opt-tab-panel";
    panel.dataset.tab = "rhwp-shell-appearance";

    // 현재 값은 <html data-theme-mode / data-theme-skin>에서 읽는다(theme.ts applyTheme가 관리; 기본 스킨은 속성 없음)
    const root = document.documentElement;
    const themeSection = buildSection(T.theme, T.themeDesc);
    addRadioGroup(themeSection, "rhwp-shell-theme-mode", THEME_MODES, root.dataset.themeMode || "system", "view:theme-", T.modes);
    panel.appendChild(themeSection);

    const skinSection = buildSection(T.skin, T.skinDesc);
    addRadioGroup(skinSection, "rhwp-shell-theme-skin", THEME_SKINS, root.dataset.themeSkin || "default", "view:skin-", T.skins);
    panel.appendChild(skinSection);

    optBody.appendChild(panel);
  };

  // 다이얼로그는 열릴 때마다 body 직속 .modal-overlay로 생성된다(dialog.ts show()).
  // childList만 감시(서브트리 제외)해 환경 설정 다이얼로그(.opt-body)일 때만 주입.
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.classList.contains("modal-overlay")) {
          const optBody = n.querySelector(".opt-body");
          if (optBody) injectAppearanceTab(optBody);
        }
      }
    }
  }).observe(document.body, { childList: true });
}

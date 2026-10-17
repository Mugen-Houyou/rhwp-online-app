// 메인 프로세스용 창 정책 — 팝업·네비게이션 가드와 타이틀바 오버레이 색.
// main.js가 require하고, 스모크 테스트도 같은 모듈을 require해 실물을 시험한다.
const { shell } = require("electron");

const RHWP_URL = "https://edwardkim.github.io/rhwp/";
const RHWP_ORIGIN = "https://edwardkim.github.io";

// 출처 비교는 startsWith 대신 URL 파서로 — "https://edwardkim.github.io.evil.com/…" 류 접두사 우회 차단.
// 경로도 /rhwp/ 아래로 한정(기존 startsWith(RHWP_URL)과 동등).
const isRhwpUrl = (url) => {
  try {
    const u = new URL(url);
    return u.origin === RHWP_ORIGIN && u.pathname.startsWith("/rhwp/");
  } catch {
    return false;
  }
};
const isBlank = (url) => /^about:blank(?:[?#]|$)/.test(url || "");

// 기본 브라우저로 넘길 수 있는 스킴만 — file:/javascript:/data: 등은 버린다
const openExternal = (url) => {
  try {
    const p = new URL(url).protocol;
    if (p === "https:" || p === "http:" || p === "mailto:") shell.openExternal(url).catch(() => {});
  } catch {}
};

// 테마별 폴백 오버레이 색(업스트림 --ui-bg-light / --ui-text). preload 실측값이 없을 때만 쓴다.
const OVERLAY_THEME = {
  light: { color: "#f5f5f5", symbolColor: "#333333" }, // 라이트: 메뉴바 bg / 텍스트
  dark:  { color: "#2b3037", symbolColor: "#eef1f5" }, // 다크:  메뉴바 bg / 텍스트
};
const HEX6 = /^#[0-9a-f]{6}$/i;
// preload 보고값 { effective, color?, symbolColor? } → setTitleBarOverlay 인자.
// 실측 색이 없거나(메뉴바 미생성·투명·파싱 실패) 형식이 틀리면 테마 기본표로 보완한다.
const overlayFor = (p) => {
  const base = OVERLAY_THEME[p && p.effective === "dark" ? "dark" : "light"];
  return {
    color: p && HEX6.test(p.color || "") ? p.color : base.color,
    symbolColor: p && HEX6.test(p.symbolColor || "") ? p.symbolColor : base.symbolColor,
    height: 27, // 메뉴바 높이(28px) - border(1px)
  };
};

// 창 하나(메인/자식)에 팝업·네비게이션 정책을 건다.
//  - 같은 출처(/rhwp/) 팝업(인쇄 미리보기 print.html)은 보이는 자식 창으로 허용
//  - about:blank 팝업(문서 하이퍼링크: open('about:blank') → opener가 location.replace(url))은
//    목적지를 아직 모르므로 숨긴 채 만들고, 첫 네비게이션의 출처로 판정한다:
//    같은 출처 → 표시 / 외부 → preventDefault + 기본 브라우저 + 창 파기 (사용자에겐 아무 창도 안 보임)
//  - 그 외 URL은 생성 거부 + 기본 브라우저
//  - 자식 창에도 같은 정책을 재귀 적용(did-create-window)
function attachShellPolicy(win, { hiddenBlank = false, blankTimeoutMs = 8000 } = {}) {
  const wc = win.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (isRhwpUrl(url)) return { action: "allow" };
    if (isBlank(url)) return { action: "allow", overrideBrowserWindowOptions: { show: false } };
    openExternal(url);
    return { action: "deny" };
  });

  // 창 생성은 window.open의 동기 IPC 안에서 끝나므로, opener의 location.replace가 도착하기 전에
  // 자식의 will-navigate 리스너가 걸린다(실측).
  wc.on("did-create-window", (child, details) => {
    attachShellPolicy(child, { hiddenBlank: isBlank(details.url), blankTimeoutMs });
  });

  const revealIfHidden = () => {
    if (hiddenBlank && !win.isDestroyed() && !win.isVisible()) win.show();
  };
  const dispose = () => setImmediate(() => { if (!win.isDestroyed()) win.destroy(); });

  // 메인 프레임 네비게이션 + 서버 리다이렉트 가드(event.url 사용 — 2번째 인자는 deprecated)
  const guard = (event) => {
    const url = event.url;
    if (isBlank(url)) return;
    if (isRhwpUrl(url)) {
      revealIfHidden();
      return;
    }
    event.preventDefault();
    openExternal(url);
    if (hiddenBlank) dispose();
  };
  wc.on("will-navigate", guard);
  wc.on("will-redirect", guard);

  if (hiddenBlank) {
    // 안전망: 끝내 어디로도 가지 않은 숨은 빈 창은 정리. 리스너보다 먼저 네비게이션이 끝난 경우
    // (미래 Electron 순서 변화)도 현재 URL의 출처로 뒤늦게 처리한다.
    const timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const url = wc.getURL();
      if (isRhwpUrl(url)) {
        revealIfHidden();
      } else {
        if (!isBlank(url)) openExternal(url);
        win.destroy();
      }
    }, blankTimeoutMs);
    win.once("closed", () => clearTimeout(timer));
  }
}

module.exports = { RHWP_URL, RHWP_ORIGIN, isRhwpUrl, isBlank, openExternal, OVERLAY_THEME, overlayFor, attachShellPolicy };

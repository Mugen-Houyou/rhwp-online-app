// 렌더러(격리 월드) preload — 메뉴바의 실제 배경/글자색을 읽어 메인에 전달한다.
// 메인은 이 값으로 네이티브 타이틀바 오버레이(최소화/최대화/닫기) 색을 맞춘다.
// macOS는 트래픽 라이트 색을 바꿀 수 없어, 함께 보내는 테마 모드(system|light|dark)로 네이티브 UI(메뉴·시트)의
// 밝기만 앱에 맞춘다(main.js → nativeTheme.themeSource).
// 업스트림은 <html data-theme-effective="light|dark">로 유효 테마를, <html data-theme-skin="flat|oldschool">
// (기본 스킨은 속성 없음)로 스킨을 표시하며, 스킨마다 #menu-bar 배경이 다르다. 그래서 고정 색표 대신
// getComputedStyle 실측값을 보내고, 메인은 실측값이 없을 때만 라이트/다크 기본표로 보완한다.
// contextIsolation=true라도 preload는 ipcRenderer와 DOM에 접근 가능하다.
const { ipcRenderer } = require("electron");

const THEME_MODES = new Set(["system", "light", "dark"]);
const hex2 = (n) => n.toString(16).padStart(2, "0");
// Chromium의 계산된 색은 "rgb(r, g, b)" / "rgba(r, g, b, a)"로 직렬화된다. 불투명한 색만 #rrggbb로.
function cssColorToHex(css) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css || "");
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) < 0.99) return null; // 투명/반투명 → 기본표에 맡김
  return "#" + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]);
}

function readOverlay() {
  const root = document.documentElement;
  const effective = root.getAttribute("data-theme-effective") === "dark" ? "dark" : "light";
  const modeAttr = root.getAttribute("data-theme-mode"); // theme-init.js / theme.ts가 system|light|dark로 유지
  const mode = THEME_MODES.has(modeAttr) ? modeAttr : "system";
  const bar = document.getElementById("menu-bar"); // preload 실행 시점(DOM 파싱 전)엔 없을 수 있다
  let color = null;
  let symbolColor = null;
  if (bar) {
    const barStyle = getComputedStyle(bar);
    color = cssColorToHex(barStyle.backgroundColor);
    const title = bar.querySelector(".menu-title"); // 메뉴 글자색 = 캡션 버튼 기호색
    symbolColor = cssColorToHex((title ? getComputedStyle(title) : barStyle).color);
  }
  return { effective, mode, color, symbolColor };
}

let lastKey = null;
function send() {
  const p = readOverlay();
  const key = `${p.effective}|${p.mode}|${p.color}|${p.symbolColor}`;
  if (key === lastKey) return; // 중복 전송 방지
  lastKey = key;
  ipcRenderer.send("rhwp-theme", p);
}

// 속성 변경 직후엔 스타일 재계산 전일 수 있어 다음 프레임에 읽고, 늦게 적용되는 스타일시트에
// 대비해 잠시 뒤 한 번 더 확인한다(값이 같으면 send가 걸러낸다).
let raf = 0;
let settle = 0;
function schedule() {
  cancelAnimationFrame(raf);
  clearTimeout(settle);
  raf = requestAnimationFrame(() => {
    send();
    settle = setTimeout(send, 400);
  });
}

function start() {
  const root = document.documentElement;
  if (!root) return; // 극히 이른 시점 방어
  // 테마·스킨 전환 경로를 모두 포착 — 메뉴 선택·OS 변경·초기 FOUC 적용(theme-init.js)
  new MutationObserver(schedule).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme-effective", "data-theme-skin", "data-theme-mode"],
  });
  send(); // 즉시: 메뉴바가 없어도 effective는 보내 라이트/다크 기본표로 먼저 보정
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedule, { once: true }); // #menu-bar 생성 후 실측
  } else {
    schedule();
  }
  window.addEventListener("load", schedule, { once: true }); // 스타일시트 적용 완료 뒤 최종 확인
}

// preload는 페이지 스크립트(테마 초기화 포함)보다 먼저 실행되므로,
// documentElement가 이미 있으면 즉시 옵저버를 걸어 최초 테마 설정도 포착한다.
if (document.documentElement) {
  start();
} else {
  document.addEventListener("DOMContentLoaded", start, { once: true });
}

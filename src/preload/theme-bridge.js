// 렌더러(격리 월드) preload — 웹앱의 현재 테마를 감지해 메인에 전달한다.
// 메인은 이 값으로 네이티브 타이틀바 오버레이(최소화/최대화/닫기) 색을 테마에 맞춘다.
// 업스트림은 <html>의 data-theme-effective="light|dark"로 유효 테마를 표시하며,
// 테마 전환(메뉴 선택·OS 변경·초기 FOUC 적용) 시 이 속성이 바뀐다.
// contextIsolation=true라도 preload는 ipcRenderer와 DOM에 접근 가능하다.
const { ipcRenderer } = require("electron");

let last = null;
function sendTheme() {
  const eff =
    document.documentElement.getAttribute("data-theme-effective") === "dark"
      ? "dark"
      : "light";
  if (eff === last) return; // 중복 전송 방지
  last = eff;
  ipcRenderer.send("rhwp-theme", eff);
}

function start() {
  const root = document.documentElement;
  if (!root) return; // 극히 이른 시점 방어
  // data-theme-effective 변화를 감시 — 모든 테마 전환 경로를 포착
  new MutationObserver(sendTheme).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme-effective"],
  });
  sendTheme(); // 현재값 즉시 전송
}

// preload는 페이지 스크립트(테마 초기화 포함)보다 먼저 실행되므로,
// documentElement가 이미 있으면 즉시 옵저버를 걸어 최초 테마 설정도 포착한다.
if (document.documentElement) {
  start();
} else {
  document.addEventListener("DOMContentLoaded", start, { once: true });
}

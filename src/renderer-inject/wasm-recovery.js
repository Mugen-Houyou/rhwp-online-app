// 렌더러 주입용 — WASM 초기화가 실패했을 때 main.js가 executeJavaScript로 호출한다.
//
// 배경: 업스트림은 main 푸시마다 GitHub Pages를 통째로 교체하므로 해시가 바뀐 옛 wasm 파일은 서버에서 사라진다.
// 그런데 업스트림 서비스 워커는 앱 셸(index/JS, 약 26MB)을 선캐시해 두고 wasm(약 12MB)은 30일짜리 런타임
// 캐시로만 다루므로, 재배포 뒤 첫 실행에서 "옛 셸 + 만료된 wasm 캐시" 조합이 되면 옛 해시의 wasm을
// 네트워크로 받으려다 404가 난다. 새 SW는 백그라운드로 설치되지만(skipWaiting + clientsClaim) 열린
// 페이지를 다시 불러오지는 않는다.
//
// 표시는 단계와 무관하게 하나다: 래퍼 타이틀바(titlebar.js가 그리는 메뉴바 가운데 글자)에 "RHWP 캐시 업데이트 중..."을
// 건다 — 시작 때 "RHWP 로딩 중..."이 보이던 바로 그 자리라 로딩의 연장처럼 읽힌다. 입력을 막지 않고 새 UI 요소도
// 만들지 않는다. (전체 화면 오버레이 → 우상단 토스트를 거쳐 여기로 왔다: 오버레이는 "영문 모를 빈 화면", 토스트는
// "눈에 안 띄어 로딩이 안 되는 줄 안다"는 피드백.) 문구 규칙은 titlebar.js 상단 참조.
//
// cfg: { attempt: 1 | 2, maxWaitMs?: number }
//  - attempt 1: SW 갱신을 기다린다. 새 SW가 있으면 update()는 설치(선캐시 내려받기)까지 끝나야 resolve되므로
//    느린 망에서는 분 단위가 걸릴 수 있다(상한 maxWaitMs, 기본 3분). 실제 reload는 main.js가 한다.
//  - attempt 2: 재로드로도 못 고친 경우. controllerchange를 한 번 구독해, 새 SW가 페이지를 넘겨받는 순간
//    스스로 reload한다. 상한 없음 — 아무리 느린 망이라도 설치가 끝나면 복구된다.
// 반환: "has-document"(문서가 열려 있어 중단) | "updated" | "no-sw" | "timeout" | "armed" | "reload-now"
(cfg) => new Promise((resolve) => {
  const attempt = (cfg && cfg.attempt) || 1;
  const maxWaitMs = (cfg && cfg.maxWaitMs) || 180000;

  // 방어: 이 실패 상태에서는 문서를 열 수 없지만, 만에 하나 문서가 있으면 절대 재로드하지 않는다.
  let hasDocument = false;
  try {
    const api = window.rhwpStudio && window.rhwpStudio.automation;
    hasDocument = !!(api && api.getContext && api.getContext().hasDocument);
  } catch {
    hasDocument = false; // WASM 미초기화 상태에서 getContext가 던지면 문서는 없는 것이다
  }
  if (hasDocument) {
    resolve("has-document");
    return;
  }

  const en = (document.documentElement.lang || "ko").toLowerCase().startsWith("en");
  const MESSAGE = en ? "Updating RHWP cache..." : "RHWP 캐시 업데이트 중...";

  // 타이틀바 상태 문구를 건다. titlebar.js가 아직 주입되기 전이면(드물게 실패 로그가 load 이벤트보다 먼저 올 수 있다)
  // 보류 값으로 남겨 두고, titlebar.js가 시작할 때 받아 간다. 페이지가 reload되면 함께 사라지므로 따로 치우지 않는다.
  if (typeof window.__rhwpShellStatus === "function") window.__rhwpShellStatus(MESSAGE);
  else window.__rhwpShellStatusPending = MESSAGE;

  let settled = false;
  let timer = 0;
  const done = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(value);
  };

  if (!("serviceWorker" in navigator)) {
    done("no-sw");
    return;
  }
  const sw = navigator.serviceWorker;
  sw.getRegistration().then((reg) => {
    if (!reg) {
      done("no-sw");
      return;
    }
    // 새 SW가 있으면 update()는 설치(선캐시 ≈26MB 내려받기)가 끝나야 resolve된다 — 느린 망에서 오래 걸리는
    // 구간이 바로 여기이므로, 1차 상한 타이머는 update() 앞에 건다.
    if (attempt === 1) timer = setTimeout(() => done("timeout"), maxWaitMs);
    return reg.update().catch(() => {}).then(() => {
      if (settled) return; // 상한에 걸려 이미 재로드 중
      const worker = reg.installing || reg.waiting;
      if (attempt >= 2) {
        // 갱신할 게 없거나 이미 넘겨받았다 → 마지막으로 한 번 더 재로드(main.js가 수행)
        if (!worker) {
          done("reload-now");
          return;
        }
        sw.addEventListener("controllerchange", () => location.reload(), { once: true });
        done("armed");
        return;
      }
      if (!worker) {
        done("updated");
        return;
      }
      // update()가 설치 도중 resolve된 경우(installing/waiting 존재) → 활성화까지 마저 기다린다
      worker.addEventListener("statechange", () => {
        if (worker.state === "activated" || worker.state === "redundant") done("updated");
      });
    });
  }).catch(() => done("no-sw"));
})

// 초안 릴리스 게시 — electron-builder가 CI에서 만든 draft를 제목·본문과 함께 공개로 전환한다.
// usage: ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe publish-release.js <owner/repo> <tag> <notes.md> [--username NAME]
//        (macOS: electron.exe 대신 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron)
// 자격증명: 저장된 GitHub 항목을 git credential fill로 읽는다(토큰은 절대 출력하지 않는다).
//   우선순위: GH_TOKEN/GITHUB_TOKEN 환경 변수 → --username → git config credential.https://github.com.username →
//   Git Credential Manager(Windows)에 저장된 계정 목록 → 사용자명 없이 자격증명 도우미(macOS osxkeychain 등)가 주는 항목.
//   초안이 보이는(푸시 권한 있는) 첫 항목을 쓴다.
// exit: 0 = 게시됨, 3 = 이미 게시돼 있음, 2 = 쓸 수 있는 자격증명 없음, 1 = 실패
const { execSync } = require("child_process");
const fs = require("fs");

const args = process.argv.slice(2);
const REPO = args[0];
const TAG = args[1];
const NOTES_PATH = args[2];
const userArgIdx = args.indexOf("--username");
const userArg = userArgIdx >= 0 ? args[userArgIdx + 1] : null;
if (!REPO || !TAG || !NOTES_PATH) {
  console.log("usage: publish-release.js <owner/repo> <tag> <notes.md> [--username NAME]");
  process.exit(1);
}
const NOTES = fs.readFileSync(NOTES_PATH, "utf8");

const sh = (cmd, input) => {
  try {
    return execSync(cmd, { input, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } }).trim();
  } catch { return ""; }
};
function candidateUsers() {
  const list = [];
  if (userArg) list.push(userArg);
  const pinned = sh("git config credential.https://github.com.username");
  if (pinned) list.push(pinned);
  for (const u of sh("git credential-manager github list").split(/\r?\n/)) if (u.trim()) list.push(u.trim());
  return [...new Set(list)];
}
function tokenFor(user) {
  // user가 없으면 도우미가 저장된 사용자명을 함께 돌려준다(osxkeychain)
  const out = sh("git credential fill", `protocol=https\nhost=github.com\n${user ? `username=${user}\n` : ""}\n`);
  const m = /^password=(.*)$/m.exec(out);
  return m ? m[1].trim() : null;
}
async function gh(token, path, init = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
      "User-Agent": "rhwp-online-app-cnpnr", "Content-Type": "application/json" },
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}

(async () => {
  let chosen = null;
  const candidates = [];
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (envToken) candidates.push({ user: "env:GH_TOKEN", token: envToken });
  for (const user of candidateUsers()) candidates.push({ user, token: tokenFor(user) });
  if (!candidates.length) candidates.push({ user: "credential-helper", token: tokenFor(null) });
  for (const { user, token } of candidates) {
    if (!token) { console.log(`[${user}] no stored token`); continue; }
    const rel = await gh(token, `/repos/${REPO}/releases?per_page=10`);
    const found = Array.isArray(rel.body) ? rel.body.find((x) => x.tag_name === TAG) : null;
    console.log(`[${user}] releases ${rel.status} | ${TAG}: ${found ? (found.draft ? "draft visible" : "already published") : "not visible"}`);
    if (found) { chosen = { user, token, found, all: rel.body }; break; }
  }
  if (!chosen) { console.log(`no stored credential can see release ${TAG} - leave it as a draft and publish by hand`); process.exit(2); }
  const { user, token, found, all } = chosen;
  if (!found.draft) { console.log("already published:", found.html_url); process.exit(3); }

  // 제목은 직전 공개 릴리스의 형식을 따른다: 그쪽이 태그 그대로면 태그, 'v' 없는 버전이면 버전
  const prev = all.find((x) => !x.draft && x.tag_name !== TAG);
  const version = TAG.replace(/^v/, "");
  let name = TAG;
  if (prev && prev.name === prev.tag_name.replace(/^v/, "")) name = version;
  else if (prev && prev.name === prev.tag_name) name = TAG;
  console.log(`draft id=${found.id} name='${found.name}' assets=[${(found.assets || []).map((a) => a.name).join(", ")}]`);
  console.log(`publishing as name='${name}' with ${NOTES.length}-char notes using [${user}]`);
  const res = await gh(token, `/repos/${REPO}/releases/${found.id}`, {
    method: "PATCH", body: JSON.stringify({ draft: false, name, body: NOTES }),
  });
  console.log(`PATCH ${res.status} draft=${res.body && res.body.draft} url=${res.body && res.body.html_url}`);
  process.exit(res.status === 200 && res.body && res.body.draft === false ? 0 : 1);
})().catch((e) => { console.log("error:", e && e.message); process.exit(1); });

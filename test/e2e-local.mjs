// [Define404] gyeonjeok-meo 로컬 통합 시험
// 준비: cd worker && npx wrangler d1 migrations apply gyeonjeok-meo --local && npx wrangler dev --var DEV_MODE:1
// 실행: node test/e2e-local.mjs http://localhost:8787
import assert from "node:assert/strict";

const BASE = process.argv[2] || "http://localhost:8787";
const RUN = Date.now().toString(36);
const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(["ok", name]);
  } catch (e) {
    results.push(["FAIL", name, e.message]);
  }
};

async function call(path, { method = "GET", token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function login(email, consentMarketing = false) {
  const s = await call("/api/auth/start", { method: "POST", body: { email, consentPrivacy: true, consentMarketing } });
  assert.equal(s.status, 200, s.text);
  assert.ok(s.json.devLink, "DEV_MODE 로그인 링크");
  const t = new URL(s.json.devLink).searchParams.get("t");
  const page = await call(`/auth/verify?t=${t}`);
  assert.equal(page.status, 200);
  const v = await fetch(`${BASE}/auth/verify`, { method: "POST", redirect: "manual", body: new URLSearchParams({ t }) });
  assert.equal(v.status, 303);
  const token = v.headers.get("X-Session-Token");
  assert.ok(token);
  const again = await fetch(`${BASE}/auth/verify`, { method: "POST", redirect: "manual", body: new URLSearchParams({ t }) });
  assert.equal(again.status, 400, "같은 링크는 두 번 쓸 수 없다");
  return token;
}

const quote = {
  taxMode: "general",
  vatIncluded: false,
  date: "2026-10-09",
  validUntil: "2026-11-08",
  supplier: { name: "가나 인테리어", owner: "홍길동", bizNo: "123-45-67891", address: "서울", phone: "010-0000-0000" },
  client: { name: "다라 카페" },
  items: [
    { name: "철거", spec: "1식", qty: 1, unitPrice: 800000 },
    { name: "목공", spec: "벽체", qty: 12.5, unitPrice: 85000 },
    { name: "도장", spec: "친환경", qty: 40, unitPrice: 15000 },
    { name: "조명", spec: "LED", qty: 8, unitPrice: 45000 },
    { name: "폐기물 처리", spec: "1톤", qty: 2, unitPrice: 180000 },
  ],
  notes: "부가세 별도",
};

let A, B, qid, slug, rid;

await step("가입 필수 동의 없으면 거절", async () => {
  const r = await call("/api/auth/start", { method: "POST", body: { email: "x@example.com", consentPrivacy: false } });
  assert.equal(r.status, 400);
});
await step("A 메일 로그인", async () => (A = await login(`owner-a-${RUN}@example.com`)));
await step("B 메일 로그인", async () => (B = await login(`owner-b-${RUN}@example.com`)));
await step("로그인 없이 저장하면 401", async () => {
  const r = await call("/api/quotes", { method: "POST", body: quote });
  assert.equal(r.status, 401);
});
await step("A 견적서 저장, 번호 YYYYMMDD-NNN", async () => {
  const r = await call("/api/quotes", { method: "POST", token: A, body: quote });
  assert.equal(r.status, 201, r.text);
  assert.match(r.json.number, /^\d{8}-\d{3}$/);
  assert.match(r.json.id, /^[A-Za-z0-9_-]{22}$/);
  qid = r.json.id;
  const r2 = await call("/api/quotes", { method: "POST", token: A, body: quote });
  const [d1, n1] = r.json.number.split("-");
  assert.equal(r2.json.number, `${d1}-${String(Number(n1) + 1).padStart(3, "0")}`, "같은 날 다음 번호");
});
await step("서버가 금액을 다시 계산", async () => {
  const r = await call(`/api/quotes/${qid}`, { token: A });
  assert.equal(r.status, 200);
  // 800,000 + 1,062,500 + 600,000 + 360,000 + 360,000 = 3,182,500 + 부가세 318,250
  assert.equal(r.json.total, 3_500_750);
});
await step("공유 링크 열기", async () => {
  const r = await call(`/q/${qid}`);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes("일금 삼백오십만칠백오십원정"));
  assert.ok(r.text.includes("data-accept"));
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
});
await step("인쇄용 페이지", async () => {
  const r = await call(`/q/${qid}/print`);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('class="doc"'));
});
await step("고객 수락, 두 번째는 이미 수락", async () => {
  const r = await call(`/api/quotes/${qid}/accept`, { method: "POST", body: { name: "김고객" } });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.acceptedAt);
  const r2 = await call(`/api/quotes/${qid}/accept`, { method: "POST", body: {} });
  assert.equal(r2.json.already, true);
  const page = await call(`/q/${qid}`);
  assert.ok(page.text.includes("수락한 견적서"));
});
await step("없는 견적서 수락은 404", async () => {
  const r = await call(`/api/quotes/AAAAAAAAAAAAAAAAAAAAAA/accept`, { method: "POST", body: {} });
  assert.equal(r.status, 404);
});
await step("A 사업자 정보, 견적 요청 페이지", async () => {
  const me = await call("/api/me", { token: A });
  slug = me.json.business.slug;
  assert.match(slug, /^[a-z0-9]{10}$/);
  const bad = await call("/api/business", { method: "PUT", token: A, body: { name: "가나 인테리어", bizNo: "123-45-67890" } });
  assert.equal(bad.status, 400, "틀린 사업자번호는 거절");
  const page = await call(`/r/${slug}`);
  assert.equal(page.status, 200);
  assert.ok(page.text.includes("가나 인테리어"));
});
await step("견적 요청: 동의 없으면 400, 있으면 접수", async () => {
  const no = await call(`/api/r/${slug}`, { method: "POST", body: { name: "손님", contact: "010-1111-2222", details: "주방 리모델링", consent: false } });
  assert.equal(no.status, 400);
  const ok = await call(`/api/r/${slug}`, { method: "POST", body: { name: "손님", contact: "010-1111-2222", details: "주방 리모델링 견적 부탁드립니다", consent: true } });
  assert.equal(ok.status, 200, ok.text);
});
await step("A 토큰으로 요청 목록 조회", async () => {
  const r = await call("/api/requests", { token: A });
  assert.equal(r.status, 200);
  assert.equal(r.json.requests.length, 1);
  rid = r.json.requests[0].id;
  const one = await call(`/api/requests/${rid}`, { token: A });
  assert.equal(one.status, 200);
});
await step("IDOR: B 토큰으로 A 의 요청·견적서를 읽거나 지울 수 없다", async () => {
  const list = await call("/api/requests", { token: B });
  assert.equal(list.json.requests.length, 0);
  assert.equal((await call(`/api/requests/${rid}`, { token: B })).status, 404);
  assert.equal((await call(`/api/requests/${rid}`, { method: "DELETE", token: B })).status, 404);
  assert.equal((await call(`/api/quotes/${qid}`, { token: B })).status, 404);
  assert.equal((await call(`/api/quotes/${qid}`, { method: "DELETE", token: B })).status, 404);
  assert.equal((await call(`/api/quotes`, { token: B })).json.quotes.length, 0);
  assert.equal((await call(`/api/requests/${rid}`, { token: A })).status, 200, "A 의 요청은 그대로");
});
await step("토큰 없이 요청 목록은 401, 가짜 토큰도 401", async () => {
  assert.equal((await call("/api/requests")).status, 401);
  assert.equal((await call("/api/requests", { token: "x".repeat(43) })).status, 401);
});
await step("다른 사이트에서 보낸 쓰기 요청은 403", async () => {
  const r = await call(`/api/r/${slug}`, { method: "POST", headers: { Origin: "https://evil.example" }, body: { name: "a", contact: "b", details: "c", consent: true } });
  assert.equal(r.status, 403);
});
await step("가입 없이 인쇄용 문서 렌더", async () => {
  const r = await call("/api/render", { method: "POST", body: { ...quote, client: { name: "<script>alert(1)</script>" } } });
  assert.equal(r.status, 200);
  assert.ok(r.text.includes("&lt;script&gt;"));
  assert.ok(!r.text.includes("<script>alert(1)"));
});
await step("광고 수신 동의: 기본 꺼짐, 켜고 끄기, 처리 결과 메일", async () => {
  const me = await call("/api/me", { token: B });
  assert.equal(me.json.marketing, false, "체크하지 않으면 꺼져 있다");
  const on = await call("/api/me/marketing", { method: "POST", token: B, body: { consent: true } });
  assert.equal(on.json.marketing, true);
  assert.equal(on.json.noticeSent, true);
  assert.ok(on.json.marketingAt);
  assert.equal((await call("/api/me", { token: B })).json.marketing, true);
  const off = await call("/api/me/marketing", { method: "POST", token: B, body: { consent: false } });
  assert.equal(off.json.marketing, false);
  assert.equal(off.json.noticeSent, true, "철회도 결과를 알린다");
  const again = await call("/api/me/marketing", { method: "POST", token: B, body: { consent: false } });
  assert.equal(again.json.noticeSent, false, "이미 꺼져 있으면 메일을 다시 보내지 않는다");
});
await step("광고 수신 동의(가입 때 체크): 메일 링크로 로그인을 마쳐야 켜진다", async () => {
  const email = `owner-c-${RUN}@example.com`;
  const s = await call("/api/auth/start", { method: "POST", body: { email, consentPrivacy: true, consentMarketing: true } });
  assert.equal(s.status, 200, s.text);
  const C = await login(email, true);
  assert.equal((await call("/api/me", { token: C })).json.marketing, true, "로그인을 마치면 켜진다");
  await call("/api/me/marketing", { method: "POST", token: C, body: { consent: false } });
  // 남이 C 의 메일 주소로 동의를 체크해 로그인 메일만 요청한다
  const x = await call("/api/auth/start", { method: "POST", body: { email, consentPrivacy: true, consentMarketing: true } });
  assert.equal(x.status, 200, x.text);
  assert.equal((await call("/api/me", { token: C })).json.marketing, false, "링크를 쓰지 않으면 동의가 켜지지 않는다");
});
await step("수신 거부 링크: 잘못된 토큰은 404", async () => {
  assert.equal((await call(`/m/off?t=${"x".repeat(43)}`)).status, 404);
  assert.equal((await call("/m/off")).status, 404);
});
await step("동의 문구: 목적, 항목, 보유 기간, 거부권", async () => {
  const r = await call(`/r/${slug}`);
  for (const s of ["수집 목적", "수집 항목", "보유·이용 기간", "동의하지 않으셔도 됩니다"]) assert.ok(r.text.includes(s), s);
  const idx = await call("/");
  for (const s of ["수집 목적", "보유·이용 기간", "광고성 정보 수신 동의 (선택)", "동의하지 않으셔도 견적냥의 모든 기능"]) assert.ok(idx.text.includes(s), s);
  assert.ok(!/name="consentMarketing"[^>]*checked/.test(idx.text), "광고 동의는 기본으로 체크되어 있지 않다");
});
await step("없는 요청 페이지 404", async () => {
  assert.equal((await call("/r/zzzzzzzzzz")).status, 404);
});

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed} 통과, ${failed} 실패`);
process.exit(failed ? 1 : 0);

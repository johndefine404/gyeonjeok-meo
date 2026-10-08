// [Define404] 서버가 그리는 페이지: 공유 견적서, 인쇄용 문서, 견적 요청, 로그인 확인
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { esc, normalizeQuote, renderQuoteHtml } from "../../../public/js/core.js";
import { consumeLoginToken } from "../lib/auth";
import { marketingActive } from "../lib/consent";
import { sendMarketingNotice, setMarketing } from "../lib/marketing";
import { notFoundPage, page } from "../lib/pages";
import { ID_RE, kstText, SLUG_RE, TOKEN_RE } from "../lib/util";
import { printPage } from "./api";

const pages = new Hono<AppEnv>();

async function loadQuote(db: D1Database, id: string) {
  if (!ID_RE.test(id)) return null;
  const row = await db
    .prepare("SELECT q.data, q.accepted_at, q.accepted_name, b.slug FROM quotes q JOIN businesses b ON b.id = q.business_id WHERE q.id = ?")
    .bind(id)
    .first<{ data: string; accepted_at: string | null; accepted_name: string | null; slug: string }>();
  if (!row) return null;
  return {
    q: normalizeQuote(JSON.parse(row.data)),
    acceptedAt: row.accepted_at ? kstText(row.accepted_at) : "",
    acceptedName: row.accepted_name ?? "",
    slug: row.slug,
  };
}

// 고객이 받는 공유 링크
pages.get("/q/:id", async (c) => {
  const r = await loadQuote(c.env.DB, c.req.param("id"));
  if (!r) return c.html(notFoundPage("견적서를 찾을 수 없습니다"), 404);
  const { q } = r;
  const acceptBox = r.acceptedAt
    ? `<p class="accept-done" data-accepted>${esc(r.acceptedAt)}에 수락한 견적서입니다.</p>`
    : `<form class="accept" data-accept="${esc(c.req.param("id"))}">
  <label>수락하는 분 성함 (선택)<input name="name" maxlength="40" autocomplete="name"></label>
  <button class="btn" type="submit">이 견적으로 수락</button>
  <p class="sub small">수락을 누르면 ${esc(q.supplier.name)}에 수락 시각이 전달됩니다. 계약이나 결제가 진행되지는 않습니다.</p>
  <p class="sub small">성함은 적지 않아도 수락할 수 있습니다. 적으시면 수락 기록으로 이 견적서와 함께 보관되고, ${esc(q.supplier.name)}이(가) 견적서를 지우거나 탈퇴할 때 함께 지워집니다.</p>
  <p class="msg" role="status"></p>
</form>`;
  return c.html(
    page({
      title: `${q.supplier.name} 견적서 ${q.number}`,
      css: ["/css/doc.css"],
      js: ["/js/share.js"],
      bodyClass: "share-page",
      body: `<header class="share-head wrap no-print">
  <div><p class="eyebrow">견적서 ${esc(q.number)}</p><h1 class="page-h">${esc(q.supplier.name)}에서 보낸 견적서</h1></div>
  <div class="share-actions"><a class="btn ghost" href="/q/${esc(c.req.param("id"))}/print">인쇄용으로 보기</a></div>
</header>
<main class="wrap share-main">
  <div class="sheet-scroll"><div class="sheet">${renderQuoteHtml(q, { acceptedAt: r.acceptedAt, acceptedName: r.acceptedName })}</div></div>
  <aside class="share-side no-print">${acceptBox}
  <p class="sub small">다른 견적도 받아 보고 싶다면 <a href="/r/${esc(r.slug)}">${esc(q.supplier.name)}에 견적 요청하기</a></p></aside>
</main>
<footer class="wrap made-with no-print"><a href="/">견적냥</a>으로 만든 문서입니다. 가입 없이 무료로 만들 수 있습니다.</footer>`,
    }),
  );
});

pages.get("/q/:id/print", async (c) => {
  const r = await loadQuote(c.env.DB, c.req.param("id"));
  if (!r) return c.html(notFoundPage("견적서를 찾을 수 없습니다"), 404);
  return c.html(printPage(r.q, { acceptedAt: r.acceptedAt, acceptedName: r.acceptedName }));
});

// 사업자별 견적 요청 페이지
pages.get("/r/:slug", async (c) => {
  const slug = c.req.param("slug");
  const b = SLUG_RE.test(slug)
    ? await c.env.DB.prepare("SELECT name, intro FROM businesses WHERE slug = ?").bind(slug).first<{ name: string; intro: string }>()
    : null;
  if (!b) return c.html(notFoundPage("견적 요청 페이지를 찾을 수 없습니다"), 404);
  return c.html(
    page({
      title: `${b.name} 견적 요청`,
      js: ["/js/request.js"],
      body: `<main class="wrap narrow request">
  <p class="eyebrow">견적 요청</p>
  <h1 class="page-h">${esc(b.name)}에 견적을 요청합니다</h1>
  <p class="sub">${esc(b.intro) || "필요한 작업과 일정, 예산을 적어 주시면 확인 후 견적서를 보내 드립니다."}</p>
  <form class="card form" data-request="${esc(slug)}">
    <label>이름 또는 회사명<input name="name" required maxlength="50" autocomplete="name"></label>
    <label>연락처 (전화 또는 메일)<input name="contact" required maxlength="100" autocomplete="email"></label>
    <label>요청 내용<textarea name="details" required maxlength="3000" rows="7" placeholder="예: 매장 간판 교체, 가로 3m, 11월 중 설치 희망"></textarea></label>
    <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    <fieldset class="consent">
      <legend>개인정보 수집·이용 동의 (필수)</legend>
      <p>수집 목적: 견적 상담과 회신</p>
      <p>수집 항목: 이름 또는 회사명, 연락처, 요청 내용. 요청 남용을 막으려고 접속 IP는 원문이 아닌 해시값으로만 둡니다</p>
      <p>받는 곳: ${esc(b.name)}</p>
      <p>보유·이용 기간: 접수일로부터 1년이 지나면 자동으로 지웁니다. 그 전에도 ${esc(b.name)}이(가) 지우거나 탈퇴하면 바로 지웁니다</p>
      <p>동의하지 않으셔도 됩니다. 다만 동의하지 않으면 이 페이지로 견적 요청을 보낼 수 없습니다.</p>
      <label class="check"><input type="checkbox" name="consent" required> 위 내용에 동의합니다</label>
    </fieldset>
    <button class="btn" type="submit">견적 요청 보내기</button>
    <p class="msg" role="status"></p>
  </form>
</main>
<footer class="wrap made-with"><a href="/">견적냥</a>으로 만든 요청 페이지입니다.</footer>`,
    }),
  );
});

// 광고 수신 거부 링크 (안내 메일 속). 누르면 바로 꺼진다. 비용·로그인 없이 한 번에 끝나야 한다 (정보통신망법 50조 4~6항)
async function marketingOff(c: Context<AppEnv>) {
  const t = c.req.query("t") ?? "";
  const acc = TOKEN_RE.test(t)
    ? await c.env.DB.prepare("SELECT id, email, marketing_consent, marketing_consent_at FROM accounts WHERE unsub_token = ?")
        .bind(t)
        .first<{ id: string; email: string; marketing_consent: number; marketing_consent_at: string | null }>()
    : null;
  if (!acc) return c.html(notFoundPage("수신 거부 링크가 올바르지 않습니다. 탈퇴했다면 이미 모든 정보가 지워졌습니다"), 404);
  if (marketingActive(acc.marketing_consent, acc.marketing_consent_at)) {
    const at = await setMarketing(c.env.DB, acc.id, false);
    const p = sendMarketingNotice(c.env, new URL(c.req.url).origin, acc, "withdraw", at).catch((e) => console.error("marketing notice", e));
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      /* 시험 환경 */
    }
  }
  return c.html(
    page({
      title: "광고 수신 거부",
      body: `<main class="wrap narrow"><h1 class="page-h">광고성 정보 수신을 껐습니다</h1>
<p class="sub">${esc(acc.email)} 주소로 ${esc(c.env.OPERATOR_NAME || "Define404")}의 광고 메일을 더 보내지 않습니다. 처리 결과는 메일로도 알려 드립니다. 로그인, 견적 요청·수락 알림 메일은 그대로 갑니다.</p>
<p><a class="btn ghost" href="/app.html">내 견적함</a></p></main>`,
    }),
  );
}
pages.get("/m/off", marketingOff);
pages.post("/m/off", marketingOff);

// 메일 링크를 열면 버튼을 한 번 더 누르게 한다 (메일 보안 검사기가 링크를 미리 열어 토큰을 써 버리지 않게)
pages.get("/auth/verify", (c) => {
  const t = c.req.query("t") ?? "";
  if (!TOKEN_RE.test(t)) return c.html(notFoundPage("로그인 링크가 올바르지 않습니다"), 400);
  return c.html(
    page({
      title: "로그인",
      body: `<main class="wrap narrow"><h1 class="page-h">로그인을 마칩니다</h1>
<form method="post" action="/auth/verify" class="card form"><input type="hidden" name="t" value="${esc(t)}"><button class="btn" type="submit">로그인</button></form></main>`,
    }),
  );
});

pages.post("/auth/verify", async (c) => {
  const f = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const ok = await consumeLoginToken(c, String((f as Record<string, unknown>).t ?? ""));
  if (!ok) return c.html(notFoundPage("로그인 링크가 만료됐거나 이미 쓰였습니다. 다시 요청해 주세요"), 400);
  return c.redirect("/app.html", 303);
});

export default pages;

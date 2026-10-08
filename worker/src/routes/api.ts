// [Define404] JSON API: 가입·로그인, 사업자 정보, 견적서 저장·공유·수락, 견적 요청
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { calcQuote, checkQuote, digitsOnly, normalizeQuote, renderQuoteHtml, validateBizNo, won } from "../../../public/js/core.js";
import { createLoginToken, logout, requireAccount } from "../lib/auth";
import { marketingActive } from "../lib/consent";
import { sendMail } from "../lib/mail";
import { sendMarketingNotice, setMarketing } from "../lib/marketing";
import { page } from "../lib/pages";
import { clean, EMAIL_RE, ID_RE, kstText, kstYmd, nowIso, randomId, randomSlug, sha256, SLUG_RE } from "../lib/util";

const api = new Hono<AppEnv>();

const body = async (c: { req: { json: () => Promise<unknown> } }) => {
  const b = await c.req.json().catch(() => null);
  return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
};

const origin = (url: string) => new URL(url).origin;

function later(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }, p: Promise<unknown>) {
  const safe = p.catch((e) => console.error("background", e));
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    /* 시험 환경 */
  }
}

/* ---------- 가입·로그인 ---------- */

api.post("/auth/start", async (c) => {
  const b = await body(c);
  const email = clean(b?.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: "메일 주소를 확인해 주세요" }, 400);
  if (b?.consentPrivacy !== true) return c.json({ error: "개인정보 수집·이용에 동의해 주세요 (필수)" }, 400);
  const marketing = b?.consentMarketing === true;
  const now = nowIso();
  const db = c.env.DB;

  let acc = await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>();
  if (!acc) {
    acc = { id: randomId() };
    await db
      .prepare("INSERT INTO accounts (id, email, privacy_consent_at, marketing_consent, created_at) VALUES (?, ?, ?, 0, ?)")
      .bind(acc.id, email, now, now)
      .run();
  } else {
    await db.prepare("UPDATE accounts SET privacy_consent_at = ? WHERE id = ?").bind(now, acc.id).run();
  }

  // 같은 메일로 1시간에 5번까지
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM login_tokens WHERE account_id = ? AND created_at > ?")
    .bind(acc.id, Date.now() - 3600_000)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) return c.json({ error: "로그인 메일을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요" }, 429);

  const token = await createLoginToken(db, acc.id);
  const link = `${origin(c.req.url)}/auth/verify?t=${token}`;
  const text = `아래 링크를 누르면 로그인됩니다. 20분 동안 한 번만 쓸 수 있습니다.\n\n${link}\n\n요청하지 않았다면 이 메일을 지워 주세요.`;
  await sendMail(c.env, email, `[${c.env.APP_NAME}] 로그인 링크`, text);

  // 광고성 정보 수신 동의(선택)는 체크했을 때만 켠다. 다시 체크하면 2년을 새로 센다.
  // 끄기는 내 견적함이나 안내 메일 속 링크로 한다 (로그인할 때마다 실수로 철회되지 않게)
  if (marketing) {
    const at = await setMarketing(db, acc.id, true);
    later(c, sendMarketingNotice(c.env, origin(c.req.url), { id: acc.id, email }, "consent", at));
  }
  const dev = c.env.DEV_MODE === "1" && !c.env.RESEND_API_KEY;
  return c.json({ ok: true, message: "메일로 로그인 링크를 보냈습니다", ...(dev ? { devLink: link } : {}) });
});

api.post("/auth/logout", async (c) => {
  await logout(c);
  return c.json({ ok: true });
});

/* ---------- 내 정보 ---------- */

type BizRow = {
  id: string;
  slug: string;
  name: string;
  owner: string;
  biz_no: string;
  address: string;
  phone: string;
  email: string;
  notify_email: string;
  intro: string;
};

const bizOf = (env: Env, accountId: string) =>
  env.DB.prepare("SELECT id, slug, name, owner, biz_no, address, phone, email, notify_email, intro FROM businesses WHERE account_id = ?")
    .bind(accountId)
    .first<BizRow>();

const bizJson = (b: BizRow, base: string) => ({
  slug: b.slug,
  name: b.name,
  owner: b.owner,
  bizNo: b.biz_no,
  address: b.address,
  phone: b.phone,
  email: b.email,
  notifyEmail: b.notify_email,
  intro: b.intro,
  requestUrl: `${base}/r/${b.slug}`,
});

api.get("/me", async (c) => {
  const a = c.get("account");
  if (!a) return c.json({ login: false });
  const b = await bizOf(c.env, a.id);
  const marketing = marketingActive(a.marketing_consent, a.marketing_consent_at);
  return c.json({
    login: true,
    email: a.email,
    marketing,
    marketingAt: marketing ? a.marketing_consent_at : null,
    business: b ? bizJson(b, origin(c.req.url)) : null,
  });
});

api.post("/me/marketing", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const on = (await body(c))?.consent === true;
  const was = marketingActive(a.marketing_consent, a.marketing_consent_at);
  const at = await setMarketing(c.env.DB, a.id, on);
  // 동의하거나 철회하면 처리 결과를 메일로 알린다 (정보통신망법 50조 7항)
  const notice = on || was;
  if (notice) later(c, sendMarketingNotice(c.env, origin(c.req.url), a, on ? "consent" : "withdraw", at));
  return c.json({ ok: true, marketing: on, marketingAt: on ? at : null, noticeSent: notice });
});

// 탈퇴: 계정, 사업자 정보, 견적서, 견적 요청을 모두 지운다
api.post("/me/delete", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  await c.env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(a.id).run();
  await logout(c);
  return c.json({ ok: true });
});

function readBusiness(b: Record<string, unknown>) {
  const v = {
    name: clean(b.name, 80),
    owner: clean(b.owner, 40),
    bizNo: digitsOnly(b.bizNo).slice(0, 10),
    address: clean(b.address, 160),
    phone: clean(b.phone, 40),
    email: clean(b.email, 120),
    notifyEmail: clean(b.notifyEmail, 254).toLowerCase(),
    intro: clean(b.intro, 500),
  };
  if (!v.name) return { error: "상호를 적어 주세요" };
  if (v.bizNo && !validateBizNo(v.bizNo)) return { error: "사업자등록번호가 맞지 않습니다" };
  if (v.notifyEmail && !EMAIL_RE.test(v.notifyEmail)) return { error: "알림 받을 메일 주소를 확인해 주세요" };
  return { v };
}

async function upsertBusiness(env: Env, accountId: string, v: NonNullable<ReturnType<typeof readBusiness>["v"]>) {
  const now = nowIso();
  const existing = await bizOf(env, accountId);
  if (existing) {
    await env.DB.prepare(
      "UPDATE businesses SET name=?, owner=?, biz_no=?, address=?, phone=?, email=?, notify_email=?, intro=?, updated_at=? WHERE id=?",
    )
      .bind(v.name, v.owner, v.bizNo, v.address, v.phone, v.email, v.notifyEmail, v.intro, now, existing.id)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO businesses (id, account_id, slug, name, owner, biz_no, address, phone, email, notify_email, intro, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(randomId(), accountId, randomSlug(), v.name, v.owner, v.bizNo, v.address, v.phone, v.email, v.notifyEmail, v.intro, now, now)
      .run();
  }
  return (await bizOf(env, accountId))!;
}

api.put("/business", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const r = readBusiness((await body(c)) ?? {});
  if (!r.v) return c.json({ error: r.error }, 400);
  const b = await upsertBusiness(c.env, a.id, r.v);
  return c.json({ ok: true, business: bizJson(b, origin(c.req.url)) });
});

/* ---------- 견적서 ---------- */

// 인쇄용 문서만 돌려준다 (저장하지 않음, 가입 불필요). JSON 또는 quote=<JSON> 폼 둘 다 받는다
api.post("/render", async (c) => {
  let raw: unknown = null;
  const type = c.req.header("Content-Type") || "";
  if (type.includes("application/json")) raw = await c.req.json().catch(() => null);
  else {
    const f = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    try {
      raw = JSON.parse(String((f as Record<string, unknown>).quote ?? "null"));
    } catch {
      raw = null;
    }
  }
  if (!raw) return c.json({ error: "견적 내용이 없습니다" }, 400);
  const q = normalizeQuote(raw);
  try {
    return c.html(printPage(q));
  } catch {
    return c.json({ error: "금액이 너무 큽니다" }, 400);
  }
});

export function printPage(q: ReturnType<typeof normalizeQuote>, opts: { acceptedAt?: string; acceptedName?: string } = {}) {
  return page({
    title: `견적서 ${q.number || ""} ${q.client.name}`.trim(),
    css: ["/css/doc.css"],
    js: ["/js/print.js"],
    bodyClass: "print-page",
    body: `<div class="print-bar no-print"><button class="btn" type="button" data-print>인쇄 또는 PDF로 저장</button><span class="sub">인쇄 창에서 "PDF로 저장"을 고르면 파일로 받을 수 있습니다.</span></div>
<div class="sheet-scroll"><div class="sheet">${renderQuoteHtml(q, opts)}</div></div>`,
  });
}

api.post("/quotes", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const q = normalizeQuote(await body(c));
  const errs = checkQuote(q);
  if (errs.length) return c.json({ error: errs[0], errors: errs }, 400);
  let totals;
  try {
    totals = calcQuote(q);
  } catch {
    return c.json({ error: "금액이 너무 큽니다" }, 400);
  }

  // 사업자 정보가 없으면 견적서의 공급자 정보로 만든다
  let biz = await bizOf(c.env, a.id);
  if (!biz) {
    const r = readBusiness({ ...q.supplier });
    if (!r.v) return c.json({ error: r.error }, 400);
    biz = await upsertBusiness(c.env, a.id, r.v);
  }

  // 견적 번호: YYYYMMDD-NNN (사업자별, 한국 날짜 기준)
  const ymd = kstYmd();
  const seq = await c.env.DB.prepare(
    "UPDATE businesses SET seq = CASE WHEN seq_date = ?1 THEN seq + 1 ELSE 1 END, seq_date = ?1 WHERE id = ?2 RETURNING seq",
  )
    .bind(ymd, biz.id)
    .first<{ seq: number }>();
  q.number = `${ymd}-${String(seq!.seq).padStart(3, "0")}`;

  const id = randomId();
  const total = q.taxMode === "general" ? totals.total : totals.sum;
  await c.env.DB.prepare(
    "INSERT INTO quotes (id, business_id, number, data, total, client_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, biz.id, q.number, JSON.stringify(q), total, q.client.name, nowIso())
    .run();
  return c.json({ ok: true, id, number: q.number, url: `${origin(c.req.url)}/q/${id}` }, 201);
});

api.get("/quotes", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.number, q.client_name, q.total, q.created_at, q.accepted_at FROM quotes q
     JOIN businesses b ON b.id = q.business_id WHERE b.account_id = ? ORDER BY q.created_at DESC LIMIT 200`,
  )
    .bind(a.id)
    .all();
  return c.json({ quotes: results });
});

// 내 견적서 한 건 (다른 계정의 견적서는 404)
api.get("/quotes/:id", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const row = await c.env.DB.prepare(
    `SELECT q.id, q.number, q.data, q.total, q.created_at, q.accepted_at, q.accepted_name FROM quotes q
     JOIN businesses b ON b.id = q.business_id WHERE q.id = ? AND b.account_id = ?`,
  )
    .bind(id, a.id)
    .first<Record<string, unknown>>();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ...row, data: JSON.parse(String(row.data)) });
});

api.delete("/quotes/:id", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const r = await c.env.DB.prepare("DELETE FROM quotes WHERE id = ? AND business_id IN (SELECT id FROM businesses WHERE account_id = ?)")
    .bind(id, a.id)
    .run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

// 고객이 공유 링크에서 "수락"을 누른다. 링크(=견적서 id)를 가진 사람만 할 수 있다
api.post("/quotes/:id/accept", async (c) => {
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const name = clean((await body(c))?.name, 40);
  const now = nowIso();
  const row = await c.env.DB.prepare(
    "UPDATE quotes SET accepted_at = ?, accepted_name = ? WHERE id = ? AND accepted_at IS NULL RETURNING business_id, number, client_name, total",
  )
    .bind(now, name || null, id)
    .first<{ business_id: string; number: string; client_name: string; total: number }>();
  if (!row) {
    const exists = await c.env.DB.prepare("SELECT accepted_at FROM quotes WHERE id = ?").bind(id).first<{ accepted_at: string }>();
    if (!exists) return c.json({ error: "not found" }, 404);
    return c.json({ ok: true, already: true, acceptedAt: kstText(exists.accepted_at) });
  }
  const to = await notifyAddress(c.env, row.business_id);
  if (to) {
    const text = [
      `견적서가 수락됐습니다.`,
      ``,
      `견적번호: ${row.number}`,
      `받는 분: ${row.client_name}${name ? ` (수락한 사람: ${name})` : ""}`,
      `금액: ${won(row.total)}원`,
      `수락 시각: ${kstText(now)} (한국 시간)`,
      ``,
      `${origin(c.req.url)}/q/${id}`,
    ].join("\n");
    later(c, sendMail(c.env, to, `[${c.env.APP_NAME}] 견적 수락: ${row.client_name} ${row.number}`, text));
  }
  return c.json({ ok: true, acceptedAt: kstText(now) });
});

async function notifyAddress(env: Env, businessId: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT b.notify_email, a.email FROM businesses b JOIN accounts a ON a.id = b.account_id WHERE b.id = ?")
    .bind(businessId)
    .first<{ notify_email: string; email: string }>();
  return r ? r.notify_email || r.email : null;
}

/* ---------- 견적 요청 (고객 -> 사업자) ---------- */

api.post("/r/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (!SLUG_RE.test(slug)) return c.json({ error: "not found" }, 404);
  const b = await body(c);
  if (!b) return c.json({ error: "잘못된 요청입니다" }, 400);
  if (b.website) return c.json({ ok: true }); // 봇이 채우는 숨은 칸
  const name = clean(b.name, 50);
  const contact = clean(b.contact, 100);
  const details = clean(b.details, 3000);
  if (!name || !contact || !details) return c.json({ error: "이름, 연락처, 요청 내용을 모두 적어 주세요" }, 400);
  if (b.consent !== true) return c.json({ error: "개인정보 수집·이용에 동의해 주세요" }, 400);

  const biz = await c.env.DB.prepare("SELECT id, name FROM businesses WHERE slug = ?").bind(slug).first<{ id: string; name: string }>();
  if (!biz) return c.json({ error: "not found" }, 404);

  const ipHash = await sha256(`gj-ip:${c.req.header("CF-Connecting-IP") || "local"}`);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const [byIp, byBiz] = await c.env.DB.batch<{ n: number }>([
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE business_id = ? AND created_at > ?").bind(biz.id, day),
  ]);
  if ((byIp.results[0]?.n ?? 0) >= 5 || (byBiz.results[0]?.n ?? 0) >= 100) {
    return c.json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요" }, 429);
  }

  const id = randomId();
  const now = nowIso();
  await c.env.DB.prepare("INSERT INTO requests (id, business_id, name, contact, details, consent_at, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, biz.id, name, contact, details, now, ipHash, now)
    .run();

  const to = await notifyAddress(c.env, biz.id);
  if (to) {
    const text = `새 견적 요청이 들어왔습니다.\n\n이름: ${name}\n연락처: ${contact}\n시각: ${kstText(now)} (한국 시간)\n\n${details}\n\n내 견적함: ${origin(c.req.url)}/app.html`;
    later(c, sendMail(c.env, to, `[${c.env.APP_NAME}] 새 견적 요청: ${name}`, text));
  }
  return c.json({ ok: true });
});

api.get("/requests", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.contact, r.details, r.created_at FROM requests r
     JOIN businesses b ON b.id = r.business_id WHERE b.account_id = ? ORDER BY r.created_at DESC LIMIT 200`,
  )
    .bind(a.id)
    .all();
  return c.json({ requests: results });
});

api.get("/requests/:id", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.contact, r.details, r.created_at FROM requests r
     JOIN businesses b ON b.id = r.business_id WHERE r.id = ? AND b.account_id = ?`,
  )
    .bind(id, a.id)
    .first();
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

api.delete("/requests/:id", async (c) => {
  const a = requireAccount(c);
  if (a instanceof Response) return a;
  const id = c.req.param("id");
  if (!ID_RE.test(id)) return c.json({ error: "not found" }, 404);
  const r = await c.env.DB.prepare("DELETE FROM requests WHERE id = ? AND business_id IN (SELECT id FROM businesses WHERE account_id = ?)")
    .bind(id, a.id)
    .run();
  return r.meta.changes ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
});

api.get("/config", (c) => c.json({ appName: c.env.APP_NAME, ctaUrl: c.env.CTA_URL }));

export default api;

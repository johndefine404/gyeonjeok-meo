// [Define404] 광고성 정보 수신 동의 저장, 수신 거부 링크, 처리 결과 안내 메일, 매일 정리 작업
import type { Env } from "../env";
import { marketingCutoffIso, marketingNotice, REQUEST_TTL_MS, UNVERIFIED_TTL_MS, type NoticeKind } from "./consent";
import { sendMail } from "./mail";
import { kstText, nowIso, randomId } from "./util";

/** 계정의 수신 거부 토큰. 없으면 만든다. 이 토큰으로는 수신 동의를 끄는 것만 할 수 있다 */
export async function unsubToken(db: D1Database, accountId: string): Promise<string> {
  const row = await db
    .prepare("UPDATE accounts SET unsub_token = COALESCE(unsub_token, ?) WHERE id = ? RETURNING unsub_token")
    .bind(randomId(32), accountId)
    .first<{ unsub_token: string }>();
  return row!.unsub_token;
}

/** 수신 동의를 켜거나 끄고 그 시각을 남긴다. 켤 때 남긴 시각부터 2년을 센다 */
export async function setMarketing(db: D1Database, accountId: string, on: boolean): Promise<string> {
  const at = nowIso();
  await db.prepare("UPDATE accounts SET marketing_consent = ?, marketing_consent_at = ? WHERE id = ?").bind(on ? 1 : 0, at, accountId).run();
  return at;
}

/** 동의·철회·만료 처리 결과를 메일로 알린다. 메일 키가 없으면 sendMail 이 로그에 남긴다 */
export async function sendMarketingNotice(env: Env, base: string, acc: { id: string; email: string }, kind: NoticeKind, at: string) {
  const offUrl = kind === "consent" && base ? `${base}/m/off?t=${await unsubToken(env.DB, acc.id)}` : undefined;
  const m = marketingNotice({
    kind,
    when: kstText(at),
    email: acc.email,
    app: env.APP_NAME,
    operator: env.OPERATOR_NAME || "Define404",
    contact: env.CTA_URL,
    appUrl: base ? `${base}/app.html` : "",
    offUrl,
  });
  await sendMail(env, acc.email, m.subject, m.text, { unsubscribeUrl: offUrl });
}

/**
 * 매일 정리 (wrangler.toml 의 cron, 한국 시간 오전 10시)
 * - 접수일로부터 1년 지난 견적 요청 삭제
 * - 7일 안에 로그인을 마치지 않은 가입 메일 주소 삭제
 * - 동의한 지 2년 지난 광고 수신 동의를 끄고 처리 결과 메일 발송
 */
export async function dailyCleanup(env: Env, now = Date.now()) {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM requests WHERE created_at < ?").bind(new Date(now - REQUEST_TTL_MS).toISOString()),
    db.prepare("DELETE FROM accounts WHERE verified_at IS NULL AND created_at < ?").bind(new Date(now - UNVERIFIED_TTL_MS).toISOString()),
  ]);
  const at = new Date(now).toISOString();
  const { results } = await db
    .prepare("UPDATE accounts SET marketing_consent = 0, marketing_consent_at = ? WHERE marketing_consent = 1 AND marketing_consent_at < ? RETURNING id, email")
    .bind(at, marketingCutoffIso(now))
    .all<{ id: string; email: string }>();
  const base = (env.APP_URL || "").replace(/\/+$/, "");
  for (const a of results) await sendMarketingNotice(env, base, a, "expired", at).catch((e) => console.error("marketing notice", e));
}

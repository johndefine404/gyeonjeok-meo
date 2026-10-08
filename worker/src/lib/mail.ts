// [Define404] 메일 발송: Gmail API(Google Workspace) 또는 Resend. 둘 다 없으면 로그에만 찍는다
// 고르는 순서: GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN 이 있으면 Gmail, 아니면 RESEND_API_KEY 가 있으면 Resend
import type { Env } from "../env";
import { b64url, buildMime, textToHtml } from "./mime";

export type MailOptions = {
  replyTo?: string;
  /** 수신 거부 링크. 있으면 List-Unsubscribe 와 List-Unsubscribe-Post(한 번 누르면 끝) 머리글을 붙인다 */
  unsubscribeUrl?: string;
};

export const mailProvider = (env: Env): "gmail" | "resend" | "log" =>
  env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN ? "gmail" : env.RESEND_API_KEY ? "resend" : "log";

export async function sendMail(env: Env, to: string, subject: string, text: string, opts: MailOptions = {}): Promise<void> {
  const provider = mailProvider(env);
  if (provider === "log") {
    console.log(`[mail skipped] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const html = textToHtml(text);
  const headers: Record<string, string> = {};
  if (opts.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${opts.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (provider === "gmail") {
    const raw = buildMime({ from: env.MAIL_FROM, to, subject, text, html, replyTo: opts.replyTo, headers });
    return gmailSend(env, raw);
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text, html, ...(opts.replyTo ? { reply_to: opts.replyTo } : {}), headers }),
  });
  if (!res.ok) throw new Error(`resend ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/* ---------- Gmail API ---------- */

// 액세스 토큰은 만료 1분 전까지 이 Worker 인스턴스 메모리에 둔다 (비밀값 원문은 두지 않는다)
let cached: { token: string; until: number; key: string } | null = null;

async function gmailAccessToken(env: Env): Promise<string> {
  const key = env.GMAIL_CLIENT_ID!;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`gmail token ${res.status} ${data.error ?? ""}`.trim());
  cached = { token: data.access_token, until: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000, key };
  return data.access_token;
}

async function gmailSend(env: Env, raw: string): Promise<void> {
  const send = (token: string) =>
    fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(raw) }),
    });
  let res = await send(await gmailAccessToken(env));
  if (res.status === 401) {
    // 토큰이 먼저 만료됐으면 한 번만 새로 받는다
    cached = null;
    res = await send(await gmailAccessToken(env));
  }
  if (!res.ok) throw new Error(`gmail send ${res.status} ${(await res.text()).slice(0, 200)}`);
}

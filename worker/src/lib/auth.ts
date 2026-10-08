// [Define404] 메일 로그인 링크 + 세션. 비밀번호는 쓰지 않는다. 토큰 원문은 저장하지 않고 해시만 둔다
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Account, AppEnv } from "../env";
import { randomId, sha256, TOKEN_RE } from "./util";

export const COOKIE = "gj_s";
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 20;

/** 쿠키 또는 Authorization: Bearer 로 계정을 찾는다 */
export async function loadAccount(c: Context<AppEnv>, next: Next) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer || getCookie(c, COOKIE);
  let account: Account | null = null;
  if (token && TOKEN_RE.test(token)) {
    const row = await c.env.DB.prepare(
      `SELECT a.id, a.email, a.marketing_consent FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
      .bind(await sha256(token), Date.now())
      .first<Account>();
    account = row ?? null;
  }
  c.set("account", account);
  await next();
}

export function requireAccount(c: Context<AppEnv>): Account | Response {
  const a = c.get("account");
  if (!a) return c.json({ error: "로그인이 필요합니다", login: true }, 401);
  return a;
}

/** 메일 로그인 링크 토큰을 만들고 원문을 돌려준다 */
export async function createLoginToken(db: D1Database, accountId: string): Promise<string> {
  const token = randomId(32);
  const now = Date.now();
  await db
    .prepare("INSERT INTO login_tokens (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(token), accountId, now + LOGIN_MINUTES * 60_000, now)
    .run();
  return token;
}

/** 링크 토큰을 한 번만 쓰고 세션 쿠키를 건다. 성공하면 true */
export async function consumeLoginToken(c: Context<AppEnv>, token: string): Promise<boolean> {
  if (!TOKEN_RE.test(token)) return false;
  const now = Date.now();
  const row = await c.env.DB.prepare(
    "UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING account_id",
  )
    .bind(now, await sha256(token), now)
    .first<{ account_id: string }>();
  if (!row) return false;
  const session = randomId(32);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(
      await sha256(session),
      row.account_id,
      now + SESSION_DAYS * 86_400_000,
      now,
    ),
    c.env.DB.prepare("UPDATE accounts SET verified_at = COALESCE(verified_at, ?) WHERE id = ?").bind(new Date().toISOString(), row.account_id),
    c.env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    c.env.DB.prepare("DELETE FROM login_tokens WHERE expires_at < ?").bind(now - 86_400_000),
  ]);
  setCookie(c, COOKIE, session, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: SESSION_DAYS * 86_400,
  });
  c.header("X-Session-Token", session); // 명령줄·API 사용자를 위해 (브라우저는 쿠키를 쓴다)
  return true;
}

export async function logout(c: Context<AppEnv>) {
  const token = getCookie(c, COOKIE) || c.req.header("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (token && TOKEN_RE.test(token)) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: "/" });
}

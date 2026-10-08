// [Define404] gyeonjeok-meo: 1인 사업자·소상공인·프리랜서용 한국형 견적서 생성기와 견적 요청 페이지
// 정적 화면(편집기, 내 견적함)은 ../public 에서 나가고, 이 Worker 는 API 와 공유·요청 페이지를 맡는다.
import { Hono } from "hono";
import type { AppEnv } from "./env";
import { loadAccount } from "./lib/auth";
import { notFoundPage } from "./lib/pages";
import api from "./routes/api";
import pages from "./routes/pages";

const app = new Hono<AppEnv>();

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

// 보안 헤더. 공유 링크 주소가 다른 사이트로 새지 않게 Referrer 를 막는다
app.use("*", async (c, next) => {
  await next();
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/auth/")) c.header("Cache-Control", "no-store");
  if (/^\/(q|r|auth)\//.test(c.req.path)) c.header("X-Robots-Tag", "noindex, nofollow");
});

// 접속자별 요청 제한
app.use("*", async (c, next) => {
  if (c.env.LIMITER && c.req.method !== "GET") {
    const key = c.req.header("CF-Connecting-IP") || "local";
    const { success } = await c.env.LIMITER.limit({ key });
    if (!success) return c.json({ error: "요청이 많습니다. 잠시 후 다시 시도해 주세요" }, 429);
  }
  await next();
});

// 다른 사이트에서 보낸 쓰기 요청은 받지 않는다 (쿠키 SameSite=Lax 에 더한 두 번째 방어)
app.use("*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const o = c.req.header("Origin");
    if (o && o !== new URL(c.req.url).origin) return c.json({ error: "origin not allowed" }, 403);
  }
  await next();
});

app.use("*", loadAccount);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/api", api);
app.route("/", pages);

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.html(notFoundPage(), 404)));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "잠시 후 다시 시도해 주세요" }, 500);
});

export default app;

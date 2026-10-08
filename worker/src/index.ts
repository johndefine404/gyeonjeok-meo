// [Define404] gyeonjeok-meo: 1인 사업자·소상공인·프리랜서용 한국형 견적서 생성기와 견적 요청 페이지
// 정적 화면(편집기, 내 견적함)은 ../public 에서 나가고, 이 Worker 는 API 와 공유·요청 페이지를 맡는다.
import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { loadAccount } from "./lib/auth";
import { dailyCleanup } from "./lib/marketing";
import { notFoundPage, privacyUrl, setPrivacyUrl } from "./lib/pages";
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
  setPrivacyUrl(privacyUrl(c.env));
  await next();
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  if (/^\/(api|auth|m)\//.test(c.req.path)) c.header("Cache-Control", "no-store");
  if (/^\/(q|r|auth|m)\//.test(c.req.path)) c.header("X-Robots-Tag", "noindex, nofollow");
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
    // Referrer-Policy: no-referrer 때문에 같은 사이트의 폼 전송(로그인 확인, 수신 거부)도 Origin 이 "null" 로 온다.
    // 이때는 브라우저가 붙이는 Sec-Fetch-Site 로 같은 사이트인지 본다
    if (o === "null") {
      if (c.req.header("Sec-Fetch-Site") !== "same-origin") return c.json({ error: "origin not allowed" }, 403);
    } else if (o && o !== new URL(c.req.url).origin) return c.json({ error: "origin not allowed" }, 403);
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

export default {
  fetch: app.fetch,
  // 매일 정리: 보관 기간이 지난 견적 요청·미인증 가입 정보 삭제, 2년 지난 광고 수신 동의 끄기 (wrangler.toml [triggers])
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(dailyCleanup(env));
  },
};

// [Define404] 서버가 그리는 페이지 (공유 견적서, 인쇄용 문서, 견적 요청, 로그인 확인) 공통 틀
import { esc } from "../../../public/js/core.js";

const PRETENDARD = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css";

export function page(opts: { title: string; body: string; css?: string[]; js?: string[]; bodyClass?: string; noindex?: boolean }): string {
  const css = ["/css/site.css", ...(opts.css ?? [])].map((h) => `<link rel="stylesheet" href="${h}">`).join("\n");
  const js = (opts.js ?? []).map((s) => `<script src="${s}" type="module"></script>`).join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
${opts.noindex !== false ? '<meta name="robots" content="noindex, nofollow">' : ""}
<meta name="referrer" content="no-referrer">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${PRETENDARD}">
${css}
</head>
<body class="${esc(opts.bodyClass ?? "")}">
${opts.body}
${js}
</body>
</html>`;
}

export function notFoundPage(msg = "찾을 수 없는 주소입니다"): string {
  return page({
    title: "찾을 수 없음",
    body: `<main class="wrap narrow"><h1 class="page-h">${esc(msg)}</h1><p class="sub">주소가 정확한지 확인해 주세요.</p><p><a class="btn" href="/">견적냥으로 가기</a></p></main>`,
  });
}

// [Define404] 메일 원문(RFC 5322 + MIME) 만들기. Gmail API 발송에 쓴다
// 이 파일은 다른 모듈을 가져오지 않는다 (node --test 가 바로 읽을 수 있게)

export type MailParts = {
  from: string; // "견적냥 <john@define404.com>" 또는 "john@define404.com"
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>; // List-Unsubscribe, List-Unsubscribe-Post 등
  date?: Date;
  messageId?: string;
};

const enc = new TextEncoder();

/** UTF-8 문자열을 표준 base64 로 */
export function b64(s: string | Uint8Array): string {
  const bytes = typeof s === "string" ? enc.encode(s) : s;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** base64url (패딩 없음). Gmail API 의 raw 값 */
export function b64url(s: string): string {
  return b64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 머리글 값: ASCII 면 그대로, 아니면 =?UTF-8?B?...?= (한 덩어리가 75자를 넘지 않게 나눈다) */
export function encodeWord(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const words: string[] = [];
  let chunk = "";
  for (const ch of s) {
    // 인코딩 전 39바이트면 base64 52자, 앞뒤 12자와 "Subject: " 를 더해도 한 줄 78자 안쪽
    if (enc.encode(chunk + ch).length > 39) {
      words.push(`=?UTF-8?B?${b64(chunk)}?=`);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(`=?UTF-8?B?${b64(chunk)}?=`);
  return words.join("\r\n ");
}

/** "이름 <주소>" 의 이름만 인코딩한다 */
export function encodeAddress(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!m) return addr.trim();
  const name = m[1].trim();
  if (!name) return `<${m[2]}>`;
  const shown = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeWord(name);
  return `${shown} <${m[2]}>`;
}

/** 주소만 뽑는다 ("이름 <a@b>" -> "a@b") */
export const addressOnly = (addr: string) => (addr.match(/<([^>]+)>/)?.[1] ?? addr).trim();

/** base64 본문은 76자마다 줄을 바꾼다 */
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trimEnd();

/** 머리글에 줄바꿈이 섞여 다른 머리글을 끼워 넣지 못하게 */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function rfc2822Date(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]}, ${p(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** multipart/alternative (text/plain + text/html, 둘 다 UTF-8 base64) 메일 원문 */
export function buildMime(m: MailParts): string {
  const domain = addressOnly(m.from).split("@")[1] || "localhost";
  const boundary = `alt_${randomHex(12)}`;
  const head: string[] = [
    `From: ${encodeAddress(oneLine(m.from))}`,
    `To: ${encodeAddress(oneLine(m.to))}`,
    `Subject: ${encodeWord(oneLine(m.subject))}`,
    `Date: ${rfc2822Date(m.date ?? new Date())}`,
    `Message-ID: ${m.messageId ?? `<${randomHex(16)}@${domain}>`}`,
    `MIME-Version: 1.0`,
  ];
  if (m.replyTo) head.push(`Reply-To: ${encodeAddress(oneLine(m.replyTo))}`);
  for (const [k, v] of Object.entries(m.headers ?? {})) {
    if (/^[A-Za-z0-9-]+$/.test(k)) head.push(`${k}: ${oneLine(v)}`);
  }
  head.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, `Content-Transfer-Encoding: base64`, ``, wrap76(b64(body))].join("\r\n");
  return [head.join("\r\n"), ``, part("text/plain", m.text), part("text/html", m.html), `--${boundary}--`, ``].join("\r\n");
}

/** 일반 글 메일을 HTML 로: 특수문자 이스케이프, 링크 걸기, 줄바꿈 유지 */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const body = esc(text)
    .replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
    .replace(/\r?\n/g, "<br>\n");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;color:#141414;word-break:keep-all">${body}</body></html>`;
}

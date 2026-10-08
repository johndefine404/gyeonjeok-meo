// [Define404] 메일 원문(MIME) 만들기 단위 시험: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMime, encodeAddress, encodeWord, textToHtml } from "../worker/src/lib/mime.ts";

const decodeWords = (h) =>
  h.replace(/\r\n /g, "").replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b) => Buffer.from(b, "base64").toString("utf8"));

function parse(raw) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers = {};
  for (const line of head.replace(/\r\n /g, " ").split("\r\n")) {
    const i = line.indexOf(":");
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { head, headers, body: rest.join("\r\n\r\n") };
}

function parts(raw) {
  const { headers, body } = parse(raw);
  const boundary = headers["content-type"].match(/boundary="([^"]+)"/)[1];
  return body
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((p) => {
      const [h, b] = p.replace(/^\r\n/, "").split("\r\n\r\n");
      return { type: h.match(/Content-Type: ([^;]+)/)[1], charset: /charset=UTF-8/.test(h), body: Buffer.from(b.replace(/\s+/g, ""), "base64").toString("utf8") };
    });
}

const base = {
  from: "견적냥 <john@define404.com>",
  to: "john@define404.com",
  subject: "[견적냥] 로그인 링크: 한글 제목이 길어도 제대로 나뉘는지 확인합니다",
  text: "아래 링크를 누르면 로그인됩니다.\n\nhttps://gyeonjeok.define404.com/auth/verify?t=abc&x=1",
  html: textToHtml("아래 링크를 누르면 로그인됩니다.\n\nhttps://gyeonjeok.define404.com/auth/verify?t=abc&x=1"),
};

test("한글 제목은 UTF-8 encoded word 로 인코딩되고 되돌리면 원문과 같다", () => {
  const raw = buildMime(base);
  const { head, headers } = parse(raw);
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m);
  assert.equal(decodeWords(headers.subject.replace(/ (?==\?UTF-8)/g, "")), base.subject);
  for (const line of head.split("\r\n")) assert.ok(line.length <= 78, `머리글 한 줄 78자 이하: ${line}`);
  assert.ok(/^[\x00-\x7f]*$/.test(raw), "원문은 ASCII 만");
});

test("보낸 사람 표시 이름도 인코딩하고 주소는 그대로 둔다", () => {
  const { headers } = parse(buildMime(base));
  assert.match(headers.from, /^=\?UTF-8\?B\?[^?]+\?= <john@define404\.com>$/);
  assert.equal(decodeWords(headers.from), "견적냥 <john@define404.com>");
  assert.equal(encodeAddress("Define404 <john@define404.com>"), '"Define404" <john@define404.com>');
  assert.equal(encodeAddress("john@define404.com"), "john@define404.com");
});

test("필수 머리글과 text/plain, text/html 두 부분이 모두 있다", () => {
  const raw = buildMime({ ...base, replyTo: "hello@define404.com", headers: { "List-Unsubscribe": "<https://x.test/m/off?t=1>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  const { headers } = parse(raw);
  for (const k of ["from", "to", "subject", "date", "message-id", "mime-version", "content-type", "reply-to", "list-unsubscribe", "list-unsubscribe-post"]) {
    assert.ok(headers[k], `${k} 머리글`);
  }
  assert.match(headers["content-type"], /^multipart\/alternative; boundary="/);
  assert.match(headers["message-id"], /^<[0-9a-f]+@define404\.com>$/);
  assert.match(headers.date, /^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
  const ps = parts(raw);
  assert.deepEqual(ps.map((p) => p.type), ["text/plain", "text/html"]);
  assert.ok(ps.every((p) => p.charset));
  assert.equal(ps[0].body, base.text);
  assert.match(ps[1].body, /<a href="https:\/\/gyeonjeok\.define404\.com\/auth\/verify\?t=abc&amp;x=1">/);
  assert.match(ps[1].body, /로그인됩니다\.<br>/);
});

test("머리글 줄바꿈으로 다른 머리글을 끼워 넣을 수 없다", () => {
  const { head } = parse(buildMime({ ...base, subject: "hi\r\nBcc: evil@example.com" }));
  assert.ok(!/^Bcc:/im.test(head));
});

test("ASCII 제목은 그대로 둔다", () => {
  assert.equal(encodeWord("Hello"), "Hello");
});

test("HTML 본문은 특수문자를 이스케이프한다", () => {
  assert.match(textToHtml("<script>x</script>"), /&lt;script&gt;/);
});

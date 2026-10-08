// [Define404] 광고성 정보 수신 동의 규칙 단위 시험: 2년 만료, 처리 결과 안내 메일 문구
import { test } from "node:test";
import assert from "node:assert/strict";
import { marketingActive, marketingCutoffIso, marketingNotice, MARKETING_TTL_MS } from "../worker/src/lib/consent.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-10-09T05:00:00Z");

test("수신 동의: 켜져 있고 2년이 안 지났을 때만 유효", () => {
  assert.equal(marketingActive(1, new Date(now - 30 * DAY).toISOString(), now), true);
  assert.equal(marketingActive(1, new Date(now - 729 * DAY).toISOString(), now), true);
  assert.equal(marketingActive(1, new Date(now - 732 * DAY).toISOString(), now), false, "2년 지나면 만료");
  assert.equal(marketingActive(0, new Date(now).toISOString(), now), false, "철회");
  assert.equal(marketingActive(1, null, now), false, "시각 없음");
  assert.equal(marketingCutoffIso(now), new Date(now - MARKETING_TTL_MS).toISOString());
});

const base = { when: "2026-10-09 14:05", email: "a@example.com", app: "견적냥", operator: "Define404", contact: "https://contact.define404.com", appUrl: "https://q.example.com/app.html" };

test("동의 안내 메일: 광고 표시 없음, 보낸 곳·연락처·수신 거부 링크", () => {
  const m = marketingNotice({ ...base, kind: "consent", offUrl: "https://q.example.com/m/off?t=x" });
  assert.equal(m.subject, "[견적냥] 광고성 정보 수신 동의 처리 결과");
  assert.ok(!m.subject.startsWith("(광고)"), "처리 결과 안내는 광고가 아니다");
  for (const s of ["동의하셨습니다", "2026-10-09 14:05", "a@example.com", "보낸 곳: Define404", "문의: https://contact.define404.com", "https://q.example.com/m/off?t=x", "2년", "비용은 들지 않습니다"]) {
    assert.ok(m.text.includes(s), s);
  }
});

test("철회·만료 안내 메일", () => {
  const w = marketingNotice({ ...base, kind: "withdraw" });
  assert.ok(w.text.includes("철회하셨습니다"));
  assert.ok(w.text.includes("보낸 곳: Define404"));
  const e = marketingNotice({ ...base, kind: "expired", appUrl: "" });
  assert.ok(e.text.includes("2년이 지나"));
  assert.ok(!e.text.includes("undefined"));
  assert.ok(!e.text.includes(": \n"));
});

test("문구에 엠대시가 없다", () => {
  for (const kind of ["consent", "withdraw", "expired"]) assert.ok(!marketingNotice({ ...base, kind }).text.includes(String.fromCharCode(0x2014)));
});

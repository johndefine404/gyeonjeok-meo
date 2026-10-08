// [Define404] gyeonjeok-meo 계산 모듈 단위 시험: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateBizNo,
  formatBizNo,
  toKoreanNumber,
  amountInWords,
  calcQuote,
  roundDiv,
  normalizeQuote,
  renderQuoteHtml,
} from "../public/js/core.js";

test("사업자등록번호: 올바른 번호", () => {
  // 공개된 법인 번호 3개 + 검증 규칙으로 만든 번호 1개 (123-45-67891)
  for (const n of ["124-81-00998", "220-81-62517", "1208147521", "123-45-67891"]) {
    assert.equal(validateBizNo(n), true, n);
  }
});

test("사업자등록번호: 틀린 번호", () => {
  for (const n of ["124-81-00999", "123-45-67890", "1234567890", "12345", "", "abc-de-fghij", "124-81-009981"]) {
    assert.equal(validateBizNo(n), false, n);
  }
});

test("사업자등록번호 형식", () => {
  assert.equal(formatBizNo("1248100998"), "124-81-00998");
});

test("한글 금액", () => {
  assert.equal(toKoreanNumber(0), "영");
  assert.equal(toKoreanNumber(10), "일십");
  assert.equal(toKoreanNumber(11), "일십일");
  assert.equal(toKoreanNumber(10000), "일만");
  assert.equal(toKoreanNumber(100010), "일십만일십");
  assert.equal(toKoreanNumber(1_000_000), "일백만");
  assert.equal(toKoreanNumber(123_456_789), "일억이천삼백사십오만육천칠백팔십구");
  assert.equal(toKoreanNumber(100_000_001), "일억일");
  assert.equal(toKoreanNumber(1_000_000_000_000), "일조");
  assert.equal(toKoreanNumber(1_000_200_030_004), "일조이억삼만사");
  assert.equal(toKoreanNumber("9999999999999999"), "구천구백구십구조구천구백구십구억구천구백구십구만구천구백구십구");
  assert.equal(amountInWords(1_000_000), "일금 일백만원정");
  assert.equal(amountInWords(0), "일금 영원정");
  assert.throws(() => toKoreanNumber(-1));
  assert.throws(() => toKoreanNumber("10000000000000000"));
  assert.throws(() => toKoreanNumber(1.5e16));
});

test("반올림 규칙", () => {
  assert.equal(roundDiv(15, 10, "floor"), 1);
  assert.equal(roundDiv(15, 10, "round"), 2);
  assert.equal(roundDiv(11, 10, "ceil"), 2);
  assert.equal(roundDiv(12345, 1, "floor", 10), 12340);
  assert.equal(roundDiv(12345, 1, "round", 100), 12300);
  assert.equal(roundDiv(12350, 1, "round", 100), 12400);
});

const base = (over = {}) => ({ taxMode: "general", vatIncluded: false, items: [], ...over });

test("부가세 별도", () => {
  const t = calcQuote(base({ items: [{ qty: 3, unitPrice: 33_333 }, { qty: 1, unitPrice: 1_005 }] }));
  assert.equal(t.supply, 101_004);
  assert.equal(t.vat, 10_100); // 10,100.4 절사
  assert.equal(t.total, 111_104);
});

test("부가세 별도: 반올림 설정", () => {
  const t = calcQuote(base({ items: [{ qty: 1, unitPrice: 105 }], rounding: { mode: "round", unit: 1 } }));
  assert.equal(t.vat, 11); // 10.5 반올림
});

test("부가세 포함", () => {
  const t = calcQuote(base({ vatIncluded: true, items: [{ qty: 1, unitPrice: 110_000 }] }));
  assert.equal(t.vat, 10_000);
  assert.equal(t.supply, 100_000);
  assert.equal(t.total, 110_000);
  const u = calcQuote(base({ vatIncluded: true, items: [{ qty: 1, unitPrice: 100_000 }] }));
  assert.equal(u.vat, 9_090); // 9,090.9 절사
  assert.equal(u.supply, 90_910);
  assert.equal(u.supply + u.vat, 100_000);
});

test("수량 소수", () => {
  const t = calcQuote(base({ items: [{ qty: 0.5, unitPrice: 33_333 }] }));
  assert.equal(t.lines[0], 16_666);
});

test("간이과세: 부가세 줄 없음", () => {
  const t = calcQuote(base({ taxMode: "simple", items: [{ qty: 2, unitPrice: 50_000 }] }));
  assert.equal(t.vat, 0);
  assert.equal(t.total, 100_000);
});

test("프리랜서 3.3% 원천징수", () => {
  const a = calcQuote(base({ taxMode: "freelancer", items: [{ qty: 1, unitPrice: 1_000_000 }] }));
  assert.deepEqual([a.incomeTax, a.localTax, a.withholding, a.net], [30_000, 3_000, 33_000, 967_000]);
  const b = calcQuote(base({ taxMode: "freelancer", items: [{ qty: 1, unitPrice: 1_234_567 }] }));
  // 소득세 37,037.01 -> 10원 미만 절사 37,030 / 지방소득세 3,703 -> 3,700
  assert.deepEqual([b.incomeTax, b.localTax, b.withholding, b.net], [37_030, 3_700, 40_730, 1_193_837]);
  const c = calcQuote(base({ taxMode: "freelancer", items: [{ qty: 1, unitPrice: 99_999 }] }));
  assert.deepEqual([c.incomeTax, c.localTax, c.net], [2_990, 290, 96_719]);
});

test("입력 정리: 직인은 서버에 남기지 않음, 이상값 차단", () => {
  const q = normalizeQuote({
    taxMode: "evil",
    supplier: { name: "<b>상호</b>", bizNo: "124-81-00998", seal: "data:image/png;base64,AAAA" },
    items: [{ name: "a", qty: "-5", unitPrice: "1e20" }, {}],
  });
  assert.equal(q.taxMode, "general");
  assert.equal(q.supplier.seal, "");
  assert.equal(q.items.length, 1);
  assert.equal(q.items[0].qty, 0);
  assert.equal(q.items[0].unitPrice, 100_000_000_000);
  const html = renderQuoteHtml(q);
  assert.ok(html.includes("&lt;b&gt;상호&lt;/b&gt;"));
  assert.ok(!html.includes("<b>상호"));
  const k = normalizeQuote({ supplier: { seal: 'data:image/png;base64,AA" onerror="x' } }, { keepSeal: true });
  assert.equal(k.supplier.seal, "");
});

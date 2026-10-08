// [Define404] gyeonjeok-meo 견적서 계산·표기·문서 렌더 공용 모듈
// 브라우저 편집기와 Worker(서버)가 같은 파일을 쓴다. 금액은 서버가 항상 다시 계산한다.

/* ---------- 사업자등록번호 ---------- */

const BIZ_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];

/** 숫자만 남긴다 */
export function digitsOnly(s) {
  return String(s ?? "").replace(/\D/g, "");
}

/** 사업자등록번호 검증번호(10번째 자리) 확인 */
export function validateBizNo(input) {
  const d = digitsOnly(input);
  if (d.length !== 10) return false;
  const n = [...d].map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * BIZ_WEIGHTS[i];
  sum += Math.floor((n[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === n[9];
}

/** 123-45-67890 형태로 */
export function formatBizNo(input) {
  const d = digitsOnly(input);
  if (d.length !== 10) return String(input ?? "");
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/* ---------- 한글 금액 ---------- */

const NUM = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const SMALL = ["", "십", "백", "천"];
const BIG = ["", "만", "억", "조"];
const MAX_WORDS = 10n ** 16n - 1n; // 9999조 9999억 9999만 9999

/**
 * 숫자를 한글 금액으로 (공문서 관행대로 십·백·천·만 앞의 "일"을 적는다: 일백만, 일십)
 * 0 이상 9999조 이하의 정수만 받는다.
 */
export function toKoreanNumber(value) {
  let n;
  try {
    n = typeof value === "bigint" ? value : BigInt(typeof value === "number" ? Math.trunc(value) : String(value).replace(/,/g, ""));
  } catch {
    throw new RangeError("정수만 바꿀 수 있습니다");
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new RangeError("범위를 벗어난 금액입니다");
  if (n < 0n || n > MAX_WORDS) throw new RangeError("범위를 벗어난 금액입니다");
  if (n === 0n) return "영";
  let out = "";
  for (let g = 3; g >= 0; g--) {
    const group = Number((n / 10000n ** BigInt(g)) % 10000n);
    if (group === 0) continue;
    let part = "";
    for (let p = 3; p >= 0; p--) {
      const digit = Math.floor(group / 10 ** p) % 10;
      if (digit) part += NUM[digit] + SMALL[p];
    }
    out += part + BIG[g];
  }
  return out;
}

/** "일금 일백이십삼만원정" */
export function amountInWords(value) {
  return `일금 ${toKoreanNumber(value)}원정`;
}

/** 1,234,567 */
export function won(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

/* ---------- 반올림 규칙 ---------- */

export const ROUND_MODES = ["floor", "round", "ceil"]; // 절사, 반올림, 절상
export const ROUND_UNITS = [1, 10, 100, 1000];

/** n / d 를 unit 단위로 맞춘다 (0 이상 정수). 정밀도를 위해 BigInt로 계산 */
export function roundDiv(n, d, mode = "floor", unit = 1) {
  const N = BigInt(n);
  const D = BigInt(d) * BigInt(unit);
  if (N < 0n || D <= 0n) throw new RangeError("음수는 계산하지 않습니다");
  let q = N / D;
  const r = N % D;
  if (mode === "ceil" && r > 0n) q += 1n;
  else if (mode === "round" && r * 2n >= D) q += 1n;
  return Number(q * BigInt(unit));
}

/* ---------- 견적 계산 ---------- */

export const TAX_MODES = {
  general: "일반과세",
  simple: "간이과세",
  freelancer: "프리랜서 사업소득 3.3%",
};

export const LIMITS = {
  items: 50,
  qty: 1_000_000,
  unitPrice: 100_000_000_000, // 1,000억
  total: 1_000_000_000_000_000, // 1,000조 (한글 표기와 안전한 정수 범위 안)
};

/**
 * 견적 금액 계산
 * - general + vatIncluded=false: 단가는 공급가액. 부가세 = 공급가액 x 10%
 * - general + vatIncluded=true:  단가는 부가세 포함가. 부가세 = 합계 x 10/110, 공급가액 = 합계 - 부가세
 * - simple: 부가세를 따로 적지 않는다 (간이과세자 가정, 세무 확인 필요)
 * - freelancer: 소득세 3%, 지방소득세 = 소득세의 10%. 둘 다 10원 미만 절사 (세무 확인 필요)
 */
export function calcQuote(q) {
  const mode = ROUND_MODES.includes(q?.rounding?.mode) ? q.rounding.mode : "floor";
  const unit = ROUND_UNITS.includes(Number(q?.rounding?.unit)) ? Number(q.rounding.unit) : 1;
  const lines = (q?.items ?? []).map((it) => {
    const q100 = Math.round(Number(it.qty || 0) * 100);
    const price = Math.trunc(Number(it.unitPrice || 0));
    return roundDiv(BigInt(q100) * BigInt(price), 100, mode, unit);
  });
  const sum = lines.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || sum > LIMITS.total) throw new RangeError("합계가 너무 큽니다");

  const out = { lines, sum, supply: sum, vat: 0, total: sum, incomeTax: 0, localTax: 0, withholding: 0, net: sum };
  const tax = q?.taxMode;
  if (tax === "general") {
    if (q.vatIncluded) {
      out.vat = roundDiv(sum, 11, mode, unit);
      out.supply = sum - out.vat;
      out.total = sum;
    } else {
      out.vat = roundDiv(sum, 10, mode, unit);
      out.total = sum + out.vat;
    }
    out.net = out.total;
  } else if (tax === "freelancer") {
    out.incomeTax = roundDiv(BigInt(sum) * 3n, 100, "floor", 10);
    out.localTax = roundDiv(out.incomeTax, 10, "floor", 10);
    out.withholding = out.incomeTax + out.localTax;
    out.net = sum - out.withholding;
  }
  return out;
}

/* ---------- 입력 정리 (서버는 받은 값을 이 함수로만 쓴다) ---------- */

const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SEAL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function normalizeQuote(input, { keepSeal = false } = {}) {
  const q = input && typeof input === "object" ? input : {};
  const s = q.supplier ?? {};
  const c = q.client ?? {};
  const items = Array.isArray(q.items) ? q.items.slice(0, LIMITS.items) : [];
  const out = {
    title: str(q.title, 60) || "견 적 서",
    number: str(q.number, 20),
    date: DATE.test(q.date) ? q.date : "",
    validUntil: DATE.test(q.validUntil) ? q.validUntil : "",
    taxMode: q.taxMode in TAX_MODES ? q.taxMode : "general",
    vatIncluded: Boolean(q.vatIncluded),
    rounding: {
      mode: ROUND_MODES.includes(q?.rounding?.mode) ? q.rounding.mode : "floor",
      unit: ROUND_UNITS.includes(Number(q?.rounding?.unit)) ? Number(q.rounding.unit) : 1,
    },
    supplier: {
      name: str(s.name, 80),
      owner: str(s.owner, 40),
      bizNo: digitsOnly(s.bizNo).slice(0, 10),
      address: str(s.address, 160),
      phone: str(s.phone, 40),
      email: str(s.email, 120),
      seal: keepSeal && typeof s.seal === "string" && s.seal.length < 400_000 && SEAL.test(s.seal) ? s.seal : "",
    },
    client: {
      name: str(c.name, 80),
      person: str(c.person, 40),
      phone: str(c.phone, 40),
    },
    items: items
      .map((it) => ({
        name: str(it?.name, 120),
        spec: str(it?.spec, 60),
        qty: clampNum(it?.qty, 0, LIMITS.qty, 2),
        unitPrice: clampNum(it?.unitPrice, 0, LIMITS.unitPrice, 0),
      }))
      .filter((it) => it.name || it.unitPrice),
    notes: str(q.notes, 1000),
  };
  return out;
}

function clampNum(v, min, max, decimals) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(n * f) / f));
}

/** 입력이 문서로 낼 만한지: 문제 목록을 돌려준다 (빈 배열이면 통과) */
export function checkQuote(q) {
  const errs = [];
  if (!q.supplier.name) errs.push("공급자 상호를 적어 주세요");
  if (q.supplier.bizNo && !validateBizNo(q.supplier.bizNo)) errs.push("사업자등록번호가 맞지 않습니다");
  if (!q.client.name) errs.push("받는 분(공급받는자)을 적어 주세요");
  if (!q.items.length) errs.push("품목을 하나 이상 적어 주세요");
  return errs;
}

/* ---------- 문서 HTML ---------- */

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function fmtDate(d) {
  if (!DATE.test(d || "")) return "";
  const [y, m, day] = d.split("-");
  return `${y}년 ${Number(m)}월 ${Number(day)}일`;
}

function fmtQty(n) {
  return Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/**
 * A4 한 장 견적서 HTML (doc.css와 함께 쓴다)
 * opts.acceptedAt: 수락 시각 문자열이 있으면 수락 표시
 */
export function renderQuoteHtml(q, opts = {}) {
  const t = calcQuote(q);
  const s = q.supplier;
  const vatLabel =
    q.taxMode === "general" ? (q.vatIncluded ? "부가세 포함" : "부가세 별도") : q.taxMode === "simple" ? "간이과세자, 부가세 별도 표기 없음" : "원천징수 전 금액";
  const headline = q.taxMode === "general" ? t.total : t.sum;
  const minRows = 8;
  const rows = q.items
    .map(
      (it, i) => `<tr>
<td class="c">${i + 1}</td><td>${esc(it.name)}</td><td>${esc(it.spec)}</td>
<td class="n">${fmtQty(it.qty)}</td><td class="n">${won(it.unitPrice)}</td><td class="n">${won(t.lines[i])}</td></tr>`,
    )
    .join("");
  const blanks = Array.from({ length: Math.max(0, minRows - q.items.length) }, () => `<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join("");

  let sumRows = "";
  if (q.taxMode === "general") {
    sumRows = `<tr><th>공급가액</th><td class="n">${won(t.supply)}</td></tr>
<tr><th>부가가치세</th><td class="n">${won(t.vat)}</td></tr>
<tr class="strong"><th>합계</th><td class="n">${won(t.total)}</td></tr>`;
  } else if (q.taxMode === "simple") {
    sumRows = `<tr class="strong"><th>합계</th><td class="n">${won(t.total)}</td></tr>`;
  } else {
    sumRows = `<tr><th>견적 금액 (지급 총액)</th><td class="n">${won(t.sum)}</td></tr>
<tr><th>소득세 3%</th><td class="n">- ${won(t.incomeTax)}</td></tr>
<tr><th>지방소득세 0.3%</th><td class="n">- ${won(t.localTax)}</td></tr>
<tr class="strong"><th>실 지급액</th><td class="n">${won(t.net)}</td></tr>`;
  }

  const seal = s.seal ? `<img class="seal" src="${esc(s.seal)}" alt="직인">` : `<span class="seal-mark">(인)</span>`;
  const accepted = opts.acceptedAt
    ? `<div class="accepted">견적 수락: ${esc(opts.acceptedAt)}${opts.acceptedName ? `, ${esc(opts.acceptedName)}` : ""}</div>`
    : "";

  return `<article class="doc" lang="ko">
<header class="doc-head">
  <h1 class="doc-title">${esc(q.title || "견 적 서")}</h1>
  <dl class="doc-meta">
    <div><dt>견적번호</dt><dd>${esc(q.number) || "-"}</dd></div>
    <div><dt>견적일자</dt><dd>${fmtDate(q.date) || "-"}</dd></div>
    <div><dt>유효기한</dt><dd>${fmtDate(q.validUntil) || "-"}</dd></div>
  </dl>
</header>
<section class="parties">
  <table class="party">
    <caption>공급받는자</caption>
    <tr><th>상호(성명)</th><td class="to">${esc(q.client.name)} <span>귀하</span></td></tr>
    <tr><th>담당자</th><td>${esc(q.client.person)}</td></tr>
    <tr><th>연락처</th><td>${esc(q.client.phone)}</td></tr>
    <tr><td colspan="2" class="lead-in">아래와 같이 견적합니다.</td></tr>
  </table>
  <table class="party">
    <caption>공급자</caption>
    <tr><th>등록번호</th><td>${esc(formatBizNo(s.bizNo))}</td></tr>
    <tr><th>상호</th><td>${esc(s.name)}</td></tr>
    <tr><th>대표자</th><td class="owner">${esc(s.owner)} ${seal}</td></tr>
    <tr><th>주소</th><td>${esc(s.address)}</td></tr>
    <tr><th>연락처</th><td>${esc([s.phone, s.email].filter(Boolean).join(" / "))}</td></tr>
  </table>
</section>
<section class="grand">
  <span class="grand-label">합계금액</span>
  <strong class="grand-words">${amountInWords(headline)}</strong>
  <span class="grand-num">(₩${won(headline)}, ${vatLabel})</span>
</section>
<table class="items">
  <colgroup><col style="width:7%"><col style="width:33%"><col style="width:16%"><col style="width:10%"><col style="width:16%"><col style="width:18%"></colgroup>
  <thead><tr><th>번호</th><th>품목</th><th>규격</th><th>수량</th><th>단가</th><th>${q.taxMode === "general" && q.vatIncluded ? "금액(부가세 포함)" : "금액"}</th></tr></thead>
  <tbody>${rows}${blanks}</tbody>
</table>
<section class="foot">
  <div class="notes"><h2>비고</h2><p>${esc(q.notes).replace(/\n/g, "<br>") || "&nbsp;"}</p></div>
  <table class="sums">${sumRows}</table>
</section>
${accepted}
</article>`;
}

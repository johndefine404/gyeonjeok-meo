// [Define404] 견적서 편집기: 입력, 미리보기, 인쇄, 공유 링크 저장
import { amountInWords, calcQuote, checkQuote, esc, formatBizNo, normalizeQuote, renderQuoteHtml, validateBizNo, won } from "./core.js";
import { fitSheets } from "./fit.js";

const $ = (s, el = document) => el.querySelector(s);
const ed = $("#editor");
const field = (name) => ed.querySelector(`[name="${name}"]`);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 저장 공간이 없어도 편집은 계속한다 */
    }
  },
};

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n) => ymd(new Date(Date.now() + n * 86_400_000));

// 가입 전 견적번호: 이 브라우저 안에서 날짜별로 매긴다 (저장하면 서버가 다시 매긴다)
function draftNumber() {
  const today = ymd(new Date()).replace(/-/g, "");
  const s = store.get("gj.seq", { d: "", n: 0 });
  const n = s.d === today ? s.n + 1 : 1;
  store.set("gj.seq", { d: today, n });
  return `${today}-${String(n).padStart(3, "0")}`;
}

function blank(supplier) {
  return {
    title: "견 적 서",
    number: draftNumber(),
    date: ymd(new Date()),
    validUntil: addDays(30),
    taxMode: "general",
    vatIncluded: false,
    rounding: { mode: "floor", unit: 1 },
    supplier: supplier ?? { name: "", owner: "", bizNo: "", address: "", phone: "", email: "" },
    client: { name: "", person: "", phone: "" },
    items: [{ name: "", spec: "", qty: 1, unitPrice: 0 }],
    notes: "",
  };
}

function sample() {
  const q = blank({
    name: "예시 디자인 스튜디오",
    owner: "홍길동",
    bizNo: "1234567891",
    address: "서울특별시 ○○구 ○○로 00",
    phone: "010-0000-0000",
    email: "hello@example.com",
  });
  q.client = { name: "예시 카페", person: "김○○", phone: "02-000-0000" };
  q.items = [
    { name: "메뉴판 디자인", spec: "A3 양면", qty: 1, unitPrice: 350000 },
    { name: "메뉴판 인쇄", spec: "코팅 300g", qty: 20, unitPrice: 4500 },
    { name: "매장 안내 스티커", spec: "100x100mm", qty: 50, unitPrice: 1200 },
  ];
  q.notes = "디자인 시안 2회 수정 포함. 인쇄물은 승인 후 5영업일 안에 납품합니다.";
  return q;
}

let state = store.get("gj.draft", null) ?? sample();
let seal = store.get("gj.seal", "");

/* ---------- 입력 <-> 상태 ---------- */

const simple = {
  number: ["number"],
  date: ["date"],
  validUntil: ["validUntil"],
  title: ["title"],
  notes: ["notes"],
  "s.name": ["supplier", "name"],
  "s.owner": ["supplier", "owner"],
  "s.bizNo": ["supplier", "bizNo"],
  "s.address": ["supplier", "address"],
  "s.phone": ["supplier", "phone"],
  "s.email": ["supplier", "email"],
  "c.name": ["client", "name"],
  "c.person": ["client", "person"],
  "c.phone": ["client", "phone"],
};

function fillForm() {
  for (const [name, path] of Object.entries(simple)) {
    const v = path.reduce((o, k) => o?.[k], state) ?? "";
    field(name).value = name === "s.bizNo" ? formatBizNo(v) : v;
  }
  for (const r of ed.querySelectorAll('[name="taxMode"]')) r.checked = r.value === state.taxMode;
  for (const r of ed.querySelectorAll('[name="vatIncluded"]')) r.checked = r.value === (state.vatIncluded ? "1" : "0");
  field("roundMode").value = state.rounding.mode;
  field("roundUnit").value = String(state.rounding.unit);
  renderItems();
  renderSeal();
}

ed.addEventListener("input", (e) => {
  const t = e.target;
  if (t.closest("#items")) return onItemInput(t);
  if (simple[t.name]) {
    const path = simple[t.name];
    let o = state;
    for (const k of path.slice(0, -1)) o = o[k];
    o[path.at(-1)] = t.value;
  } else if (t.name === "taxMode") state.taxMode = t.value;
  else if (t.name === "vatIncluded") state.vatIncluded = t.value === "1";
  else if (t.name === "roundMode") state.rounding.mode = t.value;
  else if (t.name === "roundUnit") state.rounding.unit = Number(t.value);
  else return;
  update();
});
ed.addEventListener("change", (e) => {
  if (e.target.name === "s.bizNo") e.target.value = formatBizNo(e.target.value);
});

/* ---------- 품목 ---------- */

const num = (v) => Number(String(v).replace(/,/g, "")) || 0;

function renderItems() {
  const box = $("#items");
  box.innerHTML = "";
  state.items.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.dataset.i = i;
    row.innerHTML = `
      <label class="f-name">품목<input data-k="name" maxlength="120"></label>
      <label class="f-spec">규격<input data-k="spec" maxlength="60"></label>
      <label class="f-qty">수량<input data-k="qty" inputmode="decimal"></label>
      <label class="f-price">단가<input data-k="unitPrice" inputmode="numeric"></label>
      <button class="icon-btn f-del" type="button" data-del aria-label="${i + 1}번 품목 지우기">×</button>
      <span class="amt" data-amt></span>`;
    row.querySelector('[data-k="name"]').value = it.name;
    row.querySelector('[data-k="spec"]').value = it.spec;
    row.querySelector('[data-k="qty"]').value = it.qty;
    row.querySelector('[data-k="unitPrice"]').value = won(it.unitPrice);
    box.append(row);
  });
}

function onItemInput(t) {
  const row = t.closest(".item-row");
  const it = state.items[Number(row.dataset.i)];
  const k = t.dataset.k;
  if (!it || !k) return;
  it[k] = k === "qty" || k === "unitPrice" ? num(t.value) : t.value;
  update();
}

$("#items").addEventListener("focusout", (e) => {
  if (e.target.dataset.k === "unitPrice") e.target.value = won(num(e.target.value));
});
$("#items").addEventListener("click", (e) => {
  if (!e.target.closest("[data-del]")) return;
  const i = Number(e.target.closest(".item-row").dataset.i);
  state.items.splice(i, 1);
  if (!state.items.length) state.items.push({ name: "", spec: "", qty: 1, unitPrice: 0 });
  renderItems();
  update();
});
$("#add-item").addEventListener("click", () => {
  if (state.items.length >= 50) return;
  state.items.push({ name: "", spec: "", qty: 1, unitPrice: 0 });
  renderItems();
  update();
  $("#items .item-row:last-child input").focus();
});

/* ---------- 직인 (브라우저에만 저장) ---------- */

function renderSeal() {
  const img = $("[data-seal-preview]");
  img.hidden = !seal;
  $("[data-seal-clear]").hidden = !seal;
  if (seal) img.src = seal;
}

$("[data-seal-file]").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5_000_000) return alert("5MB 이하 이미지를 골라 주세요");
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return alert("이미지를 읽지 못했습니다");
  const max = 240;
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * r);
  canvas.height = Math.round(bmp.height * r);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  seal = canvas.toDataURL("image/png");
  store.set("gj.seal", seal);
  e.target.value = "";
  renderSeal();
  update();
});
$("[data-seal-clear]").addEventListener("click", () => {
  seal = "";
  store.set("gj.seal", "");
  renderSeal();
  update();
});

/* ---------- 미리보기와 합계 ---------- */

const TAX_NOTE = {
  general: "일반과세자: 공급가액과 부가세(10%)를 나눠 적습니다.",
  simple: "간이과세자: 부가세를 따로 적지 않고 합계만 적습니다. 세금계산서 발급 여부 등은 세무 확인 필요.",
  freelancer: "프리랜서 사업소득: 소득세 3%와 지방소득세 0.3%를 10원 미만 버림으로 계산해 실 지급액을 적습니다. 세무 확인 필요.",
};

function current(keepSeal = true) {
  const q = structuredClone(state);
  q.supplier.seal = keepSeal ? seal : "";
  return normalizeQuote(q, { keepSeal });
}

function update() {
  store.set("gj.draft", state);
  ed.querySelector("[data-vat]").hidden = state.taxMode !== "general";
  $("[data-tax-note]").textContent = TAX_NOTE[state.taxMode];

  const hint = $("[data-biz-hint]");
  const biz = String(state.supplier.bizNo || "").replace(/\D/g, "");
  hint.className = "hint" + (biz.length === 10 ? (validateBizNo(biz) ? " good" : " bad") : "");
  hint.textContent = !biz ? "" : biz.length < 10 ? "숫자 10자리" : validateBizNo(biz) ? "검증번호가 맞습니다" : "번호가 맞지 않습니다. 다시 확인해 주세요";

  const q = current(true);
  let t;
  try {
    t = calcQuote(q);
    $("#sheet").innerHTML = renderQuoteHtml(q);
  } catch {
    $("#totals").innerHTML = '<p class="msg bad">금액이 너무 큽니다. 수량이나 단가를 확인해 주세요.</p>';
    return;
  }
  ed.querySelectorAll("#items [data-amt]").forEach((el, i) => (el.textContent = t.lines[i] != null ? `금액 ${won(t.lines[i])}원` : ""));

  const rows = [];
  if (q.taxMode === "general") rows.push(["공급가액", t.supply], ["부가세", t.vat], ["합계", t.total, true]);
  else if (q.taxMode === "simple") rows.push(["합계", t.total, true]);
  else rows.push(["견적 금액", t.sum], ["원천징수 (3.3%)", -t.withholding], ["실 지급액", t.net, true]);
  const head = q.taxMode === "general" ? t.total : t.sum;
  $("#totals").innerHTML =
    rows.map(([k, v, big]) => `<div class="row${big ? " big" : ""}"><span>${k}</span><span>${v < 0 ? "- " : ""}${won(Math.abs(v))}원</span></div>`).join("") +
    `<div class="words">${amountInWords(head)}</div>`;
  fitSheets();
}

/* ---------- 인쇄, 저장, 가입 ---------- */

function showErrors(list) {
  $("#errors").innerHTML = list.map((e) => `<li>${esc(e)}</li>`).join("");
}

$("#print").addEventListener("click", () => {
  showErrors([]);
  window.print();
});

$("#save").addEventListener("click", async () => {
  const q = current(false);
  const errs = checkQuote(q);
  showErrors(errs);
  if (errs.length) return;
  const btn = $("#save");
  btn.disabled = true;
  try {
    const res = await fetch("/api/quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      $("#signup").hidden = false;
      $("#signup [name=email]").focus();
      return;
    }
    if (!res.ok) return showErrors(data.errors ?? [data.error ?? "저장하지 못했습니다"]);
    state.number = data.number;
    field("number").value = data.number;
    update();
    $("#share-out").classList.add("on");
    $("[data-share-msg]").textContent = `견적번호 ${data.number}로 저장했습니다.`;
    $("[data-share-url]").value = data.url;
  } finally {
    btn.disabled = false;
  }
});

$("[data-copy]").addEventListener("click", async () => {
  const input = $("[data-share-url]");
  try {
    await navigator.clipboard.writeText(input.value);
    $("[data-copy]").textContent = "복사됨";
  } catch {
    input.select();
  }
});

$("#signup").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const msg = $("[data-signup-msg]");
  if (!f.consentPrivacy.checked) {
    msg.className = "msg bad";
    msg.textContent = "개인정보 수집·이용 동의(필수)에 체크해 주세요";
    return;
  }
  const res = await fetch("/api/auth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: f.email.value, consentPrivacy: true, consentMarketing: f.consentMarketing.checked }),
  });
  const data = await res.json().catch(() => ({}));
  msg.className = res.ok ? "msg good" : "msg bad";
  msg.textContent = res.ok ? "메일로 로그인 링크를 보냈습니다. 로그인한 뒤 이 화면으로 돌아와 다시 \"공유 링크 만들기\"를 눌러 주세요. 작성 중인 내용은 남아 있습니다." : data.error;
  if (data.devLink) {
    const a = document.createElement("a");
    a.href = data.devLink;
    a.className = "dev-link";
    a.textContent = `개발 모드 로그인 링크: ${data.devLink}`;
    msg.after(a);
  }
});

$("#reset").addEventListener("click", () => {
  if (!confirm("받는 분, 품목, 비고를 비우고 새 견적서를 시작할까요? 공급자 정보는 남깁니다.")) return;
  state = blank(state.supplier);
  $("#share-out").classList.remove("on");
  showErrors([]);
  fillForm();
  update();
});

/* ---------- 시작 ---------- */

fillForm();
update();

fetch("/api/config")
  .then((r) => r.json())
  .then((c) => document.querySelectorAll("[data-cta]").forEach((a) => (a.href = c.ctaUrl)))
  .catch(() => {});

fetch("/api/me")
  .then((r) => r.json())
  .then((me) => {
    if (!me.login) return;
    $("[data-me]").textContent = "내 견적함";
    const b = me.business;
    // 로그인했고 저장된 사업자 정보가 있으면, 예시나 빈 공급자 칸을 그것으로 채운다
    if (b && (!state.supplier.name || state.supplier.name === "예시 디자인 스튜디오")) {
      state.supplier = { name: b.name, owner: b.owner, bizNo: b.bizNo, address: b.address, phone: b.phone, email: b.email };
      fillForm();
      update();
    }
  })
  .catch(() => {});

// [Define404] 내 견적함
import { esc, formatBizNo, validateBizNo, won } from "./core.js";

const $ = (s) => document.querySelector(s);
const api = async (path, opts = {}) => {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "요청을 처리하지 못했습니다"), { status: res.status });
  return data;
};
const when = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

async function start() {
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => {
      document.querySelectorAll("[data-cta]").forEach((a) => (a.href = c.ctaUrl));
      if (c.privacyUrl) document.querySelectorAll("[data-privacy]").forEach((a) => (a.href = c.privacyUrl));
    })
    .catch(() => {});
  const me = await api("/api/me");
  if (!me.login) {
    $("#login").hidden = false;
    return;
  }
  $("#dash").hidden = false;
  $("[data-email]").textContent = me.email;
  $("#marketing").checked = me.marketing;
  showBusiness(me.business);
  loadRequests();
  loadQuotes();
}

function showBusiness(b) {
  const f = $("#biz-form").elements;
  if (b) for (const k of ["name", "owner", "address", "phone", "email", "notifyEmail", "intro"]) f[k].value = b[k] ?? "";
  if (b) f.bizNo.value = formatBizNo(b.bizNo);
  $("[data-req-link]").innerHTML = b
    ? `<p class="sub small">이 주소를 블로그, 인스타그램 소개, 카카오톡 채널에 걸어 두면 고객이 직접 견적을 요청하고, 요청이 오면 메일로 알려 드립니다.</p>
       <div class="copy-row"><input readonly value="${esc(b.requestUrl)}" aria-label="견적 요청 페이지 주소"><a class="btn small" href="${esc(b.requestUrl)}" target="_blank" rel="noopener">열기</a></div>`
    : `<p class="empty">사업자 정보를 저장하면 견적 요청 페이지 주소가 생깁니다.</p>`;
}

async function loadRequests() {
  const { requests } = await api("/api/requests");
  $("#requests").innerHTML = requests.length
    ? requests
        .map(
          (r) => `<li data-id="${esc(r.id)}"><div class="top"><span>${esc(r.name)}</span><span class="meta">${when(r.created_at)}</span></div>
          <span class="meta">${esc(r.contact)}</span><p class="details">${esc(r.details)}</p>
          <div class="row-actions"><button class="btn link" type="button" data-del-req>지우기</button></div></li>`,
        )
        .join("")
    : `<li><p class="empty">아직 들어온 요청이 없습니다.</p></li>`;
}

async function loadQuotes() {
  const { quotes } = await api("/api/quotes");
  $("#quotes").innerHTML = quotes.length
    ? quotes
        .map(
          (q) => `<li data-id="${esc(q.id)}"><div class="top"><span>${esc(q.number)} · ${esc(q.client_name)}</span><span>${won(q.total)}원</span></div>
          <span class="meta">${when(q.created_at)} ${q.accepted_at ? `<span class="badge ok">수락 ${when(q.accepted_at)}</span>` : `<span class="badge">수락 대기</span>`}</span>
          <div class="row-actions"><a href="/q/${esc(q.id)}" target="_blank" rel="noopener">공유 링크 열기</a><button class="btn link" type="button" data-copy-quote>링크 복사</button><button class="btn link" type="button" data-del-quote>지우기</button></div></li>`,
        )
        .join("")
    : `<li><p class="empty">저장한 견적서가 없습니다. 편집기에서 "공유 링크 만들기"를 누르면 여기에 쌓입니다.</p></li>`;
}

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const msg = $("[data-login-msg]");
  try {
    const d = await api("/api/auth/start", {
      method: "POST",
      body: JSON.stringify({ email: f.email.value, consentPrivacy: f.consentPrivacy.checked, consentMarketing: f.consentMarketing.checked }),
    });
    msg.className = "msg good";
    msg.textContent = "메일로 로그인 링크를 보냈습니다. 20분 안에 열어 주세요.";
    if (d.devLink) msg.insertAdjacentHTML("afterend", `<a class="dev-link" href="${esc(d.devLink)}">개발 모드 로그인 링크</a>`);
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
  }
});

$("#biz-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const msg = $("[data-biz-msg]");
  const body = Object.fromEntries(["name", "owner", "bizNo", "address", "phone", "email", "notifyEmail", "intro"].map((k) => [k, f[k].value]));
  if (body.bizNo && !validateBizNo(body.bizNo)) {
    msg.className = "msg bad";
    msg.textContent = "사업자등록번호가 맞지 않습니다";
    return;
  }
  try {
    const d = await api("/api/business", { method: "PUT", body: JSON.stringify(body) });
    showBusiness(d.business);
    msg.className = "msg good";
    msg.textContent = "저장했습니다";
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
  }
});

document.addEventListener("click", async (e) => {
  const li = e.target.closest("li[data-id]");
  if (e.target.matches("[data-del-req]") && confirm("이 요청을 지울까요?")) {
    await api(`/api/requests/${li.dataset.id}`, { method: "DELETE" });
    li.remove();
  } else if (e.target.matches("[data-del-quote]") && confirm("이 견적서를 지울까요? 공유 링크도 더 열리지 않습니다.")) {
    await api(`/api/quotes/${li.dataset.id}`, { method: "DELETE" });
    li.remove();
  } else if (e.target.matches("[data-copy-quote]")) {
    await navigator.clipboard?.writeText(`${location.origin}/q/${li.dataset.id}`).catch(() => {});
    e.target.textContent = "복사됨";
  }
});

$("#marketing").addEventListener("change", async (e) => {
  const msg = $("[data-marketing-msg]");
  try {
    const d = await api("/api/me/marketing", { method: "POST", body: JSON.stringify({ consent: e.target.checked }) });
    msg.textContent = `${d.marketing ? `광고성 정보 수신에 동의했습니다 (${when(d.marketingAt)})` : "광고성 정보 수신을 껐습니다"}. ${d.noticeSent ? "처리 결과를 메일로 보냈습니다." : ""}`;
  } catch (err) {
    e.target.checked = !e.target.checked;
    msg.textContent = err.message;
  }
});
$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.href = "/";
});
$("#delete").addEventListener("click", async () => {
  if (!confirm("계정, 사업자 정보, 견적서, 받은 견적 요청을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?")) return;
  await api("/api/me/delete", { method: "POST" });
  location.href = "/";
});

start().catch((err) => {
  document.querySelector("main").insertAdjacentHTML("afterbegin", `<p class="msg bad">${esc(err.message)}</p>`);
});

// [Define404] 견적 요청 페이지: 고객이 요청을 보낸다
const form = document.querySelector("form[data-request]");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = form.querySelector(".msg");
  const btn = form.querySelector("button[type=submit]");
  const f = form.elements;
  if (!f.consent.checked) {
    msg.className = "msg bad";
    msg.textContent = "개인정보 수집·이용에 동의해 주세요";
    return;
  }
  btn.disabled = true;
  msg.className = "msg";
  msg.textContent = "보내는 중입니다";
  try {
    const res = await fetch(`/api/r/${encodeURIComponent(form.dataset.request)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: f.name.value,
        contact: f.contact.value,
        details: f.details.value,
        website: f.website.value,
        consent: f.consent.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "보내지 못했습니다");
    form.innerHTML = '<p class="msg good">요청을 보냈습니다. 확인 후 연락드리겠습니다.</p>';
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
    btn.disabled = false;
  }
});

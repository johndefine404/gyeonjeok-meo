// [Define404] 공유 견적서: 수락 버튼
import { fitSheets } from "./fit.js";

fitSheets();
const form = document.querySelector("form[data-accept]");
form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = form.querySelector(".msg");
  const btn = form.querySelector("button");
  btn.disabled = true;
  msg.className = "msg";
  msg.textContent = "보내는 중입니다";
  try {
    const res = await fetch(`/api/quotes/${encodeURIComponent(form.dataset.accept)}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.elements.name.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "수락하지 못했습니다");
    const done = document.createElement("p");
    done.className = "accept-done";
    done.textContent = `${data.acceptedAt}에 수락했습니다. 공급자에게 전달됐습니다.`;
    form.replaceWith(done);
  } catch (err) {
    msg.className = "msg bad";
    msg.textContent = err.message;
    btn.disabled = false;
  }
});

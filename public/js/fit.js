// [Define404] A4 문서(.sheet)를 화면 폭에 맞춰 줄여 보여 준다. 인쇄할 때는 doc.css 가 원래 크기로 되돌린다
// 폭이 600px 보다 좁은 화면에서는 "크게 보기"를 누르면 원래 크기(100%)로 보여 주고,
// 문서 상자 안에서만 옆으로 밀어 볼 수 있게 한다 (페이지 자체는 넘치지 않는다)
const NARROW = matchMedia("(max-width: 599.98px)");

function zoomBar(box) {
  let bar = box.previousElementSibling;
  if (bar?.classList.contains("zoom-bar")) return bar;
  bar = document.createElement("div");
  bar.className = "zoom-bar no-print";
  bar.innerHTML = `<button class="btn ghost small" type="button" aria-pressed="false">크게 보기</button><span class="hint" data-zoom-hint>글자가 작으면 크게 보기를 누르세요</span>`;
  bar.querySelector("button").addEventListener("click", () => {
    box.classList.toggle("zoom");
    fitSheets();
    if (box.classList.contains("zoom")) box.scrollLeft = 0;
  });
  box.before(bar);
  return bar;
}

export function fitSheets() {
  for (const box of document.querySelectorAll(".sheet-scroll")) {
    const sheet = box.querySelector(".sheet");
    const doc = sheet?.querySelector(".doc");
    if (!sheet || !doc) continue;
    const bar = zoomBar(box);
    const zoom = NARROW.matches && box.classList.contains("zoom");
    box.classList.toggle("zoomed", zoom);
    const btn = bar.querySelector("button");
    btn.textContent = zoom ? "화면에 맞춰 보기" : "크게 보기";
    btn.setAttribute("aria-pressed", String(zoom));
    bar.querySelector("[data-zoom-hint]").textContent = zoom ? "문서를 옆으로 밀어 보세요. 인쇄 서식은 바뀌지 않습니다" : "글자가 작으면 크게 보기를 누르세요";

    sheet.style.transform = "none";
    if (zoom) {
      box.style.height = "";
      continue;
    }
    const natural = doc.offsetWidth;
    const scale = Math.min(1, box.clientWidth / natural);
    sheet.style.transform = scale < 1 ? `scale(${scale})` : "none";
    box.style.height = `${Math.ceil(doc.offsetHeight * scale)}px`;
  }
}

let raf = 0;
addEventListener("resize", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(fitSheets);
});
NARROW.addEventListener?.("change", fitSheets);
document.fonts?.ready.then(fitSheets);

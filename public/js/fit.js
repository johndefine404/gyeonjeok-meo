// [Define404] A4 문서(.sheet)를 화면 폭에 맞춰 줄여 보여 준다. 인쇄할 때는 doc.css 가 원래 크기로 되돌린다
export function fitSheets() {
  for (const box of document.querySelectorAll(".sheet-scroll")) {
    const sheet = box.querySelector(".sheet");
    const doc = sheet?.querySelector(".doc");
    if (!sheet || !doc) continue;
    sheet.style.transform = "none";
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
document.fonts?.ready.then(fitSheets);

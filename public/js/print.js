// [Define404] 인쇄용 페이지: 인쇄 버튼과 화면 맞춤
import { fitSheets } from "./fit.js";

fitSheets();
for (const b of document.querySelectorAll("[data-print]")) b.addEventListener("click", () => window.print());

// Renders LaTeX math inside a given DOM element using KaTeX auto-render.
// Called after every dynamic content insertion (chat messages, quiz questions, etc.).
// Safe to call before the deferred KaTeX scripts have loaded — renderMathInElement
// will be undefined and we no-op gracefully.
//
// NOTE: The canonical copy of renderMath() + safeMathHTML() lives in bundle.js.
// This file is kept in sync for pages that load katex-render.js separately.
function renderMath(el) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(el, {
    delimiters: [
      { left: "$$", right: "$$", display: true  },
      { left: "\\[", right: "\\]", display: true },
      { left: "$",  right: "$",  display: false },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  });
}

function safeMathHTML(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "<br>");
}

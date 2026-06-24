// Renders LaTeX math inside a given DOM element using KaTeX auto-render.
// Called after every dynamic content insertion (chat messages, quiz questions, etc.).
// Safe to call before the deferred KaTeX scripts have loaded — renderMathInElement
// will be undefined and we no-op gracefully.
function renderMath(el) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(el, {
    delimiters: [
      { left: "$$", right: "$$", display: true  },
      { left: "$",  right: "$",  display: false },
    ],
    throwOnError: false,
  });
}

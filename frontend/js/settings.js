// ── Settings page ─────────────────────────────────────────────
(function () {
  "use strict";
  const THEME_KEY = "eduai_theme";

  const label = (localStorage.getItem("eduai_student_label") || "").trim();
  const hdr = document.getElementById("header-label");
  if (hdr) hdr.textContent = label;
  const acct = document.getElementById("acct-label");
  if (acct) acct.textContent = label || "Guest";

  // Theme choice (light | dark | system)
  function stored() { return localStorage.getItem(THEME_KEY); }
  function currentChoice() { return stored() || "system"; }

  function apply(choice) {
    if (choice === "system") {
      localStorage.removeItem(THEME_KEY);
      const sys = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", sys);
    } else {
      localStorage.setItem(THEME_KEY, choice);
      document.documentElement.setAttribute("data-theme", choice);
    }
    // keep the header toggle (shell.js) in sync
    document.querySelectorAll(".theme-toggle button").forEach(b =>
      b.classList.toggle("active", b.dataset.theme === document.documentElement.getAttribute("data-theme")));
    mark();
  }

  function mark() {
    const c = currentChoice();
    document.querySelectorAll(".set-theme-card").forEach(card =>
      card.classList.toggle("selected", card.dataset.choice === c));
  }

  document.querySelectorAll(".set-theme-card").forEach(card =>
    card.addEventListener("click", () => apply(card.dataset.choice)));
  mark();

  // Sign out
  const out = document.getElementById("signout-btn");
  if (out) out.addEventListener("click", () => {
    localStorage.removeItem("eduai_student_id");
    localStorage.removeItem("eduai_student_label");
    window.location.href = "index.html";
  });
})();

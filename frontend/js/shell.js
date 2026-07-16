// ═══════════════════════════════════════════════════════════════════════════
// MindForge — App shell
// Injects the persistent left sidebar, the light/dark theme toggle, and the
// mobile drawer on every page. Pure enhancement: no feature logic lives here.
// Theme is applied pre-paint by an inline <head> snippet; this manages toggling.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  "use strict";

  // ── Icons (self-contained; does not depend on bundle load order) ──────────
  const SW = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const ic = (b) => `<svg viewBox="0 0 24 24" ${SW}>${b}</svg>`;
  const ICON = {
    dashboard: ic('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    chat:      ic('<path d="M7.9 20A9 9 0 1 0 4 16.1L3 21l4.9-1z"/><path d="M8 10h8"/><path d="M8 14h5"/>'),
    daily:     ic('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
    pair:      ic('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    progress:  ic('<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M7 13l3-3 4 4 5-5"/>'),
    leaderboard: ic('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'),
    concept:   ic('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5 6 16.5"/><path d="m12 7.5 6 9"/><path d="M7.5 19h9"/>'),
    report:    ic('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/>'),
    teacher:   ic('<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>'),
    settings:  ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
    help:      ic('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'),
    plus:      ic('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    menu:      ic('<path d="M3 12h18"/><path d="M3 6h18"/><path d="M3 18h18"/>'),
    sun:       ic('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>'),
    moon:      ic('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
  };

  // ── Which page are we on? ─────────────────────────────────────────────────
  const file = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const page = (file.replace(".html", "") || "index");
  const PAGE = page === "" ? "index" : page;

  // Nav items (page key → label, icon, href). Active resolved from PAGE.
  const NAV = [
    { key: "index",       label: "Dashboard",      href: "index.html",       icon: "dashboard" },
    { key: "chat",        label: "Tutor Chat",     href: "chat.html",        icon: "chat" },
    { key: "daily",       label: "Daily Challenge", href: "daily.html",      icon: "daily" },
    { key: "pair",        label: "Study Pair",     href: "pair.html",        icon: "pair" },
    { key: "progress",    label: "My Progress",    href: "progress.html",    icon: "progress" },
    { key: "leaderboard", label: "Leaderboard",    href: "leaderboard.html", icon: "leaderboard" },
    { key: "profile",     label: "Concept Map",    href: "profile.html",     icon: "concept" },
    { key: "report",      label: "Full Report",    href: "report.html",      icon: "report" },
    { key: "teacher",     label: "Teacher",        href: "teacher.html",     icon: "teacher" },
  ];
  // pages that belong under a nav item even if not literally in NAV
  const ALIAS = { diagnostic: "chat", quiz: "chat", review: "progress", settings: null };
  const activeKey = NAV.some(n => n.key === PAGE) ? PAGE : (ALIAS[PAGE] || null);

  // ── Theme management ──────────────────────────────────────────────────────
  const THEME_KEY = "mindforge_theme";
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "dark";
  }
  function applyTheme(t, persist) {
    document.documentElement.setAttribute("data-theme", t);
    if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
    document.querySelectorAll(".theme-toggle button").forEach(b =>
      b.classList.toggle("active", b.dataset.theme === t));
  }

  function buildThemeToggle() {
    const wrap = document.createElement("div");
    wrap.className = "theme-toggle";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Colour theme");
    wrap.innerHTML =
      `<button data-theme="light" title="Light mode" aria-label="Light mode">${ICON.sun}</button>` +
      `<button data-theme="dark" title="Dark mode" aria-label="Dark mode">${ICON.moon}</button>`;
    wrap.querySelectorAll("button").forEach(b =>
      b.addEventListener("click", () => applyTheme(b.dataset.theme, true)));
    return wrap;
  }

  // React to OS changes only while the user hasn't chosen manually
  try {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
      if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? "light" : "dark", false);
    });
  } catch (e) {}

  // ── Sidebar ───────────────────────────────────────────────────────────────
  function studentLabel() {
    try { return localStorage.getItem("mindforge_student_label") || ""; } catch (e) { return ""; }
  }
  function buildSidebar() {
    const label = studentLabel();
    const initial = (label || "?").trim().charAt(0).toUpperCase();
    const aside = document.createElement("aside");
    aside.className = "app-sidebar";
    aside.innerHTML =
      `<a class="sb-brand" href="index.html">
         <span class="sb-logo">${ICON.dashboard}</span>
         <span class="sb-brand-text"><b>MindForge</b><small>Expert Companion</small></span>
       </a>
       <nav class="sb-nav">
         ${NAV.map(n => `<a class="sb-link${n.key === activeKey ? " active" : ""}" href="${n.href}" data-page="${n.key}">${ICON[n.icon]}<span>${n.label}</span></a>`).join("")}
       </nav>
       <div class="sb-spacer"></div>
       <div class="sb-cta"><a class="btn btn-primary" href="chat.html">${ICON.plus}<span>New Session</span></a></div>
       <div class="sb-foot">
         <a class="sb-foot-link" href="settings.html">${ICON.settings}<span>Settings</span></a>
         <a class="sb-foot-link" href="settings.html#help">${ICON.help}<span>Help</span></a>
         ${label ? `<div class="sb-profile"><span class="sb-avatar">${initial}</span><span class="sb-profile-meta"><b>${label}</b><small>Learner</small></span></div>` : ""}
       </div>`;
    return aside;
  }

  // Mobile drawer
  let backdrop = null;
  function openDrawer(open) {
    const aside = document.querySelector(".app-sidebar");
    if (!aside) return;
    aside.classList.toggle("open", open);
    if (backdrop) backdrop.classList.toggle("show", open);
  }

  // ── Inject into the page header ───────────────────────────────────────────
  function decorateHeader() {
    const header = document.querySelector(".site-header");
    if (!header) return;
    if (!header.querySelector(".theme-toggle")) header.appendChild(buildThemeToggle());
    // hamburger for mobile (left)
    if (!header.querySelector(".sb-toggle")) {
      const burger = document.createElement("button");
      burger.className = "sb-toggle";
      burger.setAttribute("aria-label", "Menu");
      burger.innerHTML = ICON.menu;
      burger.addEventListener("click", () => openDrawer(!document.querySelector(".app-sidebar")?.classList.contains("open")));
      header.insertBefore(burger, header.firstChild);
    }
  }

  // ── Sidebar visibility (index has a marketing landing with no rail) ────────
  function refreshSidebarVisibility() {
    const aside = document.querySelector(".app-sidebar");
    if (!aside) return;
    let show = true;
    if (PAGE === "index") {
      const welcome = document.getElementById("welcome-state");
      show = !!(welcome && getComputedStyle(welcome).display !== "none");
    }
    aside.style.display = show ? "" : "none";
    document.body.classList.toggle("has-sidebar", show);
    const burger = document.querySelector(".sb-toggle");
    if (burger) burger.style.display = show ? "" : "none";
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  function boot() {
    // sidebar
    document.body.appendChild(buildSidebar());
    backdrop = document.createElement("div");
    backdrop.className = "sb-backdrop";
    backdrop.addEventListener("click", () => openDrawer(false));
    document.body.appendChild(backdrop);

    decorateHeader();
    applyTheme(currentTheme(), false); // sync toggle active state
    refreshSidebarVisibility();

    // index toggles landing/welcome via inline style → watch for it
    if (PAGE === "index") {
      const welcome = document.getElementById("welcome-state");
      if (welcome) new MutationObserver(refreshSidebarVisibility)
        .observe(welcome, { attributes: true, attributeFilter: ["style"] });
    }
    // close drawer on nav click (mobile)
    document.querySelectorAll(".sb-link").forEach(l =>
      l.addEventListener("click", () => openDrawer(false)));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

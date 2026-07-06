// ── Concept Map Visualization ─────────────────────────────────

const MASTERY_COLORS = {
  solid:      { fill: "rgba(34,197,94,0.18)",   stroke: "#22c55e", text: "#4ade80" },
  shaky:      { fill: "rgba(251,146,60,0.18)",   stroke: "#fb923c", text: "#fdba74" },
  not_tested: { fill: "rgba(255,255,255,0.05)",  stroke: "rgba(255,255,255,0.15)", text: "rgba(255,255,255,0.4)" },
};

function computeLayout(nodes) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const depthMap = {};

  function depth(id, visiting = new Set()) {
    if (depthMap[id] !== undefined) return depthMap[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = nodeMap[id];
    if (!n || !n.depends_on || n.depends_on.length === 0) {
      depthMap[id] = 0;
      return 0;
    }
    depthMap[id] = Math.max(...n.depends_on.map(d => depth(d, new Set(visiting)))) + 1;
    return depthMap[id];
  }

  nodes.forEach(n => depth(n.id));

  const layers = {};
  nodes.forEach(n => {
    const d = depthMap[n.id] || 0;
    (layers[d] = layers[d] || []).push(n.id);
  });

  const SVG_W = 620;
  const NODE_W = 148;
  const NODE_H = 54;
  const V_STEP = 100;

  const positions = {};
  Object.entries(layers).forEach(([d, ids]) => {
    const y = parseInt(d) * V_STEP + 16;
    const span = ids.length * NODE_W + (ids.length - 1) * 16;
    const startX = (SVG_W - span) / 2;
    ids.forEach((id, i) => {
      positions[id] = { x: startX + i * (NODE_W + 16), y };
    });
  });

  const maxDepth = Math.max(...Object.keys(layers).map(Number));
  const svgH = (maxDepth + 1) * V_STEP + NODE_H + 24;

  return { positions, depthMap, SVG_W, NODE_W, NODE_H, svgH };
}

function renderSubtopicMap(container, stId, data) {
  const { nodes } = data;
  if (!nodes || nodes.length === 0) return;

  const { positions, SVG_W, NODE_W, NODE_H, svgH } = computeLayout(nodes);

  let edges = "";
  let nodesSvg = "";

  // Edges (drawn behind nodes)
  nodes.forEach(node => {
    (node.depends_on || []).forEach(parentId => {
      const from = positions[parentId];
      const to = positions[node.id];
      if (!from || !to) return;
      const x1 = from.x + NODE_W / 2;
      const y1 = from.y + NODE_H;
      const x2 = to.x + NODE_W / 2;
      const y2 = to.y;
      const mid = (y1 + y2) / 2;
      edges += `<path d="M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}"
        stroke="rgba(255,255,255,0.14)" stroke-width="1.5" fill="none"
        marker-end="url(#arr-${stId})"/>`;
    });
  });

  // Nodes
  nodes.forEach(node => {
    const pos = positions[node.id];
    if (!pos) return;
    const c = MASTERY_COLORS[node.mastery] || MASTERY_COLORS.not_tested;
    const lbl = node.label.length > 24 ? node.label.slice(0, 22) + "…" : node.label;
    const statusText = node.mastery === "not_tested" ? "not explored" : node.mastery;
    const escapedDesc = (node.description || "").replace(/"/g, "&quot;");

    nodesSvg += `
      <g transform="translate(${pos.x},${pos.y})" class="cnode" data-desc="${escapedDesc}">
        <rect width="${NODE_W}" height="${NODE_H}" rx="11"
          fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>
        <text x="${NODE_W / 2}" y="22" text-anchor="middle"
          font-size="12" font-weight="600" fill="${c.text}"
          font-family="-apple-system,BlinkMacSystemFont,sans-serif">${lbl}</text>
        <text x="${NODE_W / 2}" y="39" text-anchor="middle"
          font-size="10" fill="rgba(255,255,255,0.38)"
          font-family="-apple-system,BlinkMacSystemFont,sans-serif">${statusText}</text>
      </g>`;
  });

  const svgMarkup = `
    <svg viewBox="0 0 ${SVG_W} ${svgH}" xmlns="http://www.w3.org/2000/svg"
      style="width:100%;max-width:${SVG_W}px;display:block;margin:0 auto;overflow:visible;">
      <defs>
        <marker id="arr-${stId}" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L0,7 L7,3.5 z" fill="rgba(255,255,255,0.18)"/>
        </marker>
      </defs>
      ${edges}
      ${nodesSvg}
    </svg>`;

  const section = document.createElement("div");
  section.className = "concept-section glass-card";
  section.innerHTML = `<h3 class="concept-section-title">${data.label}</h3>${svgMarkup}`;
  container.appendChild(section);

  // Tooltip on hover
  section.querySelectorAll(".cnode").forEach(el => {
    el.style.cursor = "default";
    el.addEventListener("mouseenter", e => {
      const desc = el.dataset.desc;
      if (!desc) return;
      let tip = document.getElementById("ctip");
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "ctip";
        tip.className = "concept-tooltip";
        document.body.appendChild(tip);
      }
      tip.textContent = desc;
      tip.style.display = "block";
    });
    el.addEventListener("mousemove", e => {
      const tip = document.getElementById("ctip");
      if (tip) { tip.style.left = (e.clientX + 14) + "px"; tip.style.top = (e.clientY - 8) + "px"; }
    });
    el.addEventListener("mouseleave", () => {
      const tip = document.getElementById("ctip");
      if (tip) tip.style.display = "none";
    });
  });
}

async function loadConceptMap() {
  const container = document.getElementById("concept-map-container");
  const loading   = document.getElementById("concept-loading");

  if (!Store.studentId) {
    loading.textContent = "Sign in on the home page first.";
    return;
  }

  const headerLbl = document.getElementById("header-label");
  if (headerLbl) headerLbl.textContent = Store.studentLabel || "";

  try {
    const data = await Api.getConceptMap(Store.studentId);
    loading.remove();

    const ids = Object.keys(data);
    if (ids.length === 0) {
      container.innerHTML =
        '<p style="color:var(--text-mid);text-align:center;padding:40px 0;">' +
        "No concept data yet — complete some tutoring sessions first.</p>";
      return;
    }

    ids.forEach(stId => renderSubtopicMap(container, stId, data[stId]));
  } catch (e) {
    loading.textContent = "Could not load concept map.";
    console.error(e);
  }
}

loadConceptMap();

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupUploads();
  setupMatch();
  setupFilters();
  setupExport();
  setupAdmin();
  refreshFacets();
  loadDashboard();
});

function setupTabs() {
  $$(".tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tabs button").forEach((b) => b.classList.remove("active"));
      $$(".tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "dashboard") loadDashboard();
      if (btn.dataset.tab === "browse") {
        refreshFacets();
        loadRecommendations();
      }
    });
  });
}

async function postFile(url, fileInputSel) {
  const file = $(fileInputSel).files[0];
  if (!file) { return { error: "No file selected." }; }
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(url, { method: "POST", body: fd });
  return res.json();
}

function setupUploads() {
  $("#upload-titles").addEventListener("click", async () => {
    $("#titles-result").textContent = "Uploading...";
    const r = await postFile("/api/upload/titles", "#titles-file");
    $("#titles-result").textContent = JSON.stringify(r, null, 2);
    refreshFacets();
  });
  $("#upload-courses").addEventListener("click", async () => {
    $("#courses-result").textContent = "Uploading...";
    const r = await postFile("/api/upload/courses", "#courses-file");
    $("#courses-result").textContent = JSON.stringify(r, null, 2);
    refreshFacets();
  });
}

function setupMatch() {
  $("#run-match").addEventListener("click", async () => {
    $("#match-result").textContent = "Running...";
    const topK = $("#top-k").value;
    const minScore = $("#min-score").value;
    const res = await fetch(`/api/match/run?top_k=${topK}&min_score=${minScore}`, { method: "POST" });
    const j = await res.json();
    $("#match-result").textContent = JSON.stringify(j, null, 2);
    refreshFacets();
  });
}

async function refreshFacets() {
  try {
    const r = await fetch("/api/facets");
    if (!r.ok) return;
    const f = await r.json();
    fillSelect("#f-campus", f.campus, "All campuses");
    fillSelect("#f-college", f.college, "All colleges");
    fillSelect("#f-program", f.program, "All programs");
    fillSelect("#f-author", f.author, "All authors");
    fillSelect("#f-publisher", f.publisher, "All publishers");
    fillSelect("#f-year", f.year, "All years");
  } catch (e) { /* ignore */ }
}

function fillSelect(sel, values, placeholder) {
  const el = $(sel);
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  el.value = current;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function setupFilters() {
  $("#apply-filters").addEventListener("click", loadRecommendations);
}

function currentFilterParams() {
  const p = new URLSearchParams();
  for (const [id, key] of [
    ["f-campus", "campus"], ["f-college", "college"], ["f-program", "program"],
    ["f-course", "course"], ["f-author", "author"], ["f-publisher", "publisher"],
    ["f-year", "year"], ["f-style", "style"],
  ]) {
    const v = $("#" + id).value;
    if (v) p.set(key, v);
  }
  return p;
}

async function loadRecommendations() {
  const p = currentFilterParams();
  const res = await fetch("/api/recommendations?" + p.toString());
  if (!res.ok) {
    $("#rec-count").textContent = "Error loading recommendations.";
    return;
  }
  const data = await res.json();
  renderTable(data.rows);
  renderBibliography(data.bibliography);
}

function renderTable(rows) {
  const tbody = $("#rec-table tbody");
  tbody.innerHTML = "";
  $("#rec-count").textContent = `${rows.length} recommendation rows.`;
  for (const r of rows.slice(0, 1000)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(r.Campus)}</td>
      <td>${escapeHtml(r.College)}</td>
      <td>${escapeHtml(r.Program)}</td>
      <td>${escapeHtml(r.Course)}</td>
      <td>${escapeHtml(r["Book Title"])}</td>
      <td>${escapeHtml(r.Author)}</td>
      <td>${escapeHtml(r["Publication Year"])}</td>
      <td>${escapeHtml(r.Publisher)}</td>
      <td>${escapeHtml(r["Number of Copies"])}</td>`;
    tbody.appendChild(tr);
  }
  if (rows.length > 1000) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9" class="muted">... showing first 1000 of ${rows.length}. Use export for the full list.</td>`;
    tbody.appendChild(tr);
  }
}

function renderBibliography(biblio) {
  const root = $("#biblio");
  root.innerHTML = "";
  const keys = Object.keys(biblio).sort();
  if (!keys.length) {
    root.innerHTML = '<p class="muted">No bibliography entries.</p>';
    return;
  }
  for (const k of keys) {
    const div = document.createElement("div");
    div.className = "group";
    div.innerHTML = `<h3>${escapeHtml(k)}</h3><ol>` +
      biblio[k].map(c => `<li>${escapeHtml(c)}</li>`).join("") + "</ol>";
    root.appendChild(div);
  }
}

function setupExport() {
  $$(".export button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = currentFilterParams();
      p.set("fmt", btn.dataset.fmt);
      window.location.href = "/api/export?" + p.toString();
    });
  });
}

function setupAdmin() {
  $("#reset").addEventListener("click", async () => {
    if (!confirm("This wipes all titles, courses, and matches, then reseeds PSU programs. Continue?")) return;
    $("#reset-result").textContent = "Resetting...";
    const r = await fetch("/api/admin/reset", { method: "POST" });
    $("#reset-result").textContent = JSON.stringify(await r.json(), null, 2);
    refreshFacets();
  });
}

async function loadDashboard() {
  try {
    const res = await fetch("/api/dashboard");
    if (!res.ok) return;
    const d = await res.json();
    const stats = [
      { label: "Total Courses Processed", value: d.totals.courses },
      { label: "Total Titles Loaded", value: d.totals.titles },
      { label: "Total Matches", value: d.totals.matches },
      { label: "Distinct Titles Matched", value: d.totals.matched_titles },
    ];
    $("#stats").innerHTML = stats.map(s =>
      `<div class="stat"><div class="label">${s.label}</div><div class="value">${s.value}</div></div>`
    ).join("");
    $("#top-publishers").innerHTML = d.top_publishers.map(p =>
      `<li>${escapeHtml(p.publisher)} <span class="muted">(${p.count})</span></li>`
    ).join("");
    $("#cross-titles").innerHTML = d.cross_program_titles.map(t =>
      `<li>${escapeHtml(t.title)} <span class="muted">(${t.programs} programs)</span></li>`
    ).join("");
  } catch (e) { /* ignore */ }
}

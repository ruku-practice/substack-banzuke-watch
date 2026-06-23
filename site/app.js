"use strict";

let DATA = null;
let activePeriodKey = "cumulative";
let sortKey = "top10";
let sortDir = "desc"; // desc | asc
let searchTerm = "";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

init();

async function init() {
  try {
    const res = await fetch("data.json", { cache: "no-cache" });
    DATA = await res.json();
  } catch (e) {
    $("#metaBar").textContent = "データの読み込みに失敗しました。";
    return;
  }
  renderMeta();
  renderPeriodTabs();
  bindEvents();
  renderRanking();
  renderTrends();
  if (location.hash === "#trends") activateView("trends");
}

function activateView(view) {
  $$("#viewTabs .tab").forEach((x) => x.classList.toggle("is-active", x.dataset.view === view));
  $("#rankingView").hidden = view !== "ranking";
  $("#trendsView").hidden = view !== "trends";
}

function renderMeta() {
  const d = DATA.date_range;
  $("#metaBar").innerHTML =
    `<span>集計期間 <b>${esc(d.start)}</b> 〜 <b>${esc(d.end)}</b>（<b>${d.days}</b>日間）</span>` +
    `<span>発行元 <b>${DATA.publisher_count}</b> 件 / 記事 <b>${d.entries}</b> 件</span>`;
  $("#srcLink").href = DATA.source.url;
  const g = new Date(DATA.generated_at);
  $("#genAt").textContent = "最終更新: " + g.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) + "（毎朝自動更新）";
}

function renderPeriodTabs() {
  ["#periodTabs", "#periodTabsTrends"].forEach((sel) => {
    const wrap = $(sel);
    if (!wrap) return;
    wrap.innerHTML = DATA.periods.map((p) =>
      `<button data-period="${esc(p.key)}"${p.key === activePeriodKey ? ' class="is-active"' : ""}>${esc(p.label)}</button>`
    ).join("");
    wrap.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setPeriod(b.dataset.period)));
  });
}

function setPeriod(key) {
  activePeriodKey = key;
  $$("#periodTabs button, #periodTabsTrends button").forEach((x) =>
    x.classList.toggle("is-active", x.dataset.period === key));
  renderRanking();
  renderTrends();
}

function bindEvents() {
  // view tabs
  $$("#viewTabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      const v = t.dataset.view;
      activateView(v);
      history.replaceState(null, "", v === "trends" ? "#trends" : "#");
    }));
  // sortable headers
  $$("#rankTable th[data-sort]").forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (sortKey === k) {
        sortDir = sortDir === "desc" ? "asc" : "desc";
      } else {
        sortKey = k;
        // 文字列(name)は昇順、数値は降順を既定に
        sortDir = k === "name" || k === "avg_rank" ? "asc" : "desc";
      }
      renderRanking();
    }));
  // search
  let t = null;
  $("#searchBox").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => { searchTerm = e.target.value.trim().toLowerCase(); renderRanking(); }, 120);
  });
}

function currentPeriod() {
  return DATA.periods.find((p) => p.key === activePeriodKey) || DATA.periods[0];
}

function avatarHtml(p) {
  const logo = (DATA.logos && DATA.logos[p.host]) || "";
  const inner = logo
    ? `<img class="avatar" src="${esc(logo)}" loading="lazy" decoding="async" alt="">`
    : `<span class="avatar avatar-fallback">${esc((p.name || "?").trim().charAt(0))}</span>`;
  return p.url
    ? `<a class="avatar-link" href="${esc(p.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${inner}</a>`
    : inner;
}

function sortPublishers(list) {
  const dir = sortDir === "asc" ? 1 : -1;
  const arr = list.slice();
  arr.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (sortKey === "name") {
      return String(va).localeCompare(String(vb), "ja") * dir;
    }
    if (va == null) va = sortKey === "avg_rank" ? 999 : 0;
    if (vb == null) vb = sortKey === "avg_rank" ? 999 : 0;
    if (va === vb) {
      // tie-break: Top10 → 平均順位
      if (b.top10 !== a.top10) return b.top10 - a.top10;
      return a.avg_rank - b.avg_rank;
    }
    return (va - vb) * dir;
  });
  return arr;
}

function renderRanking() {
  const period = currentPeriod();
  $("#periodNote").textContent =
    `${period.label}：${period.start} 〜 ${period.end}（${period.days}日間・${period.entries}件）／ 行クリックで並べ替え`;

  let list = period.publishers;
  if (searchTerm) {
    list = list.filter((p) =>
      (p.name || "").toLowerCase().includes(searchTerm) ||
      (p.host || "").toLowerCase().includes(searchTerm));
  }
  list = sortPublishers(list);

  // header sort indicator
  $$("#rankTable th[data-sort]").forEach((th) => {
    const on = th.dataset.sort === sortKey;
    th.classList.toggle("sorted", on);
    th.classList.toggle("asc", on && sortDir === "asc");
  });

  const body = $("#rankBody");
  $("#emptyNote").hidden = list.length > 0;
  body.innerHTML = list.map((p, i) => {
    const idx = i + 1;
    const link = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`
      : `<span>${esc(p.name)}</span>`;
    const host = p.host ? `<span class="host">${esc(p.host)}</span>` : "";
    return `<tr class="medal-${idx}">
      <td class="col-idx">${idx}</td>
      <td class="col-avatar">${avatarHtml(p)}</td>
      <td class="col-name">${link}${host}</td>
      <td>${p.days}</td>
      <td class="${p.top1 ? "num hot" : ""}">${p.top1}</td>
      <td>${p.top3}</td>
      <td>${p.top10}</td>
      <td>${p.avg_rank}位</td>
      <td>${p.avg_attention}</td>
    </tr>`;
  }).join("");
}

function renderTrends() {
  const period = currentPeriod();
  const t = period.trends;
  $("#trendNote").textContent =
    `${period.label}：${period.start} 〜 ${period.end}（${period.days}日間・${period.entries}件）の集計`;

  // 上位の平均注目度（スタッツカード）
  const s = t.summary || {};
  const cards = [
    ["1位の平均注目度", s.avg_att_rank1],
    ["Top3の平均", s.avg_att_top3],
    ["Top10の平均", s.avg_att_top10],
    ["番付全体の平均", s.avg_att_all],
  ];
  $("#statCards").innerHTML = cards.map(([label, val]) =>
    `<div class="stat-card"><span class="stat-val">${val ?? "-"}</span><span class="stat-lbl">${label}</span></div>`
  ).join("");

  // 順位帯別 平均指標
  $("#bandTable").innerHTML =
    `<thead><tr><th style="text-align:left">順位帯</th><th>件数</th><th>注目度</th><th>♥</th><th>Restack</th><th>コメント</th></tr></thead>` +
    "<tbody>" + (t.bands || []).map((b) =>
      `<tr><td style="text-align:left">${esc(b.label)}</td><td>${b.n}</td><td>${b.avg_attention}</td><td>${b.avg_likes}</td><td>${b.avg_restacks}</td><td>${b.avg_comments}</td></tr>`
    ).join("") + "</tbody>";

  // カテゴリ別ランキング（上位15）
  const cats = (t.categories || []).slice(0, 15);
  $("#catTable").innerHTML =
    `<thead><tr><th style="text-align:left">カテゴリ</th><th>Top10</th><th>Top3</th><th>件数</th><th>平均注目度</th></tr></thead>` +
    "<tbody>" + cats.map((c) =>
      `<tr><td style="text-align:left">${esc(c.category)}</td><td>${c.top10}</td><td>${c.top3}</td><td>${c.entries}</td><td>${c.avg_attention}</td></tr>`
    ).join("") + "</tbody>";
}

"use strict";

let DATA = null;
let activePeriodKey = "cumulative";
let sortKey = "top10";
let sortDir = "desc"; // desc | asc
let searchTerm = "";
const RUKU_HOST = "rukupractice.substack.com";

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
  const rukuLogo = DATA.logos && DATA.logos[RUKU_HOST];
  if (rukuLogo) $("#creatorIcon").src = rukuLogo;
  else $("#creatorIcon").remove();
}

function renderPeriodTabs() {
  const fixed = DATA.periods.filter((p) => !p.is_month);
  const months = DATA.periods.filter((p) => p.is_month);   // 新しい順（build順）
  const recentMonths = months.slice(0, 3);                 // 直近3ヶ月はタブ
  const olderMonths = months.slice(3);                     // それ以前はプルダウン

  ["#periodTabs", "#periodTabsTrends"].forEach((sel) => {
    const wrap = $(sel);
    if (!wrap) return;
    let html = fixed.concat(recentMonths).map((p) =>
      `<button data-period="${esc(p.key)}"${p.key === activePeriodKey ? ' class="is-active"' : ""}>${esc(p.label)}</button>`
    ).join("");
    if (olderMonths.length) {
      html += `<select class="month-select" aria-label="過去の月を選ぶ"><option value="">過去の月…</option>` +
        olderMonths.map((p) =>
          `<option value="${esc(p.key)}"${p.key === activePeriodKey ? " selected" : ""}>${esc(p.label)}</option>`
        ).join("") + `</select>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setPeriod(b.dataset.period)));
    const ms = wrap.querySelector(".month-select");
    if (ms) ms.addEventListener("change", () => { if (ms.value) setPeriod(ms.value); });
  });
}

function setPeriod(key) {
  activePeriodKey = key;
  renderPeriodTabs();
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

// 同点時: rukupractice を最上位、それ以外はホスト(slug)のABC昇順
function tieBreak(a, b) {
  if (a.host === RUKU_HOST && b.host !== RUKU_HOST) return -1;
  if (b.host === RUKU_HOST && a.host !== RUKU_HOST) return 1;
  return String(a.host || "").localeCompare(String(b.host || ""));
}

function sortPublishers(list) {
  const dir = sortDir === "asc" ? 1 : -1;
  const arr = list.slice();
  arr.sort((a, b) => {
    if (sortKey === "name") {
      const r = String(a.name).localeCompare(String(b.name), "ja") * dir;
      return r || tieBreak(a, b);
    }
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) va = sortKey === "avg_rank" ? 999 : 0;
    if (vb == null) vb = sortKey === "avg_rank" ? 999 : 0;
    if (va === vb) return tieBreak(a, b);
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
    const c = (key) => "c-" + key + (key === sortKey ? " is-sorted" : "");
    return `<tr class="medal-${idx}">
      <td class="col-idx">${idx}</td>
      <td class="col-avatar">${avatarHtml(p)}</td>
      <td class="col-name ${"name" === sortKey ? "is-sorted" : ""}">${link}${host}</td>
      <td class="${c("days")}">${p.days}</td>
      <td class="${c("top1")} ${p.top1 ? "hot" : ""}">${p.top1}</td>
      <td class="${c("top3")}">${p.top3}</td>
      <td class="${c("top10")}">${p.top10}</td>
      <td class="${c("avg_rank")}">${p.avg_rank}位</td>
      <td class="${c("avg_attention")}">${p.avg_attention}</td>
      <td class="${c("avg_likes")}">${p.avg_likes}</td>
      <td class="${c("avg_restacks")}">${p.avg_restacks}</td>
      <td class="${c("avg_comments")}">${p.avg_comments}</td>
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

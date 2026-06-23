"use strict";

let DATA = null;
let DAILY = null;
let dailyPromise = null;
let cumByHost = {};
let dailyDate = null;
let activePeriodKey = "cumulative";
let sortKey = "top10";
let sortDir = "desc"; // desc | asc
let searchTerm = "";
const RUKU_HOST = "rukupractice.substack.com";

function loadDaily() {
  if (!dailyPromise) {
    dailyPromise = fetch("daily.json", { cache: "no-cache" })
      .then((r) => r.json()).then((d) => (DAILY = d));
  }
  return dailyPromise;
}

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
  const cum = DATA.periods.find((p) => p.key === "cumulative") || DATA.periods[0];
  (cum.publishers || []).forEach((p) => { cumByHost[p.host] = p; });
  renderMeta();
  renderPeriodTabs();
  bindEvents();
  renderRanking();
  renderTrends();
  const h = location.hash;
  if (h === "#trends") activateView("trends");
  else if (h === "#daily") activateView("daily");
}

function activateView(view) {
  $$("#viewTabs .tab").forEach((x) => x.classList.toggle("is-active", x.dataset.view === view));
  $("#rankingView").hidden = view !== "ranking";
  $("#trendsView").hidden = view !== "trends";
  $("#dailyView").hidden = view !== "daily";
  if (view === "daily") initDailyView();
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
      history.replaceState(null, "", v === "ranking" ? "#" : "#" + v);
    }));

  // ランキング行クリック → 発行元詳細（リンククリックは除外）
  $("#rankBody").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-host]");
    if (tr) openDetail(tr.dataset.host);
  });

  // 日別ビュー: 前/次・日付選択
  $("#dayPrev").addEventListener("click", () => stepDay(-1));
  $("#dayNext").addEventListener("click", () => stepDay(1));
  $("#daySelect").addEventListener("change", (e) => renderDaily(e.target.value));
  $("#dailyBody").addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const tr = e.target.closest("tr[data-host]");
    if (tr) openDetail(tr.dataset.host);
  });

  // モーダル閉じる
  $("#dmClose").addEventListener("click", closeDetail);
  $("#detailModal").addEventListener("click", (e) => { if (e.target.id === "detailModal") closeDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDetail(); });
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
    `${period.label}：${period.start} 〜 ${period.end}（${period.days}日間・${period.entries}件）／ 見出しクリックで並べ替え・行クリックで順位推移`;

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
    return `<tr class="medal-${idx} row-click" data-host="${esc(p.host)}" title="クリックで詳細・順位推移">
      <td class="col-idx"><span class="rank-num">${idx}</span></td>
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

/* ── 発行元 詳細モーダル ─────────────────────────────── */
function showModal() { $("#detailModal").hidden = false; document.body.classList.add("modal-open"); }
function closeDetail() { $("#detailModal").hidden = true; document.body.classList.remove("modal-open"); }

function statChips(p) {
  const items = [
    ["登場日数", p.days + "日"],
    ["最高順位", p.best_rank ? p.best_rank + "位" : "–"],
    ["平均順位", p.avg_rank + "位"],
    ["1位", p.top1 + "回"],
    ["Top3", p.top3 + "回"],
    ["Top10", p.top10 + "回"],
    ["平均注目度", p.avg_attention],
    ["平均❤️", p.avg_likes],
  ];
  return items.map(([l, v]) =>
    `<div class="dm-stat"><span class="dm-stat-v">${esc(String(v))}</span><span class="dm-stat-l">${esc(l)}</span></div>`
  ).join("");
}

function buildRankChart(apps) {
  const dates = DAILY.dates, N = dates.length;
  const idxOf = {}; dates.forEach((d, i) => (idxOf[d] = i));
  const W = 640, H = 240, padL = 30, padR = 14, padT = 16, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB, maxR = 30;
  const x = (i) => padL + (N <= 1 ? innerW / 2 : (i / (N - 1)) * innerW);
  const y = (r) => padT + ((Math.min(r, maxR) - 1) / (maxR - 1)) * innerH;
  const guides = [1, 10, 20, 30].map((r) =>
    `<line x1="${padL}" y1="${y(r).toFixed(1)}" x2="${W - padR}" y2="${y(r).toFixed(1)}" class="g-grid"/>` +
    `<text x="${padL - 5}" y="${(y(r) + 3).toFixed(1)}" class="g-lbl" text-anchor="end">${r}</text>`
  ).join("");
  const pts = apps.map((a) => `${x(idxOf[a.date]).toFixed(1)},${y(a.r).toFixed(1)}`).join(" ");
  const line = apps.length > 1 ? `<polyline points="${pts}" class="g-line"/>` : "";
  const bestR = Math.min(...apps.map((a) => a.r));
  const dots = apps.map((a) =>
    `<circle cx="${x(idxOf[a.date]).toFixed(1)}" cy="${y(a.r).toFixed(1)}" r="${a.r === bestR ? 4.5 : 3}" class="g-dot${a.r === bestR ? " g-best" : ""}"><title>${a.date} ${a.r}位</title></circle>`
  ).join("");
  const xl = `<text x="${padL}" y="${H - 6}" class="g-lbl">${dates[0].slice(5)}</text>` +
    `<text x="${W - padR}" y="${H - 6}" class="g-lbl" text-anchor="end">${dates[N - 1].slice(5)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="rank-chart">${guides}${line}${dots}${xl}</svg>`;
}

async function openDetail(host) {
  const cum = cumByHost[host];
  const name = cum ? cum.name : host;
  const url = cum ? cum.url : "https://" + host + "/";
  const logo = (DATA.logos && DATA.logos[host]) || "";
  $("#dmName").textContent = name;
  $("#dmName").href = url;
  $("#dmHost").textContent = host;
  const av = $("#dmAvatar");
  if (logo) { av.src = logo; av.style.display = ""; } else { av.style.display = "none"; }
  $("#dmStats").innerHTML = cum ? statChips(cum) : "";
  $("#dmChartSub").textContent = "";
  $("#dmChart").innerHTML = '<div class="dm-loading">読み込み中…</div>';
  $("#dmHistory").innerHTML = "";
  showModal();
  await loadDaily();
  const apps = [];
  DAILY.dates.forEach((d) => (DAILY.days[d] || []).forEach((e) => { if (e.h === host) apps.push({ date: d, ...e }); }));
  if (!apps.length) { $("#dmChart").innerHTML = '<div class="dm-loading">データなし</div>'; return; }
  const bestR = Math.min(...apps.map((a) => a.r));
  $("#dmChartSub").textContent = `（${apps.length}回登場・最高${bestR}位）`;
  $("#dmChart").innerHTML = buildRankChart(apps);
  const desc = apps.slice().reverse().slice(0, 40);
  $("#dmHistory").innerHTML = desc.map((a) =>
    `<a class="dm-h-row" href="${esc(a.u)}" target="_blank" rel="noopener">` +
    `<span class="dm-h-rank medal-${a.r <= 3 ? a.r : "x"}">${a.r}位</span>` +
    `<span class="dm-h-title">${esc(a.t || "(無題)")}</span>` +
    `<span class="dm-h-meta">${a.date.slice(5)}・注目度${a.a}</span></a>`
  ).join("");
}

/* ── 日別TOP30ビュー ─────────────────────────────────── */
let dailyInited = false;
function initDailyView() {
  loadDaily().then(() => {
    if (dailyInited) return;
    dailyInited = true;
    const sel = $("#daySelect");
    sel.innerHTML = DAILY.dates.slice().reverse().map((d) => `<option value="${d}">${d}</option>`).join("");
    renderDaily(DAILY.dates[DAILY.dates.length - 1]);
  });
}
function stepDay(delta) {
  if (!DAILY) return;
  const i = DAILY.dates.indexOf(dailyDate);
  const ni = i + delta;
  if (ni >= 0 && ni < DAILY.dates.length) renderDaily(DAILY.dates[ni]);
}
function avatarByHost(host, name, root) {
  const logo = (DATA.logos && DATA.logos[host]) || "";
  const inner = logo
    ? `<img class="avatar" src="${esc(logo)}" loading="lazy" decoding="async" alt="">`
    : `<span class="avatar avatar-fallback">${esc((name || "?").trim().charAt(0))}</span>`;
  return `<a class="avatar-link" href="${esc(root)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${inner}</a>`;
}
function renderDaily(date) {
  dailyDate = date;
  $("#daySelect").value = date;
  const entries = DAILY.days[date] || [];
  $("#dailyNote").textContent = `${date} の番付 TOP${entries.length}`;
  const i = DAILY.dates.indexOf(date);
  $("#dayPrev").disabled = i <= 0;
  $("#dayNext").disabled = i >= DAILY.dates.length - 1;
  $("#dailyBody").innerHTML = entries.map((e) => {
    const root = "https://" + e.h + "/";
    return `<tr class="medal-${e.r} row-click" data-host="${esc(e.h)}" title="クリックで詳細・順位推移">
      <td class="col-idx"><span class="rank-num">${e.r}</span></td>
      <td class="col-avatar">${avatarByHost(e.h, e.n, root)}</td>
      <td class="col-name"><a href="${esc(root)}" target="_blank" rel="noopener">${esc(e.n)}</a>` +
      `<a class="daily-title" href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.t || "(無題)")}</a></td>
      <td>${e.a}</td><td>${e.l}</td><td>${e.rs}</td><td>${e.c}</td>
    </tr>`;
  }).join("");
}

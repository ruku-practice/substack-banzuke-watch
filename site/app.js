"use strict";

let DATA = null;
let DAILY = null;
let dailyPromise = null;
let cumByHost = {};
let dailyDate = null;
let compareHosts = [];
let selectedCategory = null;
let activePeriodKey = "cumulative";
let sortKey = "top10";
let sortDir = "desc"; // desc | asc
let searchTerm = "";
let renderedPublishers = [];
const RUKU_HOST = "rukupractice.substack.com";
const DETAIL_PARAM = "p";
const PERIOD_PARAM = "period";

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
  const requestedPeriod = new URLSearchParams(location.search).get(PERIOD_PARAM);
  if (requestedPeriod && DATA.periods.some((p) => p.key === requestedPeriod)) {
    activePeriodKey = requestedPeriod;
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
  else if (h === "#risers") activateView("risers");
  else if (h === "#newcomers") activateView("newcomers");
  const initialHost = new URLSearchParams(location.search).get(DETAIL_PARAM);
  if (initialHost && cumByHost[initialHost]) openDetail(initialHost, { updateUrl: false });
}

function activateView(view) {
  $$("#viewTabs .tab").forEach((x) => x.classList.toggle("is-active", x.dataset.view === view));
  $("#rankingView").hidden = view !== "ranking";
  $("#trendsView").hidden = view !== "trends";
  $("#dailyView").hidden = view !== "daily";
  $("#riserView").hidden = view !== "risers";
  $("#newcomerView").hidden = view !== "newcomers";
  if (view === "daily") initDailyView();
  if (view === "risers") renderRisers();
  if (view === "newcomers") renderNewcomers(currentPeriod());
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

  ["#periodTabs", "#periodTabsTrends", "#periodTabsRisers", "#periodTabsNewcomers"].forEach((sel) => {
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
  selectedCategory = null;
  renderPeriodTabs();
  renderRanking();
  renderTrends();
  renderRisers();
  renderNewcomers(currentPeriod());
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
    const btn = e.target.closest("button[data-detail-host]");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      openDetail(btn.dataset.detailHost);
      return;
    }
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
  $("#compareA").addEventListener("change", renderCompare);
  $("#compareB").addEventListener("change", renderCompare);
  $("#catTable").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-cat]");
    if (tr) renderCategoryDetail(tr.dataset.cat);
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
  $("#csvExport").addEventListener("click", exportCsv);
  $("#shareX").addEventListener("click", () => shareDetail("x"));
  $("#shareNotes").addEventListener("click", () => shareDetail("notes"));
  $("#copyDetailUrl").addEventListener("click", () => shareDetail("copy"));
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

function scoreCompare(a, b, period) {
  const sa = scoreValue(a, period);
  const sb = scoreValue(b, period);
  if (sa.score !== sb.score) return sb.score - sa.score;
  if (a.top10 !== b.top10) return b.top10 - a.top10;
  if (a.days !== b.days) return b.days - a.days;
  if (a.avg_rank !== b.avg_rank) return a.avg_rank - b.avg_rank;
  return tieBreak(a, b);
}

function scoreRankMap(list, period) {
  const map = {};
  list.slice().sort((a, b) => scoreCompare(a, b, period)).forEach((p, i) => {
    map[p.host] = i + 1;
  });
  return map;
}

function renderRanking() {
  const period = currentPeriod();
  $("#periodNote").textContent =
    `${period.label}：${period.start} 〜 ${period.end}（${period.days}日間・${period.entries}件）／ 見出しクリックで並べ替え・詳細ボタンで順位推移`;

  let list = period.publishers;
  if (searchTerm) {
    list = list.filter((p) =>
      (p.name || "").toLowerCase().includes(searchTerm) ||
      (p.host || "").toLowerCase().includes(searchTerm));
  }
  list = sortPublishers(list);
  renderedPublishers = list;
  renderScorePanel(period, list);

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
    const score = scoreValue(p, period).score;
    const link = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>`
      : `<span>${esc(p.name)}</span>`;
    const host = p.host ? `<span class="host">${esc(p.host)}</span>` : "";
    const c = (key) => "c-" + key + (key === sortKey ? " is-sorted" : "");
    return `<tr class="medal-${idx} row-click" data-host="${esc(p.host)}" title="クリックで詳細・順位推移">
      <td class="col-idx"><span class="rank-num">${idx}</span></td>
      <td class="col-avatar">${avatarHtml(p)}</td>
      <td class="col-name ${"name" === sortKey ? "is-sorted" : ""}">${link}${host}</td>
      <td class="col-action">
        <button type="button" class="detail-btn" data-detail-host="${esc(p.host)}" aria-label="${esc(p.name)} の詳細と順位推移を開く">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 12.5h11"/><path d="M5 11l3-3 2.2 1.8L12.5 6"/><path d="M12.5 6v4"/><path d="M12.5 6h-4"/></svg>
          <span>詳細</span>
        </button>
      </td>
      <td><span class="score-value-badge">${score}</span></td>
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

function scoreValue(p, period) {
  const publishers = period.publishers || [];
  const byTop10 = publishers.slice().sort((a, b) => (b.top10 - a.top10) || tieBreak(a, b));
  const top10Rank = Math.max(1, byTop10.findIndex((x) => x.host === p.host) + 1);
  const pct = publishers.length > 1 ? (publishers.length - top10Rank) / (publishers.length - 1) : 1;
  const continuity = period.days ? Math.min(1, p.days / period.days) : 0;
  const rankPower = p.avg_rank ? Math.max(0, (31 - p.avg_rank) / 30) : 0;
  return {
    score: Math.round(45 + pct * 25 + continuity * 18 + rankPower * 12),
    top10Rank,
    top10Rate: p.days ? Math.round((p.top10 / p.days) * 100) : 0,
    continuity: Math.round(continuity * 100),
  };
}

function scoreLabel(score) {
  if (score >= 80) return "横綱級";
  if (score >= 70) return "大関級";
  if (score >= 62) return "関脇級";
  if (score >= 55) return "小結級";
  return "幕内級";
}

function scoreHtml(p, period, compact = false, scoreRank = null) {
  const s = scoreValue(p, period);
  const label = scoreLabel(s.score);
  return `<div class="score-main${compact ? " compact" : ""}">
    <div class="score-ring" aria-label="番付偏差値 ${s.score}"><span>${s.score}</span><small>偏差値</small></div>
    <div class="score-copy">
      <b>${esc(label)}</b>
      <span>${esc(period.label)}でTop10回数 ${s.top10Rank}位。登場日のTop10率 ${s.top10Rate}%、番付への継続登場率 ${s.continuity}%。</span>
      <small class="score-rank-line">${scoreRank ? `偏差値順位 ${scoreRank}位` : "偏差値順位を計算中…"}</small>
      <small>算出: Top10回数の相対順位 + 登場継続率 + 平均順位</small>
    </div>
  </div>`;
}

function renderScorePanel(period, visibleList) {
  const panel = $("#scorePanel");
  if (!panel) return;
  if (!searchTerm || visibleList.length !== 1) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const p = visibleList[0];
  const ranks = scoreRankMap(period.publishers || [], period);
  panel.hidden = false;
  panel.innerHTML = `<div class="score-panel-head">
    <span class="score-eyebrow">自分の番付偏差値</span>
    <button type="button" data-detail-host="${esc(p.host)}">詳細を見る</button>
  </div>${scoreHtml(p, period, false, ranks[p.host])}`;
  const btn = panel.querySelector("[data-detail-host]");
  if (btn) btn.addEventListener("click", () => openDetail(btn.dataset.detailHost));
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
      `<tr class="row-click" data-cat="${esc(c.category)}" title="クリックで深掘り"><td style="text-align:left">${esc(c.category)}</td><td>${c.top10}</td><td>${c.top3}</td><td>${c.entries}</td><td>${c.avg_attention}</td></tr>`
    ).join("") + "</tbody>";

  renderCompareSelectors(period);
  renderCompare();
  renderCategoryDetail();
  renderNewcomers(period);
  loadDaily().then(() => {
    if (selectedCategory !== "__none__" && !$("#trendsView").hidden) renderCategoryDetail();
  });
  renderRisers();
}

function renderCompareSelectors(period) {
  const list = sortPublishers(period.publishers || []);
  compareHosts = list.slice(0, 2).map((p) => p.host);
  const opts = list.map((p) => `<option value="${esc(p.host)}">${esc(p.name)} (${esc(p.host)})</option>`).join("");
  const a = $("#compareA");
  const b = $("#compareB");
  if (!a || !b) return;
  if (a.innerHTML !== opts) a.innerHTML = opts;
  if (b.innerHTML !== opts) b.innerHTML = opts;
  if (compareHosts[0]) a.value = compareHosts[0];
  if (compareHosts[1]) b.value = compareHosts[1];
  else b.value = compareHosts[0] || a.value;
}

function compareStat(p, period) {
  const s = scoreValue(p, period);
  return {
    host: p.host,
    name: p.name,
    category: p.category || "（カテゴリ未設定）",
    first_date: p.first_date || "—",
    days: p.days,
    top1: p.top1,
    top3: p.top3,
    top10: p.top10,
    top10Rate: s.top10Rate,
    avg_rank: p.avg_rank,
    best_rank: p.best_rank || "—",
    avg_attention: p.avg_attention,
    score: s.score,
    label: scoreLabel(s.score),
  };
}

function renderCompare() {
  const period = currentPeriod();
  const list = period.publishers || [];
  if (!list.length) return;
  const aHost = $("#compareA")?.value || list[0].host;
  const bHost = $("#compareB")?.value || list[Math.min(1, list.length - 1)].host || list[0].host;
  const a = list.find((p) => p.host === aHost) || list[0];
  const b = list.find((p) => p.host === bHost) || list[Math.min(1, list.length - 1)] || list[0];
  if (!a || !b) return;
  const sa = compareStat(a, period);
  const sb = compareStat(b, period);
  const rows = [
    ["カテゴリー", sa.category, sb.category],
    ["初登場", sa.first_date, sb.first_date],
    ["登場日数", `${sa.days}日`, `${sb.days}日`],
    ["Top1", `${sa.top1}回`, `${sb.top1}回`],
    ["Top3", `${sa.top3}回`, `${sb.top3}回`],
    ["Top10", `${sa.top10}回`, `${sb.top10}回`],
    ["Top10率", `${sa.top10Rate}%`, `${sb.top10Rate}%`],
    ["平均順位", `${sa.avg_rank}位`, `${sb.avg_rank}位`],
    ["最高順位", `${sa.best_rank}位`, `${sb.best_rank}位`],
    ["平均注目度", sa.avg_attention, sb.avg_attention],
    ["番付偏差値", `${sa.score} (${sa.label})`, `${sb.score} (${sb.label})`],
  ];
  $("#compareTable").innerHTML =
    `<thead><tr><th style="text-align:left">項目</th><th style="text-align:left">${esc(sa.name)}</th><th style="text-align:left">${esc(sb.name)}</th></tr></thead>` +
    "<tbody>" + rows.map((r) =>
      `<tr><td style="text-align:left">${esc(r[0])}</td><td style="text-align:left">${esc(r[1])}</td><td style="text-align:left">${esc(r[2])}</td></tr>`
    ).join("") + "</tbody>";
  const winner = sa.score === sb.score ? "引き分け" : (sa.score > sb.score ? sa.name : sb.name);
  $("#compareSummary").innerHTML =
    `<div class="compare-pill">比較基準: <b>${esc(period.label)}</b></div>` +
    `<div class="compare-pill">勝ち筋: <b>${esc(winner)}</b></div>`;
}

function renderCategoryDetail(cat) {
  const period = currentPeriod();
  if (cat !== undefined) selectedCategory = cat || "__none__";
  const key = selectedCategory === "__none__"
    ? null
    : (selectedCategory || (period.trends.categories && period.trends.categories[0] && period.trends.categories[0].category));
  const panel = $("#categoryDetail");
  if (!panel) return;
  if (!key) {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  const pubs = (period.publishers || [])
    .filter((p) => (p.category || "（カテゴリ未設定）") === key)
    .sort((a, b) => (b.top10 - a.top10) || (a.avg_rank - b.avg_rank) || tieBreak(a, b))
    .slice(0, 8);
  const entries = [];
  if (DAILY && DAILY.dates) {
    DAILY.dates.forEach((d) => (DAILY.days[d] || []).forEach((e) => {
      if ((e.cat || "（カテゴリ未設定）") === key) entries.push({ date: d, ...e });
    }));
  }
  entries.sort((a, b) => b.date.localeCompare(a.date) || a.r - b.r);
  const recent = entries.slice(0, 8);
  panel.hidden = false;
  panel.innerHTML = `
    <div class="category-detail-head">
      <div>
        <span class="category-eyebrow">カテゴリ深掘り</span>
        <h4>${esc(key)}</h4>
      </div>
      <button type="button" id="categoryReset">カテゴリ選択を解除</button>
    </div>
    <div class="category-detail-grid">
      <div>
        <div class="category-mini-title">強い発行元</div>
        <ol class="category-list">
          ${pubs.map((p) => `<li><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a><span>${p.top10}回 / 平均${p.avg_rank}位</span></li>`).join("")}
        </ol>
      </div>
      <div>
        <div class="category-mini-title">最新の番付入り記事</div>
        <ol class="category-list">
          ${recent.map((e) => `<li><a href="${esc(e.u)}" target="_blank" rel="noopener">${esc(e.t || "(無題)")}</a><span>${esc(e.date)} / ${esc(e.n)} / ${e.r}位</span></li>`).join("")}
        </ol>
      </div>
    </div>`;
  const reset = $("#categoryReset");
  if (reset) reset.addEventListener("click", () => {
    selectedCategory = "__none__";
    panel.hidden = true;
    panel.innerHTML = "";
  });
}

function renderNewcomers(period) {
  const list = (period.publishers || [])
    .filter((p) => p.first_date)
    .sort((a, b) => String(b.first_date).localeCompare(String(a.first_date)) || (a.best_rank - b.best_rank) || tieBreak(a, b))
    .slice(0, 12);
  const note = $("#newcomerNote");
  if (note) note.textContent = `${period.label}で初めて番付入りした発行元の一覧`;
  $("#newcomerTable").innerHTML =
    `<thead><tr><th style="text-align:left">発行元</th><th>初登場</th><th>登場日数</th><th>Top10</th><th>最高順位</th></tr></thead>` +
    "<tbody>" + list.map((p) =>
      `<tr class="row-click" data-host="${esc(p.host)}"><td style="text-align:left"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a><span class="host">${esc(p.host)}</span></td><td>${esc(p.first_date)}</td><td>${p.days}</td><td>${p.top10}</td><td>${p.best_rank || "—"}</td></tr>`
    ).join("") + "</tbody>";
  $("#newcomerTable").querySelectorAll("tr[data-host]").forEach((tr) =>
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) openDetail(tr.dataset.host); }));
}

function renderRisers() {
  const last7 = DATA.periods.find((p) => p.key === "last7");
  const cumulative = DATA.periods.find((p) => p.key === "cumulative") || DATA.periods[0];
  if (!last7 || !cumulative) return;
  const rankByTop10 = (list) => list.slice().sort((a, b) =>
    (b.top10 - a.top10) || (b.top3 - a.top3) || (a.avg_rank - b.avg_rank) || tieBreak(a, b));
  const cumRank = {};
  rankByTop10(cumulative.publishers).forEach((p, i) => { cumRank[p.host] = i + 1; });
  const risers = rankByTop10(last7.publishers)
    .map((p, i) => {
      const cRank = cumRank[p.host] || cumulative.publishers.length + 1;
      return { ...p, recent_rank: i + 1, cumulative_rank: cRank, rise: cRank - (i + 1) };
    })
    .filter((p) => p.top10 > 0 && p.rise > 0)
    .sort((a, b) => (b.rise - a.rise) || (b.top10 - a.top10) || tieBreak(a, b))
    .slice(0, 12);
  const note = $("#riserNote");
  if (note) note.textContent = "直近7日のTop10入りと累積順位を比べた急上昇リスト";
  $("#riserTable").innerHTML =
    `<thead><tr><th style="text-align:left">発行元</th><th>7日順位</th><th>累積順位</th><th>上昇</th><th>Top10</th></tr></thead>` +
    "<tbody>" + risers.map((p) =>
      `<tr class="row-click" data-host="${esc(p.host)}"><td style="text-align:left"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a><span class="host">${esc(p.host)}</span></td><td>${p.recent_rank}</td><td>${p.cumulative_rank}</td><td>+${p.rise}</td><td>${p.top10}</td></tr>`
    ).join("") + "</tbody>";
  $("#riserTable").querySelectorAll("tr[data-host]").forEach((tr) =>
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) openDetail(tr.dataset.host); }));
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const period = currentPeriod();
  const header = ["rank", "name", "host", "days", "top1", "top3", "top10", "avg_rank", "avg_attention", "avg_likes", "avg_restacks", "avg_comments", "url"];
  const rows = renderedPublishers.map((p, i) => [
    i + 1, p.name, p.host, p.days, p.top1, p.top3, p.top10, p.avg_rank,
    p.avg_attention, p.avg_likes, p.avg_restacks, p.avg_comments, p.url,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `banzuke-${period.key}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── 発行元 詳細モーダル ─────────────────────────────── */
function showModal() { $("#detailModal").hidden = false; document.body.classList.add("modal-open"); }
function closeDetail() {
  $("#detailModal").hidden = true;
  document.body.classList.remove("modal-open");
  if (new URLSearchParams(location.search).has(DETAIL_PARAM)) {
    const url = new URL(location.href);
    url.searchParams.delete(DETAIL_PARAM);
    history.replaceState(null, "", url.pathname + url.search + location.hash);
  }
}

function statChips(p, extra = []) {
  const items = [
    ["登場日数", p.days + "日"],
    ["最高順位", p.best_rank ? p.best_rank + "位" : "–"],
    ["平均順位", p.avg_rank + "位"],
    ["1位", p.top1 + "回"],
    ["Top3", p.top3 + "回"],
    ["Top10", p.top10 + "回"],
    ["平均注目度", p.avg_attention],
    ["平均❤️", p.avg_likes],
  ].concat(extra);
  return items.map(([l, v]) =>
    `<div class="dm-stat"><span class="dm-stat-v">${esc(String(v))}</span><span class="dm-stat-l">${esc(l)}</span></div>`
  ).join("");
}

function detailShareUrl(host, periodKey = activePeriodKey) {
  const url = new URL(location.href);
  url.searchParams.set(PERIOD_PARAM, periodKey);
  url.searchParams.set(DETAIL_PARAM, host);
  if (!url.hash) url.hash = location.hash || "#ranking";
  return url.toString();
}

function detailShareText(host, kind = "x") {
  const period = currentPeriod();
  const periodPub = (period.publishers || []).find((p) => p.host === host) || cumByHost[host];
  if (!periodPub) return "";
  const ranks = scoreRankMap(period.publishers || [], period);
  const s = scoreValue(periodPub, period);
  const label = scoreLabel(s.score);
  const url = detailShareUrl(host, period.key);
  const lines = [
    `${periodPub.name}｜${period.label}`,
    `偏差値 ${s.score}（${label}） / 偏差値順位 ${ranks[host] || "–"}位`,
    `Top10回数 ${s.top10Rank}位・登場日のTop10率 ${s.top10Rate}%`,
  ];
  if (kind === "notes") return [...lines, url].join("\n");
  return lines.join(" ");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

async function shareDetail(kind) {
  const host = $("#dmName").dataset.host || ($("#dmHost").textContent || "");
  if (!host) return;
  const text = detailShareText(host, kind);
  const url = detailShareUrl(host, activePeriodKey);
  if (kind === "x") {
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener");
    return;
  }
  await copyTextToClipboard(kind === "copy" ? url : text);
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

async function openDetail(host, opts = {}) {
  const updateUrl = opts.updateUrl !== false;
  const cum = cumByHost[host];
  const name = cum ? cum.name : host;
  const url = cum ? cum.url : "https://" + host + "/";
  const logo = (DATA.logos && DATA.logos[host]) || "";
  $("#dmName").textContent = name;
  $("#dmName").href = url;
  $("#dmName").dataset.host = host;
  $("#dmHost").textContent = host;
  const av = $("#dmAvatar");
  if (logo) { av.src = logo; av.style.display = ""; } else { av.style.display = "none"; }
  const period = currentPeriod();
  const periodPub = (period.publishers || []).find((p) => p.host === host) || cum;
  const ranks = scoreRankMap(period.publishers || [], period);
  $("#dmStats").innerHTML = cum ? statChips(cum, periodPub ? [["偏差値順位", `${ranks[host] || "–"}位`]] : []) : "";
  $("#dmScore").innerHTML = periodPub ? scoreHtml(periodPub, period, true, ranks[host]) : "";
  $("#dmChartSub").textContent = "";
  $("#dmChart").innerHTML = '<div class="dm-loading">読み込み中…</div>';
  $("#dmHistory").innerHTML = "";
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set(DETAIL_PARAM, host);
    history.replaceState(null, "", url.pathname + url.search + location.hash);
  }
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

"use strict";

let DATA = null;
let DAILY = null;
let dailyPromise = null;
let cumByHost = {};
let dailyDate = null;
let compareHosts = [];
let selectedCategory = null;
let activePeriodKey = "last30";
let customPeriod = null;
let customRange = null;
let activeView = "ranking";
let sortKey = "top10";
let sortDir = "desc"; // desc | asc
let searchTerm = "";
let riserSearchTerm = "";
let newcomerSearchTerm = "";
let renderedPublishers = [];
const RUKU_HOST = "rukupractice.substack.com";
const DETAIL_PARAM = "p";
const PERIOD_PARAM = "period";
const VIEW_PARAM = "view";
const RANK_QUERY_PARAM = "rq";
const RISER_QUERY_PARAM = "xq";
const NEWCOMER_QUERY_PARAM = "nq";

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
  const params = new URLSearchParams(location.search);
  const requestedPeriod = params.get(PERIOD_PARAM);
  const requestedView = params.get(VIEW_PARAM);
  const requestedSearch = params.get(RANK_QUERY_PARAM);
  const requestedRiserSearch = params.get(RISER_QUERY_PARAM);
  const requestedNewcomerSearch = params.get(NEWCOMER_QUERY_PARAM);
  if (requestedPeriod && DATA.periods.some((p) => p.key === requestedPeriod)) activePeriodKey = requestedPeriod;
  let restoreCustom = false;
  if (requestedPeriod === "custom") {
    activePeriodKey = "custom";
    const crs = params.get("crs"), cre = params.get("cre");
    if (crs && cre) customRange = { start: crs, end: cre };
    restoreCustom = true;
  }
  if (requestedView && ["ranking", "trends", "daily", "risers", "newcomers"].includes(requestedView)) activeView = requestedView;
  else {
    const hashView = location.hash.replace(/^#/, "");
    if (["trends", "daily", "risers", "newcomers"].includes(hashView)) activeView = hashView;
  }
  searchTerm = (requestedSearch || "").trim().toLowerCase();
  riserSearchTerm = (requestedRiserSearch || "").trim().toLowerCase();
  newcomerSearchTerm = (requestedNewcomerSearch || "").trim().toLowerCase();
  const cum = DATA.periods.find((p) => p.key === "cumulative") || DATA.periods[0];
  (cum.publishers || []).forEach((p) => { cumByHost[p.host] = p; });
  renderMeta();
  renderPeriodTabs();
  bindEvents();
  renderRanking();
  renderTrends();
  activateView(activeView);
  setupSticky();
  const initialHost = params.get(DETAIL_PARAM);
  if (initialHost && cumByHost[initialHost]) openDetail(initialHost, { updateUrl: false });
  if (restoreCustom) ensureCustomPeriod().then(afterPeriodChange);
}

function activateView(view) {
  activeView = view;
  $$("#viewTabs .tab").forEach((x) => x.classList.toggle("is-active", x.dataset.view === view));
  $("#rankingView").hidden = view !== "ranking";
  $("#trendsView").hidden = view !== "trends";
  $("#dailyView").hidden = view !== "daily";
  $("#riserView").hidden = view !== "risers";
  $("#newcomerView").hidden = view !== "newcomers";
  if (view === "daily") initDailyView();
  if (view === "risers") {
    // 累積では急上昇を計算できないため、今月（無ければ直近30日）に切替
    if (activePeriodKey === "cumulative") {
      const fallback = DATA.periods.find((p) => p.key === "this_month") || DATA.periods.find((p) => p.key === "last30");
      if (fallback) { activePeriodKey = fallback.key; renderPeriodTabs(); renderRanking(); renderTrends(); renderNewcomers(currentPeriod()); }
    }
    renderRisers();
  }
  if (view === "newcomers") renderNewcomers(currentPeriod());
  syncViewInputs();
  syncViewUrl();
  if (typeof refreshStickyHeader === "function") { const f = document.getElementById("stickyHead"); if (f) f._sig = null; refreshStickyHeader(); }
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
  // タブ順: 直近30日 → 累積 → 今月 → 直近7日
  const ORDER = ["last30", "cumulative", "this_month", "last7"];
  const fixed = DATA.periods.filter((p) => !p.is_month)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const months = DATA.periods.filter((p) => p.is_month);   // 新しい順（build順）
  const recentMonths = months.slice(0, 1);                 // 先月のみタブ
  const olderMonths = months.slice(1);                     // 先月以前はプルダウン

  ["#periodTabs", "#periodTabsTrends", "#periodTabsRisers", "#periodTabsNewcomers"].forEach((sel) => {
    const wrap = $(sel);
    if (!wrap) return;
    // 急上昇は「累積どうし」を比較できないため累積タブを出さない
    const fixedForSel = sel === "#periodTabsRisers" ? fixed.filter((p) => p.key !== "cumulative") : fixed;
    let html = fixedForSel.concat(recentMonths).map((p) =>
      `<button data-period="${esc(p.key)}"${p.key === activePeriodKey ? ' class="is-active"' : ""}>${esc(p.label)}</button>`
    ).join("");
    if (olderMonths.length) {
      html += `<select class="month-select" aria-label="過去の月を選ぶ"><option value="">過去の月…</option>` +
        olderMonths.map((p) =>
          `<option value="${esc(p.key)}"${p.key === activePeriodKey ? " selected" : ""}>${esc(p.label)}</option>`
        ).join("") + `</select>`;
    }
    // 任意の期間
    html += `<button data-period="custom"${activePeriodKey === "custom" ? ' class="is-active"' : ""}>任意の期間</button>`;
    if (activePeriodKey === "custom") {
      const r = customRange || defaultCustomRange();
      const min = DATA.date_range.start, max = DATA.date_range.end;
      html += `<span class="custom-range">` +
        `<input type="date" class="cr-start" value="${esc(r.start)}" min="${esc(min)}" max="${esc(max)}" aria-label="開始日">` +
        `<span class="cr-sep">〜</span>` +
        `<input type="date" class="cr-end" value="${esc(r.end)}" min="${esc(min)}" max="${esc(max)}" aria-label="終了日">` +
        `</span>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => setPeriod(b.dataset.period)));
    const ms = wrap.querySelector(".month-select");
    if (ms) ms.addEventListener("change", () => { if (ms.value) setPeriod(ms.value); });
    const cs = wrap.querySelector(".cr-start"), ce = wrap.querySelector(".cr-end");
    if (cs && ce) {
      const onCh = () => applyCustomRange(cs.value, ce.value);
      cs.addEventListener("change", onCh);
      ce.addEventListener("change", onCh);
    }
  });
}

function setPeriod(key) {
  activePeriodKey = key;
  selectedCategory = null;
  if (key === "custom") { ensureCustomPeriod().then(afterPeriodChange); return; }
  afterPeriodChange();
}

function afterPeriodChange() {
  renderPeriodTabs();
  renderRanking();
  renderTrends();
  renderRisers();
  renderNewcomers(currentPeriod());
  syncViewUrl();
}

function defaultCustomRange() {
  const end = DATA.date_range.end;
  const d = new Date(end + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 13);
  let start = d.toISOString().slice(0, 10);
  if (start < DATA.date_range.start) start = DATA.date_range.start;
  return { start, end };
}

async function ensureCustomPeriod() {
  await loadDaily();
  if (!customRange) customRange = defaultCustomRange();
  customPeriod = buildCustomPeriod(customRange.start, customRange.end);
}

function applyCustomRange(start, end) {
  if (!start || !end) return;
  if (start > end) { const t = start; start = end; end = t; }
  const min = DATA.date_range.start, max = DATA.date_range.end;
  if (start < min) start = min;
  if (end > max) end = max;
  customRange = { start, end };
  activePeriodKey = "custom";
  loadDaily().then(() => { customPeriod = buildCustomPeriod(start, end); afterPeriodChange(); });
}

// daily.json から任意期間の発行元集計（build_site_data.py と同じロジック）
function aggregateFromDailyRows(rows) {
  const g = new Map();
  for (const e of rows) {
    const key = e.h || e.n;
    let s = g.get(key);
    if (!s) { s = { dates: new Set(), app: 0, top1: 0, top3: 0, top10: 0, rankSum: 0, best: 99, att: 0, likes: 0, rs: 0, c: 0, latest: "", first: "", name: "", host: "", url: "", cat: {} }; g.set(key, s); }
    s.dates.add(e.date); s.app++;
    const rk = e.r;
    if (rk === 1) s.top1++;
    if (rk <= 3) s.top3++;
    if (rk <= 10) s.top10++;
    s.rankSum += rk; if (rk < s.best) s.best = rk;
    s.att += e.a; s.likes += e.l; s.rs += e.rs; s.c += e.c;
    if (e.cat) s.cat[e.cat] = (s.cat[e.cat] || 0) + 1;
    if (!s.first || e.date < s.first) s.first = e.date;
    if (e.date >= s.latest) { s.latest = e.date; s.name = e.n; s.host = e.h; s.url = e.h ? ("https://" + e.h + "/") : e.u; }
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const out = [];
  for (const [key, s] of g) {
    const n = s.app;
    let cat = "", bestCnt = -1;
    for (const [k, v] of Object.entries(s.cat)) { if (v > bestCnt || (v === bestCnt && k < cat)) { bestCnt = v; cat = k; } }
    out.push({
      name: s.name || key, host: s.host, url: s.url, days: s.dates.size, appearances: n,
      first_date: s.first || null, category: cat,
      top1: s.top1, top3: s.top3, top10: s.top10,
      avg_rank: n ? r1(s.rankSum / n) : 0, best_rank: s.best !== 99 ? s.best : null,
      avg_attention: n ? r1(s.att / n) : 0, avg_likes: n ? r1(s.likes / n) : 0,
      avg_restacks: n ? r1(s.rs / n) : 0, avg_comments: n ? r1(s.c / n) : 0,
    });
  }
  out.sort((a, b) => (b.top10 - a.top10)
    || ((a.host === RUKU_HOST ? 0 : 1) - (b.host === RUKU_HOST ? 0 : 1))
    || String(a.host).localeCompare(String(b.host)));
  return out;
}

function trendsFromDailyRows(rows) {
  const r1 = (x) => Math.round(x * 10) / 10;
  const bandsDef = [["1位", 1, 1], ["2〜3位", 2, 3], ["4〜10位", 4, 10], ["11〜20位", 11, 20], ["21〜30位", 21, 30]];
  const bands = [];
  for (const [label, lo, hi] of bandsDef) {
    const sub = rows.filter((e) => e.r >= lo && e.r <= hi);
    const n = sub.length; if (!n) continue;
    const avg = (f) => r1(sub.reduce((s, e) => s + f(e), 0) / n);
    bands.push({ label, n, avg_attention: avg((e) => e.a), avg_likes: avg((e) => e.l), avg_restacks: avg((e) => e.rs), avg_comments: avg((e) => e.c) });
  }
  const attBy = (pred) => { const sub = rows.filter((e) => pred(e.r)); return sub.length ? r1(sub.reduce((s, e) => s + e.a, 0) / sub.length) : 0; };
  const summary = { avg_att_rank1: attBy((r) => r === 1), avg_att_top3: attBy((r) => r <= 3), avg_att_top10: attBy((r) => r <= 10), avg_att_all: attBy(() => true) };
  const cg = new Map();
  for (const e of rows) {
    const k = e.cat || "（カテゴリ未設定）";
    let s = cg.get(k); if (!s) { s = { entries: 0, att: 0, top10: 0, top3: 0 }; cg.set(k, s); }
    s.entries++; s.att += e.a; if (e.r <= 10) s.top10++; if (e.r <= 3) s.top3++;
  }
  const categories = [...cg].map(([category, s]) => ({ category, entries: s.entries, top10: s.top10, top3: s.top3, avg_attention: s.entries ? r1(s.att / s.entries) : 0 }))
    .sort((a, b) => (b.top10 - a.top10) || (b.entries - a.entries));
  return { summary, bands, categories };
}

function buildCustomPeriod(start, end) {
  const rows = [];
  for (const d of DAILY.dates) {
    if (d >= start && d <= end) (DAILY.days[d] || []).forEach((e) => rows.push({ date: d, ...e }));
  }
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  return {
    key: "custom",
    label: `任意（${start}〜${end}）`,
    start: dates[0] || start, end: dates[dates.length - 1] || end,
    days: dates.length, entries: rows.length,
    publishers: aggregateFromDailyRows(rows),
    trends: trendsFromDailyRows(rows),
  };
}

function syncViewInputs() {
  const rankBox = $("#searchBox");
  if (rankBox && rankBox.value !== searchTerm) rankBox.value = searchTerm;
  const riserBox = $("#riserSearchBox");
  if (riserBox && riserBox.value !== riserSearchTerm) riserBox.value = riserSearchTerm;
  const newcomerBox = $("#newcomerSearchBox");
  if (newcomerBox && newcomerBox.value !== newcomerSearchTerm) newcomerBox.value = newcomerSearchTerm;
}

function syncViewUrl() {
  const url = new URL(location.href);
  const params = url.searchParams;
  params.set(PERIOD_PARAM, activePeriodKey);
  if (activePeriodKey === "custom" && customRange) {
    params.set("crs", customRange.start); params.set("cre", customRange.end);
  } else { params.delete("crs"); params.delete("cre"); }
  if (activeView !== "ranking") params.set(VIEW_PARAM, activeView);
  else params.delete(VIEW_PARAM);
  if (searchTerm) params.set(RANK_QUERY_PARAM, searchTerm); else params.delete(RANK_QUERY_PARAM);
  if (riserSearchTerm) params.set(RISER_QUERY_PARAM, riserSearchTerm); else params.delete(RISER_QUERY_PARAM);
  if (newcomerSearchTerm) params.set(NEWCOMER_QUERY_PARAM, newcomerSearchTerm); else params.delete(NEWCOMER_QUERY_PARAM);
  if (activeView === "ranking") url.hash = "#ranking";
  else url.hash = "#" + activeView;
  history.replaceState(null, "", url.pathname + (params.toString() ? "?" + params.toString() : "") + url.hash);
}

function bindEvents() {
  // view tabs
  $$("#viewTabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      const v = t.dataset.view;
      activateView(v);
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
    t = setTimeout(() => {
      searchTerm = e.target.value.trim().toLowerCase();
      renderRanking();
      syncViewUrl();
    }, 120);
  });
  $("#riserSearchBox").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      riserSearchTerm = e.target.value.trim().toLowerCase();
      renderRisers();
      syncViewUrl();
    }, 120);
  });
  $("#newcomerSearchBox").addEventListener("input", (e) => {
    clearTimeout(t);
    t = setTimeout(() => {
      newcomerSearchTerm = e.target.value.trim().toLowerCase();
      renderNewcomers(currentPeriod());
      syncViewUrl();
    }, 120);
  });
  $("#csvExport").addEventListener("click", exportCsv);
  $("#shareX").addEventListener("click", () => shareDetail("x"));
  $("#shareNotes").addEventListener("click", () => shareDetail("notes"));
  $("#copyDetailUrl").addEventListener("click", () => shareDetail("copy"));
  $("#copyImage").addEventListener("click", copyShareImage);
}

function currentPeriod() {
  if (activePeriodKey === "custom" && customPeriod) return customPeriod;
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

// 購読者数の概数ラベル（Substackプロフィール由来・参考値・公開分のみ）。無ければ "–"
function subsLabel(host) {
  return (DATA.subscribers && DATA.subscribers[host]) || "";
}
function subsHtml(host) {
  const s = subsLabel(host);
  return s
    ? `<span class="subs-badge" title="Substackの購読者数（概数・参考値）">${esc(s)}</span>`
    : `<span class="subs-none" title="購読者数は非公開">–</span>`;
}

// 同点時: rukupractice を最上位、それ以外はホスト(slug)のABC昇順
function tieBreak(a, b) {
  if (a.host === RUKU_HOST && b.host !== RUKU_HOST) return -1;
  if (b.host === RUKU_HOST && a.host !== RUKU_HOST) return 1;
  return String(a.host || "").localeCompare(String(b.host || ""));
}

// 列の値が同点のときの第2キー: つみあげスコア（丸める前の精密値）の高い順 → ルク最上位 → ホストABC。
// 精密値はTop10相対順位・登場継続率・平均順位を織り込むので、表示が同じ57でも優劣が付く。
function tieBreakByScore(a, b, period) {
  const ra = scoreValue(a, period).raw;
  const rb = scoreValue(b, period).raw;
  if (ra !== rb) return rb - ra;
  return tieBreak(a, b);
}

function sortPublishers(list, period) {
  const dir = sortDir === "asc" ? 1 : -1;
  const arr = list.slice();
  arr.sort((a, b) => {
    if (sortKey === "name") {
      const r = String(a.name).localeCompare(String(b.name), "ja") * dir;
      return r || tieBreakByScore(a, b, period);
    }
    if (sortKey === "score") {
      const ra = scoreValue(a, period).raw;
      const rb = scoreValue(b, period).raw;
      if (ra === rb) return tieBreak(a, b);
      return (ra - rb) * dir;
    }
    let va = a[sortKey], vb = b[sortKey];
    if (va == null) va = sortKey === "avg_rank" ? 999 : 0;
    if (vb == null) vb = sortKey === "avg_rank" ? 999 : 0;
    if (va === vb) return tieBreakByScore(a, b, period);
    return (va - vb) * dir;
  });
  return arr;
}

function scoreCompare(a, b, period) {
  const ra = scoreValue(a, period).raw;
  const rb = scoreValue(b, period).raw;
  if (ra !== rb) return rb - ra;
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
  list = sortPublishers(list, period);
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
    const score = scoreValue(p, period).scoreText;
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
      <td class="${c("days")}">${p.days}</td>
      <td class="${c("top1")} ${p.top1 ? "hot" : ""}">${p.top1}</td>
      <td class="${c("top3")}">${p.top3}</td>
      <td class="${c("top10")}">${p.top10}</td>
      <td class="${c("avg_rank")}">${p.avg_rank}位</td>
      <td class="${c("avg_attention")}">${p.avg_attention}</td>
      <td class="${c("avg_likes")}">${p.avg_likes}</td>
      <td class="${c("avg_restacks")}">${p.avg_restacks}</td>
      <td class="${c("avg_comments")}">${p.avg_comments}</td>
      <td class="col-score ${"score" === sortKey ? "is-sorted" : ""}"><span class="score-value-badge">${score}</span></td>
      <td class="col-subs">${subsHtml(p.host)}</td>
    </tr>`;
  }).join("");
  if (typeof refreshStickyHeader === "function") refreshStickyHeader();
}

// 期間ごとに Top10回数の分布（パーセンタイル・同数順位）を一度だけ計算してキャッシュ。
function periodComputed(period) {
  if (period._sc) return period._sc;
  const pubs = period.publishers || [];
  const N = pubs.length;
  const counts = new Map();
  pubs.forEach((p) => counts.set(p.top10, (counts.get(p.top10) || 0) + 1));
  const values = [...counts.keys()].sort((a, b) => a - b);
  const lessThan = new Map(); // Top10値 → それ未満の発行元数
  let cum = 0;
  for (const v of values) { lessThan.set(v, cum); cum += counts.get(v); }
  const rankByCount = new Map(); // Top10値 → 表示順位（同数は同順位・1始まり）
  for (const v of values) { rankByCount.set(v, N - lessThan.get(v) - counts.get(v) + 1); }
  const sc = { N, lessThan, rankByCount };
  try { Object.defineProperty(period, "_sc", { value: sc, enumerable: false, configurable: true }); }
  catch (e) { period._sc = sc; }
  return sc;
}

// つみあげスコア: Top10回数のパーセンタイル・登場継続率・平均順位の重み付け合算（その期間の強さ）。
// Top10回数が同じ発行元は pct も同じ → その中の優劣は継続率・平均順位で決まる。
function scoreValue(p, period) {
  const sc = periodComputed(period);
  const top10Rank = sc.rankByCount.get(p.top10) || sc.N;
  const pct = sc.N > 1 ? (sc.lessThan.get(p.top10) || 0) / (sc.N - 1) : 1;
  const continuity = period.days ? Math.min(1, p.days / period.days) : 0;
  const rankPower = p.avg_rank ? Math.max(0, (31 - p.avg_rank) / 30) : 0;
  const raw = 45 + pct * 25 + continuity * 18 + rankPower * 12;
  const score = Math.round(raw * 10) / 10;
  return {
    raw,                          // 丸める前の精密値（並べ替え用）
    score,                        // 小数第1位（称号判定・比較）
    scoreText: score.toFixed(1),  // 表示用文字列 "57.3"
    top10Rank,
    top10Rate: p.days ? Math.round((p.top10 / p.days) * 100) : 0,
    continuity: Math.round(continuity * 100),
  };
}

function scoreLabel(s) {
  if (s >= 80) return "横綱級";
  if (s >= 72) return "大関級";
  if (s >= 65) return "関脇級";
  if (s >= 58) return "小結級";
  if (s >= 52) return "前頭級";
  if (s >= 48) return "十両級";
  return "幕下級";
}

function scoreHtml(p, period, compact = false, scoreRank = null) {
  const s = scoreValue(p, period);
  const label = scoreLabel(s.score);
  return `<div class="score-main${compact ? " compact" : ""}">
    <div class="score-ring" aria-label="つみあげスコア ${s.scoreText}"><span>${s.scoreText}</span><small>スコア</small></div>
    <div class="score-copy">
      <b>${esc(label)}</b>
      <span>${esc(period.label)}でTop10回数 ${s.top10Rank}位。登場日のTop10率 ${s.top10Rate}%、番付への継続登場率 ${s.continuity}%。</span>
      <small class="score-rank-line">つみあげスコア ${s.score}（${esc(label)}）${scoreRank ? ` / スコア順位 ${scoreRank}位` : ""}</small>
      <small>算出: Top10回数の相対順位 ＋ 登場継続率 ＋ 平均順位（日々の好成績の"つみあげ"を点数化）</small>
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
    <span class="score-eyebrow">自分のつみあげスコア</span>
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
      `<tr><td style="text-align:left">${esc(c.category)}</td><td>${c.top10}</td><td>${c.top3}</td><td>${c.entries}</td><td>${c.avg_attention}</td></tr>`
    ).join("") + "</tbody>";

  renderCompareSelectors(period);
  renderCompare();
  renderNewcomers(period);
  renderRisers();
}

function renderCompareSelectors(period) {
  const list = sortPublishers(period.publishers || [], period);
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
    raw: s.raw,
    scoreText: s.scoreText,
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
    ["つみあげスコア", `${sa.scoreText} (${sa.label})`, `${sb.scoreText} (${sb.label})`],
  ];
  $("#compareTable").innerHTML =
    `<thead><tr><th style="text-align:left">項目</th><th style="text-align:left">${esc(sa.name)}</th><th style="text-align:left">${esc(sb.name)}</th></tr></thead>` +
    "<tbody>" + rows.map((r) =>
      `<tr><td style="text-align:left">${esc(r[0])}</td><td style="text-align:left">${esc(r[1])}</td><td style="text-align:left">${esc(r[2])}</td></tr>`
    ).join("") + "</tbody>";
  const winner = sa.raw === sb.raw ? "引き分け" : (sa.raw > sb.raw ? sa.name : sb.name);
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
  let list = (period.publishers || [])
    .filter((p) => p.first_date)
    .sort((a, b) => String(b.first_date).localeCompare(String(a.first_date)) || (a.best_rank - b.best_rank) || tieBreak(a, b))
    .slice(0, 12);
  if (newcomerSearchTerm) {
    list = list.filter((p) =>
      (p.name || "").toLowerCase().includes(newcomerSearchTerm) ||
      (p.host || "").toLowerCase().includes(newcomerSearchTerm));
  }
  const note = $("#newcomerNote");
  if (note) note.textContent = `${period.label}で初めて番付入りした発行元の一覧`;
  const headerRow =
    `<thead><tr><th class="col-avatar"></th><th class="col-name" style="text-align:left">発行元</th><th class="col-action">詳細</th>` +
    `<th class="num">初登場</th><th class="num">登場<br>日数</th><th class="num">Top10</th><th class="num">最高<br>順位</th>` +
    `<th class="num">平均<br>順位</th><th class="num">平均<br>注目度</th><th class="num col-score">つみあげ<br>スコア</th></tr></thead>`;
  if (!list.length) {
    $("#newcomerTable").innerHTML = headerRow +
      `<tbody><tr><td colspan="10" style="text-align:center;color:var(--ink-3);padding:22px 8px">この期間に初登場の発行元はありません。</td></tr></tbody>`;
    return;
  }
  $("#newcomerTable").innerHTML = headerRow +
    "<tbody>" + list.map((p) => {
      const score = scoreValue(p, period).scoreText;
      return `<tr class="row-click" data-host="${esc(p.host)}" title="クリックで詳細・順位推移">` +
      `<td class="col-avatar">${avatarHtml(p)}</td>` +
      `<td class="col-name"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a><span class="host">${esc(p.host)}</span></td>` +
      `<td class="col-action">${detailBtnHtml(p)}</td>` +
      `<td>${esc(p.first_date)}</td><td>${p.days}</td><td>${p.top10}</td><td>${p.best_rank || "—"}</td>` +
      `<td>${p.avg_rank}位</td><td>${p.avg_attention}</td>` +
      `<td class="col-score"><span class="score-value-badge">${score}</span></td></tr>`;
    }).join("") + "</tbody>";
  $("#newcomerTable").querySelectorAll("tr[data-host]").forEach((tr) =>
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) openDetail(tr.dataset.host); }));
}

function renderRisers() {
  const period = currentPeriod();
  const cumulative = DATA.periods.find((p) => p.key === "cumulative") || DATA.periods[0];
  if (!period || !cumulative) return;
  const rankByTop10 = (list) => list.slice().sort((a, b) =>
    (b.top10 - a.top10) || (b.top3 - a.top3) || (a.avg_rank - b.avg_rank) || tieBreak(a, b));
  const cumRank = {};
  rankByTop10(cumulative.publishers).forEach((p, i) => { cumRank[p.host] = i + 1; });
  let risers = rankByTop10(period.publishers || [])
    .map((p, i) => {
      const cRank = cumRank[p.host] || cumulative.publishers.length + 1;
      return { ...p, recent_rank: i + 1, cumulative_rank: cRank, rise: cRank - (i + 1) };
    })
    .filter((p) => p.top10 > 0 && p.rise > 0)
    .sort((a, b) => (b.rise - a.rise) || (b.top10 - a.top10) || tieBreak(a, b));
  if (riserSearchTerm) {
    risers = risers.filter((p) =>
      (p.name || "").toLowerCase().includes(riserSearchTerm) ||
      (p.host || "").toLowerCase().includes(riserSearchTerm));
  }
  risers = risers.slice(0, 12);
  const note = $("#riserNote");
  const isCumulative = activePeriodKey === "cumulative";
  if (note) {
    note.textContent = isCumulative
      ? "「直近7日」「今月」など期間を選ぶと、累積順位からの急上昇が出ます（累積どうしは比較できません）。"
      : `${period.label}のTop10入りと累積順位を比べた急上昇リスト`;
  }
  const headerRow =
    `<thead><tr><th class="col-avatar"></th><th class="col-name" style="text-align:left">発行元</th><th class="col-action">詳細</th>` +
    `<th class="num">上昇</th><th class="num">${esc(period.label)}<br>順位</th><th class="num">累積<br>順位</th>` +
    `<th class="num">Top10</th><th class="num">平均<br>順位</th><th class="num">平均<br>注目度</th><th class="num col-score">つみあげ<br>スコア</th></tr></thead>`;
  if (!risers.length) {
    $("#riserTable").innerHTML = headerRow +
      `<tbody><tr><td colspan="10" style="text-align:center;color:var(--ink-3);padding:22px 8px">` +
      (isCumulative
        ? "上の期間タブから「直近7日」などを選んでください。"
        : "この期間に該当する急上昇の発行元はありません。") +
      `</td></tr></tbody>`;
    return;
  }
  $("#riserTable").innerHTML = headerRow +
    "<tbody>" + risers.map((p) => {
      const score = scoreValue(p, period).scoreText;
      return `<tr class="row-click" data-host="${esc(p.host)}" title="クリックで詳細・順位推移">` +
      `<td class="col-avatar">${avatarHtml(p)}</td>` +
      `<td class="col-name"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a><span class="host">${esc(p.host)}</span></td>` +
      `<td class="col-action">${detailBtnHtml(p)}</td>` +
      `<td class="num hot">+${p.rise}</td><td>${p.recent_rank}</td><td>${p.cumulative_rank}</td>` +
      `<td>${p.top10}</td><td>${p.avg_rank}位</td><td>${p.avg_attention}</td>` +
      `<td class="col-score"><span class="score-value-badge">${score}</span></td></tr>`;
    }).join("") + "</tbody>";
  $("#riserTable").querySelectorAll("tr[data-host]").forEach((tr) =>
    tr.addEventListener("click", (e) => { if (!e.target.closest("a")) openDetail(tr.dataset.host); }));
}

function detailBtnHtml(p) {
  return `<button type="button" class="detail-btn" data-detail-host="${esc(p.host)}" aria-label="${esc(p.name)} の詳細">` +
    `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 12.5h11"/><path d="M5 11l3-3 2.2 1.8L12.5 6"/><path d="M12.5 6v4"/><path d="M12.5 6h-4"/></svg><span>詳細</span></button>`;
}

function csvCell(v) {
  const s = String(v == null ? "" : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv() {
  const period = currentPeriod();
  const header = ["rank", "name", "host", "days", "top1", "top3", "top10", "avg_rank", "avg_attention", "avg_likes", "avg_restacks", "avg_comments", "tsumiage_score", "url"];
  const rows = renderedPublishers.map((p, i) => [
    i + 1, p.name, p.host, p.days, p.top1, p.top3, p.top10, p.avg_rank,
    p.avg_attention, p.avg_likes, p.avg_restacks, p.avg_comments, scoreValue(p, period).scoreText, p.url,
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
  if (typeof refreshStickyHeader === "function") refreshStickyHeader();
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
    ["平均Restack", p.avg_restacks],
  ].concat(extra);
  return items.map(([l, v]) =>
    `<div class="dm-stat"><span class="dm-stat-v">${esc(String(v))}</span><span class="dm-stat-l">${esc(l)}</span></div>`
  ).join("");
}

// 共有用URL = 発行元ごとのOGPページ（XにこのURLを貼るとカードがプレビュー表示される）。
// 人間がアクセスするとアプリ本体（?p=host）へ自動リダイレクトする。
function detailShareUrl(host) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, "").replace(/\/$/, "");
  return `${base}/p/${host}/`;
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
    `つみあげスコア ${s.scoreText}（${label}） / スコア順位 ${ranks[host] || "–"}位`,
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
    // 発行元OGPページのURLを貼るので、Xではカード画像がプレビュー表示される。
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(intent, "_blank", "noopener");
    showToast("Xを開きました。URLのプレビューにカード画像が表示されます");
    return;
  }
  await copyTextToClipboard(kind === "copy" ? url : text);
}

/* ── 共有カード画像の生成＋クリップボードコピー ───────── */
function loadImage(src, cors) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (cors) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function fillTextTrunc(ctx, text, x, y, maxW) {
  text = String(text || "");
  if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  ctx.fillText(t + "…", x, y);
}

async function generateShareCard(host) {
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  const period = currentPeriod();
  const pub = (period.publishers || []).find((p) => p.host === host) || cumByHost[host];
  const s = scoreValue(pub, period);
  const label = scoreLabel(s.score);
  const ranks = scoreRankMap(period.publishers || [], period);
  const scoreRank = ranks[host] || "–";
  const logo = (DATA.logos && DATA.logos[host]) || "";

  const W = 1080, H = 690, SC = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * SC; canvas.height = H * SC;
  const ctx = canvas.getContext("2d");
  ctx.scale(SC, SC);
  const UI = '"Zen Kaku Gothic New", sans-serif';
  const NUM = '"Fraunces", Georgia, serif';
  const SERIF = '"Zen Old Mincho", serif';

  // 背景
  ctx.fillStyle = "#f5f1ea"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#ef6011"; ctx.fillRect(0, 0, W, 8);
  ctx.save(); ctx.globalAlpha = 0.05; ctx.fillStyle = "#ec600d";
  ctx.font = `900 420px ${SERIF}`; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  ctx.fillText("番", W + 40, H / 2 + 24); ctx.restore();

  // アバター
  const ax = 64, ay = 56, asz = 120;
  let avImg = null;
  if (logo) {
    try { avImg = await loadImage(`https://images.weserv.nl/?url=${encodeURIComponent(logo)}&w=240&h=240&fit=cover&output=png`, true); } catch (e) {}
  }
  ctx.save();
  ctx.beginPath(); ctx.arc(ax + asz / 2, ay + asz / 2, asz / 2, 0, Math.PI * 2); ctx.clip();
  if (avImg) { ctx.drawImage(avImg, ax, ay, asz, asz); }
  else {
    ctx.fillStyle = "#ef6011"; ctx.fillRect(ax, ay, asz, asz);
    ctx.fillStyle = "#fff"; ctx.font = `700 60px ${SERIF}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText((pub.name || "?").trim().charAt(0), ax + asz / 2, ay + asz / 2 + 4);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,.08)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(ax + asz / 2, ay + asz / 2, asz / 2, 0, Math.PI * 2); ctx.stroke();

  // 名前・ホスト・期間
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#211d18"; ctx.font = `700 40px ${UI}`;
  fillTextTrunc(ctx, pub.name, 210, 104, 600);
  ctx.fillStyle = "#8a8174"; ctx.font = `400 22px ${UI}`;
  fillTextTrunc(ctx, host, 210, 140, 600);
  ctx.fillStyle = "#5c5448"; ctx.font = `700 22px ${UI}`;
  ctx.fillText(period.label, 210, 178);

  // スコアリング（右上）
  const cx = 952, cy = 116, rr = 66;
  ctx.lineWidth = 12; ctx.lineCap = "round";
  ctx.strokeStyle = "#f0e3d2"; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
  const frac = Math.max(0.02, Math.min(1, (s.score - 40) / 60));
  ctx.strokeStyle = "#ef6011"; ctx.beginPath();
  ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "#c94b00"; ctx.font = `600 52px ${NUM}`; ctx.fillText(s.scoreText, cx, cy + 8);
  ctx.fillStyle = "#8a8174"; ctx.font = `700 17px ${UI}`; ctx.fillText("つみあげスコア", cx, cy + 36);
  ctx.fillStyle = "#c94b00"; ctx.font = `700 24px ${UI}`; ctx.fillText(label, cx, cy - rr - 16);

  // スタッツ10枠（5列×2行・モーダルと同内容）
  const stats = [
    ["登場日数", pub.days + "日"],
    ["最高順位", pub.best_rank ? pub.best_rank + "位" : "–"],
    ["平均順位", pub.avg_rank + "位"],
    ["1位", pub.top1 + "回"],
    ["Top3", pub.top3 + "回"],
    ["Top10", pub.top10 + "回"],
    ["平均注目度", String(pub.avg_attention)],
    ["平均❤️", String(pub.avg_likes)],
    ["平均Restack", String(pub.avg_restacks)],
    ["スコア順位", scoreRank + "位"],
  ];
  const bx0 = 64, by0 = 244, bh = 108, gap = 18, rgap = 16, bw = (W - 128 - gap * 4) / 5;
  stats.forEach(([l, v], i) => {
    const bx = bx0 + (i % 5) * (bw + gap);
    const by = by0 + Math.floor(i / 5) * (bh + rgap);
    ctx.fillStyle = "#fbf9f4"; roundRectPath(ctx, bx, by, bw, bh, 14); ctx.fill();
    ctx.strokeStyle = "#e7e0d3"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#211d18"; ctx.font = `600 34px ${NUM}`; ctx.fillText(String(v), bx + bw / 2, by + 56);
    ctx.fillStyle = "#8a8174"; ctx.font = `500 18px ${UI}`; ctx.fillText(l, bx + bw / 2, by + 86);
  });

  // フッター（ブランド）
  const fy = 580;
  ctx.strokeStyle = "#e7e0d3"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(64, fy); ctx.lineTo(W - 64, fy); ctx.stroke();
  try {
    const brand = await loadImage("icon.png");
    ctx.drawImage(brand, 64, fy + 28, 44, 44);
  } catch (e) {}
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#211d18"; ctx.font = `700 26px ${UI}`;
  ctx.fillText("Substack番付 つみあげウォッチ", 120, fy + 58);
  ctx.textAlign = "right"; ctx.fillStyle = "#8a8174"; ctx.font = `400 22px ${UI}`;
  ctx.fillText("ruku-practice.github.io/substack-banzuke-watch", W - 64, fy + 58);

  return canvas;
}

// カードを生成してクリップボードへ。返り値: "both" | "img" | "download" | false
async function copyCardImage(host) {
  const canvas = await generateShareCard(host);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const url = detailShareUrl(host, currentPeriod().key);
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "image/png": blob,
        "text/plain": new Blob([url], { type: "text/plain" }),
      })]);
      return "both";
    } catch (e) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return "img";
      } catch (e2) {}
    }
  }
  // フォールバック: 画像をダウンロード＋URLをテキストコピー
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `banzuke-${host.replace(/[^a-z0-9.-]/gi, "_")}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  try { await copyTextToClipboard(url); } catch (e) {}
  return "download";
}

let toastTimer = null;
function showToast(msg) {
  let el = $("#cardToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "cardToast";
    el.className = "card-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

async function copyShareImage() {
  const btn = $("#copyImage");
  const span = btn.querySelector("span");
  const orig = span.textContent;
  const host = $("#dmName").dataset.host || $("#dmHost").textContent;
  if (!host) return;
  span.textContent = "画像を生成中…"; btn.disabled = true;
  try {
    const r = await copyCardImage(host);
    span.textContent = r === "download" ? "画像を保存＋URLコピー" : "画像をコピーしました！";
  } catch (e) {
    console.error(e);
    span.textContent = "失敗しました";
  } finally {
    btn.disabled = false;
    setTimeout(() => { span.textContent = orig; }, 2400);
  }
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
  const dmExtra = periodPub ? [["スコア順位", `${ranks[host] || "–"}位`]] : [];
  const dmSubs = subsLabel(host);
  if (dmSubs) dmExtra.push(["購読者数(参考)", dmSubs]);
  $("#dmStats").innerHTML = cum ? statChips(cum, dmExtra) : "";
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

/* ── スクロール追従ヘッダー ─────────────────────────────── */
const MAIN_TABLES = { ranking: "rankTable", daily: "dailyTable", risers: "riserTable", newcomers: "newcomerTable" };

function activeMainScroll() {
  const id = MAIN_TABLES[activeView];
  if (!id) return null;
  const table = document.getElementById(id);
  if (!table || !table.tHead || !table.tBodies[0] || !table.tBodies[0].rows.length) return null;
  return { table, scroll: table.closest(".table-scroll"), thead: table.tHead };
}

let _stickyRAF = null;
function refreshStickyHeader() {
  if (_stickyRAF) return;
  _stickyRAF = requestAnimationFrame(() => { _stickyRAF = null; doStickyHeader(); });
}

function doStickyHeader() {
  try { doStickyHeaderInner(); }
  catch (e) { const f = document.getElementById("stickyHead"); if (f) f.hidden = true; }
}
function doStickyHeaderInner() {
  const float = document.getElementById("stickyHead");
  if (!float) return;
  const modal = document.getElementById("detailModal");
  if (modal && !modal.hidden) { float.hidden = true; return; }
  const ctx = activeMainScroll();
  if (!ctx) { float.hidden = true; return; }
  const { table, scroll, thead } = ctx;
  const tableRect = table.getBoundingClientRect();
  const headH = thead.offsetHeight;
  if (!(tableRect.top < 0 && tableRect.bottom > headH + 6)) { float.hidden = true; return; }
  const inner = float.firstElementChild;
  const sig = thead.innerHTML + "|" + Math.round(scroll.clientWidth) + "|" + Math.round(tableRect.width);
  if (float._sig !== sig) {
    float._sig = sig;
    const ftable = document.createElement("table");
    ftable.className = table.className;
    ftable.style.tableLayout = "fixed";
    ftable.style.width = tableRect.width + "px";
    const cthead = thead.cloneNode(true);
    const realThs = thead.querySelectorAll("th");
    const cThs = cthead.querySelectorAll("th");
    realThs.forEach((th, i) => {
      const w = th.getBoundingClientRect().width;
      if (cThs[i]) { cThs[i].style.width = w + "px"; cThs[i].style.minWidth = w + "px"; cThs[i].style.maxWidth = w + "px"; }
    });
    ftable.appendChild(cthead);
    inner.innerHTML = "";
    inner.appendChild(ftable);
    ftable.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const idx = Array.prototype.indexOf.call(th.parentNode.children, th);
      const realTh = thead.querySelectorAll("th")[idx];
      if (realTh) realTh.click();
    });
  }
  float.style.left = Math.max(0, tableRect.left) + "px";
  float.style.width = scroll.clientWidth + "px";
  inner.scrollLeft = scroll.scrollLeft;
  float.hidden = false;
}

function setupSticky() {
  window.addEventListener("scroll", refreshStickyHeader, { passive: true });
  window.addEventListener("resize", () => {
    const f = document.getElementById("stickyHead");
    if (f) f._sig = null;
    refreshStickyHeader();
  });
  document.querySelectorAll(".table-scroll").forEach((s) =>
    s.addEventListener("scroll", () => {
      const f = document.getElementById("stickyHead");
      if (f && !f.hidden) f.firstElementChild.scrollLeft = s.scrollLeft;
    }, { passive: true }));
}

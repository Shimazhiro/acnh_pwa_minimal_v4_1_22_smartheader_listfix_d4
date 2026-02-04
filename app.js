function dispMonths(s){
  const t = String(s||"").trim();
  if (!t) return "";
  if (/^1月\s*[〜～-]\s*12月$/.test(t)) return "1年中";
  return t;
}
function dispTimes(s){
  const t = String(s||"").trim();
  if (!t) return "";
  if (t === "24時間") return "1日中";
  return t;
}
function rememberedLocLabel(s){
  const t = String(s||"").trim();
  return (t === "(指定なし)") ? "指定なし" : t;
}

// months: [1..12] 数値配列から連続区間を作る（例: [1,2,3,7,8] -> [{s:1,e:3},{s:7,e:8}]）
function monthsToRangeObjs(months){
  const a = Array.from(new Set((months||[]).map(n=>Number(n)).filter(n=>n>=1 && n<=12))).sort((x,y)=>x-y);
  if (!a.length) return [];
  const ranges=[];
  let s=a[0], p=a[0];
  for (let i=1;i<a.length;i++){
    const m=a[i];
    if (m===p+1){ p=m; continue; }
    ranges.push({s, e:p}); s=m; p=m;
  }
  ranges.push({s, e:p});
  return ranges;
}

// ★表示用：
// - 1..12全部なら「1年中」
// - 末尾が「～12月」、先頭が「1月～」のときだけ結合して「11月～4月」のようにする
//   例）[1,2,3,4,7,8,9,11,12] -> "11月～4月、7月～9月"
function formatMonthsDisplayFromArray(months){
  const uniq = Array.from(new Set((months||[]).map(n=>Number(n)).filter(n=>n>=1 && n<=12)));
  if (!uniq.length) return "";

  // 1年中
  if (uniq.length === 12) return "1年中";

  const ranges = monthsToRangeObjs(uniq);
  if (!ranges.length) return "";

  // 先頭が 1月開始 && 末尾が 12月終了 の場合は結合して年またぎ表現にする
  if (ranges.length >= 2 && ranges[0].s === 1 && ranges[ranges.length - 1].e === 12) {
    const first = ranges.shift();       // 1月～...
    const last  = ranges.pop();         // ...～12月
    const merged = { s: last.s, e: first.e }; // 11月～4月

    // 表示順：年またぎmerged → 残り（中間）
    const out = [merged, ...ranges];

    return out.map(r => {
      if (r.s === r.e) return `${r.s}月`;
      return `${r.s}月～${r.e}月`;
    }).join("、");
  }

  // 通常
  return ranges.map(r => {
    if (r.s === r.e) return `${r.s}月`;
    return `${r.s}月～${r.e}月`;
  }).join("、");
}

// あつまれどうぶつの森 チェックツール（オフラインPWA） v4.1
// 修正点：
// - 生き物が表示されない問題に対応（fetch失敗時は data-inline.js を利用）
// - 書き出し/読み込み（JSON）を削除
// - 出現（月/時間）を「出現月」「出現時間」に分割
// - 操作UI（設定/絞り込み/ソート/検索）を整列（グリッド化）
// - ★スマホは No+名前だけのカード一覧にし、タップで詳細展開（見やすく）
// - ★魚影サイズを表示
// - ★「チェック済のみ表示」「未チェックのみ表示」「1年中を除外」を追加
// - ★「状態」セレクトを削除し、位置に「すべてチェック」「すべて解除」ボタンを配置（表示中のfilteredに対して実行）
// - ★見た目のバランスを整える（filtersGrid / checksRow / 一括ボタン整列）
// - ★footerが空でも表示領域を奪う問題 → status空の時はfooter自体を非表示

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = "acnh_checklist_v4.1";

// ★ 魚影サイズ（No -> 影）
const FISH_SHADOW_BY_NO = {
  1:"極小",  2:"極小",  3:"小",    4:"中",    5:"大",    6:"大",    7:"極小",  8:"極小",
  9:"小",    10:"極小", 11:"小",   12:"中",   13:"中",   14:"極小", 15:"小",   16:"小",
  17:"小",   18:"大",   19:"特大", 20:"小",   21:"中",   22:"大",   23:"大",   24:"特大",
  25:"小",   26:"中",   27:"中",   28:"大",   29:"中",   30:"超特大",31:"大",  32:"超特大",
  33:"小",   34:"極小", 35:"小",   36:"小",   37:"小",   38:"極小", 39:"極小", 40:"小",
  41:"大",   42:"特大", 43:"超特大",44:"超特大",45:"大", 46:"超特大",47:"極小",48:"極小",
  49:"極小", 50:"小",   51:"小",   52:"超特大",53:"中", 54:"中",   55:"中",   56:"極小",
  57:"小",   58:"中",   59:"特大", 60:"中",   61:"中",  62:"大",   63:"中",   64:"特大",
  65:"細長", 66:"超特大",67:"超特大",68:"特大",69:"超特大",70:"背びれ",71:"特大",72:"背びれ",
  73:"背びれ",74:"背びれ",75:"背びれ",76:"大",77:"大",78:"超特大",79:"小",80:"超特大"
};

const defaultState = {
  meta: { version: "4.1.21" },
  settings: {
    hemisphere: "north", // north | south
    nowMode: "auto",     // auto | manual
    // 手動日時は「年不要」なので、月日だけ保持（デフォルトは今日）
    manualMonth: (new Date()).getMonth() + 1,
    manualDay: (new Date()).getDate(),
    manualTime: `${String((new Date()).getHours()).padStart(2,"0")}:00`,
    manualAnytime: false,

    // いま狙えるUI表示（バッジ表示 + Only/昇順UI表示）
    showNowUI: true,

    // 今狙える（Only/昇順）
    showNowOnly: false,
    sortNowFirst: false
  },
  filters: {
    fish: { caught: "all", place: "", name: "", excludeAllYear: false },
    bugs: { caught: "all", place: "", name: "", excludeAllYear: false },
    sea:  { caught: "all", name: "", excludeAllYear: false }
  },
  marks: {},
  tab: "fish"
};

function deepClone(x){ return JSON.parse(JSON.stringify(x)); }
function clampInt(v, min, max, def){
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
function daysInMonth(month){
  const m = clampInt(month,1,12,1);
  return [31,28,31,30,31,30,31,31,30,31,30,31][m-1];
}
function pad2(n){ return String(n).padStart(2,"0"); }

function migrateIfNeeded(obj){
  if (!obj) return deepClone(defaultState);
  const merged = {
    ...deepClone(defaultState),
    ...obj,
    settings: { ...deepClone(defaultState.settings), ...(obj.settings || {}) },
    filters: { ...deepClone(defaultState.filters), ...(obj.filters || {}) },
    marks: obj.marks || {}
  };

  // older: manualDate (YYYY-MM-DD)
  if (merged.settings.manualDate && typeof merged.settings.manualDate === "string") {
    const m = merged.settings.manualDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      merged.settings.manualMonth = Number(m[2]);
      merged.settings.manualDay = Number(m[3]);
    }
    delete merged.settings.manualDate;
  }

  merged.settings.manualMonth = clampInt(merged.settings.manualMonth, 1, 12, 1);
  merged.settings.manualDay = clampInt(merged.settings.manualDay, 1, 31, 1);

  // showNowUI が無い旧データ対策
  if (!("showNowUI" in merged.settings)) merged.settings.showNowUI = true;

  for (const [k,v] of Object.entries(merged.marks)) {
    if (typeof v === "boolean") merged.marks[k] = { caught: v };
    else if (v && typeof v === "object") merged.marks[k] = { caught: !!v.caught };
    else merged.marks[k] = { caught: false };
  }

  ["fish","bugs","sea"].forEach(v=>{
    merged.filters[v] = { ...deepClone(defaultState.filters[v]), ...(merged.filters[v] || {}) };
  });

  // version migration (keep marks)
  const prevVer = (merged.meta && merged.meta.version) ? String(merged.meta.version) : "";
  const curVer  = "4.1.21";
  merged.meta = { ...(merged.meta || {}), version: curVer };

  if (prevVer !== curVer) {
    merged.settings.hemisphere = merged.settings.hemisphere || "north";
    merged.settings.nowMode = "auto";
    merged.settings.sortNowFirst = false;
    merged.settings.manualAnytime = false;
    merged.settings.showNowOnly = false;
    merged.settings.showNowUI = true;

    // 手動日付は「今日」にリセット
    const d = new Date();
    merged.settings.manualMonth = d.getMonth() + 1;
    merged.settings.manualDay   = 1;

    // 条件/場所フィルタ整理
    if (merged.filters && merged.filters.bugs) delete merged.filters.bugs.cond;
    if (merged.filters && merged.filters.sea)  delete merged.filters.sea.place;
  }

  return merged;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return deepClone(defaultState);
    return migrateIfNeeded(JSON.parse(raw));
  } catch {
    return deepClone(defaultState);
  }
}
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// ★修正：空メッセージなら footer 自体を消して表示領域を最大化
function status(msg){
  const t = String(msg ?? "");
  const el = $("#statusText");
  if (el) el.textContent = t;

  const ft = document.querySelector(".footer");
  if (ft) ft.style.display = t ? "block" : "none";
}

function getNowDateTime() {
  const s = state.settings;
  const now = new Date();
  if (s.nowMode === "auto") return now;

  // 手動は「月だけ指定」：日付は1日固定、時刻は「時間（手動）」を使用（分は0固定）
  const year = now.getFullYear();
  const m = clampInt(s.manualMonth, 1, 12, (now.getMonth()+1));
  const d = 1;
  const h = clampInt(String(s.manualTime||"").split(":")[0], 0, 23, now.getHours());
  return new Date(year, m-1, d, h, 0, 0, 0);
}

function isCatchable(item){
  const s = state.settings;
  const dt = getNowDateTime();
  const month = dt.getMonth() + 1;
  const hemi = s.hemisphere;

  const months = (item.months && item.months[hemi]) || [];
  if (!months.includes(month)) return false;

  if (s.nowMode === "manual" && s.manualAnytime) return true;

  const windows = (item.time && item.time.windows) || [];
  if (!windows.length) return true;

  const hour = dt.getHours() + dt.getMinutes()/60;
  for (const [st,en] of windows) {
    const a = Number(st), b = Number(en);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0 && b === 24) return true;

    if (b < a) { // cross midnight
      if (hour >= a || hour < b) return true;
    } else {
      if (hour >= a && hour < b) return true;
    }
  }
  return false;
}

function normalizeText(s){ return String(s ?? "").toLowerCase(); }

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

// -------- data loading (fetch -> inline fallback) --------
async function loadData(kind){
  // Prefer fetch when hosted; fallback to inline when file://
  try{
    const res = await fetch(`./data/${kind}.json`, {cache:"no-store"});
    if (res.ok) return await res.json();
  } catch {}
  const inline = (window.ACNH_DATA && window.ACNH_DATA[kind]) ? window.ACNH_DATA[kind] : null;
  if (inline) return inline;
  throw new Error("Data load failed (fetch & inline)");
}

function ensureInitialMarks(items){
  let changed=false;
  for (const it of items) {
    if (!state.marks[it.id]) {
      state.marks[it.id] = { caught: !!(it.initial && it.initial.caught) };
      changed=true;
    }
  }
  if (changed) saveState();
}

function buildOptions(items, key){
  const set = new Set(items.map(it => (it[key] || "").trim()).filter(Boolean));
  return ["", ...Array.from(set).sort((a,b)=>a.localeCompare(b,"ja"))];
}

function applyFilters(kind, items){
  const f = state.filters[kind] || {};
  const nameQ  = normalizeText(f.name || "");
  const placeQ = normalizeText(f.place || "");

  const hemi = (state.settings && state.settings.hemisphere) ? state.settings.hemisphere : "north";

  return items.filter(it=>{
    const mk = state.marks[it.id] || {caught:false};

    // ★1年中を除外（その半球で 1..12 が揃っているものを除外）
    if (f.excludeAllYear){
      const mArr = (it.months && it.months[hemi]) || [];
      const mSet = new Set((mArr||[]).map(n=>Number(n)).filter(n=>n>=1 && n<=12));
      if (mSet.size >= 12) return false;
    }

    if (f.caught === "caught" && !mk.caught) return false;
    if (f.caught === "uncaught" && mk.caught) return false;

    if (nameQ && !normalizeText(it.name).includes(nameQ)) return false;
    if (kind !== "sea" && placeQ && !normalizeText(it.place).includes(placeQ)) return false;

    return true;
  });
}

/**
 * ★スマホ用表示のためのCSSをJSから注入
 * （styles.css の編集忘れやキャッシュで "変わらない" を防ぐ）
 */
function ensureCompactStyles(){
  if (document.getElementById("acnh-compact-style")) return;
  const st = document.createElement("style");
  st.id = "acnh-compact-style";
  st.textContent = `
/* ===== compact list (mobile) injected ===== */
.cList{ display:flex; flex-direction:column; gap:8px; }
.cRow{
  display:block !important;
  grid-template-columns: none !important;
  gap: 0 !important;
  align-items: stretch !important;
  padding: 0 !important;
  border-bottom: 0 !important;
  border: 1px solid var(--border);
  background: var(--card);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.cHead{ display:flex; align-items:center; gap:10px; padding: 12px 12px; }
.cChk{ display:flex; align-items:center; gap:8px; flex:0 0 auto; }
.cMain{ min-width:0; flex:1 1 auto; display:flex; flex-direction:column; gap:4px; }
.cTopLine{ display:flex; align-items:center; gap:10px; min-width:0; }
.cNo{ font-weight:900; font-size:12px; color: var(--muted); flex:0 0 auto; }
.cNameBtn{
  appearance:none; border:0; background:transparent;
  padding:0; margin:0; text-align:left;
  font-weight:950; font-size:15px; color: var(--text);
  min-width:0; flex:1 1 auto;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  cursor:pointer;
}
.cBadges{ display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.cToggle{
  flex:0 0 auto;
  border: 1px solid var(--border);
  background: rgba(255,255,255,.7);
  border-radius: 10px;
  padding: 8px 10px;
  font-weight:900;
  cursor:pointer;
}
.cDetail{ padding: 0 12px 12px 12px; }
.cGrid{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top: 10px; }
.cItem{ border:1px solid var(--border); background: rgba(255,255,255,.65); border-radius:12px; padding:10px; }
.cLabel{ font-size:11px; color: var(--muted); font-weight:900; margin-bottom:4px; }
.cVal{ font-size:13px; font-weight:900; color: var(--text); word-break: break-word; }

/* 重要：スマホ幅でテーブルを消してカード一覧を見せる */
@media (max-width: 900px){
  .card .tableWrap{ display:none !important; }
  .card .cList{ display:flex !important; }
}
@media (min-width: 901px){
  .card .cList{ display:none !important; }
  .card .tableWrap{ display:block !important; }
}

/* ===== ★見た目整形：操作UIを“フォームっぽく”揃える ===== */

/* いま狙える〜各チェック類：詰まり/段落ちを整える */
.checksRow{
  display:flex;
  flex-wrap:wrap;
  gap: 10px 14px;
  align-items:center;
}
.checksRow .row{
  align-items:center;
  gap: 6px;
}

/* 上段と下段のグリッドに“フォーム感”を出して整列 */
.sectionGrid, .filtersGrid{
  display:grid;
  gap: 12px;
}

/* filtersGrid：PCは 3列（左:一括 / 中:場所 / 右:名前）で見た目を揃える */
.filtersGrid{
  grid-template-columns: minmax(180px, 220px) minmax(180px, 220px) 1fr;
  align-items:end;
}

/* 一括ボタンを「入力部品」っぽい並びに */
.bulkBtns{
  display:flex;
  gap: 8px;
  width:100%;
}
.bulkBtns .btn{
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}

/* モバイルは1列にしてボタンは横幅いっぱいに */
@media (max-width: 900px){
  .filtersGrid{
    grid-template-columns: 1fr;
  }
  .bulkBtns .btn{
    flex: 1 1 0;
  }
}

/* ===== ★スマホ：チェック項目を“2列グリッド”で整列して縦幅圧縮 ===== */
@media (max-width: 900px){
  /* checksRow 自体を grid 化（2列） */
  .checksRow{
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    column-gap: 14px;
    row-gap: 8px;
    align-items: center;
  }

  /* 親 .row の justify-content 等の影響を打ち消して左寄せに固定 */
  .checksRow > .row{
    width: 100%;
    justify-content: flex-start !important;
    gap: 8px !important;
    margin: 0 !important;
  }

  /* ラベル文字を少し詰めて縦幅を短く */
  .checksRow > .row .label{
    font-size: 12px;
    line-height: 1.15;
    white-space: nowrap;
  }

  /* チェックボックスの余計なズレ対策 */
  .checksRow > .row input[type="checkbox"]{
    margin: 0 !important;
  }
}

/* さらに狭い端末だけ 1列に落とす（超小型iPhone等） */
@media (max-width: 360px){
  .checksRow{
    grid-template-columns: 1fr;
  }
  .checksRow > .row .label{
    white-space: normal;
  }
}
`;
  document.head.appendChild(st);
}

function renderList(kind, items){
  ensureCompactStyles();

  const s = state.settings;
  const f = state.filters[kind];

  let filtered = applyFilters(kind, items);

  // showNowUI がOFFなら、Only/昇順は内部的にもOFF扱いにしておく（隠れて効きっぱなし防止）
  if (!s.showNowUI){
    s.showNowOnly = false;
    s.sortNowFirst = false;
  }

  if (s.showNowOnly) filtered = filtered.filter(it => isCatchable(it));

  // Sorting
  if (s.sortNowFirst) {
    filtered.sort((a,b)=>{
      const an = isCatchable(a) ? 0 : 1;
      const bn = isCatchable(b) ? 0 : 1;
      if (an !== bn) return an - bn;
      return (a.no||0) - (b.no||0);
    });
  } else {
    filtered.sort((a,b)=> (a.no||0) - (b.no||0));
  }

  // Settings UI values
  const dt = getNowDateTime();
  const m0 = dt.getMonth()+1;
  const d0 = dt.getDate();
  const h0 = dt.getHours();
  const min0 = dt.getMinutes();
  const whenAuto = `${m0}/${d0} ${h0}:${pad2(min0)}`;

  const mMan = clampInt(s.manualMonth, 1, 12, (new Date()).getMonth()+1);
  const hMan = clampInt(String(s.manualTime||"").split(":")[0], 0, 23, (new Date()).getHours());
  const whenManual = s.manualAnytime ? `${mMan}/1 / すべての時間` : `${mMan}/1 ${hMan}:00`;

  const hemiLabel = (s.hemisphere==="north") ? "北半球" : "南半球";

  const monthOpts = Array.from({length:12},(_,i)=>i+1)
    .map(m=>`<option value="${m}" ${s.manualMonth===m?"selected":""}>${m}月</option>`).join("");

  const curHour = clampInt(String(s.manualTime||"").split(":")[0], 0, 23, (new Date()).getHours());
  const hourOpts = Array.from({length:24},(_,i)=>i)
    .map(h=>`<option value="${h}" ${curHour===h?"selected":""}>${h}時</option>`).join("");

  const manualDisabled = (s.nowMode !== "manual");
  const placeOptions = buildOptions(items, "place");

  let html = `
    <div class="card">
      <div class="row" style="justify-content:space-between;">
        <div>
          <div class="small">${hemiLabel} / 日時判定（${s.nowMode==="auto"?`自動：${whenAuto}`:`手動：${whenManual}` }）</div>
        </div>
        <div class="badge">${filtered.length} 件</div>
      </div>

      <div class="sectionGrid">
        <div class="fitem">
          <div class="label">半球</div>
          <select id="${kind}-set-hemi">
            <option value="north" ${s.hemisphere==="north"?"selected":""}>北半球</option>
            <option value="south" ${s.hemisphere==="south"?"selected":""}>南半球</option>
          </select>
        </div>

        <div class="fitem">
          <div class="label">Nowモード</div>
          <select id="${kind}-set-nowMode">
            <option value="auto" ${s.nowMode==="auto"?"selected":""}>自動</option>
            <option value="manual" ${s.nowMode==="manual"?"selected":""}>手動</option>
          </select>
        </div>

        <div class="fitem">
          <div class="row manualRow" style="display:${s.nowMode==="manual"?"flex":"none"};">
            <div class="manualStack">
              <div class="inlineLabel">月（手動）</div>
              <select id="${kind}-set-month" ${manualDisabled?"disabled":""}>${monthOpts}</select>
            </div>
            <div class="manualStack">
              <div class="inlineLabel">時間（手動）</div>
              <select id="${kind}-set-hour" ${(manualDisabled||s.manualAnytime)?"disabled":""}>${hourOpts}</select>
            </div>
            <label class="row anytimeLabel" style="gap:6px;">
              <input type="checkbox" id="${kind}-set-anytime" ${s.manualAnytime?"checked":""} ${manualDisabled?"disabled":""}/>
              <span class="inlineLabel">すべての時間</span>
            </label>
          </div>
        </div>

        <div class="fitem spanAll">
          <div class="row checksRow">


<!-- ★ここに移動（いま狙えるの右隣） -->
<label class="row">
  <input type="checkbox" id="${kind}-f-excludeAllYear" ${f.excludeAllYear?"checked":""}/>
  <span class="label">1年中を除外</span>
</label>
<label class="row">
  <input type="checkbox" id="${kind}-q-caughtOnly" ${f.caught==="caught"?"checked":""}/>
  <span class="label">チェック済のみ表示</span>
</label>

<label class="row">
  <input type="checkbox" id="${kind}-q-uncaughtOnly" ${f.caught==="uncaught"?"checked":""}/>
  <span class="label">未チェックのみ表示</span>
</label>
<label class="row">
  <input type="checkbox" id="${kind}-set-showNowUI" ${s.showNowUI?"checked":""}/>
  <span class="label">いま狙える</span>
</label>

${s.showNowUI ? `
  <label class="row"><input type="checkbox" id="${kind}-set-showNowOnly" ${s.showNowOnly?"checked":""}/> <span class="label">今狙える（Only）</span></label>
  <label class="row"><input type="checkbox" id="${kind}-set-sortNowFirst" ${s.sortNowFirst?"checked":""}/> <span class="label">今狙える（昇順）</span></label>
` : ``}
          </div>
        </div>
      </div>

      <div class="filtersGrid">
        <!-- ★状態セレクトを廃止：ここに一括操作ボタンを配置 -->
        <!-- ★見た目整形：class化してCSSで“入力部品風”に揃える -->
        <div class="fitem bulkBox">
          <div class="label">一括</div>
          <div class="bulkBtns">
            <button type="button" id="${kind}-checkAllBtn" class="btn">すべてチェック</button>
            <button type="button" id="${kind}-uncheckAllBtn" class="btn">すべて解除</button>
          </div>
        </div>

        ${ kind!=="sea" ? `
        <div class="fitem">
          <div class="label">場所</div>
          <select id="${kind}-f-place">
            ${placeOptions.map(p=> `<option value="${escapeHtml(p)}" ${String(f.place)===String(p)?"selected":""}>${p===""?"指定なし":escapeHtml(p)}</option>`).join("")}
          </select>
        </div>
        ` : `` }

        <div class="fitem">
          <div class="label">名前（部分一致）</div>
          <div class="inputWithClear">
            <input type="text" id="${kind}-f-name" placeholder="${kind==='bugs'?'例：チョウ':(kind==='sea'?'例：ガニ':'例：サメ')}" value="${escapeHtml(f.name)}" autocomplete="off">
            <button type="button" id="${kind}-f-name-clear" class="clearBtn" aria-label="clear" ${f.name?"" :"disabled"}>×</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <!-- ===== Mobile: compact list ===== -->
      <div class="cList">
  `;

  // mobile list
  for (const it of filtered) {
    const mk = state.marks[it.id] || {caught:false};
    const now = isCatchable(it);

    const mArr = (it.months && it.months[s.hemisphere]) || [];
    const monthsStr = formatMonthsDisplayFromArray(mArr);

    const rawTimeLabel = (it.time && it.time.label) ? String(it.time.label).replaceAll(" ", "").replaceAll("　","") : "";
    const timeLabel = dispTimes(rawTimeLabel);

    const priceText = (it.price ?? "") !== "" ? `${it.price}ベル` : "";
    const placeText = rememberedLocLabel(it.place || "");

    const shadowText = (kind==="fish")
      ? (FISH_SHADOW_BY_NO[Number(it.no)] || "")
      : "";

    html += `
      <div class="cRow">
        <div class="cHead">
          <label class="cChk">
            <input type="checkbox" data-act="caught" data-id="${it.id}" ${mk.caught?"checked":""}>
          </label>

          <div class="cMain">
            <div class="cTopLine">
              <div class="cNo">No.${it.no ?? ""}</div>
              <button type="button" class="cNameBtn" data-act="toggle" data-id="${it.id}" aria-expanded="false">
                ${escapeHtml(it.name)}
              </button>
            </div>

            <div class="cBadges">
              ${(s.showNowUI && now) ? `<span class="badge now">いま狙える</span>` : ``}
              ${mk.caught ? `<span class="badge">済</span>` : ``}
            </div>
          </div>

          <button type="button" class="cToggle" data-act="toggle" data-id="${it.id}" aria-label="詳細">
            詳細
          </button>
        </div>

        <div class="cDetail" data-detail="${it.id}" hidden>
          <div class="cGrid">
            <div class="cItem">
              <div class="cLabel">売値</div>
              <div class="cVal">${escapeHtml(priceText) || "—"}</div>
            </div>

            <div class="cItem">
              <div class="cLabel">場所</div>
              <div class="cVal">${kind !== "sea" ? (escapeHtml(placeText) || "—") : "—"}</div>
            </div>

            ${kind==="fish" ? `
            <div class="cItem">
              <div class="cLabel">魚影</div>
              <div class="cVal">${escapeHtml(shadowText) || "—"}</div>
            </div>
            ` : ``}

            <div class="cItem">
              <div class="cLabel">出現月</div>
              <div class="cVal">${escapeHtml(monthsStr) || "—"}</div>
            </div>

            <div class="cItem">
              <div class="cLabel">出現時間</div>
              <div class="cVal">${escapeHtml(timeLabel) || "—"}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  html += `
      </div>

      <!-- ===== Desktop: table ===== -->
      <div class="tableWrap">
        <table class="table">
          <thead>
            <tr>
              <th style="width:72px;">済</th>
              <th style="width:56px;">No</th>
              <th>名前</th>
              <th style="width:86px;">売値</th>
              <th style="width:160px;">場所</th>
              ${kind==="fish" ? `<th style="width:90px;">魚影</th>` : ``}
              <th style="width:160px;">出現月</th>
              <th style="width:200px;">出現時間</th>
            </tr>
          </thead>
          <tbody>
  `;

  // desktop table
  for (const it of filtered) {
    const mk = state.marks[it.id] || {caught:false};
    const now = isCatchable(it);

    const mArr = (it.months && it.months[s.hemisphere]) || [];
    const monthsStr = formatMonthsDisplayFromArray(mArr);

    const rawTimeLabel = (it.time && it.time.label) ? String(it.time.label).replaceAll(" ", "").replaceAll("　","") : "";
    const timeLabel = dispTimes(rawTimeLabel);

    const priceText = (it.price ?? "") !== "" ? `${it.price}ベル` : "";
    const placeText = rememberedLocLabel(it.place || "");

    const shadowText = (kind==="fish")
      ? (FISH_SHADOW_BY_NO[Number(it.no)] || "")
      : "";

    html += `
      <tr class="">
        <td data-label="済"><input type="checkbox" data-act="caught" data-id="${it.id}" ${mk.caught?"checked":""}></td>
        <td data-label="No">${it.no ?? ""}</td>
        <td class="td-name" data-label="名前">
          <div class="nameRow">
            <span class="nameText" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}</span>
            ${(s.showNowUI && now) ? `<span class="badge now">いま狙える</span>` : ``}
          </div>
        </td>
        <td data-label="売値">${escapeHtml(priceText)}</td>
        <td data-label="場所">${escapeHtml(placeText)}</td>
        ${kind==="fish" ? `<td data-label="魚影">${shadowText ? `<span class="badge">${escapeHtml(shadowText)}</span>` : ""}</td>` : ``}
        <td data-label="出現月">${monthsStr ? `<span class="badge">${escapeHtml(monthsStr)}</span>` : ""}</td>
        <td data-label="出現時間">${timeLabel ? `<span class="badge">${escapeHtml(timeLabel)}</span>` : ""}</td>
      </tr>
    `;
  }

  html += `
          </tbody>
        </table>
      </div>
    </div>
  `;

  const viewEl = document.querySelector(`#view-${kind}`);
  viewEl.innerHTML = html;

  const rerender = ()=>{
    const ae = document.activeElement;
    const keep = (ae && ae.id && ae.tagName === "INPUT") ? { id: ae.id, ss: ae.selectionStart, se: ae.selectionEnd, val: ae.value } : null;

    saveState();
    render();

    if (keep) {
      const el = document.getElementById(keep.id);
      if (el) {
        el.focus();
        if (el.value !== keep.val) el.value = keep.val;
        try { el.setSelectionRange(keep.ss, keep.se); } catch {}
      }
    }
  };

  // Settings bindings
  (document.querySelector(`#${kind}-set-hemi`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{ state.settings.hemisphere = e.target.value; rerender(); });
  (document.querySelector(`#${kind}-set-nowMode`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{ state.settings.nowMode = e.target.value; rerender(); });

  (document.querySelector(`#${kind}-set-month`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{
    state.settings.manualMonth = clampInt(e.target.value,1,12,1);
    const dmax = daysInMonth(state.settings.manualMonth);
    state.settings.manualDay = clampInt(state.settings.manualDay,1,dmax,1);
    rerender();
  });
  (document.querySelector(`#${kind}-set-hour`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{
    const h = clampInt(e.target.value,0,23,0);
    state.settings.manualTime = `${pad2(h)}:00`;
    rerender();
  });

  (document.querySelector(`#${kind}-set-anytime`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{ state.settings.manualAnytime = e.target.checked; rerender(); });

  // いま狙える表示（ON/OFF）
  (document.querySelector(`#${kind}-set-showNowUI`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{
    state.settings.showNowUI = e.target.checked;
    if (!e.target.checked){
      state.settings.showNowOnly = false;
      state.settings.sortNowFirst = false;
    }
    rerender();
  });

  (document.querySelector(`#${kind}-set-showNowOnly`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{ state.settings.showNowOnly = e.target.checked; rerender(); });
  (document.querySelector(`#${kind}-set-sortNowFirst`) || {addEventListener:()=>{}}).addEventListener("change",(e)=>{ state.settings.sortNowFirst = e.target.checked; rerender(); });

  // ★全件チェック／解除（表示中のfilteredに対して実行）
  (document.querySelector(`#${kind}-checkAllBtn`) || {addEventListener:()=>{}}).addEventListener("click", ()=>{
    for (const it of filtered) state.marks[it.id] = { caught: true };
    rerender();
  });
  (document.querySelector(`#${kind}-uncheckAllBtn`) || {addEventListener:()=>{}}).addEventListener("click", ()=>{
    for (const it of filtered) state.marks[it.id] = { caught: false };
    rerender();
  });

  // ★クイック絞り込み：チェック済のみ表示／未チェックのみ表示（相互排他、f.caught を操作）
  (document.querySelector(`#${kind}-q-caughtOnly`) || {addEventListener:()=>{}}).addEventListener("change", (e)=>{
    if (e.target.checked) state.filters[kind].caught = "caught";
    else state.filters[kind].caught = "all";
    rerender();
  });
  (document.querySelector(`#${kind}-q-uncaughtOnly`) || {addEventListener:()=>{}}).addEventListener("change", (e)=>{
    if (e.target.checked) state.filters[kind].caught = "uncaught";
    else state.filters[kind].caught = "all";
    rerender();
  });

  // ★1年中（1〜12月）を除外
  (document.querySelector(`#${kind}-f-excludeAllYear`) || {addEventListener:()=>{}}).addEventListener("change", (e)=>{
    state.filters[kind].excludeAllYear = e.target.checked;
    rerender();
  });

  // Filters
  const rerenderDebounced = (() => {
    if (!window.__acnhDebounce) window.__acnhDebounce = { t: null };
    if (!window.__acnhIME) window.__acnhIME = { composing: false };
    const tick = () => {
      if (window.__acnhIME && window.__acnhIME.composing) {
        window.__acnhDebounce.t = setTimeout(tick, 200);
        return;
      }
      rerender();
    };
    return () => {
      clearTimeout(window.__acnhDebounce.t);
      window.__acnhDebounce.t = setTimeout(tick, 200);
    };
  })();

  const bind = (id, key, mode) => {
    const el = document.querySelector(`#${kind}-${id}`);
    if (!el) return;

    const isText = el.tagName === "INPUT" && (el.type === "text" || el.type === "search" || !el.type);

    const commit = () => {
      state.filters[kind][key] = el.value;
      if (mode === "debounce") rerenderDebounced();
      else rerender();
    };

    if (isText) {
      el.addEventListener("compositionstart", () => {
        if (!window.__acnhIME) window.__acnhIME = { composing: false };
        window.__acnhIME.composing = true;
        if (window.__acnhDebounce) clearTimeout(window.__acnhDebounce.t);
      });
      el.addEventListener("compositionend", () => {
        if (!window.__acnhIME) window.__acnhIME = { composing: false };
        window.__acnhIME.composing = false;
        commit();
      });
      el.addEventListener("input", () => {
        state.filters[kind][key] = el.value;
        if (window.__acnhIME && window.__acnhIME.composing) return;
        if (mode === "debounce") rerenderDebounced();
        else rerender();
      });
    } else {
      el.addEventListener("change", commit);
    }
  };

  // 状態セレクトは廃止したので bind("f-caught") は呼ばない
  if (kind !== "sea") bind("f-place", "place");
  bind("f-name", "name", "debounce");

  // Name clear button
  const clearBtn = viewEl.querySelector(`#${kind}-f-name-clear`);
  if (clearBtn){
    clearBtn.addEventListener("click", ()=>{
      state.filters[kind].name = "";
      rerender();
      const inp = viewEl.querySelector(`#${kind}-f-name`);
      if (inp) { try { inp.focus(); } catch(_) {} }
    });
  }

  // Row checkbox (table + list)
  viewEl.querySelectorAll(`[data-act="caught"]`).forEach(el=>{
    el.addEventListener("change",(e)=>{
      const id = e.target.getAttribute("data-id");
      state.marks[id] = { caught: e.target.checked };
      rerender();
    });
  });

  // Mobile: detail toggle (bind once per view element)
  if (!viewEl.__acnhToggleBound) {
    viewEl.__acnhToggleBound = true;
    viewEl.addEventListener("click", (e)=>{
      const trg = e.target.closest && e.target.closest(`[data-act="toggle"]`);
      if (!trg) return;
      const id = trg.getAttribute("data-id");
      if (!id) return;

      const detail = viewEl.querySelector(`[data-detail="${id}"]`);
      if (!detail) return;

      detail.hidden = !detail.hidden;

      const btn = viewEl.querySelector(`.cNameBtn[data-id="${id}"]`);
      if (btn) btn.setAttribute("aria-expanded", detail.hidden ? "false" : "true");
    });
  }
}

function setView(view){
  document.querySelectorAll(".tab").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === view);
  });
  ["fish","bugs","sea"].forEach(v=>{
    document.querySelector(`#view-${v}`).classList.toggle("hidden", v !== view);
  });
  state.currentView = view;
  saveState();
  render();
}

let state = loadState();
let cache = { fish:null, bugs:null, sea:null };

async function ensureLoaded(){
  if (!cache.fish) cache.fish = await loadData("fish");
  if (!cache.bugs) cache.bugs = await loadData("bugs");
  if (!cache.sea)  cache.sea  = await loadData("sea");

  ensureInitialMarks([...cache.fish, ...cache.bugs, ...cache.sea]);
}

async function render(){
  const active = document.activeElement;
  const isTextInput = !!(active && active.tagName === "INPUT" && (active.type === "text" || active.type === "search" || active.type === ""));
  const activeId = (isTextInput && active.id) ? active.id : null;
  const sel = (isTextInput && typeof active.selectionStart==="number" && typeof active.selectionEnd==="number")
    ? { start: active.selectionStart, end: active.selectionEnd }
    : null;

  try{
    await ensureLoaded();
    const view = state.currentView || "fish";
    renderList(view, cache[view]);
    status("");
  } catch(e){
    console.error(e);
    status("データの読み込みに失敗しました。GitHub Pages等で https で開くと確実です。");
    const view = state.currentView || "fish";
    const el = document.querySelector(`#view-${view}`);
    if (el) el.innerHTML = `<div class="card"><b>表示できません</b><div class="small">原因：初期化に失敗しました</div><div class="small" style="margin-top:6px;white-space:pre-wrap;">${escapeHtml(String(e && (e.stack||e.message||e)))}</div><div class="small" style="margin-top:6px;">※ file:// 直開きで動かない場合は http://localhost などで開いてください。</div></div>`;
  } finally {
    if (activeId){
      const el = document.getElementById(activeId);
      if (el){
        try { el.focus({preventScroll:true}); } catch(_) { try { el.focus(); } catch(__) {} }
        if (sel && typeof el.setSelectionRange === "function"){
          const len = String(el.value||"").length;
          const s = Math.min(sel.start, len);
          const t = Math.min(sel.end, len);
          try { el.setSelectionRange(s, t); } catch(_) {}
        }
      }
    }
  }
}

// tabs
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", ()=> setView(btn.dataset.view)));

// smart header: shrink on scroll (mainly for mobile)
(function initSmartHeader(){
  const header = document.querySelector(".topbar");
  if(!header) return;
  let last = null;
  let ticking = false;

  const update = ()=>{
    const compact = (window.scrollY || 0) > 8;
    if (compact !== last) {
      header.classList.toggle("compact", compact);
      last = compact;
    }
    ticking = false;
  };

  const onScroll = ()=>{
    if (ticking) return;
    ticking = true;
    (window.requestAnimationFrame || setTimeout)(update, 16);
  };

  window.addEventListener("scroll", onScroll, {passive:true});
  // initial
  onScroll();
})();

(async ()=>{
  if ("serviceWorker" in navigator) {
    try{ await navigator.serviceWorker.register("./service-worker.js"); }catch{}
  }
  state.currentView = state.currentView || "fish";
  saveState();
  setView(state.currentView);
})();

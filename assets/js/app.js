/* 主程式只在獨立網站的完整 DOM 載入資料後執行一次。 */
(function(){
var DB_STATUS = {featureErrors:[]};
function scrollToInstant(x, y){
  window.scrollTo(x, y);
}

/* [JS-BOOT] 主 App 啟動函式：以下所有資料模型、renderer、feature module 都在此作用域。 */
function __boot(){
var DB_SCHEMA_VERSION = 3;
var PAT_META_SCHEMA_VERSION = 2;
var CONTENT_META_SCHEMA_VERSION = 1;
function safeRun(label, fn){
  try{ return fn(); }
  catch(err){
    var item = {feature:label, message:String(err && err.message ? err.message : err)};
    DB_STATUS.featureErrors.push(item);
    if(window.console && console.error) console.error('[律師懲戒案件資料庫] '+label+'初始化失敗：', err);
    return null;
  }
}
function safeFeature(label, fn){
  var features = window.DisciplineApp && window.DisciplineApp.features;
  if(!features || typeof features.init !== 'function') return safeRun(label, fn);
  return safeRun(label, function(){ return features.init(label, fn); });
}
var dbNode = document.getElementById('db');
var contentNode = document.getElementById('db-content-meta');
var patternNode = document.getElementById('db-pattern-meta');
if(!dbNode || !contentNode || !patternNode) throw new Error('啟動時內嵌資料節點尚未就緒');
var DATA = JSON.parse(dbNode.textContent);
if(DATA.schemaVersion !== DB_SCHEMA_VERSION){
  throw new Error('資料庫格式版本不相容：預期 '+DB_SCHEMA_VERSION+'，實際 '+DATA.schemaVersion);
}
var CONTENT_META = JSON.parse(contentNode.textContent);
if(CONTENT_META.schemaVersion !== CONTENT_META_SCHEMA_VERSION){
  throw new Error('內容資料格式版本不相容：預期 '+CONTENT_META_SCHEMA_VERSION+'，實際 '+CONTENT_META.schemaVersion);
}
var APP_CONTEXT = window.DisciplineApp && window.DisciplineApp.context;
if(APP_CONTEXT){ APP_CONTEXT.data = DATA; APP_CONTEXT.content = CONTENT_META; }
/* 純內容資料只在各自功能區建立短別名，避免把不同頁籤的資料與程式混在一起。 */
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
/* 外部資料進入 href 前除了 HTML escaping，也必須限制協定，避免誤植成
   javascript: 或 data: URL。回傳值已完成 HTML escaping，只能放進屬性值。 */
function safeHref(value, allowMail){
  var raw = String(value == null ? '' : value).trim();
  if(!raw) return '';
  try{
    var u = new URL(raw, location.href);
    var ok = u.protocol === 'https:' || u.protocol === 'http:' || (allowMail && u.protocol === 'mailto:');
    return ok ? esc(raw) : '';
  }catch(e){ return ''; }
}

/* [JS-CORE] 共用基礎設施 */
/* ======================================================================
   共用基礎設施：格式、DOM、焦點／捲動、rAF 節流、resize 排程
   只放跨功能共用的 helper；功能專屬 helper 留在各自頁籤區塊。
   ====================================================================== */
function numFmt(v){ return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function rocDate(iso){
  if(!iso) return '';
  var p = iso.split('-');
  if(p.length!==3) return iso;
  return (parseInt(p[0],10)-1911)+'.'+p[1]+'.'+p[2];
}
function el(id){ return document.getElementById(id); }
/* 檢索文字的最後正規化只有一個來源：欄位索引與全文索引都經此處。
   不做 NFKC，避免把全形 ＆＋－（）轉成具運算意義的半形符號。 */
function searchNormalizeText(s){
  return String(s == null ? '' : s).replace(/\s+/g, ' ').toLowerCase();
}
function searchNormalizeHtml(s){
  return searchNormalizeText(String(s == null ? '' : s)
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' '));
}

/* ---------- 通用小工具（原本散在各處各寫一份，集中於此避免版本分歧） ----------
   keepScroll：包住會改變捲動位置的動作（如 <dialog>.showModal() 會使捲軸消失、
   　　　　　　版面寬度改變），執行後把捲動位置復原；下一畫格再復原一次，
   　　　　　　因為部分瀏覽器的調整發生在同一輪版面計算之後。
   focusNoScroll：設定焦點但不捲動；preventScroll 不支援時退回一般 focus()。
   rafThrottle：把高頻事件（resize／scroll）節流到下一畫格才執行一次。 */
function keepScroll(fn){
  var x = window.pageXOffset, y = window.pageYOffset;
  function restore(){
    if(window.pageXOffset !== x || window.pageYOffset !== y) scrollToInstant(x, y);
  }
  fn();
  restore();
  if(window.requestAnimationFrame) window.requestAnimationFrame(restore);
  else setTimeout(restore, 0);
}
function focusNoScroll(node){
  if(!node || !node.focus) return;
  try{ node.focus({preventScroll:true}); }catch(e){ node.focus(); }
}
function rafThrottle(fn){
  var tick = false;
  return function(){
    if(tick) return;
    tick = true;
    var run = function(){ tick = false; fn(); };
    if(window.requestAnimationFrame) window.requestAnimationFrame(run); else setTimeout(run, 0);
  };
}

/* 主程式共用 resize 排程器：所有版面重算集中在同一個 animation frame，
   避免各模組各自掛 window.resize、同一幀重複觸發 layout。 */
var RESIZE_TASKS = [];
var runResizeTasks = rafThrottle(function(){
  RESIZE_TASKS.slice().forEach(function(fn){ fn(); });
});
function onDbResize(fn){
  if(typeof fn !== 'function' || RESIZE_TASKS.indexOf(fn) >= 0) return;
  RESIZE_TASKS.push(fn);
}
window.addEventListener('resize', runResizeTasks, {passive:true});

/* [JS-PAGE-SCROLLBAR] 不佔版面寬度的極窄頁面捲軸。 */
function initPageScrollbar(){
  var bar = el('page-scrollbar'), thumb = el('page-scrollbar-thumb');
  if(!bar || !thumb) return;
  var root = document.scrollingElement || document.documentElement;
  var dragging = false, dragOffset = 0, fadeTimer = 0;

  function metrics(){
    var viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    var total = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
    var max = Math.max(0, total - viewport);
    var track = bar.clientHeight;
    var height = max ? Math.max(24, Math.round(track * viewport / total)) : track;
    return {max:max, track:track, height:Math.min(track, height)};
  }
  function update(){
    var m = metrics(), canScroll = m.max > 1;
    bar.classList.toggle('db-scrollable', canScroll);
    bar.tabIndex = canScroll ? 0 : -1;
    bar.setAttribute('aria-valuemax', String(Math.round(m.max)));
    bar.setAttribute('aria-valuenow', String(Math.round(root.scrollTop || window.pageYOffset || 0)));
    thumb.style.height = m.height + 'px';
    var room = Math.max(0, m.track - m.height);
    var top = m.max ? room * (root.scrollTop || window.pageYOffset || 0) / m.max : 0;
    thumb.style.transform = 'translateY(' + Math.round(top) + 'px)';
  }
  function showWhileScrolling(){
    update();
    bar.classList.add('db-scrolling');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function(){ bar.classList.remove('db-scrolling'); }, 450);
  }
  function scrollFromPointer(clientY, offset){
    var m = metrics(), rect = bar.getBoundingClientRect();
    var room = Math.max(0, m.track - m.height);
    if(!m.max || !room) return;
    var thumbTop = Math.max(0, Math.min(room, clientY - rect.top - offset));
    window.scrollTo(0, Math.round(m.max * thumbTop / room));
  }

  thumb.addEventListener('pointerdown', function(e){
    if(e.button !== undefined && e.button !== 0) return;
    dragging = true;
    dragOffset = e.clientY - thumb.getBoundingClientRect().top;
    bar.classList.add('db-scrolling');
    if(thumb.setPointerCapture) thumb.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  window.addEventListener('pointermove', function(e){
    if(!dragging) return;
    scrollFromPointer(e.clientY, dragOffset);
    e.preventDefault();
  });
  window.addEventListener('pointerup', function(){
    if(!dragging) return;
    dragging = false;
    showWhileScrolling();
  });
  bar.addEventListener('pointerdown', function(e){
    if(e.target === thumb) return;
    var m = metrics();
    scrollFromPointer(e.clientY, m.height / 2);
    e.preventDefault();
  });
  bar.addEventListener('keydown', function(e){
    var viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    var y = root.scrollTop || window.pageYOffset || 0, handled = true;
    if(e.key === 'ArrowUp') y -= 40;
    else if(e.key === 'ArrowDown') y += 40;
    else if(e.key === 'PageUp') y -= viewport * .9;
    else if(e.key === 'PageDown') y += viewport * .9;
    else if(e.key === 'Home') y = 0;
    else if(e.key === 'End') y = metrics().max;
    else handled = false;
    if(handled){ e.preventDefault(); window.scrollTo(0, Math.max(0, y)); }
  });

  window.addEventListener('scroll', showWhileScrolling, {passive:true});
  onDbResize(update);
  if(window.ResizeObserver && document.body) new ResizeObserver(update).observe(document.body);
  update();
}

/* [JS-DATA] 資料正規化／衍生索引／audit */
/* ======================================================================
   核心資料正規化與衍生索引
   原始 JSON 只保存事實資料；編號、法條索引、樣態案件等可推導值於此集中生成。
   ====================================================================== */
/* 案件編號一律由陣列位置推導，不再存於資料中。
   這是先前 86 筆態樣錯位的根因：產生器以 no−1 當索引、渲染端以陣列位置取值，
   兩者一旦不同步就會靜默指向錯誤案件。改為推導後，編號與位置不可能再不一致。 */
for (var _i = 0; _i < DATA.cases.length; _i++) DATA.cases[_i].no = _i + 1;

/* ---------- 懲戒種類分級 hc：由 h 推導，不另存欄位 ----------------------
   h 是排序權重（愈小愈重），hc 是懲戒輕重的分級，僅用於案件列表的儲存格底色。
   兩者是一對一的關係（原資料逐筆比對無一例外），故 hc 一律由下表推導。

   hc  意義                    h
   ──  ──────────────────────  ──────────────────────────────────
    1  除名                    1.0
    2  停職 1 年以上           2.09–2.25（期間愈長，值愈小）
    3  停職未滿 1 年           2.3–2.8
    4  申誡併研習              3.0–3.61
    5  申誡                    3.7
    6  警告併研習              4.01–4.61
    7  警告                    4.7
    8  僅研習                  5.01–5.61
    0  非懲戒                  免議 6.0／不受理 7.0／不付懲戒 8.0／不予懲戒 9.0
    0  律聲字（暫停職聲請）    不予停職 1001／覆審准回復 1001.1／應予停職 1002
   小數第 2、3 位用來區分「是否併研習、研習時數」等細節。
   有覆審變更者，h 依覆審後的最終結果編碼。

   ※ h 與 hc 都是純人工編碼，不可推導。新增案件時比對既有相同 decision 之案件
     沿用；查無先例者提案後由維護者確認，不得自行創值。
   ※ 新增 h 值時務必同時在下表補上對應的 hc，否則該案的底色會落空。 */
var HC_OF = (function(){
  var t = {'1':1,'2.09':2,'2.1':2,'2.11':2,'2.12':2,'2.23':2,'2.24':2,'2.25':2,'2.3':3,'2.31':3,'2.32':3,'2.341':3,'2.342':3,'2.35':3,'2.38':3,'2.4':3,'2.41':3,'2.44':3,'2.49':3,'2.495':3,'2.497':3,'2.5':3,'2.51':3,'2.52':3,'2.6':3,'2.61':3,'2.62':3,'2.63':3,'2.7':3,'2.71':3,'2.72':3,'2.73':3,'2.8':3,'3':4,'3.01':4,'3.2':4,'3.21':4,'3.4':4,'3.41':4,'3.61':4,'3.7':5,'4.01':6,'4.21':6,'4.6':6,'4.61':6,'4.7':7,'5.01':8,'5.21':8,'5.41':8,'5.6':8,'5.61':8,'6':0,'7':0,'8':0,'9':0,'1001':0,'1001.1':0,'1002':0};
  return function(h){ var v = t['' + h]; return v == null ? '' : v; };
})();

/* ---------- 暫時處分（律師法第74條第1項）的判準 -----------------------
   「暫時停止執行職務」是保全性質的暫時處分，不是終局的懲戒決定，故案件清單分成
   兩個分頁各自檢索——混在一起時，件數、排序與法條篩選的分母都會互相干擾。
   判準取決議欄文字：「應予停止執行職務」「不予停止執行職務」，其後可接括號內的
   覆審結果。刻意不另存欄位（衍生資料另存正是覆轍清單第 1 點），也不改用 h 判斷：
   h 是懲戒輕重的人工編碼，目前 1001／1001.1／1002 恰好就是這批案件，但那是巧合
   不是定義，故另於 __auditData 比對兩者是否走散。
   ※「停止執行職務6月」這類帶期間者是懲戒處分，不在此列，故「停止執行職務」之後
     必須緊接字串結尾或全形左括號。 */
var PROV_RE = /^(?:應予|不予)停止執行職務(?:（|$)/;
var IS_PROV = DATA.cases.map(function(c){ return PROV_RE.test(String(c.decision || '')); });
var PROV_N = IS_PROV.filter(Boolean).length;

/* ---------- 備註欄中的法條：由 note 文字推導 -------------------------
   備註常記載「另移送違反某某條、決議不成立」之類的條文。這些條文與 norm
   一樣要能點開條文卡片，也要能被違失態樣檢索到（否則找不到不成立的案件），
   但一律於載入時由 note 文字推導，不另存欄位——理由與 no、articleIndex
   相同：另存一份必然有失步的一天。

   辨識規則：
     ．出現法典名稱（舊／新／修正前／修正後 ＋ 律師法／律師倫理規範，
       書名號可有可無）後，該處的「第○條…」歸屬該法典，並記住法典；
     ．其後緊接「、／及與和，」等連接符號的「第○條…」沿用同一法典；
     ．其餘未帶法典名稱的「第○條…」（例如「台北律師公會章程第42條」）
       一律不辨識，並清除記住的法典，避免誤掛到前一部法典。
   回傳每項為 {t:顯示文字, c:法典鍵, a:條號, i:於 note 中的起始位置}。 */
var NOTE_RE = /(?:(舊|新|修正前|修正後)《?(律師倫理規範|倫理規範|法律扶助法|律師法)》?)?第([0-9]+(?:-[0-9]+)?)條((?:第[0-9]+項)?(?:第[0-9]+款)?(?:前段|後段|但書|本文)?)/g;
var NOTE_JOIN = { '、':1, '／':1, '/':1, '及':1, '與':1, '和':1, '，':1, ',':1 };
/* 案件層級的備註條文取得口。
   備註偶爾只是「敘述某條文」而非「本案涉及該條文」——例如指出決議書把
   第39條第2款誤植、實應為第3款。這類文字若照樣做成條文標籤，該案就會
   因為備註而被拉進第39條第2款的篩選結果與對應違失態樣，形同把筆誤當成
   事實。故案件可設 noteNoLaw:true，表示「本則備註中的條號僅供閱讀，
   不生標籤、篩選與樣態歸屬的效果」。
   一律走這個函式，三處用途（法條篩選器、樣態歸屬、備註欄渲染）才不會分歧。 */
function caseNoteSegs(c){
  return (c && c.noteNoLaw) ? [] : noteSegs(c && c.note);
}
function noteSegs(note){
  var t = String(note || ''), out = [], cur = null, m;
  if(!t) return out;
  NOTE_RE.lastIndex = 0;
  while((m = NOTE_RE.exec(t))){
    var key = null;
    if(m[2]){
      /* 新／修正後 → 現行法（k 律師法、m 倫理規範、o 法律扶助法）
         舊／修正前 → 前一版（j 律師法、l 倫理規範、n 法律扶助法） */
      var nw = (m[1] === '新' || m[1] === '修正後');
      if(m[2] === '法律扶助法')   key = nw ? 'o' : 'n';
      else if(m[2] === '律師法')  key = nw ? 'k' : 'j';
      else                        key = nw ? 'm' : 'l';
      cur = key;
    }else{
      var prev = m.index > 0 ? t.charAt(m.index - 1) : '';
      if(cur && NOTE_JOIN[prev]) key = cur;
      else { cur = null; continue; }
    }
    out.push({ t: m[0], c: key, a: m[3], i: m.index });
  }
  return out;
}

/* ---------- 由 norm 推導索引結構 -------------------------------------
   法條篩選器（articleIndex）、違失態樣歸屬（patterns[].cases）、樣態所涉條文
   （patterns[].laws）、法規瀏覽器的已引用標記（laws[].articles[].used），
   一律於載入時由案件的 norm 與 mapRows 推導，不存於 JSON。

   這麼做的理由與 no 欄位相同：這些結構原本是另存一份的衍生資料，一旦與 norm
   失步就會靜默指向錯誤案件——先前 86 筆樣態錯位、22 筆樣態漏列都源於此。
   改為推導後，只要維護 norm 與 mapRows，其餘自動一致。

   比對規則：條號須相同；項、款未指明者視為涵蓋全部；本文與前段視為同義，
   與但書、後段互斥。

   歷史條文（於資料庫收錄版本前已刪除者，如舊倫理規範第38條）：條文文字或對照表
   項目中含「已刪除」字樣者，其條號一律加上「-原」後綴（例：38 → 38-原），使其
   與現行同條號分屬不同條，避免案件被歸入錯誤樣態。此規則須與 laws 中歷史條文之
   no 欄位一致。 */
/* 條文比對介面：由下方推導區塊填入（見該區塊之「5. 對外輸出條文比對介面」）。
   宣告在外層，是為了讓違失態樣說明的子類對照表共用同一套比對規則。 */
var PROV_API = null;
(function(){
  var CN = {零:0,一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  function num(s){
    s = String(s).trim();
    if(/^\d+$/.test(s)) return parseInt(s, 10);
    if(s === '十') return 10;
    if(s.indexOf('十') >= 0){
      var p = s.split('十');
      return (p[0] ? (CN[p[0]] || 1) : 1) * 10 + (p[1] ? (CN[p[1]] || 0) : 0);
    }
    return CN.hasOwnProperty(s) ? CN[s] : null;
  }
  /* 條文文字含「已刪除」者，視為歷史條文，條號加「-原」後綴（與 laws 之 no 一致） */
  function legacySfx(t){ return /已刪除/.test(String(t || '')) ? '-原' : ''; }
  function artNo(t){
    var s = String(t || '').replace(/\s/g, '');
    var m = /^第([0-9\-]+)條/.exec(s);
    return m ? m[1] + legacySfx(s) : null;
  }
  /* 條文字串之「項、款」序位，供同一條之多個對照列排序用（未指明者為 0，排最前）。
     款可寫成「第1、2款」等連寫形式，一律取第一個號次。 */
  function subKey(t){
    var s = String(t || '').replace(/\s/g, '');
    var x = /第([0-9]+)項/.exec(s), y = /第([0-9]+)[0-9、]*款/.exec(s);
    return [x ? parseInt(x[1], 10) : 0, y ? parseInt(y[1], 10) : 0];
  }
  /* 把條文字串展開為 [條, 項, 款, 綴] 之陣列；項／款未指明者為 null */
  function provisions(t){
    t = String(t || '').replace(/\s/g, '');
    var m = /第([0-9一二三四五六七八九十\-之]+)條/.exec(t);
    if(!m) return [];
    var art = m[1] + legacySfx(t), rest = t.slice(m.index + m[0].length);
    var suffix = (rest.match(/(本文|前段|後段|但書)/g) || []).join('');
    function pick(tag){
      var out = [], re = new RegExp('第([0-9一二三四五六七八九十、]+)' + tag, 'g'), mm;
      while((mm = re.exec(rest))){
        mm[1].split('、').forEach(function(p){ var x = num(p); if(x) out.push(x); });
      }
      return out.length ? out : [null];
    }
    var ps = pick('項'), ks = pick('款'), out = [];
    for(var a = 0; a < ps.length; a++)
      for(var b = 0; b < ks.length; b++) out.push([art, ps[a], ks[b], suffix]);
    return out;
  }
  function compat(a, b){
    if(a[0] !== b[0]) return false;
    if(a[1] !== null && b[1] !== null && a[1] !== b[1]) return false;
    if(a[2] !== null && b[2] !== null && a[2] !== b[2]) return false;
    var sa = a[3], sb = b[3];
    if(sa && sb){
      var head = {'本文':1, '前段':1};
      var A = head[sa] ? head : (function(o){ o[sa] = 1; return o; })({});
      var B = head[sb] ? head : (function(o){ o[sb] = 1; return o; })({});
      for(var k in A) if(B[k]) return true;
      return false;
    }
    return true;
  }
  /* 每件案件所引條文，依法典分組 */
  var caseProv = DATA.cases.map(function(c){
    var g = {};
    (c.norm || []).forEach(function(n){
      if('jklmno'.indexOf(n[1]) < 0) return;
      var K = n[1].toUpperCase();
      (g[K] = g[K] || []).push.apply(g[K], provisions(n[0]));
    });
    /* 備註欄提及之法條一併納入，樣態檢索才找得到「決議不成立」的案件 */
    caseNoteSegs(c).forEach(function(s){
      var K = s.c.toUpperCase();
      (g[K] = g[K] || []).push.apply(g[K], provisions(s.t));
    });
    return g;
  });

  /* 1. 法條篩選器
     取樣範圍與樣態歸屬（caseProv）一致：norm ＋ 備註中的條文。
     兩者若不一致，就會出現「備註寫了某條、該條的篩選結果卻找不到這件」，
     而移送不成立、決議另認他條之類的案件正是靠備註才留下線索——
     分類時要參考不成立的案例，就必須從篩選器裡找得到它。
     判準因此收斂為一句話：備註上做得出條文標籤的，篩選器與樣態都要收得到。 */
  var bucket = {J:{}, K:{}, L:{}, M:{}, N:{}, O:{}};
  DATA.cases.forEach(function(c, i){
    (c.norm || []).forEach(function(n){
      if('jklmno'.indexOf(n[1]) < 0 || !n[2]) return;
      var K = n[1].toUpperCase();
      (bucket[K][n[2]] = bucket[K][n[2]] || {})[i] = 1;
    });
    caseNoteSegs(c).forEach(function(s){
      var K = s.c.toUpperCase();
      if(!bucket[K]) return;
      var ps = provisions(s.t);          /* 取條號；歷史條文之「-原」後綴一併處理 */
      if(!ps.length || !ps[0][0]) return;
      (bucket[K][ps[0][0]] = bucket[K][ps[0][0]] || {})[i] = 1;
    });
  });
  /* 條號排序鍵：「30-1」→[30,1]；歷史條文「38-原」→[38,0.5]，緊接第38條之後 */
  function artKey(a){
    var p = String(a).split('-');
    var sub = p[1] ? (parseInt(p[1], 10) || 0.5) : 0;
    return [parseInt(p[0], 10), sub];
  }
  DATA.articleIndex = {};
  ['J','K','L','M','N','O'].forEach(function(K){
    DATA.articleIndex[K] = Object.keys(bucket[K]).sort(function(x, y){
      var a = artKey(x), b = artKey(y);
      return a[0] - b[0] || a[1] - b[1];
    }).map(function(a){
      /* related 之顯示順序：依該對照列所指的「項、款」由小到大排列
         （未指明項、款者＝整條，排最前），項款相同者維持對照表原順序。
         不倚賴引擎排序的穩定性，故以蒐集序 o 作為次要鍵。
         排序在推導階段完成，對照表 mapRows 本身的順序不必、也不應為此調整。 */
      var rel = [];
      DATA.mapRows.forEach(function(r, ri){
        var arts = (r.cols && r.cols[K]) || [];
        for(var t = 0; t < arts.length; t++) if(artNo(arts[t]) === a){
          rel.push({ i: ri, k: subKey(arts[t]), o: rel.length }); return;
        }
      });
      rel = rel.sort(function(x, y){
        return x.k[0] - y.k[0] || x.k[1] - y.k[1] || x.o - y.o;
      }).map(function(e){ return e.i; });
      /* 顯示字串取自 laws 之歷史條文設定；一般條文即「第○條」 */
      var ao = null, la = DATA.laws && DATA.laws[K] ? DATA.laws[K].articles : [];
      for(var q = 0; q < la.length; q++) if(la[q].no === a){ ao = la[q]; break; }
      return {
        no: a,
        art: (ao && ao.flt) || ('第' + a + '條'),
        tag: (ao && ao.tag) || ('第' + a + '條'),
        cases: Object.keys(bucket[K][a]).map(Number).sort(function(x, y){ return x - y; }),
        related: rel
      };
    });
  });

  /* 2. 樣態所涉條文：由對照表彙整 */
  var lawsOf = {};
  DATA.mapRows.forEach(function(r){
    var t = lawsOf[r.patternId] = lawsOf[r.patternId] || {J:[], K:[], L:[], M:[], N:[], O:[]};
    ['J','K','L','M','N','O'].forEach(function(K){
      ((r.cols && r.cols[K]) || []).forEach(function(a){ if(t[K].indexOf(a) < 0) t[K].push(a); });
    });
  });

  /* 3. 樣態歸屬 */
  DATA.patterns.forEach(function(p){
    p.laws = lawsOf[p.id] || {J:[], K:[], L:[], M:[], N:[], O:[]};
    var want = {};
    ['J','K','L','M','N','O'].forEach(function(K){
      want[K] = [];
      p.laws[K].forEach(function(s){ want[K].push.apply(want[K], provisions(s)); });
    });
    p.cases = [];
    DATA.cases.forEach(function(c, i){
      var g = caseProv[i], hit = false;
      for(var K in g){
        if(hit) break;
        for(var a = 0; a < g[K].length && !hit; a++)
          for(var b = 0; b < want[K].length && !hit; b++)
            if(compat(g[K][a], want[K][b])) hit = true;
      }
      /* 少數備註會提及「不成立／誤植」的法條；patternExclude 可保留備註原文，
         同時避免該案被誤歸入特定違失態樣。 */
      if(hit && Array.isArray(c.patternExclude) && c.patternExclude.indexOf(p.id) >= 0) hit = false;
      /* patternInclude 是 patternExclude 的對稱操作：人工補正樣態歸屬。
         少數決議認定的事實明明落在某態樣射程內，卻未援引該態樣之法條——早期
         決議習慣單引律師法而不併引倫理規範、保密義務於 2020 年修法前無對應
         條文，皆為著例。這類案件若僅靠條文比對，會永遠檢索不到。此時由人工
         填 patternInclude 補正，並於備註欄記載理由（該態樣名稱同步做成可點擊
         標籤，見 patLinkify）。
         這是輸入資料而非衍生資料，故可、也只能手工維護；關聯一律收永久 ID，
         態樣名稱日後修改不影響歸屬。
         影響範圍僅止於 patterns[].cases：條文比對相關的 articleIndex、
         patterns[].laws、子類對照表一概不經此處，該案不會因此被拉進本態樣
         之法條篩選結果，備註中的態樣名稱也不生任何條文標籤。 */
      if(!hit && Array.isArray(c.patternInclude) && c.patternInclude.indexOf(p.id) >= 0) hit = true;
      if(hit) p.cases.push(i);
    });
  });

  /* 3-1. 樣態排序：依件數由多至少自動排序。
     排序在資料推導階段完成，故頁籤二的清單、展開／收起、詳情頁一律自動一致，
     維護時不必、也不應手動調整 JSON 中 patterns 的先後順序（手排必然與實際件數失步）。
     件數相同者維持 JSON 原順序：先寫入 _ord 作為次要鍵，不倚賴引擎的排序穩定性。
     可安全重排之理由：patterns 之陣列位置不被任何其他結構引用——
     articleIndex[].related 指向 mapRows、patterns[].cases 與 articleIndex[].cases
     指向 DATA.cases，網址雜湊僅記錄頁籤編號，均與 patterns 的位置無關。 */
  DATA.patterns.forEach(function(p, i){ p._ord = i; });
  DATA.patterns.sort(function(a, b){
    return b.cases.length - a.cases.length || a._ord - b._ord;
  });
  DATA.patterns.forEach(function(p){ delete p._ord; });

  /* 4. 法規瀏覽器的已引用標記 */
  ['J','K','L','M','N','O'].forEach(function(K){
    if(!DATA.laws[K]) return;
    DATA.laws[K].articles.forEach(function(a){
      a.used = Object.prototype.hasOwnProperty.call(bucket[K], a.no);
    });
  });

  /* 5. 對外輸出條文比對介面。
     違失態樣說明中的「子類對照表」（見 descBlockHtml 之 subcats）需要以同一套
     規則推導件數，若在別處另寫一份比對邏輯，兩份規則必然有分歧的一天
     （＝樣態錯位的老問題）。故此處輸出既有的 provisions／compat／caseProv，
     一切子類推導一律共用，不另立第二套。 */
  PROV_API = {
    provisions: provisions,   /* 條文字串 → [條, 項, 款, 綴] 陣列 */
    compat: compat,           /* 兩條文是否相容（項款未指明者涵蓋全部） */
    caseProv: caseProv        /* 各案已引條文（含備註推導者），依法典分組 */
  };
})();

/* 樣態跨功能導覽一律以永久 ID 關聯；陣列索引只用於目前排序後的畫面位置。 */
var PATTERN_BY_ID = {};
var PATTERN_INDEX_BY_ID = {};
DATA.patterns.forEach(function(p, i){
  PATTERN_BY_ID[p.id] = p;
  PATTERN_INDEX_BY_ID[p.id] = i;
});

/* ---------- 條文 → 違失態樣（推導，不另存一份） ----------------------
   態樣欄與法條卡片內的態樣按鈕，都需要「這一條（項、款）
   在對照表裡對應到哪些態樣」。此處一律沿用 PROV_API 既有的 provisions／compat，
   不另寫第二套比對規則（理由同第四節：兩套規則必然有分歧的一天）。
   ※ PROV_PAT_ROWS 只是 mapRows 的展開快取（首次使用時才建），
     真正的歸屬資料仍只有 mapRows 一份；mapRows 一改，重新載入即同步。 */
var PROV_PAT_ROWS = null;
function provPatRows(){
  if(PROV_PAT_ROWS) return PROV_PAT_ROWS;
  var out = [];
  DATA.mapRows.forEach(function(r){
    if(!r.patternId) return;
    ['J','K','L','M','N','O'].forEach(function(K){
      ((r.cols && r.cols[K]) || []).forEach(function(entry){
        PROV_API.provisions(entry).forEach(function(pv){ out.push({k:K, p:pv, id:r.patternId}); });
      });
    });
  });
  PROV_PAT_ROWS = out;
  return out;
}
/* [條, 項, 款, 綴] 陣列 → 態樣 ID 陣列。
   同一態樣只回一次；順序一律照「違失態樣」頁的顯示順序（件數多→少），
   使各處列出的態樣先後一致。 */
function patIdsOfProvs(key, provs){
  if(!key || !provs || !provs.length || !PROV_API) return [];
  var K = String(key).toUpperCase(), rows = provPatRows(), seen = {}, out = [];
  rows.forEach(function(r){
    if(r.k !== K || seen[r.id]) return;
    for(var i = 0; i < provs.length; i++){
      if(PROV_API.compat(provs[i], r.p)){ seen[r.id] = 1; out.push(r.id); return; }
    }
  });
  return out.sort(function(a, b){
    return (PATTERN_INDEX_BY_ID[a] || 0) - (PATTERN_INDEX_BY_ID[b] || 0);
  });
}
/* 條文字串（例「第32條第2項」「第38條（已刪除）」）→ 態樣 ID 陣列 */
function patIdsOfText(key, text){
  return PROV_API ? patIdsOfProvs(key, PROV_API.provisions(text)) : [];
}
/* 條號＋項＋款＋（本文／但書／前段／後段）→ 比對用之 [條, 項, 款, 綴] 陣列。
   法條卡片專用：卡片手上只有拆好的參數，且歷史條文之條號帶「-原」後綴，
   無法再組回「第○條」字串交給 provisions() 解析，故在此直接組出 tuple。 */
function provsOfParts(artNo, xiang, ks, seg){
  var x = parseInt(xiang, 10); if(!(x > 0)) x = null;
  var kl = (ks || []).filter(function(n){ return n > 0; });
  if(!kl.length) kl = [null];
  return kl.map(function(k){ return [String(artNo), x, k, seg || '']; });
}

/* ---------- 決議書全文的存取層 --------------------------------------
   全文與案件資料同在一份 #db JSON 中，直接掛在案件記錄的 ft／ftRev
   （段落字串陣列，join('\n') 即還原原字串）。
   併案（一份決議書含多名律師、最多一案 10 人）只在該案號首次出現的那一列
   存放全文，故不能以「本列有沒有 ft」判斷有無全文，一律查下面這張索引。
   FT＝{main:{案號:全文}, rev:{覆審案號:全文}}，載入時掃一遍 cases 推導而得，
   不存於 JSON、不另行維護（同 articleIndex、patterns[].cases 的既有作法）。
   案號與決議書是一對一（645 筆逐列核對無例外），故案號本身即是鍵，
   不另設文件代號或對照表。
   全文之 <h2> 內不再存放案號與來源連結：兩者都由 ftHydrate() 注入——案號取自
   本表的鍵，來源取自本表的 u（即 full／revFull）與 p（紙本頁次）。JSON 內只留
   被付懲戒人（pname，併案時列出該決議書的全部受懲人，與 name 不同義，故保留）。
   全無全文資料時 FT 為 null，全站退回原本的外部連結行為。
   對外介面 ftHas(slot, i)／ftDoc(slot, i) 的簽章與過去相同，
   slot 為 'main'／'rev'、i 為案件之陣列位置，渲染層不必改動。 */
/* 案號 → 該決議的覆審案號（同案各列 revNo 之聯集）。
   覆審是逐人聲請的，故同一份決議書可能只有部分被付懲戒人有 revNo；而決議書
   全文是「決議」層級的文件，其前導資訊區的「覆審」欄問的是「這份決議有沒有
   人聲請覆審」，不是「存放本份全文的那一列有沒有」。兩者語意不同：
   110年度律懲字第5號 三人中只有張睿紘、周武榮聲請覆審，全文存在邱于倫那一列，
   若照該列的 revNo 取值，全文就會顯示成沒有覆審、也無從跳到覆審決議。
   案件列表上的覆審欄仍照各列自己的 revNo，維持「這個人有沒有聲請」的語意。 */
var REV_OF = (function(){
  var m = {};
  DATA.cases.forEach(function(c){
    if(!c.revNo) return;
    if(!m[c.caseNo]) m[c.caseNo] = [];
    if(m[c.caseNo].indexOf(c.revNo) < 0) m[c.caseNo].push(c.revNo);
  });
  var out = {};
  for(var k in m) if(Object.prototype.hasOwnProperty.call(m, k)) out[k] = m[k].join('、');
  return out;
})();
/* 只供「故意犯罪經判刑確定」案件全文使用的刑事確定判決資料。
   資料源：使用者提供的司法院網址對照表；複數裁判按判決年度由舊到新。 */
var CRIMINAL_JUDGMENTS = {
  "111年度律懲字第50號、113年度律懲字第2號、113年度律懲字第18號、114年度律懲字第38號": [
    {
      "title": "臺灣橋頭地方法院111年度訴字第31號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=CTDM%2c111%2c%e8%a8%b4%2c31%2c20220926%2c2",
      "date": "111.09.26",
      "cause": "違反商業會計法"
    },
    {
      "title": "最高法院111年度台上字第5009號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c111%2c%e5%8f%b0%e4%b8%8a%2c5009%2c20240306%2c1",
      "date": "113.03.06",
      "cause": "違反貪污治罪條例"
    }
  ],
  "104年度律懲字第3號": [
    {
      "title": "臺灣高等法院花蓮分院104年度上易字第4號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=HLHM%2c104%2c%e4%b8%8a%e6%98%93%2c4%2c20151016%2c1",
      "date": "104.10.16",
      "cause": "妨害名譽"
    }
  ],
  "114年度律懲字第5號": [
    {
      "title": "福建金門地方法院108年度選訴字第10號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KMDM%2c108%2c%e9%81%b8%e8%a8%b4%2c10%2c20200226%2c1",
      "date": "109.02.26",
      "cause": "違反總統副總統選舉罷免法"
    }
  ],
  "101年度律懲字第18號、101年度律懲字第19號、101年度律懲字第20號": [
    {
      "title": "臺灣高雄地方法院101年度簡字第3216號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSDM%2c101%2c%e7%b0%a1%2c3216%2c20121126%2c1",
      "date": "101.11.26",
      "cause": "業務侵占"
    },
    {
      "title": "臺灣高雄地方法院101年度簡字第5962號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSDM%2c101%2c%e7%b0%a1%2c5962%2c20130221%2c1",
      "date": "102.02.21",
      "cause": "業務侵占"
    }
  ],
  "109年度律懲字第23號": [
    {
      "title": "臺灣高雄地方法院108年度易字第98號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSDM%2c108%2c%e6%98%93%2c98%2c20191227%2c1&ot=in",
      "date": "108.12.27",
      "cause": "詐欺等"
    }
  ],
  "98年度律懲字第11號": [
    {
      "title": "臺灣高等法院高雄分院92年度上訴字第1946號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSHM%2c92%2c%e4%b8%8a%e8%a8%b4%2c1946%2c20040809%2c1",
      "date": "93.08.09",
      "cause": "偽造文書等"
    }
  ],
  "96年度律懲字第1號": [
    {
      "title": "臺灣高等法院高雄分院94年度上易字第301號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSHM%2c94%2c%e4%b8%8a%e6%98%93%2c301%2c20060615%2c1",
      "date": "95.06.15",
      "cause": "詐欺"
    }
  ],
  "109年度律懲字第11號、109年度律懲字第17號": [
    {
      "title": "臺灣苗栗地方法院108年度苗交簡字第728號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=MLDM%2c108%2c%e8%8b%97%e4%ba%a4%e7%b0%a1%2c728%2c20190916%2c1",
      "date": "108.09.16",
      "cause": "公共危險"
    },
    {
      "title": "臺灣苗栗地方法院108年度苗交簡字第1179號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=MLDM%2c108%2c%e8%8b%97%e4%ba%a4%e7%b0%a1%2c1179%2c20191203%2c1",
      "date": "108.12.03",
      "cause": "公共危險"
    }
  ],
  "107年度律懲字第35號": [
    {
      "title": "臺灣南投地方法院107年度審易字第371號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=NTDM%2c107%2c%e5%af%a9%e6%98%93%2c371%2c20180827%2c1",
      "date": "107.08.27",
      "cause": "妨害電腦使用罪"
    }
  ],
  "106年度律懲字第23號、106年度律懲字第26號": [
    {
      "title": "臺灣新北地方法院106年度審簡字第338號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=PCDM%2c106%2c%e5%af%a9%e7%b0%a1%2c338%2c20170505%2c1",
      "date": "106.05.05",
      "cause": "瀆職"
    }
  ],
  "107年度律懲字第29號、107年度律懲字第34號": [
    {
      "title": "臺灣新北地方法院107年度審易字第1186號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=PCDM%2c107%2c%e5%af%a9%e6%98%93%2c1186%2c20180531%2c1",
      "date": "107.05.31",
      "cause": "瀆職"
    }
  ],
  "113年度律懲字第66號": [
    {
      "title": "臺灣新北地方法院114年度簡上字第276號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=PCDM%2c114%2c%e7%b0%a1%e4%b8%8a%2c276%2c20251113%2c1",
      "date": "114.11.13",
      "cause": "偽證"
    }
  ],
  "112年度律懲字第30號、113年度律懲字第46號": [
    {
      "title": "臺灣新竹地方法院113年度竹簡字第1050號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=SCDM%2c113%2c%e7%ab%b9%e7%b0%a1%2c1050%2c20250114%2c1",
      "date": "114.01.14",
      "cause": "偽證"
    }
  ],
  "98年度律懲字第15號": [
    {
      "title": "臺灣新竹地方法院98年度審訴字第445號刑事宣示筆錄",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=SCDM%2c98%2c%e5%af%a9%e8%a8%b4%2c445%2c20100115%2c4",
      "date": "99.01.15",
      "cause": "違反稅捐稽徵法等"
    }
  ],
  "113年度律懲字第23號": [
    {
      "title": "臺灣士林地方法院112年度訴字第539號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=SLDM%2c112%2c%e8%a8%b4%2c539%2c20240910%2c1",
      "date": "113.09.10",
      "cause": "偽造有價證券等"
    }
  ],
  "113年度律懲字第9號、113年度律懲字第26號": [
    {
      "title": "臺灣士林地方法院113年度審簡字第93號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=SLDM%2c113%2c%e5%af%a9%e7%b0%a1%2c93%2c20240301%2c1",
      "date": "113.03.01",
      "cause": "瀆職"
    }
  ],
  "101年度律懲字第13號": [
    {
      "title": "臺灣臺中地方法院101年度中交簡字第196號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c101%2c%e4%b8%ad%e4%ba%a4%e7%b0%a1%2c196%2c20120120%2c1",
      "date": "101.01.20",
      "cause": "公共危險"
    }
  ],
  "102年度律懲字第8號": [
    {
      "title": "臺灣臺中地方法院101年度交訴字第278號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c101%2c%e4%ba%a4%e8%a8%b4%2c278%2c20130125%2c1",
      "date": "102.01.25",
      "cause": "肇事逃逸罪"
    }
  ],
  "108年度律懲字第5號": [
    {
      "title": "臺灣臺中地方法院105年度易字第1450號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c105%2c%e6%98%93%2c1450%2c20170213%2c1",
      "date": "106.02.13",
      "cause": "詐欺"
    }
  ],
  "108年度律懲字第36號": [
    {
      "title": "臺灣臺中地方法院107年度金重訴字第1162號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c107%2c%e9%87%91%e9%87%8d%e8%a8%b4%2c1162%2c20190529%2c8",
      "date": "108.05.29",
      "cause": "違反證券交易法等"
    }
  ],
  "109年度律懲字第36號": [
    {
      "title": "臺灣臺中地方法院109年度中簡字第576號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c109%2c%e4%b8%ad%e7%b0%a1%2c576%2c20200623%2c1",
      "date": "109.06.23",
      "cause": "瀆職"
    }
  ],
  "100年度律懲字第7號": [
    {
      "title": "臺灣高等法院臺中分院100年度上易字第274號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c100%2c%e4%b8%8a%e6%98%93%2c274%2c20110414%2c1",
      "date": "100.04.14",
      "cause": "詐欺"
    }
  ],
  "100年度律懲字第19號": [
    {
      "title": "臺灣高等法院臺中分院100年度上易字第537號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c100%2c%e4%b8%8a%e6%98%93%2c537%2c20111026%2c1",
      "date": "100.10.26",
      "cause": "洩漏國防以外秘密罪"
    }
  ],
  "97年度律懲字第14號": [
    {
      "title": "臺灣高等法院臺中分院100年度上訴字第594號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c100%2c%e4%b8%8a%e8%a8%b4%2c594%2c20110906%2c1",
      "date": "100.09.06",
      "cause": "妨害自由"
    }
  ],
  "103年度律懲字第4號": [
    {
      "title": "臺灣高等法院臺中分院102年度上易字第184號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c102%2c%e4%b8%8a%e6%98%93%2c184%2c20130530%2c1",
      "date": "102.05.30",
      "cause": "背信"
    }
  ],
  "103年度律懲字第33號": [
    {
      "title": "臺灣高等法院臺中分院103年度上易字第495號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c103%2c%e4%b8%8a%e6%98%93%2c495%2c20140904%2c1",
      "date": "103.09.04",
      "cause": "侵占"
    }
  ],
  "105年度律懲字第15號": [
    {
      "title": "臺灣高等法院臺中分院104年度上易字第913號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c104%2c%e4%b8%8a%e6%98%93%2c913%2c20160630%2c1",
      "date": "105.06.30",
      "cause": "詐欺"
    }
  ],
  "105年度律懲字第11號": [
    {
      "title": "臺灣高等法院臺中分院105年度上易字第33號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c105%2c%e4%b8%8a%e6%98%93%2c33%2c20160324%2c1",
      "date": "105.03.24",
      "cause": "詐欺"
    }
  ],
  "106年度律懲字第19號": [
    {
      "title": "臺灣高等法院臺中分院106年度上易字第109號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c106%2c%e4%b8%8a%e6%98%93%2c109%2c20181227%2c2",
      "date": "107.12.27",
      "cause": "詐欺等"
    }
  ],
  "108年度律懲字第15號": [
    {
      "title": "最高法院100年度台上字第6776號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c100%2c%e5%8f%b0%e4%b8%8a%2c6776%2c20111208",
      "date": "100.12.08",
      "cause": "妨害自由"
    },
    {
      "title": "臺灣高等法院臺中分院106年度上易字第109號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c106%2c%e4%b8%8a%e6%98%93%2c109%2c20181227%2c2",
      "date": "107.12.27",
      "cause": "詐欺等"
    }
  ],
  "110年度律懲字第43號、111年度律懲字第24號": [
    {
      "title": "臺灣高等法院臺中分院107年度上訴字第1382號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c107%2c%e4%b8%8a%e8%a8%b4%2c1382%2c20200414%2c1",
      "date": "109.04.14",
      "cause": "偽造文書等"
    }
  ],
  "96年度律懲字第13號": [
    {
      "title": "臺灣高等法院臺中分院93年度上易字第1204號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c93%2c%e4%b8%8a%e6%98%93%2c1204%2c20050118%2c1",
      "date": "94.01.18",
      "cause": "妨害自由"
    }
  ],
  "94年度律懲字第12號": [
    {
      "title": "臺灣高等法院臺中分院93年度上易字第469號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c93%2c%e4%b8%8a%e6%98%93%2c469%2c20041201%2c1",
      "date": "93.12.01",
      "cause": "妨害公務"
    }
  ],
  "94年度律懲字第3號": [
    {
      "title": "臺灣高等法院臺中分院93年度上易字第491號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c93%2c%e4%b8%8a%e6%98%93%2c491%2c20040729%2c1",
      "date": "93.07.29",
      "cause": "詐欺"
    }
  ],
  "98年度律懲字第3號": [
    {
      "title": "臺灣高等法院臺中分院97年度上易字第1691號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c97%2c%e4%b8%8a%e6%98%93%2c1691%2c20081028%2c1",
      "date": "97.10.28",
      "cause": "偽造文書"
    }
  ],
  "98年度律懲字第8號": [
    {
      "title": "臺灣高等法院臺中分院97年度上訴字第1426號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c97%2c%e4%b8%8a%e8%a8%b4%2c1426%2c20080826%2c1",
      "date": "97.08.26",
      "cause": "殺人"
    }
  ],
  "99年度律懲字第4號": [
    {
      "title": "臺灣高等法院臺中分院98年度上易字第1301號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c98%2c%e4%b8%8a%e6%98%93%2c1301%2c20091109%2c1",
      "date": "98.11.09",
      "cause": "詐欺"
    }
  ],
  "99年度律懲字第13號": [
    {
      "title": "臺灣高等法院臺中分院98年度上易字第305號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c98%2c%e4%b8%8a%e6%98%93%2c305%2c20100415%2c1",
      "date": "99.04.15",
      "cause": "詐欺"
    }
  ],
  "98年度律懲字第17號": [
    {
      "title": "臺灣高等法院臺中分院98年度上訴字第905號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c98%2c%e4%b8%8a%e8%a8%b4%2c905%2c20090527%2c1",
      "date": "98.05.27",
      "cause": "偽證"
    }
  ],
  "104年度律懲字第17號、104年度律懲字第23號": [
    {
      "title": "臺灣臺南地方法院102年度交簡上字第148號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c102%2c%e4%ba%a4%e7%b0%a1%e4%b8%8a%2c148%2c20131129%2c1",
      "date": "102.11.29",
      "cause": "公共危險"
    }
  ],
  "104年度律懲字第9號": [
    {
      "title": "臺灣臺南地方法院104年度簡字第212號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c104%2c%e7%b0%a1%2c212%2c20150206%2c1",
      "date": "104.02.06",
      "cause": "妨害秘密"
    }
  ],
  "109年度律懲字第27號": [
    {
      "title": "臺灣臺南地方法院109年度簡字第1296號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c109%2c%e7%b0%a1%2c1296%2c20200501%2c1",
      "date": "109.05.01",
      "cause": "偽造文書"
    }
  ],
  "109年度律懲字第49號": [
    {
      "title": "臺灣臺南地方法院109年度簡字第1296號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c109%2c%e7%b0%a1%2c1296%2c20200501%2c1",
      "date": "109.05.01",
      "cause": "偽造文書"
    }
  ],
  "112年度律懲字第1號": [
    {
      "title": "臺灣臺南地方法院111年度簡字第2943號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c111%2c%e7%b0%a1%2c2943%2c20221031%2c1",
      "date": "111.10.31",
      "cause": "瀆職"
    }
  ],
  "112年度律懲字第18號": [
    {
      "title": "臺灣臺南地方法院111年度簡字第2943號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c111%2c%e7%b0%a1%2c2943%2c20221031%2c1",
      "date": "111.10.31",
      "cause": "瀆職"
    }
  ],
  "113年度律懲字第45號、113年度律懲字第55號": [
    {
      "title": "臺灣臺南地方法院113年度易字第583號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNDM%2c113%2c%e6%98%93%2c583%2c20240502%2c1",
      "date": "113.05.02",
      "cause": "家暴毀損等"
    }
  ],
  "102年度律懲字第6號": [
    {
      "title": "臺灣高等法院臺南分院101年度選上訴字第21號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2c101%2c%e9%81%b8%e4%b8%8a%e8%a8%b4%2c21%2c20130417%2c1",
      "date": "102.04.17",
      "cause": "賄選"
    }
  ],
  "113年度律懲字第47號、113年度律懲字第53號、113年度律懲字第60號": [
    {
      "title": "臺灣高等法院臺南分院113年度上訴字第118號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2c113%2c%e4%b8%8a%e8%a8%b4%2c118%2c20240529%2c1",
      "date": "113.05.29",
      "cause": "偽造文書"
    }
  ],
  "101年度律懲字第16號、101年度律懲字第23號": [
    {
      "title": "臺灣臺北地方法院100年度簡字第2656號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c100%2c%e7%b0%a1%2c2656%2c20110721%2c1",
      "date": "100.07.21",
      "cause": "詐欺"
    },
    {
      "title": "最高法院101年度台上字第5208號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c101%2c%e5%8f%b0%e4%b8%8a%2c5208%2c20121011",
      "date": "101.10.11",
      "cause": "妨害自由"
    }
  ],
  "102年度律懲字第15號": [
    {
      "title": "臺灣臺北地方法院101年度簡字第961號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c101%2c%e7%b0%a1%2c961%2c20130102%2c1",
      "date": "102.01.02",
      "cause": "違反稅捐稽徵法等"
    }
  ],
  "103年度律懲字第13號": [
    {
      "title": "臺灣臺北地方法院102年度交簡字第2968號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c102%2c%e4%ba%a4%e7%b0%a1%2c2968%2c20131226%2c1",
      "date": "102.12.26",
      "cause": "公共危險"
    }
  ],
  "109年度律懲字第8號": [
    {
      "title": "臺灣臺北地方法院108年度交簡字第1855號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c108%2c%e4%ba%a4%e7%b0%a1%2c1855%2c20191029%2c1",
      "date": "108.10.29",
      "cause": "公共危險"
    }
  ],
  "111年度律懲字第46號": [
    {
      "title": "臺灣臺北地方法院108年度訴字第826號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c108%2c%e8%a8%b4%2c826%2c20200326%2c1",
      "date": "109.03.26",
      "cause": "偽造有價證券等"
    }
  ],
  "113年度律懲字第6號": [
    {
      "title": "臺灣臺北地方法院110年度金重訴字第7號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c110%2c%e9%87%91%e9%87%8d%e8%a8%b4%2c7%2c20221115%2c2",
      "date": "111.11.15",
      "cause": "銀行法等"
    }
  ],
  "110年度律懲字第22號、110年度律聲字第2號、111年度律聲字第1號": [
    {
      "title": "臺灣臺北地方法院111年度審簡字第1124號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c111%2c%e5%af%a9%e7%b0%a1%2c1124%2c20220830%2c1",
      "date": "111.08.30",
      "cause": "偽造文書等"
    }
  ],
  "112年度律懲字第39號": [
    {
      "title": "臺灣臺北地方法院112年度交簡上字第20號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c112%2c%e4%ba%a4%e7%b0%a1%e4%b8%8a%2c20%2c20230525%2c1",
      "date": "112.05.25",
      "cause": "公共危險"
    }
  ],
  "114年度律懲字第16號": [
    {
      "title": "臺灣臺北地方法院112年度審簡上字第119號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c112%2c%e5%af%a9%e7%b0%a1%e4%b8%8a%2c119%2c20240515%2c1",
      "date": "113.05.15",
      "cause": "湮滅證據"
    }
  ],
  "113年度律懲字第68號": [
    {
      "title": "臺灣臺北地方法院112年度簡字第3246號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c112%2c%e7%b0%a1%2c3246%2c20231130%2c1",
      "date": "112.11.30",
      "cause": "竊盜"
    }
  ],
  "113年度律懲字第34號": [
    {
      "title": "臺灣臺北地方法院113年度簡字第1318號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c113%2c%e7%b0%a1%2c1318%2c20240531%2c1",
      "date": "113.05.31",
      "cause": "瀆職"
    }
  ],
  "94年度律懲字第9號": [
    {
      "title": "臺灣臺北地方法院92年度簡字第578號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c92%2c%e7%b0%a1%2c578%2c20030221%2c1",
      "date": "92.02.21",
      "cause": "妨害秩序等"
    }
  ],
  "95年度律懲字第12號": [
    {
      "title": "臺灣臺北地方法院94年度訴字第1142號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c94%2c%e8%a8%b4%2c1142%2c20060120%2c2",
      "date": "95.01.20",
      "cause": "違反稅捐稽徵法等"
    }
  ],
  "105年度律懲字第22號": [
    {
      "title": "臺灣高等法院100年度上重訴字第49號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c100%2c%e4%b8%8a%e9%87%8d%e8%a8%b4%2c49%2c20130613%2c2",
      "date": "102.06.13",
      "cause": "偽造有價證券等"
    }
  ],
  "101年度律懲字第15號": [
    {
      "title": "臺灣高等法院101年度上易字第686號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c101%2c%e4%b8%8a%e6%98%93%2c686%2c20120614%2c1",
      "date": "101.06.14",
      "cause": "妨害公務"
    }
  ],
  "102年度律懲字第3號": [
    {
      "title": "臺灣高等法院101年度上訴字第1787號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c101%2c%e4%b8%8a%e8%a8%b4%2c1787%2c20130109%2c1",
      "date": "102.01.09",
      "cause": "偽證等"
    }
  ],
  "103年度律懲字第32號": [
    {
      "title": "臺灣高等法院102年度上易字第1586號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c102%2c%e4%b8%8a%e6%98%93%2c1586%2c20140612%2c1",
      "date": "103.06.12",
      "cause": "詐欺"
    }
  ],
  "102年度律懲字第21號": [
    {
      "title": "臺灣高等法院102年度上易字第1775號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c102%2c%e4%b8%8a%e6%98%93%2c1775%2c20131009%2c1",
      "date": "102.10.09",
      "cause": "詐欺"
    }
  ],
  "103年度律懲字第20號": [
    {
      "title": "臺灣高等法院102年度侵上易字第2號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c102%2c%e4%be%b5%e4%b8%8a%e6%98%93%2c2%2c20140430%2c1",
      "date": "103.04.30",
      "cause": "妨害性自主"
    }
  ],
  "102年度律懲字第9號、102年度律懲字第18號、105年度律懲字第8號": [
    {
      "title": "臺灣高等法院103年度上易字第477號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c103%2c%e4%b8%8a%e6%98%93%2c477%2c20141030%2c2",
      "date": "103.10.30",
      "cause": "恐嚇等"
    },
    {
      "title": "臺灣高等法院104年度上訴字第2623號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c104%2c%e4%b8%8a%e8%a8%b4%2c2623%2c20151222%2c1",
      "date": "104.12.22",
      "cause": "偽造文書等"
    },
    {
      "title": "最高法院105年度台上字第270號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c105%2c%e5%8f%b0%e4%b8%8a%2c270%2c20160127",
      "date": "105.01.27",
      "cause": "殺人未遂等罪"
    }
  ],
  "106年度律懲字第11號": [
    {
      "title": "臺灣高等法院105年度上易字第1295號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c105%2c%e4%b8%8a%e6%98%93%2c1295%2c20170126%2c1",
      "date": "106.01.26",
      "cause": "妨害公務等"
    }
  ],
  "105年度律懲字第9號、108年度律懲字第45號": [
    {
      "title": "臺灣高等法院105年度上易字第1980號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c105%2c%e4%b8%8a%e6%98%93%2c1980%2c20190718%2c1",
      "date": "108.07.18",
      "cause": "妨害公務等"
    }
  ],
  "111年度律懲字第41號": [
    {
      "title": "臺灣高等法院108年度上易字第1262號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c108%2c%e4%b8%8a%e6%98%93%2c1262%2c20200519%2c2",
      "date": "109.05.19",
      "cause": "詐欺等"
    }
  ],
  "113年度律懲字第27號、113年度律懲字第41號、113年度律懲字第42號": [
    {
      "title": "臺灣高等法院108年度上易字第1262號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c108%2c%e4%b8%8a%e6%98%93%2c1262%2c20200519%2c2",
      "date": "109.05.19",
      "cause": "詐欺等"
    }
  ],
  "107年度律懲字第38號、109年度律懲字第51號、110年度律懲字第19號、110年度律懲字第33號、110年度律懲字第34號": [
    {
      "title": "臺灣高等法院108年度上訴字第3710號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c108%2c%e4%b8%8a%e8%a8%b4%2c3710%2c20200819%2c2",
      "date": "109.08.19",
      "cause": "毒品危害防制條例等"
    },
    {
      "title": "臺灣高等法院110年度上訴字第1077號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c110%2c%e4%b8%8a%e8%a8%b4%2c1077%2c20210526%2c1",
      "date": "110.05.26",
      "cause": "妨害公務"
    }
  ],
  "112年度律懲字第44號、113年度律懲字第21號、114年度律懲字第40號": [
    {
      "title": "臺灣高等法院109年度上易字第1472號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c109%2c%e4%b8%8a%e6%98%93%2c1472%2c20221214%2c1",
      "date": "111.12.14",
      "cause": "侵占等"
    },
    {
      "title": "臺灣高等法院110年度上易字第1675號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c110%2c%e4%b8%8a%e6%98%93%2c1675%2c20220810%2c1",
      "date": "111.08.10",
      "cause": "侵占等"
    }
  ],
  "110年度律懲字第29號": [
    {
      "title": "臺灣高等法院109年度上訴字第3308號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c109%2c%e4%b8%8a%e8%a8%b4%2c3308%2c20210406%2c4",
      "date": "110.04.06",
      "cause": "毒品危害防制條例等"
    }
  ],
  "108年度律懲字第12號、112年度律懲字第11號": [
    {
      "title": "臺灣高等法院110年度上易字第969號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c110%2c%e4%b8%8a%e6%98%93%2c969%2c20230110%2c1",
      "date": "112.01.10",
      "cause": "詐欺"
    }
  ],
  "111年度律懲字第28號": [
    {
      "title": "臺灣高等法院110年度金上重訴字第8號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c110%2c%e9%87%91%e4%b8%8a%e9%87%8d%e8%a8%b4%2c8%2c20210923%2c16",
      "date": "110.09.23",
      "cause": "銀行法等"
    }
  ],
  "113年度律懲字第8號、113年度律懲字第19號、113年度律懲字第20號": [
    {
      "title": "臺灣高等法院高雄分院112年度上易字第279號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSHM%2c112%2c%e4%b8%8a%e6%98%93%2c279%2c20231129%2c1",
      "date": "112.11.29",
      "cause": "毀棄損壞"
    }
  ],
  "112年度律懲字第14號": [
    {
      "title": "臺灣高等法院112年度上訴字第88號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c112%2c%e4%b8%8a%e8%a8%b4%2c88%2c20230323%2c1",
      "date": "112.03.23",
      "cause": "傷害"
    }
  ],
  "112年度律懲字第20號、112年度律懲字第32號、114年度律懲字第93號": [
    {
      "title": "臺灣高等法院114年度上易字第7號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c114%2c%e4%b8%8a%e6%98%93%2c7%2c20250515%2c1",
      "date": "114.05.15",
      "cause": "妨害公務等"
    }
  ],
  "98年度律懲字第12號": [
    {
      "title": "臺灣高等法院92年度上易字第647號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c92%2c%e4%b8%8a%e6%98%93%2c647%2c20030829%2c1",
      "date": "92.08.29",
      "cause": "侵占"
    }
  ],
  "96年度律懲字第21號": [
    {
      "title": "臺灣高等法院95年度上訴字第4673號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c95%2c%e4%b8%8a%e8%a8%b4%2c4673%2c20070419%2c1",
      "date": "96.04.19",
      "cause": "誣告"
    }
  ],
  "99年度律懲字第15號": [
    {
      "title": "臺灣高等法院96年度矚上訴字第3號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c96%2c%e7%9f%9a%e4%b8%8a%e8%a8%b4%2c3%2c20070329%2c1",
      "date": "96.03.29",
      "cause": "貪污治罪條例等"
    }
  ],
  "96年度律懲字第17號": [
    {
      "title": "臺灣高等法院97年度上易字第2947號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c97%2c%e4%b8%8a%e6%98%93%2c2947%2c20091217%2c1",
      "date": "98.12.17",
      "cause": "詐欺等"
    }
  ],
  "99年度律懲字第19號": [
    {
      "title": "臺灣高等法院98年度上易字第2894號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c98%2c%e4%b8%8a%e6%98%93%2c2894%2c20100609%2c1",
      "date": "99.06.09",
      "cause": "詐欺"
    }
  ],
  "101年度律懲字第21號": [
    {
      "title": "最高法院101年度台上字第4898號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c101%2c%e5%8f%b0%e4%b8%8a%2c4898%2c20120920",
      "date": "101.09.20",
      "cause": "違反貪污治罪條例等罪"
    }
  ],
  "99年度律懲字第22號、102年度律懲字第20號": [
    {
      "title": "最高法院102年度台上字第4200號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c102%2c%e5%8f%b0%e4%b8%8a%2c4200%2c20131017",
      "date": "102.10.17",
      "cause": "違反貪污治罪條例等罪"
    }
  ],
  "108年度律懲字第10號": [
    {
      "title": "最高法院102年度台上字第4400號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c102%2c%e5%8f%b0%e4%b8%8a%2c4400%2c20131030",
      "date": "102.10.30",
      "cause": "偽造文書"
    }
  ],
  "100年度律懲字第2號": [
    {
      "title": "最高法院102年度台上字第611號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c102%2c%e5%8f%b0%e4%b8%8a%2c611%2c20130207",
      "date": "102.02.07",
      "cause": "誣告"
    }
  ],
  "106年度律懲字第8號、108年度律懲字第41號": [
    {
      "title": "臺灣高等法院108年度上易字第198號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c108%2c%e4%b8%8a%e6%98%93%2c198%2c20190528%2c1",
      "date": "108.05.28",
      "cause": "背信"
    }
  ],
  "103年度律懲字第23號": [
    {
      "title": "最高法院103年度台上字第547號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c103%2c%e5%8f%b0%e4%b8%8a%2c547%2c20140226",
      "date": "103.02.26",
      "cause": "背信"
    }
  ],
  "104年度律懲字第6號": [
    {
      "title": "最高法院103年度台上字第595號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c103%2c%e5%8f%b0%e4%b8%8a%2c595%2c20140227",
      "date": "103.02.27",
      "cause": "偽造文書"
    }
  ],
  "106年度律懲字第4號、106年度律懲字第16號": [
    {
      "title": "最高法院105年度台上字第3158號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c105%2c%e5%8f%b0%e4%b8%8a%2c3158%2c20161130",
      "date": "105.11.30",
      "cause": "誣告"
    }
  ],
  "108年度律懲字第44號": [
    {
      "title": "最高法院106年度台上字第1337號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c1337%2c20181226%2c1",
      "date": "107.12.26",
      "cause": "違反貪污治罪條例"
    }
  ],
  "106年度律懲字第32號、106年度律懲字第35號": [
    {
      "title": "最高法院106年度台上字第20號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c20%2c20170809",
      "date": "106.08.09",
      "cause": "偽證"
    }
  ],
  "108年度律懲字第21號": [
    {
      "title": "最高法院106年度台上字第3327號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c3327%2c20181018%2c1",
      "date": "107.10.18",
      "cause": "貪污等罪"
    }
  ],
  "107年度律懲字第15號": [
    {
      "title": "最高法院106年度台上字第532號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c532%2c20170823",
      "date": "106.08.23",
      "cause": "偽證"
    }
  ],
  "109年度律懲字第22號": [
    {
      "title": "最高法院108年度台上字第1546號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c108%2c%e5%8f%b0%e4%b8%8a%2c1546%2c20190911%2c1",
      "date": "108.09.11",
      "cause": "違反銀行法"
    }
  ],
  "108年度律懲字第1號、108年度律懲字第8號": [
    {
      "title": "最高法院108年度台上字第2號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c108%2c%e5%8f%b0%e4%b8%8a%2c2%2c20190227%2c1",
      "date": "108.02.27",
      "cause": "違反貪污治罪條例等罪"
    }
  ],
  "108年度律懲字第19號": [
    {
      "title": "最高法院108年度台上字第2號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c108%2c%e5%8f%b0%e4%b8%8a%2c2%2c20190227%2c1",
      "date": "108.02.27",
      "cause": "違反貪污治罪條例等罪"
    }
  ],
  "108年度律懲字第35號": [
    {
      "title": "最高法院108年度台上字第798號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c108%2c%e5%8f%b0%e4%b8%8a%2c798%2c20190516%2c1",
      "date": "108.05.16",
      "cause": "損害債權"
    }
  ],
  "109年度律懲字第10號": [
    {
      "title": "最高法院109年度台上字第2083號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c109%2c%e5%8f%b0%e4%b8%8a%2c2083%2c20210318%2c1",
      "date": "110.03.18",
      "cause": "違反證券交易法"
    }
  ],
  "111年度律懲字第32號": [
    {
      "title": "最高法院109年度台上字第2083號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c109%2c%e5%8f%b0%e4%b8%8a%2c2083%2c20210318%2c1",
      "date": "110.03.18",
      "cause": "違反證券交易法"
    }
  ],
  "110年度律懲字第6號": [
    {
      "title": "最高法院109年度台上字第2883號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c109%2c%e5%8f%b0%e4%b8%8a%2c2883%2c20201015%2c1",
      "date": "109.10.15",
      "cause": "妨害自由等罪"
    }
  ],
  "113年度律懲字第69號、114年度律懲字第10號": [
    {
      "title": "最高法院109年度台上字第3416號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c109%2c%e5%8f%b0%e4%b8%8a%2c3416%2c20201223%2c1",
      "date": "109.12.23",
      "cause": "違反貪污治罪條例"
    }
  ],
  "107年度律懲字第23號": [
    {
      "title": "最高法院109年度台上字第4460號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c109%2c%e5%8f%b0%e4%b8%8a%2c4460%2c20201014%2c1",
      "date": "109.10.14",
      "cause": "違反證券交易法"
    }
  ],
  "111年度律懲字第35號": [
    {
      "title": "最高法院111年度台上字第3759號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c111%2c%e5%8f%b0%e4%b8%8a%2c3759%2c20220825%2c1",
      "date": "111.08.25",
      "cause": "妨害名譽"
    }
  ],
  "111年度律懲字第47號、112年度律懲字第2號": [
    {
      "title": "最高法院111年度台上字第4880號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c111%2c%e5%8f%b0%e4%b8%8a%2c4880%2c20221117%2c1",
      "date": "111.11.17",
      "cause": "偽造文書等罪"
    }
  ],
  "114年度律懲字第8號": [
    {
      "title": "最高法院111年度台上字第969號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c111%2c%e5%8f%b0%e4%b8%8a%2c969%2c20231019%2c1",
      "date": "112.10.19",
      "cause": "違反銀行法等罪"
    }
  ],
  "113年度律懲字第25號、114年度律懲字第20號": [
    {
      "title": "最高法院113年度台上字第4248號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c113%2c%e5%8f%b0%e4%b8%8a%2c4248%2c20250115%2c1",
      "date": "114.01.15",
      "cause": "傷害"
    }
  ],
  "100年度律懲字第8號": [
    {
      "title": "最高法院92年度台上字第4377號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c92%2c%e5%8f%b0%e4%b8%8a%2c4377%2c20030807",
      "date": "92.08.07",
      "cause": "違反貪污治罪條例"
    }
  ],
  "96年度律懲字第4號": [
    {
      "title": "最高法院94年度台上字第6247號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c94%2c%e5%8f%b0%e4%b8%8a%2c6247%2c20051110",
      "date": "94.11.10",
      "cause": "貪污"
    }
  ],
  "99年度律懲字第11號": [
    {
      "title": "最高法院99年度台上字第2131號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c99%2c%e5%8f%b0%e4%b8%8a%2c2131%2c20100409",
      "date": "99.04.09",
      "cause": "違反公司法"
    }
  ],
  "96年度律懲字第11號": [
    {
      "title": "最高法院99年度台上字第2725號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c99%2c%e5%8f%b0%e4%b8%8a%2c2725%2c20100506",
      "date": "99.05.06",
      "cause": "偽證"
    }
  ],
  "100年度律懲字第4號": [
    {
      "title": "最高法院99年度台上字第8041號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c99%2c%e5%8f%b0%e4%b8%8a%2c8041%2c20101223",
      "date": "99.12.23",
      "cause": "偽造文書"
    }
  ],
  "101年度律懲字第11號": [
    {
      "title": "臺灣桃園地方法院100年度審簡字第510號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TYDM%2c100%2c%e5%af%a9%e7%b0%a1%2c510%2c20111230%2c1",
      "date": "100.12.30",
      "cause": "妨害公務"
    }
  ],
  "108年度律懲字第37號": [
    {
      "title": "臺灣桃園地方法院108年度簡上字第151號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TYDM%2c108%2c%e7%b0%a1%e4%b8%8a%2c151%2c20190725%2c1",
      "date": "108.07.25",
      "cause": "瀆職"
    }
  ],
  "110年度律懲字第47號": [
    {
      "title": "臺灣桃園地方法院109年度原訴字第116號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TYDM%2c109%2c%e5%8e%9f%e8%a8%b4%2c116%2c20211012%2c1",
      "date": "110.10.12",
      "cause": "兒童及少年性剝削防制條例等"
    }
  ],
  "99年度律懲字第1號": [
    {
      "title": "臺灣高等法院104年度矚上重訴字第48號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c104%2c%e7%9f%9a%e4%b8%8a%e9%87%8d%e8%a8%b4%2c48%2c20171226%2c1",
      "date": "106.12.26",
      "cause": "貪污治罪條例等"
    }
  ],
  "106年度律懲字第15號": [
    {
      "title": "臺灣高等法院105年度上訴字第1398號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c105%2c%e4%b8%8a%e8%a8%b4%2c1398%2c20160704%2c2",
      "date": "105.07.04",
      "cause": "家庭暴力罪之傷害"
    }
  ],
  "106年度律懲字第27號": [
    {
      "title": "臺灣臺中地方法院105年度易字第1450號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCDM%2c105%2c%e6%98%93%2c1450%2c20170213%2c1&ot=in",
      "date": "106.02.13",
      "cause": "詐欺"
    }
  ],
  "106年度律懲字第33號": [
    {
      "title": "臺灣高等法院高雄分院106年度上易字第582號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSHM%2c106%2c%e4%b8%8a%e6%98%93%2c582%2c20180307%2c2",
      "date": "107.03.07",
      "cause": "詐欺"
    }
  ],
  "106年度律懲字第38號": [
    {
      "title": "臺灣高等法院臺南分院104年度上易字第554號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2c104%2c%e4%b8%8a%e6%98%93%2c554%2c20170712%2c1",
      "date": "106.07.12",
      "cause": "違反稅捐稽徵法"
    },
    {
      "title": "臺灣高等法院臺南分院104年度上訴字第722號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TNHM%2c104%2c%e4%b8%8a%e8%a8%b4%2c722%2c20170712%2c1",
      "date": "106.07.12",
      "cause": "違反稅捐稽徵法"
    }
  ],
  "106年度律懲字第39號": [
    {
      "title": "最高法院106年度台上字第255號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c255%2c20171101",
      "date": "106.11.01",
      "cause": "銀行法等"
    }
  ],
  "107年度律懲字第3號": [
    {
      "title": "最高法院104年度台上字第1231號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c104%2c%e5%8f%b0%e4%b8%8a%2c1231%2c20150506",
      "date": "104.05.06",
      "cause": "公共危險等"
    }
  ],
  "107年度律懲字第4號": [
    {
      "title": "臺灣高等法院高雄分院106年度上易字第142號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=KSHM%2c106%2c%e4%b8%8a%e6%98%93%2c142%2c20170727%2c1",
      "date": "106.07.27",
      "cause": "傷害"
    }
  ],
  "107年度律懲字第6號": [
    {
      "title": "最高法院106年度台上字第4118號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c106%2c%e5%8f%b0%e4%b8%8a%2c4118%2c20180110%2c1",
      "date": "107.01.10",
      "cause": "偽造文書"
    }
  ],
  "107年度律懲字第28號": [
    {
      "title": "臺灣高等法院107年度上易字第943號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPHM%2c107%2c%e4%b8%8a%e6%98%93%2c943%2c20180829%2c1",
      "date": "107.08.29",
      "cause": "毀損"
    }
  ],
  "107年度律懲字第31號": [
    {
      "title": "最高法院107年度台上字第2501號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c107%2c%e5%8f%b0%e4%b8%8a%2c2501%2c20180719%2c1",
      "date": "107.07.19",
      "cause": "偽造文書等"
    }
  ],
  "107年度律懲字第33號": [
    {
      "title": "最高法院102年度台上字第676號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPSM%2c102%2c%e5%8f%b0%e4%b8%8a%2c676%2c20130221",
      "date": "102.02.21",
      "cause": "誣告"
    }
  ],
  "108年度律懲字第11號": [
    {
      "title": "臺灣臺北地方法院107年度審簡字第993號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TPDM%2c107%2c%e5%af%a9%e7%b0%a1%2c993%2c20180608%2c1&ot=in",
      "date": "107.06.08",
      "cause": "竊盜"
    }
  ],
  "94年度律懲字第11號": [
    {
      "title": "臺灣高等法院臺中分院72年度上訴字第264號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "95年度律懲字第3號": [
    {
      "title": "臺灣高等法院88年度上訴字第969號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "96年度律懲字第8號": [
    {
      "title": "臺灣高等法院臺中分院72年度上訴字第264號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "96年度律懲字第19號": [
    {
      "title": "臺灣臺中地方法院95年度中簡上字第264號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "97年度律懲字第9號": [
    {
      "title": "臺灣臺北地方法院96年度重訴字第1271號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "98年度律懲字第7號": [
    {
      "title": "臺灣高等法院94年度上訴字第3169號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "98年度律懲字第9號": [
    {
      "title": "臺灣高等法院84年度上易字第5922號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "99年度律懲字第2號": [
    {
      "title": "臺灣高等法院83年度上易字第208號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "99年度律懲字第8號": [
    {
      "title": "臺灣臺北地方法院99年度簡字第579號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "100年度律懲字第12號": [
    {
      "title": "臺灣高等法院99年度重上更字第81號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "103年度律懲字第15號": [
    {
      "title": "臺灣高等法院臺中分院100年度重上字第63號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "103年度律懲字第16號、103年度律懲字第22號": [
    {
      "title": "臺灣高等法院臺中分院103年度上易字第1007號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "106年度律懲字第12號": [
    {
      "title": "臺灣高等法院103年度上訴字第3381號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "109年度律懲字第46號、110年度律懲字第17號": [
    {
      "title": "臺灣高等法院109年度上重更一字第3號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "113年度律懲字第29號": [
    {
      "title": "臺灣臺北地方法院112年度審簡字第969號刑事判決",
      "url": "",
      "date": "",
      "cause": ""
    }
  ],
  "105年度律懲字第23號、106年度律懲字第34號、106年度律懲字第36號": [
    {
      "title": "臺灣高等法院臺中分院106年度上易字第338號刑事判決",
      "url": "https://judgment.judicial.gov.tw/FJUD/data.aspx?ty=JD&id=TCHM%2c106%2c%e4%b8%8a%e6%98%93%2c338%2c20170817%2c1",
      "date": "106.08.17",
      "cause": "業務侵占"
    }
  ]
};
function isIntentionalCriminalCase(c){
  return (c.norm || []).some(function(n){
    return (n[1] === 'j' && /第39條第2款/.test(n[0]))
        || (n[1] === 'k' && /第73條第2款/.test(n[0]));
  });
}
var CRIMINAL_CASE_ALLOWED = (function(){
  var m = {};
  DATA.cases.forEach(function(c){ if(isIntentionalCriminalCase(c)) m[c.caseNo] = true; });
  return m;
})();
function buildFulltext(){
  var main = {}, rev = {}, n = 0;
  try{
    DATA.cases.forEach(function(c){
      /* d＝全文段落陣列、u＝來源網址、p＝紙本頁次（僅紙本來源有）、g＝署名區索引 */
      /* d＝段落陣列、u＝來源網址、p＝紙本頁次、g＝署名區索引、
         t＝決議日期、o＝作成決議原本日期、xl／xv＝互見欄位的標籤與值、hs＝歷審決議 */
      if(c.ft    && c.caseNo && !main[c.caseNo]){ main[c.caseNo] = {d:c.ft,    u:c.full,    p:c.srcPage,    g:c.sig,
          t:c.date,    o:c.dOrig,    xl:'覆審',   xv:REV_OF[c.caseNo] || '', hs:c.hist,
          cj:CRIMINAL_CASE_ALLOWED[c.caseNo] ? (CRIMINAL_JUDGMENTS[c.caseNo] || []) : []}; n++; }
      if(c.ftRev && c.revNo  && !rev[c.revNo]  ){ rev[c.revNo]  = {d:c.ftRev, u:c.revFull, p:c.srcPageRev, g:c.sigRev,
          t:c.revDate, o:c.revDOrig, xl:'原決議', xv:c.caseNo,
          cj:CRIMINAL_CASE_ALLOWED[c.caseNo] ? (CRIMINAL_JUDGMENTS[c.caseNo] || []) : []}; n++; }
    });
  }catch(e){ return null; }
  return n ? {main:main, rev:rev} : null;
}
var FT = buildFulltext();
var FULLTEXT_PROMISE = null;
function ensureFulltext(){
  if(FT) return Promise.resolve(FT);
  if(FULLTEXT_PROMISE) return FULLTEXT_PROMISE;
  var service = window.DisciplineApp && window.DisciplineApp.services && window.DisciplineApp.services.fulltext;
  if(!service || typeof service.load !== 'function') return Promise.resolve(null);
  FULLTEXT_PROMISE = service.load().then(function(payload){
    if(!payload || payload.schemaVersion !== DB_SCHEMA_VERSION) throw new Error('全文資料格式版本不相容');
    var main = payload.main || {}, rev = payload.rev || {};
    DATA.cases.forEach(function(c){
      if(!c.ft && c.caseNo && main[c.caseNo]) c.ft = main[c.caseNo];
      if(!c.ftRev && c.revNo && rev[c.revNo]) c.ftRev = rev[c.revNo];
    });
    FT = buildFulltext();
    FT_PLAIN = null;
    initFulltextDialog();
    safeRun('全文索引完成', function(){
      renderList();
      if(typeof pst !== 'undefined' && pst.expanded) renderPatternList();
      if(typeof applyRoute === 'function' && DBROUTE.route().full) applyRoute(false);
    });
    return FT;
  }).catch(function(err){
    FULLTEXT_PROMISE = null;
    if(window.console && console.error) console.error('[律師懲戒案件資料庫] 全文載入失敗：', err);
    throw err;
  });
  return FULLTEXT_PROMISE;
}
/* 索引模式下全文資料尚未載入時，全文標籤仍會先顯示在案件列表中。
   這個一次性委派器負責接住第一次點擊，載入全文後把同一個點擊重新交給
   initFulltextDialog() 建立的正式事件處理器；避免啟動時因 FT 尚未存在而漏綁事件。 */
var fulltextDeferredClickReady = false;
function initFulltextDeferredClick(){
  if(fulltextDeferredClickReady) return;
  fulltextDeferredClickReady = true;
  document.addEventListener('click', function(e){
    if(FT) return;
    var target = e.target;
    var button = target && target.closest ? target.closest('.db-ft-open') : null;
    if(!button) return;
    e.preventDefault();
    var slot = button.getAttribute('data-ft-slot');
    var index = button.getAttribute('data-ft-i');
    var hit = button.getAttribute('data-ft-hit');
    ensureFulltext().then(function(){
      /* ensureFulltext() 會重繪案件列表，原 button 可能已離開 DOM；重新取得
         同一筆按鈕後再派送，事件才會沿 document 委派器正常冒泡。 */
      var selector = '.db-ft-open[data-ft-slot="'+slot+'"][data-ft-i="'+index+'"]';
      if(hit != null) selector += '[data-ft-hit="'+hit+'"]';
      var current = document.querySelector(selector);
      if(!current) return;
      current.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
    }).catch(function(){
      if(window.console && console.error) console.error('[律師懲戒案件資料庫] 無法開啟全文');
    });
  });
}
/* 案件之第 i 列在該 slot 對應的鍵（原決議＝案號、覆審＝覆審案號） */
function ftKey(slot, i){
  var c = DATA.cases[i];
  if(!c) return '';
  return String((slot === 'rev' ? c.revNo : c.caseNo) || '');
}
/* 段落陣列 → 原字串。相容於直接存成單一字串的舊寫法 */
function ftJoin(d){
  var renderer = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextRenderer;
  if(renderer && renderer.join) return renderer.join(d);
  if(!d) return null;
  return (typeof d === 'string') ? d : d.join('\n');
}
/* 全文標題的案號一律由 caseNo／revNo 注入，全文字串內不得再存一份——
   曾經兩邊各存一份，併案時全文那份只寫了其中一個案號，全庫 39 處與清單不符。
   ftDoc（彈窗）與 ftPlain（全文檢索）都經過本函式，故檢索行為一致。 */
/* 全文來源網站：網域 → 顯示名稱。全庫只有下列三個來源（350／340／5 筆）。
   name 為紙本者另需頁次（見 srcPage），否則單一網址無從指出是書中哪幾頁。
   日後新增來源只要在此加一列；未列入者由載入檢核在主控台指出，不會靜默產生空標籤。 */
var FULLTEXT_RENDERER = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextRenderer;
var FT_SITE = FULLTEXT_RENDERER && FULLTEXT_RENDERER.sites || {
  'lawyerbc.moj.gov.tw': {name:'法務部查詢系統'},
  'gazette.nat.gov.tw':  {name:'行政院公報資訊網'},
  'www.twba.org.tw':     {name:'律師懲戒案例選集', paper:true}
};
/* 網址 → 網域（不用 URL 物件，舊瀏覽器亦可） */
function ftHost(u){
  if(FULLTEXT_RENDERER && FULLTEXT_RENDERER.host) return FULLTEXT_RENDERER.host(u);
  var m = /^https?:\/\/([^\/?#]+)/i.exec(String(u || ''));
  return m ? m[1].toLowerCase() : '';
}
/* 全文頁首的案號與來源按鈕一律於渲染時注入，全文字串內不得再存一份：
   ．案號  ← FT 索引的鍵（即 caseNo／revNo）
   ．來源  ← 該案的 full／revFull，網域決定來源名稱，紙本另加頁次
   曾經兩邊各存一份，其中的網址在 6 筆併案上漂移到同案另一人的頁面；
   一律生成之後，來源只有 full／revFull 一處，結構上不可能再漂移。 */
function ftHydrate(doc, no, link, page){
  var t = String(doc == null ? '' : doc);
  if(t.indexOf('<h2>') < 0) return t;
  var head = '';
  if(no) head += '<span class="cn">' + esc(no) + '</span>';
  var site = FT_SITE[ftHost(link)];
  if(site){
    var label = site.name + (site.paper && page ? '第' + page + '頁' : '');
    var href = safeHref(link);
    if(!href) return t;
    head += '<a class="srcbtn" href="' + href + '" target="_blank" rel="noopener">'
          + '檢索原文（' + esc(label) + '）</a>';
  }
  /* 來源按鈕排在人名之後（CSS 以 margin-left:auto 靠右），故整段接在 <h2> 之後即可 */
  return t.replace('<h2>', '<h2>' + head);
}
/* 署名區只保存「會變動的姓名」；固定 HTML、欄位標題及三種固定決議機關只定義一次。
   DATA.signs 每筆格式：[機關代碼, 委員長, [委員...], 書記官]
   機關代碼：0＝臺灣律師懲戒委員會；1＝律師懲戒委員會；2＝律師懲戒覆審委員會。
   空姓名／空委員陣列統一渲染為 <span class="empty">（空）</span>。
   297 筆舊署名 HTML 均已逐筆驗證，可由此結構完整還原。 */
var SIGN_AGENCY = FULLTEXT_RENDERER && FULLTEXT_RENDERER.agencies || ['臺灣律師懲戒委員會','律師懲戒委員會','律師懲戒覆審委員會'];
function ftSignCell(v){
  return v ? esc(v) : '<span class="empty">（空）</span>';
}
function ftSign(t, g){
  if(g == null || !DATA.signs) return t;
  var s = DATA.signs[g];
  if(!Array.isArray(s) || s.length !== 4) return t;
  var agency = SIGN_AGENCY[s[0]];
  if(!agency) return t;
  var members = Array.isArray(s[2]) ? s[2].join('、') : '';
  var blk = '<div class="sec signwrap"><h3>決議機關及署名</h3><table class="sign"><tbody>'
    + '<tr><th>決議機關</th><td>' + agency + '</td></tr>'
    + '<tr><th>委員長</th><td>' + ftSignCell(s[1]) + '</td></tr>'
    + '<tr><th>委員</th><td>' + ftSignCell(members) + '</td></tr>'
    + '<tr><th>書記官</th><td>' + ftSignCell(s[3]) + '</td></tr>'
    + '</tbody></table></div>';
  return t.replace(/\n<\/div>\s*$/, '\n' + blk + '\n</div>');
}
/* 前導資訊區（dl.meta）一律由紀錄生成，全文字串內不得再存一份——
   決議日期與原決議案號本就是 date／revDate、caseNo／revNo 的複本，
   其中 28 份因併案只寫了第一個案號而與 caseNo 不符（同前述的案號漂移）。
   「作成決議原本日期」是真資料（與決議日期在 640 份中不同），故升為
   dOrig／revDOrig 欄位保留；它帶 class="hide"，畫面上不顯示，照原樣輸出。
   案號與被付懲戒人兩列由 fillMetaHead() 於開窗後自標題條補上（見下）。 */
function ftRoc(iso){
  if(FULLTEXT_RENDERER && FULLTEXT_RENDERER.roc) return FULLTEXT_RENDERER.roc(iso);
  var m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(iso || ''));
  if(!m) return '';
  return '民國' + (+m[1] - 1911) + '年' + (+m[2]) + '月' + (+m[3]) + '日';
}
function ftMetaRow(label, value, hide){
  var h = hide ? ' class="hide"' : '';
  var v = value ? esc(value) : '<span class="empty">（空）</span>';
  return '<dt' + h + '>' + esc(label) + '</dt><dd' + (hide ? ' class="hide"' : ' class="wide"') + '>' + v + '</dd>';
}
function ftCriminalDate(s){
  if(FULLTEXT_RENDERER && FULLTEXT_RENDERER.criminalDate) return FULLTEXT_RENDERER.criminalDate(s);
  var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(s || ''));
  if(!m) return '';
  return '民國' + (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日';
}
function ftCriminalRow(items){
  if(!items || !items.length) return '';
  var content = items.map(function(j){
    var title = String(j.title || '').replace(/\s+/g, '');
    if(!j.url) return esc(title) + '（無連結）';
    var href = safeHref(j.url);
    if(!href) return esc(title) + '（無效連結）';
    return '<a href="' + href + '" target="_blank" rel="noopener">' + esc(title) + '</a>'
      + '（' + esc(ftCriminalDate(j.date)) + '，案由：' + esc(j.cause) + '）';
  }).join('、');
  return '<dt>刑事確定判決</dt><dd class="wide">' + content + '</dd>';
}
function ftMeta(e){
  var r = [];
  /* 96年度律懲字更一字第1號是全庫唯一一件標「歷審決議」者（所指的兩件本庫未收），
     原檔於該件不另列覆審欄，此處照原樣：有歷審決議且無覆審時，只列歷審決議。 */
  if(e.hs && !e.xv) r.push(ftMetaRow('歷審決議', e.hs, false));
  else {
    r.push(ftMetaRow(e.xl, e.xv, false));
    if(e.hs) r.push(ftMetaRow('歷審決議', e.hs, false));
  }
  if(e.cj && e.cj.length) r.push(ftCriminalRow(e.cj));
  r.push(ftMetaRow('決議日期', ftRoc(e.t), false));
  r.push(ftMetaRow('作成決議原本日期', ftRoc(e.o), true));
  /* 各列之間保留換行，與原檔的字串排版一致（僅為可讀性，不影響版面） */
  return '<dl class="meta">\n' + r.join('\n') + '\n</dl>';
}
/* 索引項 → 完整可渲染的全文字串。彈窗（ftDoc）與全文檢索（ftPlain）共用這一條
   路徑，兩者若各拼一套，畫面看得到的字就會與搜得到的字不一致。 */
function ftBuild(e, k){
  var d = ftJoin(e.d);
  if(d == null) return null;
  d = ftHydrate(ftSign(d, e.g), k, e.u, e.p);
  /* 前導資訊區緊接在標題條之後（原檔即為此位置） */
  return d.replace('</h2>', '</h2>\n' + ftMeta(e));
}
/* 只問「這一格有沒有全文」——查索引即可，不必接字串 */
function ftHas(slot, i){
  if(!FT || i == null) return false;
  var k = ftKey(slot, i);
  return !!(k && FT[slot === 'rev' ? 'rev' : 'main'][k]);
}
function ftDoc(slot, i){
  if(!FT || i == null) return null;
  var k = ftKey(slot, i);
  if(!k) return null;
  var e = FT[slot === 'rev' ? 'rev' : 'main'][k];
  if(!e) return null;
  return ftBuild(e, k);
}
(function(){
"use strict";
var PAGE_SIZE = 60;
var srcByKey = {};
/* 法律扶助法之下拉不顯示於篩選列（見下方 initExtraFilters），但條號索引、
   篩選狀態與「檢視引用本條之案件」一律與四部主要法典共用同一套機制，
   故凡走訪法典的迴圈一律用 ALL_SRC，不再用 DATA.sources。 */
var ALL_SRC = DATA.sources.concat(DATA.extraSources || []);
ALL_SRC.forEach(function(s){ srcByKey[s.key] = s; });

/* ---------- 資料完整性檢核 ------------------------------------------
   本資料庫的引用一律以「陣列位置」為準，請勿改用 no 或其他編號：
     ．patterns[].cases、articleIndex[].cases → DATA.cases 之索引（0 起算）
     ．articleIndex[].related                → DATA.mapRows 之索引（0 起算）
   下列檢核可攔截「引用基準寫錯」「態樣與所引法條不符」等不會造成畫面報錯、
   卻會靜默顯示錯誤案件的問題。正式訪客不自動執行；維護時可於主控台呼叫
   __auditData()，或以 ?dbdebug=1 載入後在瀏覽器閒置時自動檢核。
-------------------------------------------------------------------- */
function auditData(){
  var bad = [];
  if(DATA.schemaVersion !== DB_SCHEMA_VERSION) bad.push('schemaVersion 應為 '+DB_SCHEMA_VERSION+'，實際為 '+DATA.schemaVersion);
  if(!PAT_META_DATA || PAT_META_DATA.schemaVersion !== PAT_META_SCHEMA_VERSION) bad.push('PAT_META schemaVersion 不相容');
  if(!CONTENT_META || CONTENT_META.schemaVersion !== CONTENT_META_SCHEMA_VERSION) bad.push('CONTENT_META schemaVersion 不相容');
  function artNo(t){
    var m = /^第([0-9\-]+)條/.exec(t||'');
    return m ? m[1] + (/已刪除/.test(String(t||'')) ? '-原' : '') : null;
  }
  /* 每筆案件所引法條之「法典-條號」集合，供比對用 */
  var artsOf = DATA.cases.map(function(c){
    var set = {};
    (c.norm||[]).forEach(function(n){
      if(n[2]) set[String(n[1]).toUpperCase()+'-'+n[2]] = true;
    });
    caseNoteSegs(c).forEach(function(s){ set[s.c.toUpperCase()+'-'+s.a] = true; });
    return set;
  });
  /* 編號與位置一致性已由上方的推導保證，毋須再檢查 */
  DATA.patterns.forEach(function(p){
    var want = [];
    Object.keys(p.laws).forEach(function(k){
      p.laws[k].forEach(function(a){ var n = artNo(a); if(n) want.push(k+'-'+n); });
    });
    p.cases.forEach(function(i){
      var c = DATA.cases[i];
      if(!c){ bad.push('態樣「'+p.name+'」引用不存在的索引 '+i); return; }
      if(!want.length) return;
      /* patternInclude 之案件本就不引本態樣之法條（係人工補正歸屬），不算異常 */
      if(Array.isArray(c.patternInclude) && c.patternInclude.indexOf(p.id) >= 0) return;
      var hit = want.some(function(w){ return artsOf[i][w]; });
      if(!hit) bad.push('態樣「'+p.name+'」列入 '+c.caseNo+'（'+c.name+'），惟其懲戒依據不含本態樣之法條');
    });
  });
  Object.keys(DATA.articleIndex).forEach(function(k){
    DATA.articleIndex[k].forEach(function(e){
      var n = artNo(e.art);
      e.cases.forEach(function(i){
        var c = DATA.cases[i];
        if(!c){ bad.push('條文索引 '+k+e.art+' 引用不存在的索引 '+i); return; }
        if(n && !artsOf[i][k+'-'+n]) bad.push('條文索引 '+k+e.art+' 列入 '+c.caseNo+'（'+c.name+'），惟其懲戒依據不含本條');
      });
      (e.related||[]).forEach(function(r){
        if(!DATA.mapRows[r]) bad.push('條文索引 '+k+e.art+' 之 related 指向不存在的對照列 '+r);
      });
    });
  });
  /* 全文頁首的案號與來源按鈕一律由 ftHydrate() 注入，故 JSON 內的 ft／ftRev
     不應再出現 <span class="cn"> 或 <a class="srcbtn">。若日後重新匯入原始檔而
     帶回這兩段，畫面會出現兩個案號、兩顆來源按鈕，且併案時與 caseNo／full 不符。 */
  DATA.cases.forEach(function(c, i){
    ['ft', 'ftRev'].forEach(function(k){
      var a = c[k];
      if(!a) return;
      var head = (typeof a === 'string') ? a : (a[0] || '');
      if(head.indexOf('class="cn"') >= 0){
        bad.push(c.caseNo + '（' + c.name + '）之 ' + k + ' 仍在全文內另存一份案號，應刪除');
      }
      if(head.indexOf('class="srcbtn') >= 0){
        bad.push(c.caseNo + '（' + c.name + '）之 ' + k + ' 仍在全文內另存一份來源連結，應刪除');
      }
    });
  });
  /* 來源網站表須涵蓋所有全文的來源網域，否則來源按鈕會生不出來。
     只檢查「實際持有全文」的那一列（併案時全文只存一列，來源與頁次都取自該列，
     其餘同案號各列雖然 ftHas 為真，卻不是來源的出處，不應要求它們填頁次）。 */
  DATA.cases.forEach(function(c, i){
    [['ft', c.full, 'srcPage', '原決議'], ['ftRev', c.revFull, 'srcPageRev', '覆審']].forEach(function(p){
      if(!c[p[0]]) return;
      var h = ftHost(p[1]), site = FT_SITE[h];
      if(!site){ bad.push(c.caseNo + '（' + c.name + '）之' + p[3] + '來源網域「' + h + '」未列於 FT_SITE，來源按鈕將無法產生'); return; }
      if(site.paper && !c[p[2]]) bad.push(c.caseNo + '（' + c.name + '）之' + p[3] + '來源為紙本，卻未填 ' + p[2] + '（頁次）');
      if(!site.paper && c[p[2]]) bad.push(c.caseNo + '（' + c.name + '）之' + p[3] + '來源非紙本，卻填了 ' + p[2]);
    });
  });
  /* 樣態說明之案例：須有 no（案號）欄位，其值須與 cases[].caseNo 或 revNo 逐字相同，
     且該案須收錄決議書全文，否則該案號會變成不能點的純文字。
     併案之 no 含數個以「、」相連的案號，以第一個查全文即可（同 descCaseNoHtml）。 */
  if(typeof PAT_META_BY_ID !== 'undefined' && PAT_META_BY_ID){
    /* no 得為原決議案號或覆審案號，兩者皆逐字比對 cases[] 之對應欄位 */
    var caseNoSet = {};
    DATA.cases.forEach(function(c){
      if(c.caseNo) caseNoSet[c.caseNo] = true;
      if(c.revNo)  caseNoSet[c.revNo]  = true;
    });
    Object.keys(PAT_META_BY_ID).forEach(function(pid){
      var pm = PAT_META_BY_ID[pid], d = pm && pm.desc, cs = Array.isArray(d) ? [] : ((d && d.cases) || []);
      cs.forEach(function(it, k){
        if(/（[^（）]*[0-9]+年度[^（）]*）。$/.test(descCaseText(it))){
          bad.push('態樣 '+pid+' 案例'+(k+1)+'之內文句末仍附有「（案號）。」，應改寫於 no 欄位');
        }
        var nos = descCaseNos(it);
        if(!nos.length){
          bad.push('態樣 '+pid+' 案例'+(k+1)+'未填 no（案號）欄位');
          return;
        }
        /* 案例編號（lb）：同一態樣內不得有填有不填——流水號與型態編號混用時，
           畫面上會出現「案例1、案例A」這種看不出意義的並列。 */
        var lbN = 0, lbAll = cs.length;
        cs.forEach(function(x){ if(x && typeof x === 'object' && String(x.lb == null ? '' : x.lb).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')) lbN++; });
        if(k === 0 && lbN > 0 && lbN < lbAll){
          bad.push('態樣 '+pid+' 之案例編號（lb）有填有不填（'+lbN+'／'+lbAll+' 則），畫面會混用型態編號與流水號');
        }
        nos.forEach(function(no){
          if(!caseNoSet[no]){
            bad.push('態樣 '+pid+' 案例'+(k+1)+'之案號「'+no+'」與 cases[].caseNo／revNo 皆不一致（併案須整串填在同一個 no）');
          }
          var first = String(no).split(/[、，,]/)[0];
          if(typeof FT_XREF_CASE === 'function' && !FT_XREF_CASE(first)){
            bad.push('態樣 '+pid+' 案例'+(k+1)+'引用之 '+no+' 查無決議書全文，該案號將無法點擊');
          }
          /* 案號後的懲戒決定標籤：一份決議書含數名被付懲戒人而決定不一致時，
             「該案的懲戒決定」並無單一答案，須由案例撰寫者以 who 指名究係何人，
             程式不得代為挑選。未指名者退為並列各決定並冠姓名，於此逐則提醒。 */
          if(typeof descCaseByNo === 'function'){
            var hits = descCaseByNo()[String(no)] || [];
            var who = descCaseWho(it), decs = {}, nd = 0;
            hits.forEach(function(i2){
              var dk = String(DATA.cases[i2].decision || '');
              if(!decs[dk]){ decs[dk] = 1; nd++; }
            });
            who.forEach(function(w){
              var in1 = hits.some(function(i2){ return DATA.cases[i2].name === w; });
              if(!in1) bad.push('態樣 '+pid+' 案例'+(k+1)+'之 who「'+w+'」不是 '+no+' 的被付懲戒人，該指名不生作用');
            });
            if(!who.length && nd > 1){
              bad.push('態樣 '+pid+' 案例'+(k+1)+'之 '+no+' 有數名被付懲戒人且懲戒決定不一致，'+
                       '請以 who 欄位指名本則案例所述之被付懲戒人（未指名時並列各決定並冠姓名）');
            }
          }
        });
      });
    });
  }
  /* 人工子類標記（cases[].subcat）：關聯以永久 id 維護，id 打錯不會報錯、
     只會靜默失效——本檔一再吃虧的那類錯，於此攔下。
     最後一項尤其重要：凡採 tag 模式之樣態，只要有案件尚未人工歸類即逐件列出。
     新收案件若落入該樣態，會在此浮現，提醒補上標記，件數才不會短計。 */
  if(SUBCAT_ROWS){
    var tagPats = {};
    Object.keys(SUBCAT_ROWS).forEach(function(id){
      if(SUBCAT_ROWS[id].by === 'tag') tagPats[SUBCAT_ROWS[id].patternId] = 1;
    });
    DATA.cases.forEach(function(c, i){
      if(c.subcat == null) return;
      if(!Array.isArray(c.subcat)){
        bad.push(c.caseNo+'（'+c.name+'）之 subcat 應為陣列');
        return;
      }
      c.subcat.forEach(function(id){
        var r = SUBCAT_ROWS[id];
        if(!r){
          bad.push(c.caseNo+'（'+c.name+'）之 subcat 引用不存在的子類 id「'+id+'」');
        }else if(r.by !== 'tag'){
          bad.push(c.caseNo+'（'+c.name+'）之 subcat 引用「'+id+'」，惟該子類係由條文推導，不接受人工標記');
        }else if(((PATTERN_BY_ID[r.patternId] || {}).cases || []).indexOf(i) < 0){
          bad.push(c.caseNo+'（'+c.name+'）標記了「'+id+'」，惟本案並不屬於態樣 '+r.patternId+'，該標記不生作用');
        }
      });
    });
    /* 未歸類檢核按「軸」逐一進行：一個樣態可有數張子類表，各表本就各自分類，
       合在一起檢查會讓「A 表已歸類、B 表未歸類」的案件矇混過關。
       標了 optional 的軸（只列部分值得注意的型態者）不要求涵蓋全部案件。 */
    var axes = {};
    Object.keys(SUBCAT_ROWS).forEach(function(id){
      var r = SUBCAT_ROWS[id];
      if(r.by !== 'tag' || r.axisOptional) return;
      (axes[r.axis] = axes[r.axis] || {pid:r.patternId, ids:{}}).ids[id] = 1;
    });
    Object.keys(axes).forEach(function(ax){
      var p = PATTERN_BY_ID[axes[ax].pid], ids = axes[ax].ids;
      if(!p) return;
      var miss = p.cases.filter(function(i){
        var s = DATA.cases[i].subcat;
        if(!Array.isArray(s)) return true;
        return !s.some(function(id){ return ids[id]; });
      });
      if(miss.length){
        bad.push('態樣 '+axes[ax].pid+'「'+p.name+'」之子類表「'+ax+'」尚有 '+miss.length+
          ' 件未人工歸類（cases[].subcat）：'+
          miss.slice(0, 10).map(function(i){ return DATA.cases[i].caseNo+'（'+DATA.cases[i].name+'）'; }).join('、')+
          (miss.length > 10 ? ' …等' : ''));
      }
    });
  }
  /* 民眾入口（申訴救濟頁）：一律只收永久 ID，名稱與件數於渲染時取得。
     ID 打錯不會報錯，只會讓該按鈕靜默消失或子類預選靜默失效，故於此攔下。 */
  if(typeof PUBLIC_ENTRY !== 'undefined' && Array.isArray(PUBLIC_ENTRY)){
    PUBLIC_ENTRY.forEach(function(pe){
      var arr = Array.isArray(pe && pe.pats) ? pe.pats : [];
      if(!arr.length) bad.push('民眾入口「'+(pe && pe.t)+'」未指定任何態樣');
      arr.forEach(function(x){
        if(!PATTERN_BY_ID[x && x.p]){
          bad.push('民眾入口「'+pe.t+'」引用不存在的態樣 id「'+(x && x.p)+'」');
          return;
        }
        (Array.isArray(x.subs) ? x.subs : []).forEach(function(id){
          var r = (typeof SUBCAT_ROWS !== 'undefined' && SUBCAT_ROWS) ? SUBCAT_ROWS[id] : null;
          if(!r) bad.push('民眾入口「'+pe.t+'」引用不存在的子類 id「'+id+'」');
          else if(r.patternId !== x.p)
            bad.push('民眾入口「'+pe.t+'」之子類「'+id+'」不屬於態樣 '+x.p+'，預選不生作用');
        });
      });
    });
  }
  /* 違失態樣永久 ID 與七大類 metadata：名稱僅供顯示，所有關聯都以 id 維護。 */
  if(typeof PAT_GROUPS !== 'undefined' && PAT_GROUPS && typeof PAT_META_BY_ID !== 'undefined'){
    var pgIds = {}, patIds = {};
    PAT_GROUPS.forEach(function(g){
      if(pgIds[g.id]) bad.push('大類 id 重複：'+g.id);
      pgIds[g.id] = true;
    });
    DATA.patterns.forEach(function(p){
      if(!/^P\d{3}$/.test(p.id || '')) bad.push('態樣「'+p.name+'」缺少合法永久 id');
      if(patIds[p.id]) bad.push('態樣永久 id 重複：'+p.id);
      patIds[p.id] = true;
      if(!PAT_META_BY_ID[p.id]) bad.push('態樣 '+p.id+'「'+p.name+'」缺少 PAT_META_BY_ID');
    });
    Object.keys(PAT_META_BY_ID).forEach(function(id){
      if(!patIds[id]) bad.push('PAT_META_BY_ID 列有不存在的態樣 id「'+id+'」');
      var gs = PAT_META_BY_ID[id].groups || [];
      if(!gs.length) bad.push('態樣 '+id+' 未列入任何大類');
      gs.forEach(function(gid){ if(!pgIds[gid]) bad.push('態樣 '+id+' 引用不存在的大類 '+gid); });
    });
    DATA.mapRows.forEach(function(r, i){
      if(r.patternId && !patIds[r.patternId]) bad.push('mapRows['+i+'] 引用不存在的 patternId「'+r.patternId+'」');
    });
    /* 人工歸屬（patternInclude／patternExclude）以永久 ID 關聯，id 打錯不會報錯、
       只會靜默失效——正是本檔一再吃過虧的那種錯，於此攔下。 */
    DATA.cases.forEach(function(c){
      ['patternInclude', 'patternExclude'].forEach(function(f){
        if(!Array.isArray(c[f])) return;
        c[f].forEach(function(pid){
          if(!patIds[pid]) bad.push(c.caseNo+'（'+c.name+'）之 '+f+' 引用不存在的態樣 id「'+pid+'」');
        });
      });
    });
  }
  /* 全文與欄位的一致性：full／revFull 為外部連結者必有全文，反之亦然。
     這兩者現行資料 645 筆逐列相符（fullTag 的「無連結即無全文」退路即據此刪除），
     日後若新增了有連結卻未收全文的案件，該欄會顯示空白而非連結，於此攔下。 */
  DATA.cases.forEach(function(c, i){
    [['main', c.full, '原決議'], ['rev', c.revFull, '覆審']].forEach(function(p){
      if(p[0] === 'rev' && !c.revNo) return;
      var link = /^https?:\/\//i.test(String(p[1] == null ? '' : p[1]).replace(/^\s+|\s+$/g, ''));
      var has = ftHas(p[0], i);
      if(link && !has) bad.push(c.caseNo+'（'+c.name+'）之'+p[2]+'有連結卻查無全文');
      if(has && !link) bad.push(c.caseNo+'（'+c.name+'）之'+p[2]+'有全文卻無來源連結');
    });
  });
  /* 署名區共用表：索引必須有效，且每一份持有全文的列都必須有索引，否則
     該份決議書會少掉整個「決議機關及署名」段落——畫面上不會報錯，只是憑空消失。 */
  (function(){
    var used = {};
    DATA.cases.forEach(function(c){
      [['ft', 'sig', '原決議'], ['ftRev', 'sigRev', '覆審']].forEach(function(p){
        var hasDoc = !!c[p[0]], k = c[p[1]];
        if(hasDoc && k == null){ bad.push(c.caseNo+'（'+c.name+'）之'+p[2]+'全文缺少署名區索引 '+p[1]); return; }
        if(!hasDoc && k != null){ bad.push(c.caseNo+'（'+c.name+'）無'+p[2]+'全文卻有 '+p[1]); return; }
        if(k == null) return;
        if(!DATA.signs || !DATA.signs[k]){
          bad.push(c.caseNo+'（'+c.name+'）之'+p[1]+'='+k+' 於 signs 表中不存在');
        }else{
          var sg = DATA.signs[k];
          if(!Array.isArray(sg) || sg.length !== 4) bad.push('signs 表第 '+k+' 筆格式錯誤');
          else{
            if(!(sg[0] === 0 || sg[0] === 1 || sg[0] === 2)) bad.push('signs 表第 '+k+' 筆機關代碼錯誤：'+sg[0]);
            if(typeof sg[1] !== 'string') bad.push('signs 表第 '+k+' 筆委員長欄位非字串');
            if(!Array.isArray(sg[2]) || sg[2].some(function(n){ return typeof n !== 'string' || !n; })) bad.push('signs 表第 '+k+' 筆委員欄位格式錯誤');
            if(typeof sg[3] !== 'string') bad.push('signs 表第 '+k+' 筆書記官欄位非字串');
          }
          used[k] = true;
        }
      });
    });
    if(DATA.signs) DATA.signs.forEach(function(_, k){
      if(!used[k]) bad.push('signs 表第 '+k+' 筆未被任何案件引用（應刪除）');
    });
  })();
  /* 前導資訊區已改為生成，全文字串內不得再留一份。三者任一殘留都代表
     該欄位同時存在兩個來源，日後必然漂移，故一律攔下。 */
  DATA.cases.forEach(function(c){
    ['ft', 'ftRev'].forEach(function(k){
      var a = c[k];
      if(!a) return;
      var t = (typeof a === 'string') ? a : a.join('\n');
      if(t.indexOf('class="meta"') >= 0) bad.push(c.caseNo+'（'+c.name+'）之 '+k+' 仍在全文內另存一份前導資訊區');
      if(t.indexOf('sec signwrap') >= 0) bad.push(c.caseNo+'（'+c.name+'）之 '+k+' 仍在全文內另存一份署名區');
      if(t.indexOf('class="lvl') >= 0)   bad.push(c.caseNo+'（'+c.name+'）之 '+k+' 仍留有已廢止的 lvl 類別');
    });
  });
  /* 作成決議原本日期：持有全文者才該有，格式須為 ISO 日期（30 份原檔即為空，故容許缺漏） */
  DATA.cases.forEach(function(c){
    [['ft', 'dOrig', '原決議'], ['ftRev', 'revDOrig', '覆審']].forEach(function(p){
      var v = c[p[1]];
      if(v == null) return;
      if(!c[p[0]]) bad.push(c.caseNo+'（'+c.name+'）無'+p[2]+'全文卻有 '+p[1]);
      else if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v))) bad.push(c.caseNo+'（'+c.name+'）之'+p[1]+'「'+v+'」非 ISO 日期');
    });
  });
  /* 懲戒種類分級：h 必須在 HC_OF 表內，否則該案決議欄的底色會落空 */
  DATA.cases.forEach(function(c){
    if(HC_OF(c.h) === '') bad.push(c.caseNo+'（'+c.name+'）之 h='+c.h+' 未列於 HC_OF 對照表');
  });
  /* 暫時處分：決議欄文字（IS_PROV）與 h≥1000 目前完全一致。兩者走散時必有一邊
     漏列，而畫面照樣渲染、不會報錯，故載入時比對一次（見 PROV_RE 之註解）。 */
  DATA.cases.forEach(function(c, i){
    if(IS_PROV[i] !== (parseFloat(c.h) >= 1000)){
      bad.push(c.caseNo+'（'+c.name+'）之暫時處分判準不一致：決議欄「'+c.decision+'」、h='+c.h);
    }
  });
  if(bad.length && window.console && console.warn){
    console.warn('[律師懲戒案件資料庫] 資料檢核發現 '+bad.length+' 項異常：');
    bad.slice(0, 50).forEach(function(m){ console.warn('  ・'+m); });
    if(bad.length > 50) console.warn('  ……其餘 '+(bad.length-50)+' 項省略');
  }
  return bad;
}
try{
  /* 正式訪客不自動執行維護檢核；手動可呼叫 __auditData()，或以 ?dbdebug=1 載入時自動檢核。 */
  window.__auditData = auditData;
  if(/(?:^|[?&])dbdebug=1(?:&|$)/.test(location.search)){
    if(window.requestIdleCallback) window.requestIdleCallback(function(){ auditData(); }, {timeout:4000});
    else setTimeout(auditData, 1200);
  }
}catch(err){ /* 檢核本身絕不影響頁面運作 */ }




/* [JS-RENDER] 共用 renderer／案件表格／分頁 */
/* ======================================================================
   共用呈現元件：全文標籤、規範標籤、案件表格與分頁
   ====================================================================== */
/* 決議全文標籤：已收錄全文→深藍底白字「全文」（於本頁開啟彈窗）；
   若本身無全文但覆審有全文→淺藍底深藍字「詳覆審」；
   「無全文」→深灰底白字。外部來源連結由全文彈窗內的來源按鈕提供。 */
/* 全文欄實際顯示的字樣。fullTag() 與關鍵字檢索索引共用這一份判斷——
   兩者若各寫一套就會不一致：畫面顯示「詳覆審」的案件，卻能被「無全文」搜到。 */
var CASE_LIST_VIEW = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.caseListView;
function fullWord(v, revv, i, slot){
  if(CASE_LIST_VIEW && CASE_LIST_VIEW.fullWord) return CASE_LIST_VIEW.fullWord(v, revv, i, slot, ftHas);
  var s = String(v==null?'':v).trim();
  if(ftHas(slot || 'main', i)) return '全文';          /* 已收錄全文 */
  /* 索引檔會移除 ft，全文資料尚未按需載入時仍要依來源網址顯示可開啟的按鈕；
     使用者點擊後由 fulltext dialog 觸發 ensureFulltext() 載入完整內容。 */
  if(/^https?:\/\//i.test(s)) return '全文';
  var rs = String(revv==null?'':revv).trim();
  /* 本案無全文，但覆審有全文連結時，標示「詳覆審」 */
  if((s==='無全文'||s==='') && /^https?:\/\//i.test(rs)) return '詳覆審';
  if(s==='無全文') return '無全文';
  return '';
}
function fullTag(v, revv, i, slot){
  if(CASE_LIST_VIEW && CASE_LIST_VIEW.fullTag) return CASE_LIST_VIEW.fullTag(v, revv, i, slot, ftHas, esc);
  var sl = slot || 'main', word = fullWord(v, revv, i, sl);
  if(word==='全文'){
    /* 不下 title：按鈕文字「全文」本身已說明用途，原生 tooltip 只是重複一次 */
    return '<button type="button" class="db-full-tag db-ft-open" data-ft-slot="'+sl+
      '" data-ft-i="'+i+'" aria-label="在本頁閱讀決議書全文">全文</button>';
  }
  /* 「詳覆審」「無全文」只說了結果、沒說原因，故帶 data-ft-tip：滑鼠停留／鍵盤聚焦／
     行動裝置點按時，由 [JS-FULLTEXT] 的 initFullTagTip() 顯示未公告原因的說明浮字。
     刻意不用 title 屬性——同一個元素若同時有原生 tooltip 與說明浮字會重複出現；
     說明文字掛在浮字節點（#db-ft-tip）並以 aria-describedby 指向，讀屏軟體亦讀得到。 */
  var tip = ' tabindex="0" data-ft-tip="1" aria-describedby="db-ft-tip"';
  if(word==='詳覆審') return '<span class="db-full-tag db-ft-rev"'+tip+'>詳覆審</span>';
  if(word==='無全文') return '<span class="db-full-tag db-ft-none"'+tip+'>無全文</span>';
  return '';
}
/* ---------- 其它規範（norm 之 x 類）：名稱清單與備註欄辨識 ------------
   名稱清單一律由 cases[].norm 推導，不另存一份（理由同 patterns[].cases：
   衍生資料一旦與 norm 失步就會靜默出錯）。
   規範名稱＝顯示文字中第一個「第<數字>」之前的部分；長名排前，
   比對時先長後短，避免短名先命中而截斷。 */
var OTHER_NAME_LIST = (function(){
  var seen = {}, out = [];
  DATA.cases.forEach(function(c){
    (c.norm || []).forEach(function(n){
      if(n[1] !== 'x') return;
      var m = /^([\s\S]*?)第[0-9]/.exec(n[0]);
      var nm = (m ? m[1] : n[0]).replace(/^\s+|\s+$/g, '');
      if(nm && !seen[nm]){ seen[nm] = 1; out.push(nm); }
    });
  });
  return out.sort(function(a, b){ return b.length - a.length; });
})();

/* 名稱 → LAW_OTHERS 之項目。只有「懲戒法規－其它」收錄者才有來源連結，
   也才做成可點擊標籤；公會章程、地院義務辯護要點等維持純標籤。
   一個標籤含二部規範時（例：「…注意事項第37點、法律扶助酬金計付辦法第6條」），
   以在文字中出現較前者為準。 */
function otherByName(text){
  var best = null, bestAt = -1;
  text = String(text || '');
  for(var i = 0; i < LAW_OTHERS.length; i++){
    var o = LAW_OTHERS[i];
    if(!(o.names && o.names.length)) continue;
    for(var j = 0; j < o.names.length; j++){
      var at = text.indexOf(o.names[j]);
      if(at >= 0 && (bestAt < 0 || at < bestAt)){ best = o; bestAt = at; }
    }
  }
  return best;
}

/* 備註欄中的其它規範：名稱＋條次（條／點／項／款，含頓號連寫與前段等後綴）整串框起。
   與 noteSegs 分開實作——noteSegs 之結果另供「由 norm 推導索引結構」使用，
   在其中混入 x 類會影響條文比對，故一律不動 noteSegs。 */
function reEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
var OTHER_CITE = '(?:第[0-9]+(?:之[0-9]+)?[條點項款](?:第[0-9]+(?:、[0-9]+)*[項款])*(?:前段|後段|但書|本文)?)';
var NOTE_OTHER_RES = OTHER_NAME_LIST.map(function(nm){
  return new RegExp(reEsc(nm) + OTHER_CITE + '(?:、' + OTHER_CITE + ')*', 'g');
});
function noteOtherSegs(note){
  var t = String(note || ''), out = [], m, i;
  for(i = 0; i < NOTE_OTHER_RES.length; i++){
    var re = NOTE_OTHER_RES[i];
    re.lastIndex = 0;
    while((m = re.exec(t))) out.push({ t: m[0], c: 'x', a: '', i: m.index });
  }
  return out;
}

/* 備註欄：將「《律師懲戒案例選輯》」文字加上超連結 */
var SELIN_URL = 'https://www.twba.org.tw/publication/articles/7a60e5e5-29bd-4c6a-903d-3128a9fce486';
/* 備註欄中的態樣名稱：凡案件設有 patternInclude（人工補正之樣態歸屬），即把
   備註中以「」框住、且與該態樣「現名」完全相同的字串做成可點擊標籤，點擊後
   跳至違失態樣頁之該態樣，行為與法條卡片內的態樣名稱一致。
   比對方式刻意是「先以 ID 反查現名、再比對備註文字」：日後若改了態樣名稱，
   備註中的舊名只會失去連結，不可能連到別的態樣。
   本函式只加連結、不生條文標籤，故備註中的態樣名稱不進法條篩選器。
   輸入為已跳脫之 HTML 片段，故態樣名稱亦以 esc() 後再比對。 */
function patLinkify(html, inc){
  if(!Array.isArray(inc) || !inc.length) return html;
  inc.forEach(function(pid){
    var p = PATTERN_BY_ID[pid];
    if(!p || !p.name) return;
    var nm = esc(p.name);
    /* 標籤外觀與其他態樣名稱統一由 patTagHtml 產生（紫色標籤、可跨行版）。
       第三個參數 true：若正是目前檢視的態樣，一併套深紫標示。 */
    html = html.replace(new RegExp('「' + reEsc(nm) + '」', 'g'),
      '「' + patTagHtml(pid, true, true) + '」');
  });
  return html;
}
function noteHtml(note, noLaw, inc){
  var t = String(note || '');
  if(!t) return '';
  /* noteNoLaw 之案件：備註照原文顯示，但不做條文標籤（見 caseNoteSegs） */
  if(noLaw) return patLinkify(esc(t).replace(/《律師懲戒案例選輯》/g,
    '<a href="'+SELIN_URL+'" target="_blank" rel="noopener">《律師懲戒案例選輯》</a>'), inc);
  /* 純文字段落：僅做跳脫、《律師懲戒案例選輯》超連結與態樣連結 */
  function plain(s){
    return patLinkify(esc(s).replace(/《律師懲戒案例選輯》/g,
      '<a href="'+SELIN_URL+'" target="_blank" rel="noopener">《律師懲戒案例選輯》</a>'), inc);
  }
  /* 法條段落：與「違反（或移送）之規範」欄共用 normHtml，點擊行為完全一致。
     四部法典由 noteSegs 辨識，其它規範由 noteOtherSegs 辨識，合併後依位置排序；
     位置相同時取較長者，並略過與前一段重疊者。 */
  var segs = noteSegs(t).concat(noteOtherSegs(t)), out = [], last = 0;
  segs.sort(function(p, q){ return (p.i - q.i) || (q.t.length - p.t.length); });
  segs.forEach(function(s){
    if(s.i < last) return;
    out.push(plain(t.slice(last, s.i)), normHtml([[s.t, s.c, s.a]], true));
    last = s.i + s.t.length;
  });
  out.push(plain(t.slice(last)));
  return out.join('');
}
/* 懲戒決定欄：將（覆審：…）之後的文字另外標示強調 */
/* ---------- 懲戒決定欄的說明浮字 ------------------------------------
   「免議」「不受理」「不予懲戒（不付懲戒）」只寫了結果，未說明法律依據；
   此處把《律師法》的對應條文掛成說明浮字（與「無全文」同一套，見 initFullTagTip）。
   ．浮字掛在整個 <td> 上（data-ft-tip），不另加標籤或改字樣——欄位外觀完全不變。
   ．判斷以整格文字為準：「應予除名（覆審：不付懲戒）」這類覆審後改判者亦顯示，
     因為畫面上確實出現了該結果。現行 645 筆中沒有一格同時出現兩種結果，
     故依序取第一個命中者即可；日後若出現，仍會有一則說明而不致空白。
   ．條文內容與 laws 之新律師法第90、91、92條逐字相符（載入時不另行核對，
     修法時請一併更新這三段文字）。 */
var DEC_TIPS = [
  {re: /免議/, t: '依《律師法》第91條規定：「懲戒案件有下列情形之一者，應為免議之決議：\n'+
                 '一、同一行為，已受律師懲戒委員會之懲戒處分確定。\n'+
                 '二、已逾第一百零二條規定之懲戒權行使期間。」'},
  {re: /不受理/, t: '依《律師法》第92條規定：「懲戒案件有下列情形之一者，應為不受理之決議：\n'+
                  '一、移付懲戒之程序違背規定不能補正或經通知補正逾期不補正。\n'+
                  '二、被付懲戒律師死亡。」'},
  {re: /不予懲戒|不付懲戒/, t: '依《律師法》第90條規定：「被付懲戒律師有第七十三條情事之一者，'+
                  '應為懲戒處分之決議；其證據不足或無第七十三條情事者，應為不受懲戒之決議。」'}
];
/* 回傳可直接接在 <td 之後的屬性字串；無對應者回空字串（該格完全不變） */
function decTipAttr(dec){
  var t = String(dec || '');
  for(var i = 0; i < DEC_TIPS.length; i++){
    if(DEC_TIPS[i].re.test(t)){
      return ' data-ft-tip="'+esc(DEC_TIPS[i].t)+'" aria-describedby="db-ft-tip"';
    }
  }
  return '';
}
function decisionHtml(dec){
  var t = String(dec||'');
  var i = t.indexOf('（覆審');
  if(i < 0) return esc(t);
  return esc(t.slice(0,i)) + '<span class="db-rev-flag">' + esc(t.slice(i)) + '</span>';
}
var clsToKey = {j:'J', k:'K', l:'L', m:'M', n:'N', o:'O'};
/* flow=true：改用可跨行分段的 span（備註欄專用），其餘一律沿用 button */
/* ※ 法條標籤刻意「不」隨目前檢視的態樣改色：四部法典本身已各有配色，再加一層
   強調色會讓同一格出現太多顏色而更難讀。深色標示一律只用在態樣名稱上。 */
/* lk（選用）：與 segs 等長的類名陣列，由態樣欄的對照推導而來（見 normLinks），
   掛在標籤上供 CSS 做規範⇄態樣的滑過連動。備註欄不傳，故不受連動影響。 */
/* 條文標籤內的斷行機會。
   瀏覽器對中文的斷行點取決於內建分詞，「新倫理規範第12條第1項第1款」這種法條字串
   整串幾乎找不到斷點；放不下時整顆標籤被推到下一行，上一行就空掉一大截（實測
   一行只用了三分之一）。單靠 CSS 補不回來：overflow-wrap 的任意斷行，依規範只在
   「這一行找不到任何正常斷點」時才准用，而標籤之間的 <wbr> 正是一個正常斷點。
   故此處自行在字串內補上斷點，位置取法律上的分節處：
   　．每個非開頭的「第」之前（條、項、款、點之間）
   　．每個「、」之後（第2、8款這類連寫）
   數字不會被拆開，跨瀏覽器的結果也一致，不必倚賴分詞。
   輸入為原始字串，回傳已跳脫的 HTML 片段。 */
function citeWrap(text){
  return esc(text)
    .replace(/(.)第(?=[0-9一二三四五六七八九十])/g, '$1<wbr>第')
    .replace(/、(?!<)/g, '、<wbr>');
}
function normHtml(segs, flow, lk){
  if(!segs || !segs.length) return '<span class="db-empty-cell">—</span>';
  var fc = flow ? ' db-tag-flow' : '';
  return segs.map(function(sg, si){
    var lc = (lk && lk[si]) || '';
    var text = sg[0], cls = sg[1], art = sg[2] || '';
    var key = clsToKey[cls];
    if(cls === 'x'){
      /* 其它規範：收錄於「懲戒法規－其它」者做成可點擊標籤，開啟規範速覽卡片；
         未收錄者（公會章程、地院義務辯護要點等）維持原樣，只框不連結。 */
      var oo = otherByName(text);
      if(oo){
        var xa = ' class="db-tag db-tag-x' + fc + lc + '" data-other="' + esc(oo.k) +
                 '" title="檢視《' + esc(oo.title.replace(/[《》]/g, '')) + '》">';
        return flow
          ? '<span role="button" tabindex="0"' + xa + citeWrap(text) + '</span>'
          : '<button type="button"' + xa + citeWrap(text) + '</button>';
      }
    }
    if(key && art && DATA.laws && DATA.laws[key]){
      var xm = text.match(/第(\d+)項/);
      var xiang = xm ? xm[1] : '';
      var kss = (text.match(/第(\d+)款/g)||[]).map(function(t2){ return t2.match(/\d+/)[0]; }).join(',');
      var sm = text.match(/(本文|但書|前段|後段)/);      /* 供卡片內只反白該部分 */
      var attr = ' class="db-tag db-tag-'+cls+fc+lc+'" data-law="'+key+
        '" data-art="'+esc(art)+'" data-x="'+xiang+'" data-ks="'+kss+
        '" data-seg="'+(sm?sm[1]:'')+'"';
      return flow
        ? '<span role="button" tabindex="0"'+attr+'>'+citeWrap(text)+'</span>'
        : '<button type="button"'+attr+'>'+citeWrap(text)+'</button>';
    }
    return '<span class="db-tag db-tag-'+cls+fc+lc+'">'+citeWrap(text)+'</span>';
  /* 標籤之間夾 <wbr>：相鄰兩個 inline 標籤之間，實測瀏覽器不會自行找到斷行機會
     （中文整串沒有空白，交界處又隔著外距與框線），結果是放不下的整顆標籤被推到
     下一行、上一行空掉一大截。<wbr> 是明確的斷行機會，不佔寬度、不進複製的文字。
     單一標籤的呼叫（備註欄）只有一段，join 不生作用。 */
  }).join('<wbr>');
}

/* 違失態樣標籤：外觀比照法條標籤、色系為紫（.db-tag-p），點擊即跳至「違失態樣」頁。
   凡畫面上出現「可點擊的態樣名稱」一律經由本函式產生，外觀與行為才不會各處分歧
   （態樣欄、備註欄之態樣連結；法條卡片內的按鈕是動作列樣式，另行處理）。
   flow=true：改用可跨行分段的 span（備註欄專用），其餘一律沿用 button。
   hl=true：允許套用「目前檢視之態樣」的深色標示（態樣欄與備註欄都要）。
   lc：連動類名（.db-lkN），只有態樣欄傳；備註欄不傳，故不參與淡出。
   ※ 刻意不下 title：態樣名稱本身已說明去處，hover 再冒出一行提示反而干擾閱讀。
   點擊與 Enter／Space 由文件層的 [data-pattern-id] 委派處理器接手。 */
function patTagHtml(pid, flow, hl, lc){
  var p = PATTERN_BY_ID[pid];
  if(!p || !p.name) return '';
  /* 態樣名稱是散文，斷點多半靠瀏覽器分詞即可；但頓號之後是最自然的一處，
     補上 <wbr> 讓長名（最長 17 字，欄寬放不下）一定有地方可斷。 */
  var nm = esc(p.name).replace(/、(?!<)/g, '、<wbr>');
  var on = (hl && CUR_PAT_ID && pid === CUR_PAT_ID) ? ' db-tag-p-on' : '';
  var attr = ' class="db-tag db-tag-p'+on+(flow ? ' db-tag-flow' : '')+(lc || '')+
    '" data-pattern-id="'+esc(pid)+'"';
  return flow
    ? '<span role="button" tabindex="0"'+attr+'>'+nm+'</span>'
    : '<button type="button"'+attr+'>'+nm+'</button>';
}
/* 規範欄與態樣欄的對照：把本欄（norm）的每一個條文，對到它在對照表中所屬的違失
   態樣，並讓同一組的條文與態樣共用一個 .db-lkN，供 CSS 做滑過連動。
   四條規則（皆為使用者確認過的取捨）：
   1. 推導範圍只取本欄（norm）之條文，不納入備註欄提及之條文，也不納入
      patternInclude 之人工補正——本欄顯示什麼，就只由本欄的資料決定。
      故與「違失態樣」頁的歸屬（caseProv／patternInclude，範圍較寬）並非同義，
      少數案件會出現「樣態頁收得到、本列態樣欄卻沒有該態樣」，此為預期行為。
   2. 複數條文指向同一態樣時，該態樣只出現一次（取 norm 順序中首次出現的位置），
      該組的每一個條文都掛同一個 .db-lkN。
   3. 一個條文可能對到兩個態樣（現行資料有 10 處），此時該條文同時掛兩個類名。
   4. 對照表未收錄之條文（公會章程、法扶要點等其它規範亦然）在態樣欄沒有對應項，
      條文標籤照常留在規範欄，只是不掛類名、不參與連動。
   ※ LINK_MAX：CSS 只寫到 .db-lk8（現行資料一列最多 7 組）。超過上限者整列都不給
     類名——寧可整列不連動，也不要只連一半而讓人誤判哪一條對到哪一個。 */
var LINK_MAX = 8;
function normLinks(segs){
  var order = [], of = [];
  (segs || []).forEach(function(sg){
    var key = clsToKey[sg[1]];
    var ids = key ? patIdsOfText(key, sg[0]) : [];
    of.push(ids);
    ids.forEach(function(pid){ if(order.indexOf(pid) < 0) order.push(pid); });
  });
  var ok = order.length <= LINK_MAX;
  return {
    order: order,
    /* 條文側：與 segs 等長 */
    cls: of.map(function(ids){
      return ok ? ids.map(function(pid){ return ' db-lk' + (order.indexOf(pid) + 1); }).join('') : '';
    }),
    /* 態樣側：與 order 等長 */
    pcls: order.map(function(pid, i){ return ok ? ' db-lk' + (i + 1) : ''; })
  };
}
/* 違失態樣欄的內容。順序即 normLinks 的 order（該態樣在本列條文中首次出現的先後）；
   一個態樣都沒有的案件顯示「—」。
   flow=true：與規範欄一致，標籤貼齊文字流（見 CSS 的 td.db-t-pat .db-tag-flow）。 */
function patHtml(g){
  if(!g.order.length) return '<span class="db-empty-cell">—</span>';
  return g.order.map(function(pid, i){ return patTagHtml(pid, true, true, g.pcls[i]); }).join('<wbr>');
}

/* ---------- 共用：案件表格 + 頁次 ---------- */
/* sortCfg（選用）：{key, asc, onSort} 啟用表頭點擊排序（編號、決議日期、懲戒決定） */
/* groupCfg：{active, onGroup}，只有「案件清單」傳入；不傳則表頭不生成檢視鈕，
   「違失態樣」共用本函式故不受影響。 */
/* 表頭檢視鈕：資料夾＝一案多人、人像＝一人多案；以 SVG 繪製，不依賴字型或 content。
   案號的資料夾另備「開啟」樣式：未啟用（灰）為闔上的卷宗夾，啟用（金）換成打開的
   卷宗夾，讓「正在調閱」的狀態除了顏色之外還有形狀上的差別。鍵名規則為
   kind + 'On'，未定義者沿用原圖，故人像不必另備。 */
var GRP_ICON = {
  'case': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
          '<path d="M3.2 6.6c0-.9.7-1.6 1.6-1.6h4.4l1.7 2.1h9.3c.9 0 1.6.7 1.6 1.6v8.7c0 .9-.7 1.6-1.6 1.6H4.8c-.9 0-1.6-.7-1.6-1.6z"/></svg>',
  'caseOn': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
          '<path d="M2.9 7c0-.85.65-1.5 1.5-1.5h4.1l1.6 2h8.2c.85 0 1.5.65 1.5 1.5v1.4H2.9z"/>'+
          '<path d="M3.6 12h17.1c1.05 0 1.8 1 1.55 2l-1.25 4.7c-.2.75-.9 1.3-1.7 1.3H4.9c-.9 0-1.6-.7-1.6-1.6V12z"/></svg>',
  'name': '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+
          '<circle cx="12" cy="7.8" r="3.7"/><path d="M4.6 19.6c0-3.6 3.3-5.7 7.4-5.7s7.4 2.1 7.4 5.7z"/></svg>'
};
/* 規範欄與態樣欄合併後的表頭說明鈕。 */
/* 欄位說明「?」的說明文字：滑鼠停留時以浮字顯示（同「無全文」那一套），
   點擊則另開說明卡片。兩者共用同一份文字，見 HELP_TEXT。
   ※ 資料庫說明頁「三、表記說明」的示意表頭內另有一顆同樣的「?」（靜態 HTML），
     文字與此處 norm 相同，改動時兩處要一起改。 */
var HELP_TIP = {
  norm: '若結果為「不予懲戒（不付懲戒）」、「免議」、「不受理」的案件，本欄位顯示移送懲戒單位移送之條文依據與違失態樣。'
};
var NORM_HELP_BTN = '<button aria-label="欄位說明" class="db-th-help" data-help="norm" data-ft-tip="'+esc(HELP_TIP.norm)+'" aria-describedby="db-ft-tip" type="button">?</button>';
/* 本次渲染「目前檢視的態樣」ID：違失態樣頁＝畫面上選定的那個態樣；案件清單沒有
   選定態樣，故為空字串。由 renderTable 的第 9 個參數設定。
   態樣欄與備註欄的態樣名稱共用這一個值。法條標籤不使用本值（見 normHtml 之註解）。 */
var CUR_PAT_ID = '';
var CASE_COLUMNS = [
  {col:'db-c-no', label:'#', sort:'no', tip:'編號', cell:function(c,i){ return '<td class="db-t-no">'+esc(c.no)+'</td>'; }},
  {col:'db-c-case', label:'案號', group:'case', cell:function(c,i){ return '<td class="db-t-case">'+fullTag(c.full,c.revFull,i,'main')+esc(c.caseNo)+'</td>'; }},
  {col:'db-c-name', label:'被付懲戒人', group:'name', headClass:'db-th-name', cell:function(c){ return '<td>'+esc(c.name)+'</td>'; }},
  {col:'db-c-date', label:'決議日', sort:'date', cell:function(c){ return '<td class="db-t-date">'+esc(rocDate(c.date))+'</td>'; }},
  {col:'db-c-unit', label:'移送懲戒單位', sort:'unit', cell:function(c){ return '<td>'+esc(c.unit)+'</td>'; }},
  {col:'db-c-dec', label:'懲戒決定', sort:'h', cell:function(c){ var hc=HC_OF(c.h); return '<td'+(hc?' class="db-hc'+hc+'"':'')+decTipAttr(c.decision)+'>'+decisionHtml(c.decision)+'</td>'; }},
  /* 規範欄與態樣欄：兩欄並列、共用一格表頭（head:2 → colspan="2"，見 renderTable
     的 headHtml），態樣欄本身不生表頭（headSkip）。
     兩格分別掛 db-t-norm／db-t-pat，CSS 才能把滑過連動的淡出範圍限縮在這兩欄——
     備註欄同樣有條文與態樣標籤，不該跟著淡出。
     normLinks 在兩個 cell() 各算一次：一列的條文不過數個，重算的成本遠低於
     為此另存一份對照結果（衍生資料另存正是檔首覆轍清單第 1 點）。
     兩欄的標籤都以 flow＝true 產生（span，非 button）：欄寬有限，標籤必須能隨
     文字斷行，否則放不下的整顆換行，一顆就吃掉一整行。 */
  {col:'db-c-norm', head:2,
   label:'違反（或移送'+NORM_HELP_BTN+'）之規範及態樣',
   cell:function(c){ return '<td class="db-t-norm">'+normHtml(c.norm, true, normLinks(c.norm).cls)+'</td>'; }},
  {col:'db-c-pat', headSkip:true,
   cell:function(c){ return '<td class="db-t-pat">'+patHtml(normLinks(c.norm))+'</td>'; }},
  {col:'db-c-revno', label:'覆審案號', sort:'revNo', cell:function(c,i){ return '<td class="db-t-case">'+(c.revNo?(fullTag(c.revFull,'',i,'rev')+esc(c.revNo)):'<span class="db-empty-cell">—</span>')+'</td>'; }},
  {col:'db-c-revdate', label:'覆審日', sort:'revDate', cell:function(c){ return '<td class="db-t-date">'+esc(rocDate(c.revDate))+'</td>'; }},
  /* 覆審決定欄與懲戒決定欄共用同一套說明浮字（見 decTipAttr）：判斷同樣以整格文字
     為準，例如「原決議撤銷。本件免議。」亦顯示免議之依據。 */
  {col:'db-c-revtext', label:'覆審決定', sort:'revText', cell:function(c){ return '<td class="db-t-revtext"'+decTipAttr(c.revText)+'>'+esc(c.revText)+'</td>'; }},
  {col:'db-c-note', label:'備註', sort:'note', cell:function(c){ return '<td class="db-t-note">'+noteHtml(c.note, c.noteNoLaw, c.patternInclude)+'</td>'; }}
];
/* ---------- 檢索摘要列 --------------------------------------------------
   檢索時，案件主列下方多一列、橫跨全部欄位，列出關鍵字在決議書全文中的前後文，
   命中字反白；不必先點開全文就看得到上下文。
   ．字詞取自 queryTerms(queryAst(st.q))，與全文彈窗反白同一份（「不含」的字詞不取）。
   ．只在全文有命中時才出摘要列；命中只在欄位（姓名、備註…）者不出，改在該格內反白。
   ．摘要自 ftDoc() 的原文去標籤後切取，不使用 ftPlain()——後者已轉小寫、壓縮空白，
     英文字母會顯示成小寫。成本只付在當頁（PAGE_SIZE 筆），並以「字詞＋案件」快取。
   ．只切 .sec（事實／理由／主文…）內的段落；標題條與前導資訊區的命中屬欄位性質，不入摘要。
   ．每段摘要記下它在「彈窗內 .sec mark.ft-hit 的第幾個」（ord），點摘要開全文時據以捲到該處。
     標題 h3 本身的命中也計入 ord，因為彈窗反白會標到它。
   ．前後各取 SNIP_N 字；每筆至多 SNIP_MAX_LINES 段。多字詞時優先取字詞同現的窗口，
     同分則取命中較密者，顯示時再依原文順序排列。 */
var SNIP_N = 60;
var SNIP_MAXW = SNIP_N * 2 + 100;     /* 單一窗口長度上限：命中很密的段落不致合併成一大段 */
var SNIP_MAX_LINES = 2;
var SNIP_DP = null, SNIP_CACHE = {}, SNIP_CACHE_KEY = '';
function snipRegex(terms){
  var ts = terms.slice().sort(function(a, b){ return b.length - a.length; });
  return new RegExp(ts.map(function(t){
    return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|'), 'gi');
}
function snipSections(html){
  var out = [];
  if(!html) return out;
  var doc;
  try{ doc = (SNIP_DP || (SNIP_DP = new DOMParser())).parseFromString(html, 'text/html'); }
  catch(e){ return out; }
  var secs = doc.querySelectorAll('.sec');
  for(var s = 0; s < secs.length; s++){
    var sec = secs[s], h3 = sec.querySelector('h3');
    var label = h3 ? (h3.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var inner = sec.innerHTML.replace(/<h3[\s\S]*?<\/h3>/i, '')
      .replace(/<\/(?:p|div|li|tr|table|h[1-6]|dt|dd)>|<br\s*\/?>/gi, '$&\n');
    var tmp = doc.createElement('div');
    tmp.innerHTML = inner;
    var paras = (tmp.textContent || '').split('\n').map(function(p){
      return p.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    out.push({label: label, paras: paras});
  }
  return out;
}
function snipCount(text, re){
  var n = 0, m;
  re.lastIndex = 0;
  while((m = re.exec(text))){ if(!m[0]){ re.lastIndex++; continue; } n++; }
  return n;
}
function snipFor(i, terms, re){
  var key = terms.join('\u0001');
  if(key !== SNIP_CACHE_KEY){ SNIP_CACHE = {}; SNIP_CACHE_KEY = key; }
  if(SNIP_CACHE[i]) return SNIP_CACHE[i];
  var c = DATA.cases[i], docs = [], cand = [], total = 0, by = {main:0, rev:0}, shown = {main:0, rev:0};
  if(ftHas('main', i)) docs.push({slot:'main', html:ftDoc('main', i)});
  if(c.revNo && ftHas('rev', i)){
    var rh = ftDoc('rev', i);
    if(!docs.length || rh !== docs[0].html) docs.push({slot:'rev', html:rh});   /* 與 ftTextOf 同：同文不重複 */
  }
  docs.forEach(function(d){
    var ord = 0;
    snipSections(d.html).forEach(function(sc){
      ord += snipCount(sc.label, re);
      sc.paras.forEach(function(p){
        var ms = [], m;
        re.lastIndex = 0;
        while((m = re.exec(p))){
          if(!m[0]){ re.lastIndex++; continue; }
          ms.push({s:m.index, e:m.index + m[0].length, t:m[0].toLowerCase()});
        }
        if(!ms.length) return;
        var wins = [];
        ms.forEach(function(mm, k){
          var w = wins[wins.length - 1];
          if(w && mm.s - SNIP_N <= w.b && mm.e + SNIP_N - w.a <= SNIP_MAXW){
            w.b = Math.min(p.length, mm.e + SNIP_N); w.n++; w.seen[mm.t] = 1;
          }else{
            var sn = {}; sn[mm.t] = 1;
            wins.push({a:Math.max(0, mm.s - SNIP_N), b:Math.min(p.length, mm.e + SNIP_N), n:1, seen:sn, ord:ord + k});
          }
        });
        wins.forEach(function(w){
          /* 窗口邊界不可切在命中字中間：被切到者把邊界延到命中字之外 */
          ms.forEach(function(mm){
            if(mm.s < w.b && mm.e > w.b) w.b = mm.e;
            if(mm.s < w.a && mm.e > w.a) w.a = mm.s;
          });
          cand.push({slot:d.slot, label:sc.label, p:p, a:w.a, b:w.b, ms:ms, ord:w.ord,
                     score:Object.keys(w.seen).length * 100 + w.n, seq:cand.length});
        });
        ord += ms.length;
        total += ms.length;
        by[d.slot] += ms.length;
      });
    });
  });
  var pick = cand.slice().sort(function(x, y){ return (y.score - x.score) || (x.seq - y.seq); })
    .slice(0, SNIP_MAX_LINES).sort(function(x, y){ return x.seq - y.seq; });
  pick.forEach(function(l){ shown[l.slot]++; });
  return (SNIP_CACHE[i] = {total:total, by:by, shown:shown, lines:pick, more:total > pick.length});
}
function snipText(l){
  var out = '', cur = l.a;
  l.ms.forEach(function(m){
    if(m.s < l.a || m.e > l.b) return;
    out += esc(l.p.slice(cur, m.s)) + '<mark class="ft-hit">' + esc(l.p.slice(m.s, m.e)) + '</mark>';
    cur = m.e;
  });
  out += esc(l.p.slice(cur, l.b));
  return (l.a > 0 ? '…' : '') + out + (l.b < l.p.length ? '…' : '');
}
/* 摘要列橫跨的欄數：覆審與備註欄隱藏時，第 REV_FROM 欄起以 CSS 隱藏（見 .db-rev-hidden）。
   colspan 若大於實際欄數，固定版型下多出的欄會分走寬度，故須隨顯示狀態調整（見 setRev）。 */
var REV_FROM = (function(){
  for(var k = 0; k < CASE_COLUMNS.length; k++) if(CASE_COLUMNS[k].col === 'db-c-revno') return k;
  return CASE_COLUMNS.length;
})();
function snipSpan(revVisible){ return revVisible ? CASE_COLUMNS.length : REV_FROM; }
function snipRowHtml(i, terms, re, span, zb){
  var r = snipFor(i, terms, re);
  if(!r.total || !r.lines.length) return '';
  /* 彈窗一次只開一份決議書；原決議與覆審都有命中時，分開標示各自的處數，
     「檢視全部」也分別對應各自那一份，數字才與開啟後所見一致。 */
  var both = r.by.main > 0 && r.by.rev > 0;
  var h = '<tr class="db-snip-row'+(zb ? ' db-zb' : '')+'"><td class="db-snip-pad"></td><td class="db-snip-td" colspan="'+(span - 1)+'"><div class="db-snip">'+
    '<p class="db-snip-h">全文符合 <b>'+r.total+'</b> 處'+(both ? '（原決議 '+r.by.main+'、覆審 '+r.by.rev+'）' : '')+
    (r.more ? '，顯示其中 '+r.lines.length+' 段' : '')+'</p>';
  r.lines.forEach(function(l){
    h += '<button type="button" class="db-snip-l db-ft-open" data-ft-slot="'+l.slot+'" data-ft-i="'+i+
      '" data-ft-hit="'+l.ord+'" aria-label="開啟全文並移至此段"><span class="db-snip-sec">'+
      esc((l.slot === 'rev' ? '覆審・' : '') + (l.label || '全文'))+'</span><span class="db-snip-t">'+snipText(l)+'</span></button>';
  });
  ['main', 'rev'].forEach(function(sl){
    if(r.by[sl] > r.shown[sl]){
      h += '<button type="button" class="db-snip-more db-ft-open" data-ft-slot="'+sl+'" data-ft-i="'+i+
        '" data-ft-hit="0">開啟'+(sl === 'rev' ? '覆審' : (both ? '原決議' : ''))+'全文，檢視全部 '+r.by[sl]+' 處</button>';
    }
  });
  return h + '</div></td></tr>';
}
/* 欄位內的命中反白：只處理文字節點，不碰標籤。編號欄與「全文」標籤不是檢索範圍，跳過。 */
function snipMarkCells(box, re){
  var tds = box.querySelectorAll('tbody tr:not(.db-snip-row) td:not(.db-t-no)');
  for(var t = 0; t < tds.length; t++){
    var w = document.createTreeWalker(tds[t], NodeFilter.SHOW_TEXT, null, false), nodes = [], n;
    while((n = w.nextNode())){
      if(!n.nodeValue) continue;
      var pe = n.parentNode;
      if(pe && pe.closest && pe.closest('.db-full-tag')) continue;
      re.lastIndex = 0;
      if(re.test(n.nodeValue)) nodes.push(n);
    }
    for(var k = 0; k < nodes.length; k++){
      var node = nodes[k], s = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      re.lastIndex = 0;
      while((m = re.exec(s))){
        if(!m[0]){ re.lastIndex++; continue; }
        if(m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var mk = document.createElement('mark');
        mk.className = 'ft-hit';
        mk.textContent = m[0];
        frag.appendChild(mk);
        last = m.index + m[0].length;
      }
      if(last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }
}
/* ---------- 表格橫向捲動：依實際量測決定 ------------------------------------
   [CSS-RESPONSIVE] 以「視窗寬度」預判整表放不放得下，但真正決定的是容器寬度；嵌在宿主頁面
   （jrf.org.tw 的文章欄）時兩者差距不定。預判失準而容器放不下時，因為預設是 overflow:clip，
   多出的部分被裁掉、不出捲軸，最右欄最右邊的字就被吃掉。
   故改為實際量：容器的 scrollWidth 大於 clientWidth（含 clip 狀態，scrollWidth 仍是真實
   內容寬度）就加 .db-scroll-x 恢復框內左右捲動，放得下就維持原樣（表頭可黏在頁面頂端）。
   量測前先移除 class 回到未處理狀態，結果才不受上一次影響；隱藏的頁籤量不到（0）就略過，
   由 ResizeObserver 在頁籤顯示、容器變寬變窄時重量。 */
var TS_RO = null;
function fitTableScroll(){
  var boxes = document.querySelectorAll('.db-table-scroll');
  for(var i = 0; i < boxes.length; i++){
    var b = boxes[i];
    b.classList.remove('db-scroll-x');
    if(!b.clientWidth) continue;
    if(b.scrollWidth - b.clientWidth > 0.5) b.classList.add('db-scroll-x');
  }
  if(!TS_RO && typeof ResizeObserver !== 'undefined'){
    TS_RO = new ResizeObserver(function(){ fitTableScroll(); });
    ['list-table', 'pat-table'].forEach(function(id){ var n = el(id); if(n) TS_RO.observe(n); });
  }
}
onDbResize(fitTableScroll);

/* curPatId（選用）：目前檢視之態樣 ID，只有「違失態樣」頁傳入。
   snip（選用）：{terms:[…]}，只有「案件清單」在有檢索字詞時傳入；有值才輸出檢索摘要列並
   反白欄位內的命中字（見上方「檢索摘要列」）。不傳則與過去完全相同。 */
var CASE_LIST_RENDERER = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.caseListRenderer;
var CASE_LIST_RENDER = CASE_LIST_RENDERER && CASE_LIST_RENDERER.create ? CASE_LIST_RENDERER.create({
  columns: CASE_COLUMNS,
  pageSize: PAGE_SIZE,
  pager: window.DisciplineApp.modules.caseListPager,
  groupIcons: GRP_ICON,
  deps: function(){ return {
    data: DATA,
    setPattern: function(id){ CUR_PAT_ID = id || ''; },
    snipRegex: snipRegex,
    snipSpan: snipSpan,
    snipRowHtml: snipRowHtml,
    snipMarkCells: snipMarkCells,
    fitTableScroll: fitTableScroll
  }; }
}) : null;
function renderTable(idxList, tableBox, pagerBoxes, page, onPage, sortCfg, groupCfg, revVisible, curPatId, snip){
  if(CASE_LIST_RENDER) return CASE_LIST_RENDER({idxList:idxList, tableBox:tableBox, pagerBoxes:pagerBoxes, page:page,
    onPage:onPage, sortCfg:sortCfg, groupCfg:groupCfg, revVisible:revVisible, curPatId:curPatId, snip:snip});
  return renderTableLegacy(idxList, tableBox, pagerBoxes, page, onPage, sortCfg, groupCfg, revVisible, curPatId, snip);
}
function renderTableLegacy(idxList, tableBox, pagerBoxes, page, onPage, sortCfg, groupCfg, revVisible, curPatId, snip){
  var CASE_LIST_PAGER = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.caseListPager;
  if(!Array.isArray(pagerBoxes)) pagerBoxes = [pagerBoxes];
  var total = idxList.length;
  var pages = Math.max(1, Math.ceil(total/PAGE_SIZE));

  /* 動態表格採固定容器事件委派：重繪 innerHTML 時不再逐顆重掛 listener。 */
  tableBox._dbTableSort = sortCfg || null;
  tableBox._dbTableGroup = groupCfg || null;
  /* 必須在下面產生資料格之前設定：cell() 讀的就是這個值 */
  CUR_PAT_ID = curPatId || '';
  if(!tableBox._dbEventsBound){
    tableBox.addEventListener('click', function(e){
      var g = e.target.closest ? e.target.closest('button[data-grp]') : null;
      if(g && tableBox.contains(g)){
        var gc = tableBox._dbTableGroup;
        if(gc && gc.onGroup){ e.preventDefault(); e.stopPropagation(); gc.onGroup(g.getAttribute('data-grp')); }
        return;
      }
      var th = e.target.closest ? e.target.closest('th.db-th-sort') : null;
      var sc = tableBox._dbTableSort;
      if(th && tableBox.contains(th) && sc && sc.onSort) sc.onSort(th.getAttribute('data-sk'));
    });
    tableBox.addEventListener('keydown', function(e){
      if(e.key!=='Enter' && e.key!==' ') return;
      var th = e.target.closest ? e.target.closest('th.db-th-sort') : null;
      var sc = tableBox._dbTableSort;
      if(th && tableBox.contains(th) && sc && sc.onSort){ e.preventDefault(); sc.onSort(th.getAttribute('data-sk')); }
    });
    tableBox._dbEventsBound = true;
  }
  pagerBoxes.forEach(function(bx, bi){
    bx._dbPagerState = {pages:pages, page:page, onPage:onPage, bi:bi};
    if(bx._dbEventsBound) return;
    bx.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('button[data-p]') : null;
      var ctx = bx._dbPagerState;
      if(!b || !ctx || !bx.contains(b)) return;
      var p = parseInt(b.getAttribute('data-p'),10);
      if(p>=1 && p<=ctx.pages && p!==ctx.page) ctx.onPage(p, ctx.bi);
    });
    bx._dbEventsBound = true;
  });
  if(page>pages) page = pages;
  var start = (page-1)*PAGE_SIZE;
  var slice = idxList.slice(start, start+PAGE_SIZE);
  /* 佔位分頁：頁數不足一頁時保留同高空間，避免表格位置跳動 */
  var ghost = CASE_LIST_PAGER ? CASE_LIST_PAGER.ghost() : '<nav class="db-pager" style="visibility:hidden" aria-hidden="true"><button type="button" disabled>▲</button></nav>';
  if(!total){
    tableBox.innerHTML = '<div class="db-table-scroll"><div class="db-no-result">查無符合條件之案件。</div></div>';
    tableBox.classList.toggle('db-rev-hidden', !revVisible);
    pagerBoxes.forEach(function(bx){ bx.innerHTML = ghost; });
    return;
  }
  function thCell(label, key, tip){
    if(!sortCfg || !key) return '<th>'+label+'</th>';
    var on = sortCfg.key===key;
    var arr = on ? (sortCfg.asc?'▲':'▼') : '⇅';
    return '<th class="db-th-sort" data-sk="'+key+'" role="button" tabindex="0" title="點擊依「'+(tip||label)+'」排序"'+
      ' aria-sort="'+(on?(sortCfg.asc?'ascending':'descending'):'none')+'">'+label+'<span class="db-arr">'+arr+'</span></th>';
  }
  function grpBtn(kind, label){
    if(!groupCfg) return '';
    var on = groupCfg.active === kind;
    return '<button type="button" class="db-th-grp'+(on?' db-on':'')+'" data-grp="'+kind+'"'+
      /* 說明改走 initFullTagTip() 的浮字（同「無全文」），不用原生 title */
      ' aria-pressed="'+(on?'true':'false')+'" data-ft-tip="'+label+'" aria-describedby="db-ft-tip" aria-label="'+label+'">'+
      ((on && GRP_ICON[kind+'On']) || GRP_ICON[kind])+'</button>';
  }
  var colHtml = CASE_COLUMNS.map(function(c){ return '<col class="'+c.col+'">'; }).join('');
  var headHtml = CASE_COLUMNS.map(function(c){
    /* 規範欄與態樣欄共用一格表頭，故態樣欄不生表頭、規範欄的表頭橫跨兩欄。
       ※ colspan 不影響 nth-child 序位：覆審案號的表頭仍是第 8 個 th，資料格卻已是
         第 9 個 td，覆審欄的隱藏規則因此分成兩條（見 .db-rev-hidden）。 */
    if(c.headSkip) return '';
    if(c.head > 1) return '<th colspan="'+c.head+'">'+c.label+'</th>';
    if(c.group){
      var gb = grpBtn(c.group, c.group==='case'?'檢索「一案多人」':'檢索「一人多案」');
      if(c.group==='name') return '<th class="db-th-name"><span class="db-th-lbl">'+c.label+'</span>'+gb+'</th>';
      return '<th class="db-th-1line">'+c.label+gb+'</th>';
    }
    return thCell(c.label, c.sort, c.tip);
  }).join('');
  var h = ['<div class="db-table-scroll"><table><colgroup>'+colHtml+'</colgroup><thead><tr>'+headHtml+'</tr></thead><tbody>'];
  /* 檢索摘要列：一案可能佔兩個 <tr>（主列＋摘要列）。斑馬紋因此改由 .db-zb 表示「第幾案」，
     且只在整張表確有摘要列時才掛 .db-has-snip 啟用（見 [CSS-COMMON-TABLE]）。 */
  var snipTerms = (snip && snip.terms && snip.terms.length) ? snip.terms : null;
  var snipRe = snipTerms ? snipRegex(snipTerms) : null;
  var snipSp = snipSpan(revVisible), snipAny = false;
  slice.forEach(function(i, n){
    var c = DATA.cases[i];
    var zb = !!(snipTerms && (n % 2));
    var sr = snipTerms ? snipRowHtml(i, snipTerms, snipRe, snipSp, zb) : '';
    if(sr) snipAny = true;
    var rc = snipTerms ? ((sr ? 'db-snip-main' : '') + (zb ? ' db-zb' : '')).replace(/^\s+/, '') : '';
    h.push('<tr'+(rc ? ' class="'+rc+'"' : '')+'>'+CASE_COLUMNS.map(function(col){ return col.cell(c,i); }).join('')+'</tr>'+sr);
  });
  h.push('</tbody></table></div>');
  if(snipAny) h[0] = h[0].replace('<table>', '<table class="db-has-snip">');
  tableBox.innerHTML = h.join('');
  tableBox.classList.toggle('db-rev-hidden', !revVisible);
  if(snipRe) snipMarkCells(tableBox, snipRe);
  fitTableScroll();
  if(pages<=1){ pagerBoxes.forEach(function(bx){ bx.innerHTML = ghost; }); return; }
  /* 固定槽位分頁：總頁數 ≤7 時全數列出（槽數固定為總頁數）；
     >7 時恆為 7 槽，省略號本身佔用一槽（與數字槽等寬）——
     　開頭段（第1~4頁）：1 2 3 4 5 … 末
     　中段：            1 … p-1 p p+1 … 末
     　結尾段（末4頁內）：1 … 末-4 末-3 末-2 末-1 末
     如此任何頁次下槽位數與各槽寬度皆相同，上一頁／下一頁位置固定不動 */
  if(CASE_LIST_PAGER){
    var modulePager = CASE_LIST_PAGER.html(pages, page);
    pagerBoxes.forEach(function(bx){ bx.innerHTML = modulePager; });
    return;
  }
  var slots = [];
  if(pages<=7){
    for(var p=1;p<=pages;p++) slots.push(p);
  }else if(page<=4){
    slots = [1,2,3,4,5,'gap',pages];
  }else if(page>=pages-3){
    slots = [1,'gap',pages-4,pages-3,pages-2,pages-1,pages];
  }else{
    slots = [1,'gap',page-1,page,page+1,'gap2',pages];
  }
  var ph = ['<nav class="db-pager" aria-label="頁次">'];
  ph.push('<button type="button" data-p="'+(page-1)+'"'+(page===1?' disabled':'')+'>▲</button>');
  ph.push('<span class="db-pg-nums">');
  slots.forEach(function(s){
    if(typeof s === 'string'){ ph.push('<span class="db-gap">…</span>'); return; }
    ph.push('<button type="button" data-p="'+s+'"'+(s===page?' class="db-cur" aria-current="page"':'')+'>'+s+'</button>');
  });
  ph.push('</span>');
  ph.push('<button type="button" data-p="'+(page+1)+'"'+(page===pages?' disabled':'')+'>▼</button>');
  ph.push('</nav>');
  var phtml = ph.join('');
  pagerBoxes.forEach(function(bx){ bx.innerHTML = phtml; });
}

/* ---------- 覆審／備註欄顯示切換 ---------- */
var revShown={list:false, pattern:true};
function setRev(scope,on){
  if(scope!=='pattern') scope='list';
  revShown[scope]=!!on;
  var table=el(scope==='pattern'?'pat-table':'list-table');
  if(table) table.classList.toggle('db-rev-hidden',!revShown[scope]);
  fitTableScroll();   /* 顯示／隱藏覆審與備註欄會改變整表所需寬度 */
  if(table){   /* 摘要列的 colspan 須等於目前顯示的欄數（理由見 snipSpan） */
    var sp = snipSpan(revShown[scope]), sds = table.querySelectorAll('td.db-snip-td');
    for(var q2 = 0; q2 < sds.length; q2++) sds[q2].colSpan = sp - 1;   /* 第一欄留空，故少 1 */
  }
  document.querySelectorAll('.db-rev-toggle input[data-rev-scope="'+scope+'"]').forEach(function(cb){cb.checked=revShown[scope];});
  routeReplace();
}
document.addEventListener('change',function(e){
  var t=e.target;
  if(t&&t.matches&&t.matches('.db-rev-toggle input')) setRev(t.getAttribute('data-rev-scope'),t.checked);
});

/* [JS-FX] 視覺效果：資料／renderer 之後才建立，動畫只作 enhancement。 */
/* ======================================================================
   共用視覺效果：動畫保留；由 render/init 明確呼叫，不使用 DOM MutationObserver
   ====================================================================== */
/* ---------- 視覺效果模組（明確生命週期，不監看整棵 DOM） -----------------
   動畫仍完整保留，但不再使用廣域 MutationObserver 猜測何時渲染完成；
   各 render/init 函式在完成 DOM 更新後直接呼叫對應 enhancement。 */
var FX = (function(){
  var wrap = document.querySelector('.db-wrap');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);
  var canIO = !!window.IntersectionObserver;
  var revealIO = (!reduce && canIO) ? new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(!en.isIntersecting) return;
      en.target.classList.add('db-rv-in');
      revealIO.unobserve(en.target);
    });
  }, {rootMargin:'0px 0px -8% 0px', threshold:0.04}) : null;
  var RV_SEL = [
    '.db-chart-card', '.db-stats-h', '.db-about-h', '.db-about-sh', '.db-about-meta',
    '.db-about-src', '.db-about-note', '.db-mark-scroll',
    '.db-reform-card', '.db-reform-foot', '.db-annot', '.db-pat-desc',
    '.db-bar-layout', '.db-flow-wrap', '.db-law-note-fixed'
  ].join(',');

  function scan(){
    if(!wrap || reduce || !revealIO) return;
    var nodes = wrap.querySelectorAll(RV_SEL);
    for(var i=0;i<nodes.length;i++){
      var n = nodes[i];
      if(n.getAttribute('data-rv-set')) continue;
      if(n.closest && n.closest('.db-sticky')) continue;
      /* 申訴救濟管道頁不套用捲動進場：本頁是給民眾照著做的操作指引，
         標題與表格「捲到才出現」會讓人以為內容還沒載完。整頁一律直接顯示。
         頁籤切換時的整段上滑（FX.tabRise）不受影響，仍與其他頁籤一致。 */
      if(n.closest && n.closest('#tab-complaint')) continue;
      n.setAttribute('data-rv-set','1');
      n.classList.add('db-rv');
      var r = n.getBoundingClientRect();
      if(r.top < (window.innerHeight||0) * 0.96 && r.bottom > 0) n.classList.add('db-rv-in');
      else revealIO.observe(n);
    }
  }

  var lastNum = {};
  var busyNum = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function numKey(elm){
    var host = elm.closest ? elm.closest('[id]') : null;
    return (host ? host.id : 'x') + '|' + (elm.parentElement ? elm.parentElement.className : '');
  }
  function countUp(elm, from, to){
    var t0 = 0, dur = 560;
    if(busyNum) busyNum.add(elm);
    function step(ts){
      if(!t0) t0 = ts;
      var p = Math.min(1, (ts - t0)/dur);
      var e = 1 - Math.pow(1 - p, 3);
      elm.textContent = numFmt(Math.round(from + (to - from)*e));
      if(p < 1) requestAnimationFrame(step);
      else{ elm.textContent = numFmt(to); if(busyNum) busyNum.delete(elm); }
    }
    requestAnimationFrame(step);
  }
  function numbers(){
    if(!wrap || reduce) return;
    var nodes = wrap.querySelectorAll('.db-result-count b');
    for(var i=0;i<nodes.length;i++){
      var elm = nodes[i];
      if(busyNum && busyNum.has(elm)) continue;
      var raw = (elm.textContent||'').replace(/,/g,'').trim();
      if(!/^\d{1,7}$/.test(raw)) continue;
      var to = parseInt(raw,10), k = numKey(elm), from = lastNum[k];
      lastNum[k] = to;
      if(from === undefined || from === to) continue;
      elm.classList.remove('db-num-bump');
      void elm.offsetWidth;
      elm.classList.add('db-num-bump');
      countUp(elm, from, to);
    }
  }
  function refresh(){ scan(); numbers(); }

  function yearBars(){
    if(!wrap) return;
    var t = wrap.querySelector('#tab-stats .db-stats-table');
    if(!t || t.getAttribute('data-yb-set')) return;
    var rows = t.querySelectorAll('tbody tr'), cells = [], vals = [];
    for(var i=0;i<rows.length;i++){
      if(rows[i].classList.contains('db-sum')) continue;
      var td = rows[i].querySelector('td');
      if(!td) continue;
      var v = parseInt((td.textContent||'').replace(/,/g,'').trim(),10);
      if(!isFinite(v) || v<=0) continue;
      cells.push(td); vals.push(v);
    }
    if(!cells.length) return;
    t.setAttribute('data-yb-set','1');
    var max = Math.max.apply(null, vals);
    for(var j=0;j<cells.length;j++){
      cells[j].classList.add('db-yr-bar');
      var b = document.createElement('i');
      b.className = 'db-yb';
      b.style.setProperty('--f',(vals[j]/max).toFixed(4));
      if(!reduce) b.style.transitionDelay = (j*40)+'ms';
      cells[j].insertBefore(b,cells[j].firstChild);
    }
    if(reduce || !canIO){ t.classList.add('db-yb-on'); return; }
    var io = new IntersectionObserver(function(en){
      if(en[0].isIntersecting){ t.classList.add('db-yb-on'); io.disconnect(); }
    }, {threshold:0.02});
    io.observe(t);
  }

  function linePoints(){
    if(!wrap || reduce) return;
    var svgs = wrap.querySelectorAll('#tab-stats .db-chart-svg');
    for(var s=0;s<svgs.length;s++){
      var svg = svgs[s];
      if(svg.getAttribute('data-pt-set')) continue;
      var pts = svg.querySelectorAll('.db-pt:not(.db-slice)');
      if(!pts.length) continue;
      svg.setAttribute('data-pt-set','1');
      for(var i=0;i<pts.length;i++){
        var d = (0.35 + i*0.032).toFixed(3)+'s';
        pts[i].style.animationDelay = d;
        var lb = pts[i].querySelector('text');
        if(lb) lb.style.animationDelay = d;
      }
    }
  }

  function pieSwap(){
    if(reduce) return;
    var box = document.getElementById('chart-kind');
    if(!box) return;
    var target = box.classList.contains('db-chart-svg') ? box : (box.querySelector('.db-chart-svg') || box);
    target.classList.remove('db-pie-swap');
    void target.getBoundingClientRect();
    target.classList.add('db-pie-swap');
    setTimeout(function(){ target.classList.remove('db-pie-swap'); },700);
  }

  function mapIn(){
    if(!wrap || reduce) return;
    var svg = document.getElementById('tw-map');
    if(!svg || !svg.getAttribute || svg.getAttribute('data-reg-set')) return;
    var regs = svg.querySelectorAll('.db-region');
    if(!regs.length) return;
    svg.setAttribute('data-reg-set','1');
    for(var i=0;i<regs.length;i++) regs[i].style.animationDelay = (i*0.024).toFixed(3)+'s';
    if(canIO){
      var io = new IntersectionObserver(function(en){
        if(en[0].isIntersecting){ svg.classList.add('db-map-in'); io.disconnect(); }
      }, {threshold:0.06});
      io.observe(svg);
    }else svg.classList.add('db-map-in');
  }

  /* 切換頁籤時，既有內容直接落在最終垂直位置；真正的頁籤轉場只改 panel opacity。
     後續重新 render 的新節點不帶 settled class，仍保留換頁／篩選等原始動畫。 */
  var TAB_ENTRY_SEL = [
    'tbody tr', '.db-no-result', '.db-pattern-item', '.db-lawsel button'
  ].join(',');
  function settleTab(panel){
    if(reduce || !panel) return;
    var auto = panel.querySelectorAll(TAB_ENTRY_SEL);
    for(var i=0;i<auto.length;i++) auto[i].classList.add('db-entry-settled');

    /* scroll-reveal 只把目前已進入視窗的節點直接定格；畫面下方尚未看見者
       仍交給 IntersectionObserver，日後實際捲到時才播放原本的上滑 reveal。 */
    var rv = panel.querySelectorAll(RV_SEL);
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    for(var j=0;j<rv.length;j++){
      var n = rv[j], r = n.getBoundingClientRect();
      /* 申訴救濟管道頁一律直接顯示，不進捲動進場（同 scan() 之說明）。 */
      if(n.closest && n.closest('#tab-complaint')) continue;
      var visible = r.bottom > 0 && r.top < vh * 0.96;
      if(!n.getAttribute('data-rv-set')){
        n.setAttribute('data-rv-set','1');
        n.classList.add('db-rv');
      }
      if(visible){
        n.classList.add('db-rv-snap','db-rv-in');
        if(revealIO) revealIO.unobserve(n);
        (function(node){ requestAnimationFrame(function(){ node.classList.remove('db-rv-snap'); }); })(n);
      }else if(revealIO && !n.classList.contains('db-rv-in')){
        revealIO.observe(n);
      }
    }
  }

  var tabEnterPanel = null, tabEnterTimer = 0;
  function clearTabRise(panel){
    if(!panel) return;
    panel.classList.remove('db-tab-enter-from','db-tab-enter-run');
  }
  function tabRise(panel){
    if(!panel) return;
    /* 動畫永遠是附加效果：任何環境差異／樣式例外都不得阻斷頁籤切換。 */
    try{
      if(tabEnterTimer){ clearTimeout(tabEnterTimer); tabEnterTimer = 0; }
      if(tabEnterPanel && tabEnterPanel !== panel) clearTabRise(tabEnterPanel);
      clearTabRise(panel);
      tabEnterPanel = panel;
      if(reduce){ tabEnterPanel = null; return; }

      /* 先把新 panel 固定在 14px 下方的起始狀態，強制完成一次 style/layout 後，
         再切到正常終態。動畫結束移除 run class 時，base CSS 仍是完全相同的
         opacity:1 / translate3d(0,0,0)，所以沒有 transform → none 的收尾切換。 */
      panel.classList.add('db-tab-enter-from');
      void panel.offsetWidth;
      panel.classList.add('db-tab-enter-run');
      panel.classList.remove('db-tab-enter-from');
      tabEnterTimer = setTimeout(function(){
        clearTabRise(panel);
        if(tabEnterPanel === panel) tabEnterPanel = null;
        tabEnterTimer = 0;
      }, 430);
    }catch(_err){
      clearTabRise(panel);
      tabEnterPanel = null;
      if(tabEnterTimer){ clearTimeout(tabEnterTimer); tabEnterTimer = 0; }
    }
  }

  /* 改革頁大字視差：listener 延後到 [JS-INIT] 明確啟動。 */
  var parallaxReady = false;
  function initParallax(){
    if(parallaxReady || reduce || !wrap) return;
    parallaxReady = true;
    var pid = 0;
    window.addEventListener('scroll', function(){
      if(pid) return;
      pid = requestAnimationFrame(function(){
        pid = 0;
        var mark = wrap.querySelector('.db-reform-hero .db-reform-mark');
        if(!mark) return;
        var hero = mark.parentElement.getBoundingClientRect();
        if(hero.bottom < -200 || hero.top > (window.innerHeight||0)+200) return;
        var mid = hero.top + hero.height/2 - (window.innerHeight||0)/2;
        mark.style.setProperty('--par',(-mid*0.08).toFixed(1)+'px');
      });
    },{passive:true});
  }

  return {scan:scan,numbers:numbers,refresh:refresh,yearBars:yearBars,linePoints:linePoints,pieSwap:pieSwap,mapIn:mapIn,settleTab:settleTab,tabRise:tabRise,initParallax:initParallax};
})();



/* [JS-TABS] 頁籤切換／鍵盤導覽 */
/* ---------- 頁籤切換 ---------- */
/* 由網址路由觸發頁籤切換時設為 true：此時位置已由路由模組掌控，
   略過本處的捲動，以免產生二次跳動 */
var SUPPRESS_TAB_SCROLL = false;
var tabs = [
  {btn: el('tabbtn-home'), panel: el('tab-home')},
  {btn: el('tabbtn-list'), panel: el('tab-list')},
  {btn: el('tabbtn-pattern'), panel: el('tab-pattern')},
  {btn: el('tabbtn-laws'), panel: el('tab-laws')},
  {btn: el('tabbtn-stats'), panel: el('tab-stats')},
  {btn: el('tabbtn-about'), panel: el('tab-about')},
  {btn: el('tabbtn-reform'), panel: el('tab-reform')},
  {btn: el('tabbtn-complaint'), panel: el('tab-complaint')},
  /* 舊倫理規範歷史版本：切換鈕為隱藏元素，不出現在頁首頁籤列 */
  {btn: el('tabbtn-ethichist'), panel: el('tab-ethichist')}
].filter(function(o){ return !!(o.btn && o.panel); });
function syncTabStops(){
  tabs.forEach(function(o){
    if(!o.btn || o.btn.getAttribute('role')!=='tab') return;
    o.btn.tabIndex = (o.btn.getAttribute('aria-selected')==='true') ? 0 : -1;
  });
}
syncTabStops();
var tabNav = el('db-nav');
if(tabNav) tabNav.addEventListener('keydown', function(e){
  if(['ArrowLeft','ArrowRight','Home','End'].indexOf(e.key)<0) return;
  var btn = e.target.closest ? e.target.closest('.db-tab-btn[role="tab"]') : null;
  if(!btn) return;
  var bs = tabs.map(function(o){ return o.btn; }).filter(function(b){ return b && b.getAttribute('role')==='tab' && !b.hidden; });
  var i = bs.indexOf(btn), n = i;
  if(i<0) return;
  if(e.key==='Home') n=0;
  else if(e.key==='End') n=bs.length-1;
  else n=(i+(e.key==='ArrowRight'?1:-1)+bs.length)%bs.length;
  e.preventDefault();
  bs[n].click();
  focusNoScroll(bs[n]);
});
tabs.forEach(function(t){
  t.btn.addEventListener('click', function(){
    var from = tabs.findIndex(function(o){ return o.btn && o.btn.getAttribute('aria-selected')==='true'; });
    var to = tabs.indexOf(t);
    tabs.forEach(function(o){
      var cur = o===t;
      o.btn.setAttribute('aria-selected', cur?'true':'false');
      o.panel.hidden = !cur;
    });
    syncTabStops();
    /* 使用者自行切換頁籤 → 恢復進場動畫（跳轉時暫停，見 .db-no-entry） */
    tabs.forEach(function(o){ if(o.panel) o.panel.classList.remove('db-no-entry'); });
    if(t.btn === el('tabbtn-home') && !homeReady) safeRun('首頁', initHome);
    if(t.btn === el('tabbtn-pattern')) safeRun('違失態樣', function(){ pst.expanded = true; renderPatternList(); });
    if(t.btn === el('tabbtn-laws') && !lawState.ready) safeRun('懲戒法規', initLaws);
    if(t.btn === el('tabbtn-stats')){
      safeFeature('統計與分析', initAnalysis);
      safeRun('統計圖表', anaOnTabShown);
    }
    if(t.btn === el('tabbtn-complaint')){
      if(!complaintReady) safeFeature('申訴流程與地圖', initComplaint);
      safeFeature('申訴頁導覽列', initComplaintToc);
    }
    if(t.btn === el('tabbtn-ethichist') && !ehReady) safeRun('倫理規範歷史版本', initEthicHist);
    /* 各頁首次 init 完成後，先把既有子內容的垂直進場定格，再只讓整個 panel
       走一次 CSS 上滑淡入；動畫失敗也不影響已完成的頁籤狀態切換。 */
    if(from !== to){
      FX.settleTab(t.panel);
      FX.tabRise(t.panel);
    }
    if(!SUPPRESS_TAB_SCROLL) scrollToInstant(0, 0);
    /* 換頁籤＝一次導覽，寫入一筆歷史（applyRoute 期間由 ROUTE_APPLYING 擋住）。 */
    routePush();
  });
});

/* [JS-LIST] 案件清單 */
/* ---------- 頁籤一：列表 ---------- */
/* other：其它規範篩選（LAW_OTHERS 之 k），與法條下拉互斥、可與關鍵字並用 */
/* grp：'' 一般／'case' 一案多人／'name' 一人多案（僅「案件清單」頁籤可用） */
/* kind：'disc' 懲戒處分（暫時處分以外的全部案件）／'prov' 暫時處分。兩個分頁是
   互斥的兩份清單，件數、排序、檢索與頁次都各自獨立。 */
var CASE_LIST_STATE = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.caseList;
var st = CASE_LIST_STATE && CASE_LIST_STATE.createState
  ? CASE_LIST_STATE.createState()
  : {src:'', artIdx:-1, sort:'no', asc:false, page:1, q:'', other:'', grp:'', kind:'disc'};

/* 分頁切換。暫時處分不設法條篩選器——該分頁全部案件都只引新律師法第7條第1項，
   篩了沒有分辨力，篩選器又會隨分頁隱藏，留著就成了看不見卻生效的條件，故一併
   清掉。關鍵字與一案多人／一人多案是跨分頁都成立的條件，維持不動。 */
function setKind(kind){
  st.kind = (kind === 'prov') ? 'prov' : 'disc';
  if(st.kind === 'prov'){
    ALL_SRC.forEach(function(s){ var sel = el('flt-' + s.key); if(sel) sel.value = ''; });
    st.src = ''; st.artIdx = -1; st.other = '';
  }
  st.page = 1;
}
/* 分頁列與篩選器／說明區的顯示狀態。由 renderList() 呼叫，故不論是點分頁鈕、
   上一頁／下一頁還是直接開網址，畫面與 st.kind 都一致。 */
function syncKindUI(){
  var prov = (st.kind === 'prov');
  var f = el('list-filters'), n = el('list-provnote'), bar = el('list-subtabs');
  if(f) f.hidden = prov;
  if(n) n.hidden = !prov;
  if(bar){
    bar.querySelectorAll('.db-subtab[data-kind]').forEach(function(b){
      b.setAttribute('aria-pressed', b.getAttribute('data-kind') === st.kind ? 'true' : 'false');
    });
  }
}
/* 分頁鈕的件數：一律由 DATA.cases 推導，不寫死（見檔首「不要重蹈的覆轍」）。 */
(function initKindCounts(){
  var a = el('kind-n-disc'), b = el('kind-n-prov');
  if(a) a.textContent = (DATA.cases.length - PROV_N) + ' 件';
  if(b) b.textContent = PROV_N + ' 件';
})();
(function(){
  var bar = el('list-subtabs');
  if(!bar) return;
  bar.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('.db-subtab[data-kind]') : null;
    if(!b || !bar.contains(b)) return;
    var k = b.getAttribute('data-kind');
    if(k === st.kind) return;
    setKind(k);
    renderList();
    routePush();
    if(FT_HILITE) FT_HILITE();
  });
})();

/* 條文字串 → 態樣名稱（建索引用）。同一條文字串在案件間大量重複，
   故以「法典鍵＋條文字串」為鍵快取，避免對每筆案件重跑一次 compat 比對。
   態樣本身仍只有 mapRows 一份，此處只是查詢結果的快取。 */
var PAT_NAME_CACHE = {};
function patNamesOfText(key, text){
  var ck = key + '\u0001' + text;
  var hit = PAT_NAME_CACHE[ck];
  if(hit) return hit;
  var out = patIdsOfText(key, text).map(function(pid){
    var p = PATTERN_BY_ID[pid];
    return p ? p.name : '';
  }).filter(Boolean);
  PAT_NAME_CACHE[ck] = out;
  return out;
}
/* 關鍵字檢索索引：串接「編號」以外之所有欄位（含違反規範、違失態樣、覆審、備註） */
var SEARCH_TEXT = DATA.cases.map(function(c, i){
  /* 全文欄以「畫面實際顯示的字樣」入索引（全文／詳覆審／無全文），
     而非原始欄位值——否則檢索結果會和眼睛看到的不一致。 */
  var parts = [c.caseNo, c.name, c.date, c.unit, c.decision, c.revNo, c.revDate, c.revText, c.note,
               rocDate(c.date), rocDate(c.revDate),
               fullWord(c.full, c.revFull, i, 'main'),
               c.revNo ? fullWord(c.revFull, '', i, 'rev') : ''];
  (c.norm||[]).forEach(function(n){ parts.push(n[0]); });
  /* 態樣欄顯示的是態樣名稱，名稱不入索引就檢索不到（理由同上方全文欄：
     索引須與眼睛看到的一致）。
     推導與 normLinks 完全同源——只取本欄 norm、同一套 provisions／compat，
     故索引到的態樣與畫面上看到的相同；備註欄提及之條文與 patternInclude
     的人工補正不納入（那是「違失態樣」頁較寬的歸屬，兩者刻意不同）。 */
  var seenPat = {};
  (c.norm||[]).forEach(function(n){
    var K = clsToKey[n[1]];
    if(!K) return;
    patNamesOfText(K, n[0]).forEach(function(nm){
      if(seenPat[nm]) return;
      seenPat[nm] = 1;
      parts.push(nm);
    });
  });
  return searchNormalizeText(parts.filter(Boolean).join('\n'));
});
/* 全文檢索索引：把 FT 內的決議書全部去標籤後轉為小寫純文字，
   結構與 FT 相同（main／rev 兩張以案號為鍵的表）。
   建立一次約需 0.2 秒、佔約 4 MB，故延後到「欄位比對不到關鍵字」時才建立——
   只查案號、姓名等欄位就找得到的檢索，完全不會付出這筆成本。 */
var FT_PLAIN = null;
function ftPlain(){
  if(FT_PLAIN) return FT_PLAIN;
  FT_PLAIN = {main:{}, rev:{}};
  if(FT){
    ['main', 'rev'].forEach(function(slot){
      var M = FT[slot];
      for(var k in M) if(Object.prototype.hasOwnProperty.call(M, k)){
        /* 與彈窗共用 ftBuild（署名區、案號、來源皆已還原）再去標籤，故檢索所得與過去一致 */
        FT_PLAIN[slot][k] = searchNormalizeHtml(ftBuild(M[k], k) || '');
      }
    });
  }
  return FT_PLAIN;
}
function ftTextOf(i){
  if(!FT) return '';
  var P = ftPlain(), c = DATA.cases[i], out = '';
  if(!c) return '';
  var a = c.caseNo ? P.main[c.caseNo] : null;
  var b = c.revNo  ? P.rev[c.revNo]   : null;
  if(a) out += a;
  if(b && b !== a) out += '\n' + b;
  return out;
}
/* ---------- 檢索語法 ---------------------------------------------------
   半形 & 與空格＝且、+＝或、-＝不含、( )＝組合；
   運算子無優先順序，由左至右依序比對（故 a+b&c 與 (a+b)&c 同義）。
   只有半形符號具運算意義，全形＆＋－（）維持為一般文字——案件欄位中的
   「（覆審：…）」等全形括號因此不會被誤讀成組合。
   另有一例外：兩個數字之間的半形連字號（2020-05-12、第41-1條）視為文字
   本身，不作「不含」，否則日期與含「-」之條號將無法直接檢索。 */
function qTokenize(s){
  var out = [], buf = '';
  function flush(){ if(buf){ out.push({t:'w', v:buf}); buf = ''; } }
  for(var i = 0; i < s.length; i++){
    var ch = s.charAt(i);
    if(ch === '&' || ch === '+'){ flush(); out.push({t:'op', v:ch}); }
    else if(ch === '-'){
      var pc = s.charAt(i-1), nc = s.charAt(i+1);
      if(i > 0 && pc >= '0' && pc <= '9' && nc >= '0' && nc <= '9') buf += ch;
      else { flush(); out.push({t:'op', v:'-'}); }
    }
    else if(ch === '('){ flush(); out.push({t:'('}); }
    else if(ch === ')'){ flush(); out.push({t:')'}); }
    else if(/\s/.test(ch)){ flush(); out.push({t:'sp'}); }
    else buf += ch;
  }
  flush();
  /* 空白只有在「左右兩側皆為可運算項」時才轉成隱含的「且」，
     否則「法院 & 管轄」會被讀成三個運算子。 */
  var r = [];
  for(var k = 0; k < out.length; k++){
    if(out[k].t !== 'sp'){ r.push(out[k]); continue; }
    var a = r[r.length-1], b = null;
    for(var m = k+1; m < out.length; m++) if(out[m].t !== 'sp'){ b = out[m]; break; }
    if(a && b && (a.t === 'w' || a.t === ')') && (b.t === 'w' || b.t === '(')) r.push({t:'op', v:'&'});
  }
  return r;
}
/* 語法樹節點：{t:'w',v} 字詞／{t:'all'} 全部案件／{t:'&'|'+'|'-',l,r}。
   括號未成對、運算子懸空等不完整輸入一律容忍，盡量解出可用的條件，
   使邊打邊按 Enter 的過程不會整段失效。 */
function qParse(toks){
  var p = 0;
  function primary(){
    var tk = toks[p];
    if(!tk || tk.t === 'op' || tk.t === ')') return null;
    if(tk.t === '('){
      p++;
      var e = expr();
      if(toks[p] && toks[p].t === ')') p++;        /* 容許缺右括號 */
      return e;
    }
    p++;
    return {t:'w', v:tk.v};
  }
  function expr(){
    var node = null;
    while(p < toks.length){
      var tk = toks[p];
      if(tk.t === ')') break;
      if(tk.t === 'op'){
        var op = tk.v; p++;
        var rhs = primary();
        if(!rhs) continue;                          /* 運算子後無字詞：略過 */
        /* 開頭即為運算子：「-詞」＝全部案件排除之，「&詞」「+詞」等同單一字詞 */
        if(node === null) node = (op === '-') ? {t:'-', l:{t:'all'}, r:rhs} : rhs;
        else node = {t:op, l:node, r:rhs};
        continue;
      }
      var nd = primary();
      if(!nd){ p++; continue; }
      node = (node === null) ? nd : {t:'&', l:node, r:nd};
    }
    return node;
  }
  var root = expr();
  while(p < toks.length){                            /* 多餘的右括號：跳過後續解 */
    if(toks[p].t === ')'){ p++; continue; }
    var more = expr();
    if(!more){ p++; continue; }
    root = root ? {t:'&', l:root, r:more} : more;
  }
  return root;
}
/* 解析結果快取：同一段查詢字串於一次渲染中會被反覆取用 */
var CASE_LIST_SEARCH = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.caseListSearch;
var Q_CACHE = {s:null, ast:null};
function queryAst(q){
  if(CASE_LIST_SEARCH && CASE_LIST_SEARCH.ast) return CASE_LIST_SEARCH.ast(q);
  var s = searchNormalizeText(q);
  if(Q_CACHE.s === s) return Q_CACHE.ast;
  Q_CACHE.s = s;
  Q_CACHE.ast = s ? qParse(qTokenize(s)) : null;
  return Q_CACHE.ast;
}
/* 反白用字詞：只取正向條件，「不含」右側者不取（未命中之字詞不該被標示） */
function queryTerms(node, out){
  if(CASE_LIST_SEARCH && CASE_LIST_SEARCH.terms) return CASE_LIST_SEARCH.terms(node, out);
  out = out || [];
  if(!node) return out;
  if(node.t === 'w'){ if(out.indexOf(node.v) < 0) out.push(node.v); return out; }
  if(node.t === '-') return queryTerms(node.l, out);
  if(node.l) queryTerms(node.l, out);
  if(node.r) queryTerms(node.r, out);
  return out;
}
/* 單一字詞之比對：先查欄位索引，欄位中沒有時才展開全文索引，
   使延後建立的成本只在必要時付出 */
function hasTerm(i, t){
  if(SEARCH_TEXT[i].indexOf(t) >= 0) return true;
  var ft = ftTextOf(i);
  return !!ft && ft.indexOf(t) >= 0;
}
/* 以語法樹比對第 i 件案件；短路求值使不必要的全文比對不會發生 */
function matchQuery(i, ast){
  if(!ast) return true;
  switch(ast.t){
    case 'all': return true;
    case 'w':   return hasTerm(i, ast.v);
    case '&':   return matchQuery(i, ast.l) && matchQuery(i, ast.r);
    case '+':   return matchQuery(i, ast.l) || matchQuery(i, ast.r);
    case '-':   return matchQuery(i, ast.l) && !matchQuery(i, ast.r);
  }
  return true;
}

/* 由全文彈窗於載入時掛上；檢索條件變動時用來重畫或清除關鍵字反白 */
var FT_HILITE = null;
/* 案號 → 決議書全文位置。由全文彈窗模組於初始化時填入（見 FT_XREF_CASE 之定義），
   供「違失態樣」說明中的案例案號改寫為可點擊的按鈕。 */
var FT_XREF_CASE = null;

/* 法律扶助法：篩選列上不放下拉，但仍建立一個隱藏的 select，
   使其條號篩選能沿用既有的 readFilters／gotoFilter 流程。 */
(DATA.extraSources || []).forEach(function(s){
  if(el('flt-'+s.key)) return;
  var host = el('flt-J') ? el('flt-J').parentNode : document.body;
  var sel = document.createElement('select');
  sel.id = 'flt-'+s.key; sel.hidden = true; sel.setAttribute('aria-hidden','true');
  host.appendChild(sel);
});

/* 四部主要法規在尚未篩選時，以施行時間範圍提示新舊法的分界。
   原本的「未選擇」仍留在展開的選單內；選取後會立即回到空值，故收合時仍顯示
   時間範圍，既有 readFilters、清空條件與網址還原邏輯也可繼續以空字串判斷。 */
var FILTER_EMPTY_LABEL = {
  J:'109年1月15日以前',
  K:'109年1月15日以後',
  L:'111年5月29日以前',
  M:'111年5月29日以後'
};
var FILTER_CLEAR_VALUE = '__none__';

/* 法條下拉（各法規一個），載入時即建好全部選項 */
ALL_SRC.forEach(function(s){
  var sel = el('flt-'+s.key);
  var o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = FILTER_EMPTY_LABEL[s.key] || '未選擇';
  /* hidden option 仍會作為 select 收合時的顯示值，但不會在展開清單中重複出現。 */
  if(FILTER_EMPTY_LABEL[s.key]) o0.hidden = true;
  sel.appendChild(o0);
  if(FILTER_EMPTY_LABEL[s.key]){
    var clear = document.createElement('option');
    clear.value = FILTER_CLEAR_VALUE;
    clear.textContent = '未選擇';
    sel.appendChild(clear);
  }
  DATA.articleIndex[s.key].forEach(function(a, i){
    /* 篩選器只存在於懲戒處分分頁，故件數與選項都只算該分頁的案件。
       一條條文若只被暫時處分案件引用（現行資料為新律師法第7條），列在這裡只會是
       個永遠 0 件的死選項，故整條略過；該條的案件由暫時處分分頁完整呈現。
       option 的 value 仍是 articleIndex 的原始位置，略過某幾條不影響網址與
       gotoFilter 的對應。 */
    var n = 0;
    for(var ci = 0; ci < a.cases.length; ci++) if(!IS_PROV[a.cases[ci]]) n++;
    if(!n) return;
    var o = document.createElement('option');
    o.value = String(i);
    o.textContent = a.art + '（' + n + ' 件）';
    sel.appendChild(o);
  });
  sel.addEventListener('change', function(){
    /* 「未選擇」是給使用者操作的清除項；實際狀態仍統一保存為空字串。 */
    if(sel.value === FILTER_CLEAR_VALUE) sel.value = '';
    if(sel.value !== ''){ /* 單選：選了其中一個，其餘清空 */
      ALL_SRC.forEach(function(o2){
        if(o2.key !== s.key) el('flt-'+o2.key).value = '';
      });
      st.other = '';                       /* 與「其它規範」篩選互斥 */
    }
    st.page = 1; renderList();
    routePush();
  });
});

function readFilters(){
  st.src=''; st.artIdx=-1;
  for(var i=0;i<ALL_SRC.length;i++){
    var k = ALL_SRC[i].key;
    var v = el('flt-'+k).value;
    if(v !== '' && DATA.articleIndex[k][+v]){
      st.src = k; st.artIdx = +v;
      return;
    }
  }
}

/* 中文字串比較器：繁體中文之預設定序即為筆畫序（CLDR zh-Hant = stroke），
   此處再明確指定 -u-co-stroke；環境不支援時退回字碼序，不致例外。 */
var ZH_COLL = (function(){
  try{ return new Intl.Collator('zh-Hant-u-co-stroke', {numeric:true}); }catch(e){}
  try{ return new Intl.Collator('zh-Hant', {numeric:true}); }catch(e){}
  return null;
})();
function zhCmp(a, b){
  a = a || ''; b = b || '';
  if(ZH_COLL) return ZH_COLL.compare(a, b);
  return a < b ? -1 : (a > b ? 1 : 0);
}
/* 覆審案號排序鍵：先年度、再號次（字別作為第三順位，避免同年同號次時次序浮動）。
   現況 241 筆覆審案號皆為「N年度○○字第N號」，不合格式者以 0 計、殿後。 */
function revNoKey(sNo){
  sNo = sNo || '';
  var y = sNo.match(/(\d+)\s*年度/), n = sNo.match(/第\s*(\d+)\s*號/);
  return [y ? +y[1] : 0, n ? +n[1] : 0, sNo.replace(/[0-9]+/g, '')];
}
/* ---------- 一案多人／一人多案 ---------------------------------------------
   一案多人：同一 caseNo 出現兩筆以上（＝該次決議有兩名以上被付懲戒人）。
   一人多案：同一人有兩件以上案件。姓名採寬鬆比對——括號內的別名／原名一併取出
   當作比對鍵，例如「劉璟葳（原名劉亞杰）」拆出「劉璟葳」與「劉亞杰」，
   凡共用任一鍵者即歸為同一人，故「劉亞杰」與「劉璟葳（原名劉亞杰）」會併成一組。
   代價是同名同姓的不同人也會被併入，此為「寬鬆」二字的刻意取捨。
   兩份結果皆由 cases 即時推導後快取於此，不另存於 JSON。 */
function nameKeys(n){
  var t = String(n == null ? '' : n).trim(), out = [], m;
  var base = t.replace(/[（(][^）)]*[）)]/g, '').trim();
  if(base) out.push(base);
  var re = /[（(]([^）)]*)[）)]/g;
  while((m = re.exec(t))){
    var alt = m[1].replace(/^(原名|即|舊名|本名)/, '').trim();
    if(alt) out.push(alt);
  }
  return out;
}
var DUP_CASE = null, DUP_NAME = null, GRP_KEY = null;
function dupCase(){
  if(DUP_CASE) return DUP_CASE;
  var cnt = {};
  DATA.cases.forEach(function(c){ var k = c.caseNo || ''; cnt[k] = (cnt[k]||0) + 1; });
  DUP_CASE = DATA.cases.map(function(c){ return cnt[c.caseNo || ''] > 1; });
  return DUP_CASE;
}
function dupName(){
  if(DUP_NAME) return DUP_NAME;
  var par = DATA.cases.map(function(_, i){ return i; });
  function find(x){ while(par[x] !== x){ par[x] = par[par[x]]; x = par[x]; } return x; }
  var seen = {};
  DATA.cases.forEach(function(c, i){
    nameKeys(c.name).forEach(function(k){
      if(seen[k] == null){ seen[k] = i; return; }
      var a = find(seen[k]), b = find(i);
      if(a !== b) par[b] = a;
    });
  });
  var cnt = {}, root = [];
  DATA.cases.forEach(function(_, i){ var r = find(i); root[i] = r; cnt[r] = (cnt[r]||0) + 1; });
  DUP_NAME = DATA.cases.map(function(_, i){ return cnt[root[i]] > 1; });
  /* 排序鍵：同一組共用組內最小索引者之姓名，改名前後的案件因此仍會相鄰 */
  GRP_KEY = DATA.cases.map(function(_, i){ return DATA.cases[root[i]].name || ''; });
  return DUP_NAME;
}
function grpNameKey(i){ if(!GRP_KEY) dupName(); return GRP_KEY[i] || ''; }

/* 以筆畫序比較的純文字欄位 */
var TEXT_SORT_KEYS = {unit:1, revText:1, note:1};

function caseCmp(key, asc){
  var dir = asc?1:-1;
  return function(x,y){
    var a = DATA.cases[x], b = DATA.cases[y], va, vb, c;
    /* 空值一律殿後，不隨正／反序改變——否則反序時整頁都是空白列 */
    if(key==='date' || key==='revDate'){
      va=a[key]||''; vb=b[key]||'';
      if(!va !== !vb) return va ? -1 : 1;
      if(va<vb)return -dir; if(va>vb)return dir;
    }
    else if(key==='h'){
      va=a.h; vb=b.h;
      if(va==null && vb==null){} else if(va==null) return 1; else if(vb==null) return -1;
      else if(va!==vb) return (va-vb)*dir;
    }
    else if(key==='revNo'){
      va=a.revNo||''; vb=b.revNo||'';
      if(!va !== !vb) return va ? -1 : 1;
      if(va && vb){
        var ka=revNoKey(va), kb=revNoKey(vb);
        if(ka[0]!==kb[0]) return (ka[0]-kb[0])*dir;   /* 先年度 */
        if(ka[1]!==kb[1]) return (ka[1]-kb[1])*dir;   /* 再號次 */
        c = zhCmp(ka[2], kb[2]); if(c) return c*dir;  /* 字別 */
      }
    }
    else if(TEXT_SORT_KEYS[key]){
      va=(a[key]||'').trim(); vb=(b[key]||'').trim();
      if(!va !== !vb) return va ? -1 : 1;
      c = zhCmp(va, vb); if(c) return c*dir;
    }
    /* 兩個檢視專用的排序鍵：依案號／依人（筆畫序），使同案、同人之列相鄰。
       套用後仍可點欄位標題改以其他欄位排序，篩選本身不受影響。 */
    else if(key==='grpCase'){
      c = zhCmp(a.caseNo||'', b.caseNo||''); if(c) return c*dir;
    }
    else if(key==='grpName'){
      c = zhCmp(grpNameKey(x), grpNameKey(y)); if(c) return c*dir;
      c = zhCmp(a.name||'', b.name||''); if(c) return c*dir;
    }
    else{
      va=+a.no; vb=+b.no;
      if(va!==vb) return (va-vb)*dir;
    }
    return (+a.no - +b.no); /* 穩定次序 */
  };
}

function currentIdxList(){
  var list;
  if(st.other && OTHER_IDX[st.other]){
    list = OTHER_IDX[st.other].slice();
  }else if(st.src && st.artIdx>=0){
    list = DATA.articleIndex[st.src][st.artIdx].cases.slice();
  }else{
    list = DATA.cases.map(function(_,i){ return i; });
  }
  /* 分頁過濾排在最前面：其餘條件都是在「本分頁的案件」之內再篩 */
  var wantProv = (st.kind === 'prov');
  list = list.filter(function(i){ return IS_PROV[i] === wantProv; });
  if(st.grp === 'case'){
    var dc = dupCase();
    list = list.filter(function(i){ return dc[i]; });
  }else if(st.grp === 'name'){
    var dn = dupName();
    list = list.filter(function(i){ return dn[i]; });
  }
  if(st.q){
    var ast = queryAst(st.q);
    if(ast) list = list.filter(function(i){ return matchQuery(i, ast); });
  }
  list.sort(caseCmp(st.sort, st.asc));
  return list;
}

var tagClass = {J:'db-tag-j', K:'db-tag-k', L:'db-tag-l', M:'db-tag-m', N:'db-tag-n', O:'db-tag-o'};
function lawTag(key, text){
  return '<span class="db-tag '+tagClass[key]+'">'+esc(text)+'</span>';
}
/* 條文對話框標題上的法典標籤：六部法典在「懲戒法規」頁都有對應條文，
   故做成可點擊，按下即跳至該頁該條。其它規範（x）不套用——那邊沒有條文全文。 */
var LAW_TAB_OF = {J:'F', K:'F', L:'E', M:'E', N:'X', O:'X'};
function lawTagGoto(key, text, artNo){
  if(!LAW_TAB_OF[key]) return lawTag(key, text);
  return '<button type="button" class="db-tag '+tagClass[key]+'" data-goto-art="'+key+'|'+esc(String(artNo))+
    '" title="前往「懲戒法規」頁檢視本條">'+esc(text)+'</button>';
}
/* 可點選版：從條項文字解析條號、項次，輸出開啟對話框之按鈕 */
function lawTagBtn(key, label, entryText){
  if(!(DATA.laws && DATA.laws[key])) return lawTag(key, label);
  var am = entryText.match(/第(\d+(?:-\d+)?)條/);
  if(!am) return lawTag(key, label);
  /* 歷史條文（已刪除）自成一條，條號後綴一律是「-原」，不是「-舊」——
     須與 laws[].articles[].no 及案件 norm 完全一致（例：舊倫理規範「38-原」）。
     後綴寫錯不會報錯，只會讓該條的標籤開不了卡片、樣態歸屬靜默落空。 */
  var artNo = am[1] + (/已刪除/.test(entryText) ? '-原' : '');
  var xm = entryText.match(/第(\d+)項/);
  /* 款號支援「第1款」與「第1、2款」「第2、3、4、5款」等連寫形式 */
  var km = entryText.match(/第(\d+(?:[、,]\d+)*)款/);
  var kss = km ? km[1].split(/[、,]/).join(',') : '';
  var sm = entryText.match(/(本文|但書|前段|後段)/);
  return '<button type="button" class="db-tag '+tagClass[key]+'" data-law="'+key+
    '" data-art="'+artNo+'" data-x="'+(xm?xm[1]:'')+'" data-ks="'+kss+
    '" data-seg="'+(sm?sm[1]:'')+'">'+esc(label)+'</button>';
}
function renderAnnot(){
  var box = el('annot-box');
  if(st.other){
    var oo = otherByKey(st.other);
    box.innerHTML = '<div class="db-annot"><h3><span class="db-cap">檢視規範</span>'+
      '<span class="db-tag db-tag-x">'+esc(oo ? oo.title : '')+'</span></h3>'+
      '<ul><li class="db-law">本頁列出懲戒案件中涉及本規範之全部案件。</li></ul></div>';
    return;
  }
  if(!(st.src && st.artIdx>=0)){ box.innerHTML=''; return; }
  var art = DATA.articleIndex[st.src][st.artIdx];
  var srcLabel = srcByKey[st.src].short;
  var title = '<span class="db-cap">檢視法條</span>'+lawTagBtn(st.src, srcLabel+art.tag, art.tag);
  if(!art.related.length){
    box.innerHTML = '<div class="db-annot"><h3>'+title+'</h3>'+
      '<ul><li class="db-law">對照表中無本條之對應態樣。</li></ul></div>';
    return;
  }
  var h = ['<div class="db-annot"><h3>'+title+'</h3><ul>'];
  /* 一個態樣只出一列，且列出的是該態樣「完整」的相關規定，不是命中那一列對照表
     自己的欄位。兩件事都因對照表的粒度而起：
     ① 同一態樣可能有數列都指到本條（例：舊律師法第7條第1項、第2項各佔一列），
        逐列輸出就會看到同一個態樣名稱重複出現；
     ② 一列只記載「彼此對應」的那一組條文，該態樣其餘的相關規定散在別列，
        逐列輸出因此只看得到其中一部分（全檔 52 條有此情形）。
     條文清單一律取 patterns[].laws——與違失態樣頁「相關規定：」同一份來源、
     同一個順序（ALL_SRC 之法典序），兩處必然逐字一致，不會各列一套。
     未掛態樣之對照列無從彙整，維持逐列輸出。 */
  var grp = {}, order = [];
  art.related.forEach(function(mi){
    var pid = (DATA.mapRows[mi] || {}).patternId || '';
    var gk = pid || ('#' + mi);           /* 未分類者以列序自成一組，不互相合併 */
    if(grp[gk]){ grp[gk].rows.push(mi); return; }
    grp[gk] = {pid: pid, rows: [mi]};
    order.push(gk);
  });
  order.forEach(function(gk){
    var g = grp[gk];
    /* 對照表只保存永久 patternId；顯示名稱與相關規定皆由 PATTERN_BY_ID 取得。 */
    var pat = g.pid ? PATTERN_BY_ID[g.pid] : null;
    var cols = (pat && pat.laws) || null;
    if(!cols){
      cols = {};
      g.rows.forEach(function(mi){
        var c = (DATA.mapRows[mi] || {}).cols || {};
        ALL_SRC.forEach(function(s){
          var dst = cols[s.key] = cols[s.key] || [];
          (c[s.key] || []).forEach(function(e){ if(dst.indexOf(e) < 0) dst.push(e); });
        });
      });
    }
    var parts = [];
    ALL_SRC.forEach(function(s){
      (cols[s.key] || []).forEach(function(entry){
        parts.push(lawTagBtn(s.key, s.short+entry, entry));
      });
    });
    var pn = pat ? pat.name : '';
    var patHtml = pat
      ? '<button type="button" class="db-pat" data-pattern-id="'+esc(g.pid)+'" title="檢視「'+esc(pn)+'」之案件">'+esc(pn)+'</button>'
      : '<span class="db-pat">（未分類）</span>';
    h.push('<li>'+patHtml+
      '<span class="db-rel-tags">'+parts.join(' ')+'</span></li>');
  });
  h.push('</ul></div>');
  box.innerHTML = h.join('');
}

function renderList(){
  syncKindUI();  /* 分頁列、法條篩選器與暫時處分說明，先與 st.kind 對齊 */
  readFilters(); /* 每次渲染前直接讀取下拉目前狀態，避免事件遺漏造成不同步 */
  /* 一經使用檢索或法條／其它規範篩選，即退出一案多人／一人多案檢視。
     寫在這裡而不是各個入口，是因為所有入口最後都會走到 renderList()，
     少寫一處就會出現「圖示還亮著、清單卻已是別的條件」的不一致。 */
  if(st.grp && (st.q || st.other || (st.src && st.artIdx>=0))) setGroup('');
  var list = currentIdxList();
  /* 一案多人／一人多案在畫面上只有表頭圖示變金色，條件本身看不出來，
     故於筆數後補註；其餘檢索與篩選條件在檢索列、下拉上都看得到，不另加註。 */
  var grpNote = st.grp ? '（檢索「' + (st.grp === 'case' ? '一案多人' : '一人多案') + '」）' : '';
  var label = (st.q || st.other || st.grp || (st.src && st.artIdx>=0))
    ? '檢索結果：<span class="db-rc-n"><b>'+list.length+'</b> 筆</span>'+grpNote
    : '全部案件：<span class="db-rc-n"><b>'+list.length+'</b> 筆</span>';
  el('list-count').innerHTML = label;
  renderAnnot();
  /* 檢索摘要列用的字詞：與全文彈窗反白同一份（queryTerms：正向字詞，「不含」者不取）。
     只有「案件清單」傳入；沒有檢索字詞（或只有「不含」）時為 null，表格維持原樣。 */
  var snipOpts = null;
  if(st.q){
    var qa = queryAst(st.q), qt = qa ? queryTerms(qa) : [];
    if(qt.length) snipOpts = {terms: qt};
  }
  renderTable(list, el('list-table'), [el('list-pager-top'), el('list-pager')], st.page, function(p, srcIdx){
    st.page = p; renderList();
    routePush();
    /* 上方頁次換頁：維持原位不捲動；下方頁次換頁：錨定至上方頁次列處 */
    if(srcIdx === 1) el('list-pager-top').scrollIntoView({block:'start'});
  }, {key:st.sort, asc:st.asc, onSort:function(k){
    if(st.sort===k){ st.asc = !st.asc; }     /* 點擊已套用者：切換正反序 */
    else{ st.sort = k; st.asc = true; }      /* 點擊其他欄位：套用並預設正序 */
    st.page = 1; renderList();
    routeReplace();
  }}, {active:st.grp, onGroup:toggleGroup}, revShown.list, '', snipOpts);
  fitCountRow();
  FX.refresh();
}

/* 筆數列（「全部案件：N 筆」／「檢索結果：N 筆（檢索…）」）在中等寬度下會被
   壓成多行；超過兩行時讓它獨佔一列。作法：
   　① 先移除 .db-rc-solo 回到未分列狀態，量測結果才不會受自己影響而反覆跳動；
   　② 以 white-space:nowrap 量一次單行高度（不必猜行高，字級混用 15/19px 亦準）；
   　③ 還原後再量整體高度，超過兩倍單行高即視為三行以上。
   隱藏的頁籤中高度為 0，量不到就不動作。 */
function fitCountRow(){
  var box = el('list-count');
  if(!box || !box.parentElement) return;
  var row = box.parentElement;
  row.classList.remove('db-rc-solo');
  var prev = box.style.whiteSpace;
  box.style.whiteSpace = 'nowrap';
  var one = box.offsetHeight;
  box.style.whiteSpace = prev;
  var all = box.offsetHeight;
  if(one > 0 && all > one * 2 + 1) row.classList.add('db-rc-solo');
}
/* 視窗寬度改變會改變行數，重新判斷一次；節流至下一畫格 */
onDbResize(fitCountRow);

/* 只切狀態與排序，不負責重繪（呼叫端各自 renderList） */
function setGroup(kind){
  st.grp = kind || '';
  if(st.grp){
    st.sort = (st.grp === 'case') ? 'grpCase' : 'grpName';
    st.asc = true;
  }else if(st.sort === 'grpCase' || st.sort === 'grpName'){
    st.sort = 'no'; st.asc = false;          /* 還原預設排序 */
  }
}
/* 表頭圖示點擊：同一顆再按一次即取消。啟用時一併清空檢索與各法條下拉，
   使畫面上的條件與圖示狀態永遠一致（兩者互斥，不疊加）。 */
function toggleGroup(kind){
  var on = (st.grp !== kind);
  if(on){
    ALL_SRC.forEach(function(s2){ el('flt-'+s2.key).value = ''; });
    el('flt-q').value = ''; st.q = ''; st.other = '';
  }
  setGroup(on ? kind : '');
  st.page = 1; renderList();
  routePush();
  if(FT_HILITE) FT_HILITE();                 /* 清空檢索後同步移除彈窗內反白 */
}
function applySearch(){
  st.q = el('flt-q').value.trim();
  st.page = 1; renderList();
  if(st.q && !FT){
    el('list-count').textContent = '正在載入全文索引…';
    ensureFulltext().then(function(){ routePush(); if(FT_HILITE) FT_HILITE(); })
      .catch(function(){ el('list-count').textContent = '全文載入失敗，請重新整理後再試。'; });
    return;
  }
  routePush();
  if(FT_HILITE) FT_HILITE();          /* 重新檢索：同步彈窗內的反白 */
}
el('btn-q').addEventListener('click', applySearch);
el('flt-q').addEventListener('keydown', function(e){ if(e.key==='Enter') applySearch(); });
el('flt-q').addEventListener('search', applySearch); /* 按輸入框的 × 清除時同步 */

el('btn-clear').addEventListener('click', function(){
  ALL_SRC.forEach(function(s){ el('flt-'+s.key).value = ''; });
  el('flt-q').value = ''; st.q = ''; st.other = '';
  setGroup('');
  st.page=1; renderList();
  routePush();
  if(FT_HILITE) FT_HILITE();          /* 清空條件：一併去除彈窗內的反白 */
});

/* ---------- 檢索規則說明彈窗 ----------------------------------------------
   作法與決議書全文彈窗一致：以 JS 建立原生 <dialog>，showModal() 後內容位於
   瀏覽器 top layer，不受祖先容器 z-index／overflow／transform 影響；
   開關時固定背景捲動位置（showModal 會使捲軸消失、版面寬度改變）。 */
(function(){
  var btn = el('btn-qhelp');
  if(!btn) return;
  var dlg = document.createElement('dialog');
  dlg.id = 'qh-dlg';
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-label', '檢索規則說明');
  /* 規則列以三欄格線排版（符號｜箭頭｜意義），使各列的「→」落在同一垂直線上；
     符號欄寬度取自最寬的一列（空格），由 grid 自動對齊，不靠空白字元湊。 */
  function rule(sym, mean){
    return '<div class="db-qh-r"><span class="db-qh-s">' + sym + '</span>' +
           '<span class="db-qh-ar">\u2192</span><span class="db-qh-m">' + mean + '</span></div>';
  }
  dlg.innerHTML =
    '<div id="qh-head"><span>檢索規則</span>' +
    '<button type="button" id="qh-x" aria-label="關閉說明">\u00d7</button></div>' +
    '<div id="qh-body" tabindex="-1">' +
      '<div class="db-qh-rules">' +
        rule('<b class="db-qh-k">&amp;</b>、<b class="db-qh-k">空格</b>', '且') +
        rule('<b class="db-qh-k">+</b>', '或') +
        rule('<b class="db-qh-k">-</b>', '不含') +
        rule('<b class="db-qh-k">( )</b>', '組合') +
      '</div>' +
      '<ul class="db-qh-note">' +
        '<li>檢索字詞之查詢順序為由左至右，依序比對。檢索範圍為案件清單各欄位及決議書全文。</li>' +
        '<li>運算符號一律為半形。但兩數字間的半形連字號（如 2020-05-12、第41-1條）不視為運算符號。</li>' +
      '</ul>' +
    '</div>';
  document.body.appendChild(dlg);

  var lastFocus = null;
  function open(){
    lastFocus = document.activeElement;
    keepScroll(function(){
      if(typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');    /* 極舊瀏覽器：至少讓內容可見 */
      focusNoScroll(el('qh-body'));
    });
  }
  function close(){
    keepScroll(function(){
      if(dlg.open){ if(typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
      focusNoScroll(lastFocus);
    });
  }
  btn.addEventListener('click', open);
  /* 點關閉鈕或暗處皆關閉；Esc 由 <dialog> 原生處理 */
  dlg.addEventListener('click', function(e){
    if(e.target === dlg || (e.target.id === 'qh-x')) close();
  });
})();

/* [JS-PATTERN] 違失態樣 */
/* ---------- 頁籤二：態樣（依件數排序、可展開收起） ---------- */
var pst = {idx:-1, page:1, expanded:true, sort:'h', asc:true};
var PL_COLLAPSED_N = 9;

/* ---------- 違失態樣的七大類分組 --------------------------------------
   分類主軸是「律師對誰負這項義務」，與《律師倫理規範》自身的章節架構
   （律師與委任人／律師與司法機關／律師與相對人及第三人／律師相互間）一致；
   「綜合類」置於最前，收容名稱看不出行為內容的概括條款與資格條款。

   ※ 本結構純屬導覽用的呈現層：關聯一律以永久 patternId 維護，顯示名稱可獨立修改，
     故 patterns 依件數自動排序不受影響。新增態樣時須配置唯一 Pxxx ID 與 groups，
     漏配會由 auditData() 攔下。
   ※「矇蔽、欺誘委託人或司法機關」刻意同時列於第一類與第四類：該條文的義務
     相對人有兩個（委任人、司法機關），逐案檢視結果兩者各約半數，任擇一歸類
     都會漏掉另一半。同時列出時，兩張卡片指向同一個態樣。 */


/* 違失態樣導覽與說明資料集中於 #db-pattern-meta：
   groups 與 patterns 使用同一份資料來源，避免 App／validator 各自維護七大類。 */
var PAT_META_DATA = JSON.parse(patternNode.textContent);
if(PAT_META_DATA.schemaVersion !== PAT_META_SCHEMA_VERSION){
  throw new Error('態樣說明格式版本不相容：預期 '+PAT_META_SCHEMA_VERSION+'，實際 '+PAT_META_DATA.schemaVersion);
}
var PAT_GROUPS = PAT_META_DATA.groups || [];
var PAT_META_BY_ID = PAT_META_DATA.patterns || {};

/* ---------- 違失態樣說明中的「子類對照表」 -----------------------------
   說明區塊 { type:'subcats', rows:[…] } 之每一列＝一個法條項款層級的子類。
   每列有兩組條文欄位，用途不同，不可混用：
     ．cols  → 畫面上顯示的條文（含只能標示、無法據以檢索者，例如律師法
               第26條第1項第1款同時涵蓋數個子類，標 ※ 提示）；
     ．match → 據以推導案件的條文。未寫 match 者以 cols 遞補。
   件數一律於載入時由 cases[].norm（含備註推導之條文）推導，不寫死於 JSON——
   理由與 articleIndex、patterns[].cases 相同：另存一份必然有失步的一天。

   另有一種子類：概括條款（例如「未盡適時告知、處理案件之義務」）的條文並未
   分列款項，無從以條文層級推導，只能逐案就決議認定之事實實質認定。這類區塊
   寫成 { type:'subcats', by:'tag', rows:[…] }，歸屬改由案件的隱藏欄位
   cases[].subcat（永久子類 id 陣列）提供。該欄位不出現在案件表格的任何一欄，
   純供檢索與統計；件數同樣於載入時累計，不寫死。日後新增之案件只要補上標記
   即自動計入，未標記者由 auditData 逐件指出。
   成立／不成立以 HC_OF(h) 判定：0＝不予懲戒／不付懲戒／免議／不受理，餘為成立。 */
var SUBCAT_ROWS = {};   /* 子類 id → 該列定義（供渲染與檢索標題使用） */
var SUBCAT_IDX  = {};   /* 子類 id → {yes:[案件索引…], no:[…], all:[…]} */
var SUBCAT_SEL  = {};   /* 子類 id → 是否勾選；跨重繪保留，故存於模組層 */
/* ---------- 「僅顯示不包含其他態樣的案件」核取方塊 ----------------------
   只出現在少數概括條款態樣：其條文本身不描述特定行為，實務上幾乎總是與具體條文
   併同引用，因此需要一個過濾器把「決議只援引概括條款」的案件單獨挑出來。
   名單以永久 ID 指定（人工設定，日後改態樣名稱不影響），要增減請直接改這裡。 */
var ONLYPAT_PATS = {P001:1, P005:1, P007:1, P057:1};
var ONLYPAT_SEL  = {};  /* 態樣 id → 是否勾選；跨重繪保留，故存於模組層 */
/* 「其他態樣」只算具體態樣（＝不屬「綜合類 G1」之態樣）：同時落在其他綜合類者仍算
   「不包含其他態樣」，否則本過濾器幾乎篩不出東西（概括條款彼此常一起被引用）。
   由 patterns[].cases 推導，不另存一份；未設大類的態樣一律視為具體（保守處理，
   寧可少列，不要把已有具體歸屬的案件誤當成「只有概括條款」）。 */
var SPECIFIC_HIT = null;
function specificHitSet(){
  if(SPECIFIC_HIT) return SPECIFIC_HIT;
  var h = {};
  DATA.patterns.forEach(function(p){
    var gs = patGroupsOf(p.id);
    var generalOnly = gs.length && gs.every(function(g){ return g.id === 'G1'; });
    if(generalOnly) return;
    p.cases.forEach(function(i){ h[i] = 1; });
  });
  SPECIFIC_HIT = h;
  return h;
}
(function(){
  if(!PROV_API) return;
  var KEYS = ['J','K','L','M','N','O'];
  Object.keys(PAT_META_BY_ID).forEach(function(pid){
    var pm = PAT_META_BY_ID[pid], d = pm && pm.desc;
    var blocks = (d && !Array.isArray(d) && Array.isArray(d.blocks)) ? d.blocks : [];
    blocks.forEach(function(b, bi){
      if(!b || b.type !== 'subcats' || !Array.isArray(b.rows)) return;
      var byTag = (b.by === 'tag');
      /* 分類「軸」：一個樣態可以有數張子類表，各自描述不同的分類面向
         （例如「犯罪與律師職務之關聯」與「罪名型態」）。同一軸內勾選為聯集，
         不同軸之間為交集（見 patCaseList）——同時勾選時使用者要的是「兩個條件
         都滿足」，而不是把兩批案件加在一起。未指定 axis 者以區塊序號為軸，
         故單表樣態（例如受任有利害衝突之案件）行為完全不變。
         optional:true 表示該軸不必涵蓋全部案件（例如只列「值得注意的四種罪名
         型態」），auditData 的未歸類檢核會略過該軸。 */
      var axisKey = b.axis || (pid + '#' + bi);
      b.rows.forEach(function(r){
        if(!r || !r.id) return;
        r.patternId = pid;
        r.by = byTag ? 'tag' : 'law';
        r.axis = axisKey;
        r.axisOptional = !!b.optional;
        SUBCAT_ROWS[r.id] = r;
        /* 只在該樣態自己的案件中比對。若改為全庫掃描，會出現「子類合計大於
           樣態符合案件數」的怪象——對照表 mapRows 未列的條款（例如律師法
           第34條第1項第4款）本來就不在該樣態內，其案件應先補列對照表，
           而不是從子類這一側偷偷補進來。tag 模式同理：標記落在樣態外者不計，
           並由 auditData 指出（見下方「人工子類標記」檢核）。 */
        var pool = (PATTERN_BY_ID[pid] && PATTERN_BY_ID[pid].cases) || [];
        var yes = [], no = [];
        if(byTag){
          /* tag 模式：歸屬來自案件的隱藏欄位 cases[].subcat（永久子類 id 陣列）。
             件數仍於載入時即時累計，不寫死於 JSON——新增案件只要補上標記，
             表格件數、說明文字中的數字與勾選後的清單三者必然同步。 */
          pool.forEach(function(i){
            var c = DATA.cases[i];
            if(!Array.isArray(c.subcat) || c.subcat.indexOf(r.id) < 0) return;
            (HC_OF(c.h) === 0 ? no : yes).push(i);
          });
        }else{
          var src = (r.match && typeof r.match === 'object') ? r.match : (r.cols || {});
          var want = {};
          KEYS.forEach(function(K){
            want[K] = [];
            ((src[K]) || []).forEach(function(s){
              want[K].push.apply(want[K], PROV_API.provisions(s));
            });
          });
          pool.forEach(function(i){
            var c = DATA.cases[i];
            var g = PROV_API.caseProv[i], hit = false;
            for(var K in g){
              if(hit) break;
              var have = g[K], w = want[K] || [];
              for(var a = 0; a < have.length && !hit; a++)
                for(var t = 0; t < w.length && !hit; t++)
                  if(PROV_API.compat(have[a], w[t])) hit = true;
            }
            if(!hit) return;
            (HC_OF(c.h) === 0 ? no : yes).push(i);
          });
        }
        SUBCAT_IDX[r.id] = {yes:yes, no:no, all:yes.concat(no).sort(function(x,y){ return x-y; })};
      });
    });
  });
})();

/* 某樣態目前勾選之子類 id（依定義順序） */
function patSubcatSel(pid){
  return Object.keys(SUBCAT_ROWS).filter(function(id){
    return SUBCAT_SEL[id] && SUBCAT_ROWS[id].patternId === pid;
  });
}
/* 樣態詳情頁的案件清單：未勾選任何子類時即該樣態全部案件 */
function patCaseList(p){
  var ids = patSubcatSel(p.id);
  var list = ids.length ? subcatIntersectByAxis(ids) : p.cases.slice();
  /* 勾選「僅顯示不包含其他態樣的案件」時，濾掉同時落在任何具體態樣的案件。
     與子類勾選是 AND 關係（先取子類聯集，再濾）。 */
  if(ONLYPAT_SEL[p.id]){
    var hit = specificHitSet();
    list = list.filter(function(i){ return !hit[i]; });
  }
  return list;
}
/* 勾選之子類：先依軸分組，軸內取聯集，再把各軸的結果取交集。
   只勾一個軸時等同於單純聯集，故舊有的單表樣態行為不變。 */
function subcatIntersectByAxis(ids){
  var byAxis = {}, order = [];
  (ids || []).forEach(function(id){
    var r = SUBCAT_ROWS[id];
    if(!r) return;
    var ax = r.axis || '';
    if(!byAxis[ax]){ byAxis[ax] = []; order.push(ax); }
    byAxis[ax].push(id);
  });
  if(!order.length) return [];
  var list = subcatUnion(byAxis[order[0]]);
  for(var a = 1; a < order.length; a++){
    var keep = {};
    subcatUnion(byAxis[order[a]]).forEach(function(i){ keep[i] = 1; });
    list = list.filter(function(i){ return keep[i]; });
  }
  return list;
}
/* 勾選之子類所對應案件的聯集（可複選；同時落入數個子類者只計一次） */
function subcatUnion(ids){
  var seen = {}, out = [];
  (ids || []).forEach(function(id){
    var e = SUBCAT_IDX[id];
    if(!e) return;
    e.all.forEach(function(i){ if(!seen[i]){ seen[i] = 1; out.push(i); } });
  });
  return out.sort(function(x, y){ return x - y; });
}

/* 大類以 id 建索引；態樣只透過永久 ID 讀取分類／說明。 */
var PAT_GROUP_BY_ID = {};
PAT_GROUPS.forEach(function(g){ PAT_GROUP_BY_ID[g.id] = g; });
function patMeta(id){ return PAT_META_BY_ID[id] || null; }
function patGroupsOf(id){
  var pm = patMeta(id), gids = pm ? pm.groups : [];
  return gids.map(function(gid){ return PAT_GROUP_BY_ID[gid]; }).filter(Boolean);
}
/* [暫時：撰寫進度標示] 該態樣之說明文字是否尚未撰寫。全部寫完後可整段刪除。 */
function patDescTodo(id){
  var pm = patMeta(id);
  return !(pm && pm.desc);
}
/* 單張態樣卡片。尚無案件者加上 zero 類別，於樣式上與有案件之樣態區別。 */
function patItemHtml(i){
  var p = DATA.patterns[i];
  return '<button type="button" class="db-pattern-item'+(p.cases.length?'':' db-zero')+
    (patDescTodo(p.id)?' db-todo':'')+   /* [暫時] 說明待填寫者標紅 */
    (i===pst.idx?' db-cur':'')+'" data-i="'+i+'" data-n="'+p.cases.length+'">'+
    '<span>'+esc(p.name)+'</span><span class="db-cnt">'+p.cases.length+' 件</span></button>';
}

function renderPatternList(){
  var box = el('pattern-list');
  if(!box._dbEventsBound){
    box.addEventListener('click', function(e){
      var b = e.target.closest ? e.target.closest('.db-pattern-item') : null;
      if(!b || !box.contains(b)) return;
      pst.idx = parseInt(b.getAttribute('data-i'),10);
      pst.page = 1;
      pst.sort = 'h'; pst.asc = true;
      pst.expanded = false;
      renderPatternList();
      renderPattern();
      routePush();
      var pa = el('pattern-anchor');
      if(pa){
        var py = pa.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo(0, Math.max(0, py));
      }
    });
    box._dbEventsBound = true;
  }
  var h = [];
  if(pst.expanded){
    /* 展開：依七大類分組，各類標題下附一段分類邏輯說明；
       類內順序沿用 DATA.patterns 之排序（件數由多至少）。 */
    box.className = 'db-pattern-list db-grouped';
    PAT_GROUPS.forEach(function(g){
      var idxs = [], n = 0, td = 0;
      DATA.patterns.forEach(function(p, i){
        var pm = patMeta(p.id);
        if(pm && pm.groups.indexOf(g.id) >= 0) idxs.push(i);
      });
      idxs.sort(function(a, b){ return a - b; });
      idxs.forEach(function(i){
        n += DATA.patterns[i].cases.length;
        if(patDescTodo(DATA.patterns[i].id)) td++;   /* [暫時] 本類尚待撰寫者 */
      });
      h.push('<section class="db-pat-group">',
        '<h3 class="db-pat-group-h"><span class="db-gname">'+esc(g.code)+esc(g.name)+'</span>'+
        '<span class="db-gmeta">'+idxs.length+' 類・'+n+' 件次'+
        /* [暫時] 撰寫進度 */ (td ? '<span class="db-gtodo">　待填 '+td+'</span>' : '')+'</span></h3>',
        '<p class="db-pat-group-desc">'+esc(g.desc)+'</p>',
        '<div class="db-pat-group-items">'+idxs.map(patItemHtml).join('')+'</div>',
        '</section>');
  });
  }else{
    /* 收起：維持扁平清單，顯示件數前 PL_COLLAPSED_N 名 */
    box.className = 'db-pattern-list';
    var visible = [];
    for(var i=0;i<Math.min(PL_COLLAPSED_N, DATA.patterns.length);i++) visible.push(i);
    if(pst.idx >= PL_COLLAPSED_N) visible.push(pst.idx); /* 收起時仍顯示已選態樣 */
    h.push(visible.map(patItemHtml).join(''));
  }
  box.innerHTML = h.join('');
  /* [暫時：撰寫進度標示] 全部寫完後刪除本段與 #pat-todo-note 元素 */
  var note = el('pat-todo-note');
  if(note){
    var td = 0;
    DATA.patterns.forEach(function(p){ if(patDescTodo(p.id)) td++; });
    if(td){
      note.textContent = '以紅色標示者為說明文字尚待撰寫之態樣，'
        + '目前共 ' + td + ' 類（已完成 ' + (DATA.patterns.length - td) + ' 類）。';
      note.hidden = false;
    }else{
      note.hidden = true;
    }
  }
  var tbtn = el('pl-toggle-btn');
  tbtn.textContent = pst.expanded
    ? '收起 ▲'
    : '展開全部 ▼';
}
el('pl-toggle-btn').addEventListener('click', function(){
  pst.expanded = !pst.expanded;
  renderPatternList();
});

/* 違失態樣說明文字。
   以永久 patternId 為鍵，desc 可為下列兩種格式：
   （一）陣列 → 單純段落，例：['第一段','第二段']
   （二）物件 → { intro:[前言段落…], blocks:[結構化區塊…], cases:[案例…] }
        blocks 為選填，支援 p／bullets／table；未使用時與既有格式完全相同。
        cases 預設自動編號為「案例1、案例2…」，不需自行輸入編號；
        要改用對應違失型態的編號（可數則共用一個）時，逐則填 lb 欄位。
   每則案例為物件 { no:案號, t:案例內文 }：
     * no 為原決議案號或覆審案號，寫法須與 cases[].caseNo 或 revNo 逐字相同；併案（一份決議書
       含數個案號、以「、」相連）整串寫在同一個 no 內，畫面上即為一個案號標籤。
       確係數份不同決議者，改以陣列列舉，例 no:['甲案號','乙案號']。
     * t 為案例內文，句末不再附「（案號）。」——案號一律由 no 欄位提供。
     * lb（選填）為畫面上的案例編號（顯示為「案例{lb}」）；未填者沿用流水號。
       數則案例同屬一個違失型態而要共用一個編號時，於此指定。
     * who（選填）為本則案例所述之被付懲戒人姓名。一份決議書含數名被付懲戒人而
       懲戒決定不一致時，案號後的決定標籤無從自動判斷，須於此指名（人工判斷，
       程式不得代為挑選）；未指名者並列各決定並冠姓名，並由載入檢核逐則提醒。
   相容舊格式：案例若仍為字串，視為只有內文、無案號（載入檢核會提醒）。
   尚未撰寫者不必列於此處，畫面會自動顯示「待填寫」。 */
/* 案例之案號欄位（no）→ 案號陣列。
   no 可為字串或字串陣列；每個元素代表「一份決議書」，併案者整串留在同一元素內，
   故此處不再切分「、」，畫面上一份決議即一個案號標籤。
   舊格式（案例為純字串）沒有 no 欄位，回傳空陣列，載入檢核會於主控台指出。 */
function descCaseNos(item){
  var v = (item && typeof item === 'object') ? item.no : null;
  if(v == null) return [];
  var a = Array.isArray(v) ? v : [v];
  return a.map(function(x){
    return String(x == null ? '' : x).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  }).filter(function(x){ return x; });
}
/* 案例之內文。舊格式（純字串）即內文本身。 */
function descCaseText(item){
  if(item && typeof item === 'object') return String(item.t == null ? '' : item.t);
  return String(item == null ? '' : item);
}
/* 案例之被付懲戒人（who）：一份決議書含數名被付懲戒人，而本則案例只寫其中一人
   的事實時，於此指名，懲戒決定標籤即只取該人之決定。
   人工判斷欄位，不可推導——決議書全文並未標明「本段事實屬於哪一位」，只能由撰寫
   案例的人依內文認定；故與 subcat 同屬人工維護，程式不得代為猜測。
   未填而該案號數人之決定又不一致者，退為並列各決定並冠姓名，並由 auditData 逐則
   指出，提醒補填（不靜默挑一個顯示）。得為字串或字串陣列。 */
function descCaseWho(item){
  var v = (item && typeof item === 'object') ? item.who : null;
  if(v == null) return [];
  var a = Array.isArray(v) ? v : [v];
  return a.map(function(x){
    return String(x == null ? '' : x).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  }).filter(function(x){ return x; });
}
/* 案例之編號（lb）：畫面上顯示為「案例{lb}」。未填者沿用流水號（1、2、3…）。
   之所以做成可指定：編號有時要對應該樣態的違失型態，數則案例同屬一型態時即為
   同一個編號（例如「案例A、案例A」），與流水號的一則一號不同，無從推導。
   人工欄位，與 who、subcat 同屬撰寫者的判斷，程式不代為推算。 */
function descCaseLb(item, i){
  var v = (item && typeof item === 'object') ? item.lb : null;
  v = String(v == null ? '' : v).replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
  return v || String(i + 1);
}
/* 單一案號的標籤。查得全文者為按鈕（.db-ft-open 交由全文彈窗的委派處理器開啟），
   查無全文者為純文字，避免出現點了沒反應的按鈕。 */
function descCaseNoHtml(no){
  /* 併案之 no 含數個案號，FT_XREF_CASE 之鍵為單一案號，故以第一個查全文；
     同一份決議書之全文只有一份，取任一案號查得的結果相同。 */
  var first = String(no).split(/[、，,]/)[0];
  var hit = (typeof FT_XREF_CASE === 'function') ? FT_XREF_CASE(first) : null;
  if(hit){
    return '<button type="button" class="db-case-no db-ft-open" data-ft-slot="'+hit.slot+
           '" data-ft-i="'+hit.i+'" title="開啟本案決議書全文">'+esc(no)+'</button>';
  }
  return '<span class="db-case-no db-plain" title="本資料庫未收錄本案決議書全文">'+esc(no)+'</span>';
}

/* ---------- 案例案號後的懲戒決定標籤 ---------------------------------
   顯示文字＝該案 cases[].decision 原文（含「（覆審：…）」，沿用案件清單的
   decisionHtml，覆審部分同樣另行強調）；底色＝案件清單「懲戒決定」欄的
   同一組 db-hcN 類別，由 HC_OF(h) 推導，故兩處必然同字同色。
   一律於渲染時由 cases[] 取值，不在 #db-pattern-meta 內另存一份決定文字——
   理由與 articleIndex、patterns[].cases 相同：另存一份必然有失步的一天。

   查表以 no 的完整字串比對 cases[].caseNo，查無再比對 revNo，與載入檢核
   （auditData 之「與 cases[].caseNo／revNo 皆不一致」）採同一規則，故凡檢核
   通過者此處必然查得。併案之 no 整串即為 caseNo 原值，不必切分。
   同一案號最多 10 名被付懲戒人：決定相同者合為一個標籤，決定不同者分列並
   冠上姓名（現況僅二例，仍以通則處理，日後新增不必回頭改程式）。 */
var DESC_CASE_BY_NO = null;
function descCaseByNo(){
  if(DESC_CASE_BY_NO) return DESC_CASE_BY_NO;
  var m = {}, byMain = {};
  DATA.cases.forEach(function(c, i){
    var k = String(c.caseNo || '');
    if(!k) return;
    if(!m[k]){ m[k] = []; byMain[k] = 1; }
    m[k].push(i);
  });
  /* 覆審案號後補：極少數「甲案之覆審案號與乙案之原決議案號同字同號」時，
     仍以原決議為準（同 FT_XREF_CASE 之兩輪作法）。 */
  DATA.cases.forEach(function(c, i){
    var k = String(c.revNo || '');
    if(!k || byMain[k]) return;
    if(!m[k]) m[k] = [];
    m[k].push(i);
  });
  DESC_CASE_BY_NO = m;
  return m;
}
/* 說明區案例的懲戒決定文字：有覆審變更者只顯示覆審結果（「覆審：…」），
   不並列原決議，也不套用案件清單那組強調樣式（.db-rev-flag 的粗體與深藍）。
   理由：本區要讓讀者一眼看到該案最終受到的懲戒，標籤底色本來就依覆審後的
   最終結果編碼（見 hc／h 之編碼規則），文字若仍以原決議開頭，反與底色不符。
   案件清單維持並列（原決議＋覆審強調），那一欄看的是決議歷程，用途不同。
   decision 欄之覆審寫法固定為「原結果（覆審：新結果）」單層括號，故以第一個
   「（覆審」起算、去尾括號即得；萬一格式有變（取不到內容）則原文照登，
   不讓顯示變成空白。 */
function descDecText(dec){
  var t = String(dec == null ? '' : dec);
  var i = t.indexOf('（覆審');
  if(i < 0) return t;
  var inner = t.slice(i + 1).replace(/）[\s\u3000]*$/, '');
  return inner || t;
}
function descCaseDecHtml(no, who){
  var idxs = descCaseByNo()[String(no)] || [];
  if(!idxs.length) return '';   /* 案號對不上者不輸出標籤；auditData 已逐則指出 */
  /* 指名被付懲戒人者只取該人之決定，標籤上亦不再冠姓名（此即 who 的用途）。
     指名之人不在該案號內時不過濾，改走並列的退路，錯誤由 auditData 指出，
     不至於因打錯一個字就整個標籤消失。 */
  var pick = (who && who.length)
    ? idxs.filter(function(i){ return who.indexOf(DATA.cases[i].name) >= 0; })
    : [];
  var named = pick.length > 0;
  if(named) idxs = pick;
  var order = [], byDec = {};
  idxs.forEach(function(i){
    var c = DATA.cases[i], k = String(c.decision || '');
    if(!byDec[k]){ byDec[k] = {h:c.h, names:[]}; order.push(k); }
    byDec[k].names.push(c.name);
  });
  /* 冠姓名只在「未指名而決定不一致」時才需要——指名者畫面上只有一個決定，
     再標姓名反而像是另有他人。 */
  var many = !named && order.length > 1;
  return order.map(function(k){
    var e = byDec[k], hc = HC_OF(e.h);
    return '<span class="db-case-dec'+(hc ? ' db-hc'+hc : '')+'" title="本案懲戒決定">'+
      (many ? '<span class="db-case-dec-who">'+esc(e.names.join('、'))+'</span>' : '')+
      esc(descDecText(k))+'</span>';
  }).join('');
}

/* ---------- 說明文字中的動態數字 -------------------------------------
   件數會隨資料增修而變動，寫死在 JSON 裡必然有過期的一天（本檔已因此吃過虧）。
   故說明文字一律以下列代號書寫，渲染時才由資料推導：
     {{n}}            該樣態之案件數
     {{unit:關鍵字}}   該樣態中移送機關含該關鍵字之案件數
     {{scTotal}}      該樣態全部人工子類標記之項數（一案兼數類者重複計入）
     {{scMulti}}      該樣態中同時涉及二個以上子類之案件數
     {{sc:ID}}        該子類之案件數；ID 可用 + 相連取聯集，例 {{sc:CR01+CR02}}
     {{scPct:ID}}     同上，改以占該樣態案件數之百分比表示（一位小數，不含 %）
     {{scHc:ID,代碼}}  該子類中懲戒種類代碼為該值之案件數，例 {{scHc:CO03,1}}＝除名
     {{hc:代碼}}       該樣態中懲戒種類代碼為該值之案件數（1＝除名）
     {{hcAll:代碼}}    全資料庫中懲戒種類代碼為該值之案件數
     {{alone}}        該樣態中不併列任何其他違失態樣之案件數
     {{alonePct}}     同上，改以百分比表示（一位小數，不含 %）
   代號在 esc() 之前展開；展開結果為純數字，不含標記字元。
   百分比一律以該樣態之案件數為分母；四捨五入至小數點後一位，數列相加未必為 100。
   DESC_PID 由 patDescHtml 於渲染前後設定與清除——descBlockHtml 這條路徑
   已定型，多傳一個參數要改五處呼叫，故以單一模組層變數傳遞脈絡。 */
var DESC_PID = null;
function descNumTokens(t, pid){
  if(!pid || t.indexOf('{{') < 0) return t;
  var p = PATTERN_BY_ID[pid];
  if(!p) return t;
  function tagIds(){
    return Object.keys(SUBCAT_ROWS).filter(function(id){
      return SUBCAT_ROWS[id].patternId === pid && SUBCAT_ROWS[id].by === 'tag';
    });
  }
  function pct(x){ return (p.cases.length ? (x / p.cases.length * 100) : 0).toFixed(1); }
  /* 子類聯集：ID 以 + 相連，同時落入數個者只計一次 */
  function scList(spec){
    var seen = {}, out = [];
    String(spec).split('+').forEach(function(id){
      ((SUBCAT_IDX[id.replace(/^[\s\u3000]+|[\s\u3000]+$/g, '')] || {}).all || []).forEach(function(i){
        if(!seen[i]){ seen[i] = 1; out.push(i); }
      });
    });
    return out;
  }
  /* 不併列任何其他違失態樣者。與「僅顯示不包含其他態樣的案件」不同：
     此處是「任何其他樣態」，含概括類，因為文義講的是懲戒機關有沒有再往下
     逐一檢視倫理違失，而不是有沒有落入具體樣態。 */
  function aloneList(){
    var other = {};
    DATA.patterns.forEach(function(q){
      if(q.id === pid) return;
      q.cases.forEach(function(i){ other[i] = 1; });
    });
    return p.cases.filter(function(i){ return !other[i]; });
  }
  return t.replace(/\{\{(n|scTotal|scMulti|alone|alonePct|unit:[^{}]+|sc:[^{}]+|scPct:[^{}]+|scHc:[^{}]+|hc:[^{}]+|hcAll:[^{}]+)\}\}/g, function(m, key){
    if(key === 'n') return String(p.cases.length);
    if(key === 'alone') return String(aloneList().length);
    if(key === 'alonePct') return pct(aloneList().length);
    var cut = key.indexOf(':'), head = cut < 0 ? key : key.slice(0, cut), arg = cut < 0 ? '' : key.slice(cut + 1);
    if(head === 'unit'){
      return String(p.cases.filter(function(i){
        return String(DATA.cases[i].unit || '').indexOf(arg) >= 0;
      }).length);
    }
    if(head === 'sc')    return String(scList(arg).length);
    if(head === 'scPct') return pct(scList(arg).length);
    if(head === 'scHc'){
      var q = arg.split(','), want = String((q[1] || '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''));
      return String(scList(q[0]).filter(function(i){ return String(HC_OF(DATA.cases[i].h)) === want; }).length);
    }
    if(head === 'hc'){
      return String(p.cases.filter(function(i){ return String(HC_OF(DATA.cases[i].h)) === arg; }).length);
    }
    if(head === 'hcAll'){
      return String(DATA.cases.filter(function(c){ return String(HC_OF(c.h)) === arg; }).length);
    }
    var cnt = {}, total = 0;
    tagIds().forEach(function(id){
      ((SUBCAT_IDX[id] || {}).all || []).forEach(function(i){
        cnt[i] = (cnt[i] || 0) + 1; total++;
      });
    });
    if(key === 'scTotal') return String(total);
    return String(Object.keys(cnt).filter(function(i){ return cnt[i] > 1; }).length);
  });
}
/* 說明文字的極小型行內格式：資料仍先經 esc()，僅允許 **文字** 轉為粗體，
   避免為了統計重點而在 JSON 內直接存放任意 HTML。 */
function descInlineHtml(t){
  return esc(descNumTokens(String(t == null ? '' : t), DESC_PID))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
/* 結構化說明區塊。現支援 p／bullets／table；未知型別直接略過，避免影響整頁。 */
function descBlockHtml(b){
  if(!b || typeof b !== 'object') return '';
  if(b.type === 'p') return '<p>'+descInlineHtml(b.t)+'</p>';
  if(b.type === 'bullets'){
    var items = Array.isArray(b.items) ? b.items : [];
    return '<ul class="db-desc-list">'+items.map(function(it){
      if(typeof it === 'string') return '<li><span class="db-desc-item-text">'+descInlineHtml(it)+'</span></li>';
      it = it || {};
      return '<li>'+
        (it.title ? '<strong class="db-desc-item-title">'+descInlineHtml(it.title)+'</strong>' : '')+
        (it.t ? '<span class="db-desc-item-text">'+descInlineHtml(it.t)+'</span>' : '')+
        '</li>';
    }).join('')+'</ul>';
  }
  if(b.type === 'table'){
    var heads = Array.isArray(b.headers) ? b.headers : [];
    var rows = Array.isArray(b.rows) ? b.rows : [];
    var hh = heads.length ? '<thead><tr>'+heads.map(function(x){ return '<th>'+descInlineHtml(x)+'</th>'; }).join('')+'</tr></thead>' : '';
    var bh = rows.map(function(r){
      var total = !!(r && !Array.isArray(r) && r.total);
      var cells = Array.isArray(r) ? r : ((r && Array.isArray(r.cells)) ? r.cells : []);
      return '<tr'+(total?' class="db-desc-total"':'')+'>'+cells.map(function(x){ return '<td>'+descInlineHtml(x)+'</td>'; }).join('')+'</tr>';
    }).join('');
    return '<div class="db-desc-table-scroll"><table class="db-desc-table">'+hh+'<tbody>'+bh+'</tbody></table></div>';
  }
  if(b.type === 'subcats') return subcatTableHtml(b);
  return '';
}

/* ---------- 子類對照表（可勾選 → 即時篩選同頁下方的案件清單） ----------
   最左欄為列標字母（A、B、C…），字母即開關，可複選；
   選取狀態存於 SUBCAT_SEL，說明卡重繪不會遺失。
   件數兩欄（成立／不成立）與下方案件清單同源，皆取自 SUBCAT_IDX，
   不另行計算，故畫面數字與勾選後的筆數必然一致。
   分類標題（row.group）以整列合併儲存格插在該類第一列之上；
   表末另有一列合併儲存格，放置本表的備註。
   條文欄以 lawTagBtn 產生，沿用既有 data-law 委派，可點開條文卡片。 */
/* 檢索欄的列標：A、B、C…；超過 26 列續以 AA、AB…（現行各表皆遠少於此）。
   序號取自 rows 陣列本身，故分類標題列與備註列不占字母。 */
function subcatRowLabel(i){
  var s = '';
  i = i | 0;
  do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while(i >= 0);
  return s;
}
function subcatLawCell(key, arr){
  if(!Array.isArray(arr) || !arr.length) return '<span class="db-sc-none">—</span>';
  return arr.map(function(s){ return lawTagBtn(key, String(s), String(s)); }).join(' ');
}
/* 子類表的分類標題列。pid（rows[].groupPat 或 tailGroups[].pat）指定時，整段標題
   做成可點擊，點擊跳至該違失態樣——沿用文件層的 [data-pattern-id] 委派處理器，
   與其他態樣連結行為一致。 */
function scGroupRow(text, pid, cols){
  var gh = descInlineHtml(text);
  if(pid && PATTERN_BY_ID[pid]){
    gh = '<button type="button" class="db-sc-grp-link" data-pattern-id="'+esc(pid)+
         '" title="檢視「'+esc(PATTERN_BY_ID[pid].name)+'」之案件">'+gh+'</button>';
  }
  return '<tr class="db-sc-grp"><td colspan="'+cols+'">'+gh+'</td></tr>';
}
function subcatTableHtml(b){
  var rows = Array.isArray(b.rows) ? b.rows : [];
  if(!rows.length) return '';
  /* 兩種欄位配置共用一張表：條文式（by 省略）九欄、人工標記式（by:'tag'）六欄。
     勾選欄與最後兩欄（成立／不成立）兩者相同，差別只在中間。 */
  var tag = (b.by === 'tag');
  /* tag 表的兩個可選部位：
       ．占比欄——b.pct 為真才生成，分母為該樣態之案件數（與 {{scPct:}} 同源）；
       ．表頭文字——b.labels 可覆寫「型態」「說明」兩欄的欄名，因為不同樣態
         的分類面向不同（違失型態／與職務之關聯／罪名型態…）。 */
  var wantPct = tag && !!b.pct;
  /* b.expel：在「成立」右側加一欄「除名」，列出該列成立案件中最終處分為除名者。
     除名之判準為 HC_OF(h) === 1，與案件清單「懲戒決定」欄的 .db-hc1 底色同一份
     對照表，故兩處必然一致；件數於渲染時即時由 SUBCAT_IDX 的 yes 清單推導，
     不寫死於 JSON（同 articleIndex、patterns[].cases 的既有作法）。
     做成選配旗標而非一律顯示：其餘子類表的分類面向未必與處分輕重相關，
     需要時於 #db-pattern-meta 的該區塊補上 "expel": true 即可。 */
  var wantExpel = !!b.expel;
  var lb = (b.labels && typeof b.labels === 'object') ? b.labels : {};
  var patN = ((PATTERN_BY_ID[rows[0] && rows[0].patternId] || {}).cases || []).length;
  /* tag 表固定五欄（檢索／型態／說明／成立／不成立），占比與除名為選配 */
  var COLS = (tag ? 5 : 9) + (wantPct ? 1 : 0) + (wantExpel ? 1 : 0);
  var expelTh = wantExpel ? '<th class="db-sc-h-x">除名</th>' : '';
  var heads = tag
    ? ['<th class="db-sc-pick">檢索</th>',
       '<th class="db-sc-h-t">'+descInlineHtml(lb.t || '違失型態')+'</th>',
       '<th class="db-sc-h-d">'+descInlineHtml(lb.d || '說明')+'</th>',
       '<th class="db-sc-h-n">成立</th>', expelTh, '<th class="db-sc-h-n">不成立</th>',
       wantPct ? '<th class="db-sc-h-n">占比</th>' : ''].join('')
    : ['<th class="db-sc-pick">檢索</th>',
       '<th class="db-sc-h-t">態樣</th>',
       '<th class="db-sc-law">舊律師法</th>', '<th class="db-sc-law">新律師法</th>',
       '<th class="db-sc-law">舊倫理規範</th>', '<th class="db-sc-law">新倫理規範</th>',
       '<th class="db-sc-h-cs">得經同意<br>受任</th>',
       '<th class="db-sc-h-n">成立</th>', expelTh, '<th class="db-sc-h-n">不成立</th>'].join('');
  var lastGrp = null;
  var body = rows.map(function(r, ri){
    var e = SUBCAT_IDX[r.id] || {yes:[], no:[]};
    var cols = r.cols || {};
    var on = !!SUBCAT_SEL[r.id];
    var head = '';
    if(r.group && r.group !== lastGrp){
      lastGrp = r.group;
      head = scGroupRow(r.group, r.groupPat, COLS);
    }
    var mid = tag
      ? '<td class="db-sc-t">'+descInlineHtml(r.t)+'</td>'+
        '<td class="db-sc-d">'+descInlineHtml(r.d)+'</td>'
      : '<td class="db-sc-t">'+descInlineHtml(r.t)+'</td>'+
        '<td class="db-sc-law">'+subcatLawCell('J', cols.J)+'</td>'+
        '<td class="db-sc-law">'+subcatLawCell('K', cols.K)+'</td>'+
        '<td class="db-sc-law">'+subcatLawCell('L', cols.L)+'</td>'+
        '<td class="db-sc-law">'+subcatLawCell('M', cols.M)+'</td>'+
        '<td class="db-sc-cs">'+esc(String(r.consent == null ? '' : r.consent))+'</td>';
    return head + '<tr'+(on ? ' class="db-sc-on"' : '')+'>'+
      '<td class="db-sc-pick"><button type="button" class="db-sc-lb'+(on ? ' db-sc-lb-on' : '')+
        '" data-subcat="'+esc(r.id)+'" aria-pressed="'+(on ? 'true' : 'false')+
        '" aria-label="檢索：'+esc(String(r.t||''))+'" title="點選以檢索本列案件">'+
        subcatRowLabel(ri)+'</button></td>'+
      mid +
      '<td class="db-sc-n">'+e.yes.length+'</td>'+
      (wantExpel
        ? '<td class="db-sc-x">'+e.yes.filter(function(i){
            return HC_OF(DATA.cases[i].h) === 1;
          }).length+'</td>'
        : '')+
      '<td class="db-sc-n db-sc-n0">'+e.no.length+'</td>'+
      (wantPct
        ? '<td class="db-sc-n db-sc-n0">'+
          (patN ? ((e.yes.length + e.no.length) / patN * 100).toFixed(1) : '0.0')+'%</td>'
        : '')+'</tr>';
  }).join('');
  /* 表尾的「僅標題」分類列（b.tailGroups）：該分類已改由另一個違失態樣承接，
     本表不再列其型態與件數，只保留標題並連往該樣態。因不在 rows 之內，
     故不占列標字母、不進件數與子類檢索。 */
  var tail = (Array.isArray(b.tailGroups) ? b.tailGroups : []).map(function(g){
    return g && g.t ? scGroupRow(g.t, g.pat, COLS) : '';
  }).join('');
  var note = b.note
    ? '<tr class="db-sc-note"><td colspan="'+COLS+'">'+descInlineHtml(b.note)+'</td></tr>'
    : '';
  return '<div class="db-subcat"><div class="db-desc-table-scroll">'+
    '<table class="db-desc-table db-sc-table'+(tag ? ' db-sc-tag' : '')+
    (wantExpel ? ' db-sc-expel' : '')+'"><thead><tr>'+heads+'</tr></thead>'+
    '<tbody>'+body+tail+note+'</tbody></table></div></div>';
}

function patDescHtml(id){
  var pm = patMeta(id), d = pm && pm.desc;
  var descClass = 'db-pat-desc db-pat-desc-' + id;
  if(!d) return '<div class="'+descClass+'"><div class="db-desc-body"><p class="db-desc-todo">待填寫</p></div></div>';
  /* 供 descInlineHtml 展開 {{n}} 等動態數字；本函式結束前務必清回 null，
     否則其他地方（法條卡片等）誤用到殘留的脈絡。 */
  DESC_PID = id;
  /* 相容舊格式：直接給段落陣列者，視為只有前言 */
  var intro = Array.isArray(d) ? d : (d.intro || []);
  var blocks = Array.isArray(d) ? [] : (d.blocks || []);
  var cs = Array.isArray(d) ? [] : (d.cases || []);
  var h = intro.map(function(t){ return '<p>'+descInlineHtml(t)+'</p>'; }).join('');
  if(blocks.length) h += blocks.map(descBlockHtml).join('');
  if(cs.length){
    h += '<div class="db-desc-cases">' + cs.map(function(it,i){
      var nos = descCaseNos(it);
      return '<div class="db-desc-case">'+
             '<span class="db-case-lb">案例'+esc(descCaseLb(it, i))+'</span>'+
             (nos.length
               /* 每個案號後緊接其懲戒決定標籤，兩者成對，數個案號時不致錯配 */
               ? '<span class="db-case-nos">'+(function(who){
                   return nos.map(function(no){
                     return descCaseNoHtml(no) + descCaseDecHtml(no, who);
                   }).join('');
                 })(descCaseWho(it))+'</span>'
               : '')+
             '<p>'+esc(descCaseText(it))+'</p></div>';
    }).join('') + '</div>';
  }
  DESC_PID = null;
  return '<div class="'+descClass+'"><div class="db-desc-body">'+h+'</div></div>';
}

function renderPattern(){
  var box = el('pattern-detail');
  if(pst.idx<0){ box.innerHTML=''; return; }
  var p = DATA.patterns[pst.idx];
  var lawParts = [];
  ALL_SRC.forEach(function(s){
    var arr = p.laws[s.key];
    if(arr && arr.length){
      var tags = arr.map(function(raw){ return lawTagBtn(s.key, s.short+raw, raw); }).join(' ');
      lawParts.push('<span class="db-rel-group">'+tags+'</span>');
    }
  });
  var relLine = lawParts.length
    ? '<div class="db-pat-related"><span class="db-rel-lead">相關規定：</span>'+lawParts.join('')+'</div>'
    : '';
  /* 眉標：本態樣所屬之大類（同時屬於兩類者並列） */
  var gs = patGroupsOf(p.id);
  var eyebrow = gs.length
    ? '<div class="db-pat-eyebrow">'+gs.map(function(g){
        /* 編號與標題同一層級：兩者大小、顏色一致，且中間不留空格 */
        return '<b>'+esc(g.code)+esc(g.name)+'</b>';
      }).join('<span class="db-eb-sep">｜</span>')+'</div>'
    : '';
  var h = [eyebrow,
    '<h2>'+esc(p.name)+'</h2>',
    relLine,
    patDescHtml(p.id),
    '<div id="pat-cases"></div>'];
  box.innerHTML = h.join('');
  renderPatternCases();
}

/* 案件區（筆數列＋表格＋頁次）單獨重繪。
   子類勾選是即時篩選，若整頁重繪，說明卡會跟著重建，捲動位置與剛按下的
   核取方塊焦點都會跳掉；故勾選時只換這一塊。 */
function renderPatternCases(){
  var host = el('pat-cases');
  if(pst.idx < 0 || !host) return;
  var p = DATA.patterns[pst.idx];
  var list = patCaseList(p);
  var subN = patSubcatSel(p.id).length;
  /* 概括條款態樣專屬的過濾器；勾選狀態存於 ONLYPAT_SEL，重繪不會遺失 */
  var onlyOn = !!ONLYPAT_SEL[p.id];
  var onlyBox = ONLYPAT_PATS[p.id]
    ? '<div class="db-onlypat"><label><input type="checkbox" data-onlypat="'+esc(p.id)+'"'+
      (onlyOn ? ' checked' : '')+'>不顯示包含「綜合類」以外態樣的案件</label></div>'
    : '';
  host.innerHTML = onlyBox +
    '<div class="db-table-toprow"><div class="db-result-count">'+
    '<span class="db-rc-n">符合案件：<b>'+list.length+'</b> 筆</span>'+
    (subN ? '<span class="db-rc-sub">（已依勾選之 '+subN+' 個子類篩選）</span>' : '')+
    (onlyOn ? '<span class="db-rc-sub">（僅列未落入其他具體態樣者）</span>' : '')+
    '</div><div class="db-pager-slot" id="pat-pager-top"></div>'+
    '<label class="db-rev-toggle db-table-hint"><input data-rev-scope="pattern" type="checkbox"'+
    (revShown.pattern?" checked":"")+'>顯示覆審與備註欄</label>'+
    '<span class="db-scroll-hint">↔ 表格可左右滑動</span></div>'+
    '<div id="pat-table"></div><div id="pat-pager"></div>';
  /* 預設以懲戒決定之輕重排序（輕重值小者在前；無法分類者殿後） */
  var sorted = list.slice().sort(caseCmp(pst.sort, pst.asc));
  renderTable(sorted, el('pat-table'), [el('pat-pager-top'), el('pat-pager')], pst.page, function(pg, srcIdx){
    pst.page = pg; renderPatternCases();
    routePush();
    /* 上方頁次換頁：維持原位不捲動；下方頁次換頁：錨定至上方頁次列處 */
    if(srcIdx === 1) el('pat-pager-top').scrollIntoView({block:'start'});
  }, {key:pst.sort, asc:pst.asc, onSort:function(k){
    if(pst.sort===k){ pst.asc = !pst.asc; }
    else{ pst.sort = k; pst.asc = true; }
    pst.page = 1; renderPatternCases();
    routeReplace();
  }}, null, revShown.pattern,
  /* 本頁已選定一個態樣，故傳入其 ID，使該態樣在態樣欄與備註欄中以深紫標示，
     與同列其他態樣區分。 */
  p.id);
  FX.refresh();
}
/* ---------- 子類對照表的互動 -------------------------------------------
   #pattern-detail 的內容每次重繪都整段換掉，故一律用事件委派掛在容器上，
   不在每次渲染時逐一綁定（重繪後綁定會失效，也會重複累積）。
   選取後只重繪案件區，說明卡與捲動位置維持不動。
   兩種控制項的事件不同：概括條款的過濾核取方塊仍是 change，
   子類列標字母是 <button>，走 click。 */
(function(){
  var box = el('pattern-detail');
  if(!box) return;
  box.addEventListener('change', function(e){
    var cb = e.target;
    /* 概括條款態樣的過濾核取方塊：只重繪案件區，說明卡與捲動位置不動 */
    if(!(cb && cb.getAttribute && cb.getAttribute('data-onlypat'))) return;
    var opid = cb.getAttribute('data-onlypat');
    if(cb.checked) ONLYPAT_SEL[opid] = true; else delete ONLYPAT_SEL[opid];
    pst.page = 1;
    renderPatternCases();
    routePush();
  });
  box.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.db-sc-lb') : null;
    if(!b || !box.contains(b)) return;
    var id = b.getAttribute('data-subcat');
    if(!id) return;
    if(SUBCAT_SEL[id]) delete SUBCAT_SEL[id]; else SUBCAT_SEL[id] = true;
    var on = !!SUBCAT_SEL[id];
    b.classList.toggle('db-sc-lb-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    var tr = b.closest ? b.closest('tr') : null;
    if(tr) tr.classList.toggle('db-sc-on', on);
    pst.page = 1;
    renderPatternCases();
    routePush();
  });
})();

/* [JS-LAWS] 懲戒法規／新舊對照 */
/* ---------- 頁籤三：懲戒依據（法規全文） ---------- */
var lawState = {ready:false, key:null, usedOnly:false};
var lawShort = {};
ALL_SRC.forEach(function(s){ lawShort[s.key] = s.short; });
/* 條文對話框標題專用的法典全名：「新／舊」＋《法典全名》。
   由 laws[].title（取「（」之前）與簡稱首字推導，不另存一份對照表。
   ※ 只用於對話框；表格欄位、法條標籤、態樣頁的相關規定一律維持簡稱，勿混用。 */
function lawFullName(key){
  var L = DATA.laws && DATA.laws[key], sh = lawShort[key] || '';
  var base = String((L && L.title) || '').split('（')[0];
  if(!base) return sh;
  var pre = /^[新舊]/.test(sh) ? sh.charAt(0) : '';
  return pre + '《' + base + '》';
}
/* laws[].title 末尾的版本括號，例：「（民國104年6月15日修正）」。
   對話框右側只顯示這一段，法典名不再重複。 */
function lawTitleVer(title){
  var m = /（[^（）]*）\s*$/.exec(String(title || ''));
  return m ? m[0] : String(title || '');
}
var lawClsLower = {J:'j', K:'k', L:'l', M:'m', N:'n', O:'o'};

/* ---------- 「限於情節重大」標籤 ------------------------------------
   新《律師法》第73條第3款把幾條列為「須情節重大始構成懲戒事由」，條文本身看不出
   這件事，故在條文旁標註。名單是人工設定的輸入資料（與 ONLYPAT_PATS 同性質），
   要增減直接改這裡；值＝該標籤所屬的項次，0＝整條（標在條文末尾）。
   目前只有新律師法（K）有這種限制，故以法典鍵分層，日後若有他部法典比照辦理，
   在同一個物件下加一組即可，渲染端不必再改。 */
var SEVERE_ONLY = {
  K: {'21':3, '24':5, '30':0, '31':0, '35':2, '36':0, '39':0, '43':0}
};
var SEVERE_TIP = '依新《律師法》第73條第3款，本規定須情節重大始構成懲戒事由。';
/* 說明浮字與「詳覆審／無全文」共用 initFullTagTip()：data-ft-tip 帶文字者即以該文字
   顯示（"1" 為沿用預設文字）。標籤不可點擊，故為 span；tabindex 讓鍵盤也叫得出說明。 */
/* scope：'條'＝整條皆受限（sev===0，或條文只有一項，此時條＝項）；
   '項'＝僅該項受限（sev===n）。標籤文字隨之不同，避免標籤因換行而落在
   單獨一列時，看起來像是整條都受限。 */
function severeTagHtml(scope){
  return '<span class="db-sev-tag" tabindex="0" data-ft-tip="'+esc(SEVERE_TIP)+
    '" aria-describedby="db-ft-tip">本'+(scope === '項' ? '項' : '條')+'限於情節重大</span>';
}
function articleHtml(key, a){
  var cls = lawClsLower[key];
  /* undefined＝本條無標籤；0＝整條；n＝限於第 n 項（見 SEVERE_ONLY） */
  var sev = (SEVERE_ONLY[key] || {})[a.no];
  var head = a.head || ('第'+a.no+'條');
  var anchor = '<span class="db-art-anchor" aria-hidden="true"></span>';
  var badge = a.used
    ? '<button type="button" class="db-badge" data-jump="'+key+'|'+a.no+'" title="檢視引用本條之案件">懲戒案例 →</button>'
    : '';
  /* 關聯規範標籤：條文資料中的選填欄位 refs=[{t:標籤文字, u:連結}]，無此欄位者不顯示 */
  badge += (a.refs||[]).map(function(r){
    return '<a class="db-badge db-badge-ref" href="'+esc(r.u)+'" target="_blank" rel="noopener" title="另開新視窗檢視'+esc(r.t)+'">'+esc(r.t)+' ↗</a>';
  }).join('');
  if(a.deleted){
    return '<div class="db-article" id="art-'+key+'-'+a.no+'">'+anchor+
      '<h4>'+esc(head)+'（刪除）'+badge+'</h4></div>';
  }
  var cn = a.used ? (' db-u-'+cls) : '';
  var body;
  if(a.paras.length <= 1){
    var p = a.paras[0] || {t:'', ks:[]};
    /* 只有一項者，「整條」與「限於第1項」是同一件事，兩種寫法都標在這裡 */
    body = '<div>'+esc(p.t)+(sev === undefined ? '' : severeTagHtml('條'))+'</div>';
    if(p.ks && p.ks.length){
      body += p.ks.map(function(k){ return '<div class="db-kuan">'+esc(k)+'</div>'; }).join('');
    }
  }else{
    body = '<ol class="db-paras">'+a.paras.map(function(p, pi){
      var inner = esc(p.t);
      /* 限於某一項者標在該項句末；款另起一行，故標籤必須排在款之前 */
      if(sev === pi + 1) inner += severeTagHtml('項');
      if(p.ks && p.ks.length){
        inner += p.ks.map(function(k){ return '<div class="db-kuan">'+esc(k)+'</div>'; }).join('');
      }
      return '<li>'+inner+'</li>';
    }).join('')+'</ol>';
    /* 整條皆受限（sev===0）：標在條文末尾，不掛在任何一項上 */
    if(sev === 0) body += '<div class="db-sev-row">'+severeTagHtml('條')+'</div>';
  }
  return '<div class="db-article'+cn+'" id="art-'+key+'-'+a.no+'">'+anchor+
    '<h4>'+esc(head)+badge+'</h4>'+body+'</div>';
}

/* 由條號找出列表頁該法規篩選器中對應的 option index（找不到回 -1） */
function filterIndexOf(key, artNo){
  var arts = DATA.articleIndex[key] || [];
  var want = String(artNo);
  for(var i=0;i<arts.length;i++){ if(arts[i].no===want) return i; }
  return -1;
}
/* 跳到懲戒案件列表並套用對應法條篩選器 */
function gotoFilter(key, artNo){
  var idx = filterIndexOf(key, artNo);
  if(idx<0) return; /* 理論上懲戒依據條必有對應選項 */
  if(el('law-pop') && !el('law-pop').hidden) closeLaw();
  /* 法條篩選器只存在於懲戒處分分頁。引用本條的案件若全部落在暫時處分分頁
     （現行資料只有新律師法第7條如此），就改切到該分頁——那裡沒有篩選器，但該
     分頁的案件本來就只有這一條依據，列出的結果與篩選完全一致；若不這樣處理，
     跳過去會是一張空表。 */
  var cs = (DATA.articleIndex[key][idx] || {}).cases || [];
  var allProv = !!cs.length;
  for(var ci = 0; ci < cs.length; ci++) if(!IS_PROV[cs[ci]]){ allProv = false; break; }
  setKind(allProv ? 'prov' : 'disc');
  if(!allProv){
    ALL_SRC.forEach(function(s){
      el('flt-'+s.key).value = (s.key===key) ? String(idx) : '';
    });
    st.other = '';
  }
  st.page = 1;
  tabs.forEach(function(o){
    var cur = o.btn===el('tabbtn-list');
    o.btn.setAttribute('aria-selected', cur?'true':'false');
    o.panel.hidden = !cur;
  });
  renderList();
  routePush();
  el('annot-box').scrollIntoView({block:'start'});
}

/* 其它規範（LAW_OTHERS）→ 案件清單：以整部規範為條件，不核對條次。
   與 gotoFilter 平行，差別只在條件來源是 OTHER_IDX 而非 articleIndex。 */
function otherByKey(k){
  for(var i=0;i<LAW_OTHERS.length;i++) if(LAW_OTHERS[i].k===k) return LAW_OTHERS[i];
  return null;
}
/* 其它規範在「懲戒法規」頁的定位節點：第一部的標題共用靜態的 #law-title 區塊，
   其餘各部才有自己的 #lawother-<k>（見 renderLawBody）。 */
function otherAnchorEl(k){
  if(LAW_OTHERS.length && LAW_OTHERS[0].k === k){
    var t = el('law-title');
    return t ? t.parentNode : null;
  }
  return el('lawother-' + k);
}
function gotoOther(k){
  if(!(OTHER_IDX[k] && OTHER_IDX[k].length)) return;
  if(el('law-pop') && !el('law-pop').hidden) closeLaw();
  setKind('disc');  /* 其它規範篩選只存在於懲戒處分分頁 */
  ALL_SRC.forEach(function(s){ el('flt-'+s.key).value = ''; });
  el('flt-q').value = ''; st.q = '';
  st.other = k;
  st.page = 1;
  tabs.forEach(function(o){
    var cur = o.btn===el('tabbtn-list');
    o.btn.setAttribute('aria-selected', cur?'true':'false');
    o.panel.hidden = !cur;
  });
  renderList();
  routePush();
  el('annot-box').scrollIntoView({block:'start'});
  if(FT_HILITE) FT_HILITE();
}

/* 跳到違失態樣頁並開啟指定態樣（與 gotoFilter 為反向操作）。
   跨功能關聯只收永久 ID；中文名稱即使日後修改，也不影響導覽。 */
function gotoPattern(patternId, subIds){
  var idx = PATTERN_INDEX_BY_ID[patternId];
  if(idx == null) return;
  if(el('law-pop') && !el('law-pop').hidden) closeLaw();
  /* 第二個參數：跳轉後一併勾選該態樣的指定子類（目前只有申訴救濟頁的
     民眾入口會帶）。先清掉本態樣既有的勾選再套用，跳轉後看到的才必然是
     指名的那幾列，不受先前操作殘留影響；SUBCAT_SEL 本身是跨重繪保留的。
     未傳此參數者（其餘所有呼叫端）完全不動 SUBCAT_SEL，行為與先前一致。 */
  if(subIds !== undefined){
    patSubcatSel(patternId).forEach(function(id){ delete SUBCAT_SEL[id]; });
    (subIds || []).forEach(function(id){
      if(SUBCAT_ROWS[id] && SUBCAT_ROWS[id].patternId === patternId) SUBCAT_SEL[id] = true;
    });
  }
  pst.idx = idx;
  pst.page = 1;
  pst.sort = 'h'; pst.asc = true;  /* 與點選態樣清單一致：回到預設排序 */
  pst.expanded = false;
  tabs.forEach(function(o){
    var cur = o.btn===el('tabbtn-pattern');
    o.btn.setAttribute('aria-selected', cur?'true':'false');
    o.panel.hidden = !cur;
  });
  renderPatternList();
  renderPattern();
  routePush();
  /* 定位方式與態樣清單點選相同：捲至 #pattern-anchor 上緣，標題緊接於懸浮頁首下方 */
  var pa = el('pattern-anchor');
  if(pa) window.scrollTo(0, Math.max(0, pa.getBoundingClientRect().top + window.pageYOffset));
}

/* 依法規別固定顯示之說明（律師法 / 倫理規範各一版） */
var LAW_NOTE_ACT = '《律師法》於民國 109 年 1 月 15 日全文修正公布後，懲戒引用的條次已大幅變更。本資料庫將民國 81 年 11 月 16 日公布以後，於全文修正前一版（民國 99 年 1 月 27 日公布）的條文稱為「舊律師法」；此後的條文稱之為「新律師法」，以資區分。修正後因條文結構有大幅更動，因此新、舊法的條文間並未依序、單獨對應。';
var LAW_NOTE_ETHIC_BASE = '《律師倫理規範》自民國 84 年修訂為 50 條後，睽違近 30 年於民國 111 年 5 月 29 日再次進行全文修正公布，此後懲戒引用的條次已大幅變更。本資料庫將全文修正前一版的條文稱之為「舊倫理規範」；此後的條文稱之為「新倫理規範」，以資區分。';
var LAW_NOTE_ETHIC_L = LAW_NOTE_ETHIC_BASE + '就全國律師聯合會對「舊倫理規範」的解釋，請參考民國100年9月出版的《<a href="https://www.twba.org.tw/publication/articles/c23bc629-f933-49f2-a5f5-9ff777a94126" target="_blank" rel="noopener">律師倫理規範逐條釋義</a>》。';
var LAW_NOTE_ETHIC_M = LAW_NOTE_ETHIC_BASE + '另於網頁彙整的「<a href="https://www.twba.org.tw/publication/articles/7dc191ca-b261-49aa-a3aa-0dc0106e00d3" target="_blank" rel="noopener">律師倫理規範歷年函釋</a>」，則涵蓋了新、舊倫理規範的相關解釋。';
var LAW_NOTE_ETHIC_E = LAW_NOTE_ETHIC_BASE + '就全國律師聯合會對「舊倫理規範」的解釋，請參考民國 100 年 9 月出版的《<a href="https://www.twba.org.tw/publication/articles/c23bc629-f933-49f2-a5f5-9ff777a94126" target="_blank" rel="noopener">📖律師倫理規範逐條釋義</a>》；另於網頁彙整的「<a href="https://www.twba.org.tw/publication/articles/7dc191ca-b261-49aa-a3aa-0dc0106e00d3" target="_blank" rel="noopener">📜律師倫理規範歷年函釋</a>」，則涵蓋了新、舊倫理規範的相關解釋。';
var LAW_NOTE = {J:LAW_NOTE_ACT, K:LAW_NOTE_ACT, F:LAW_NOTE_ACT, L:LAW_NOTE_ETHIC_L, M:LAW_NOTE_ETHIC_M, E:LAW_NOTE_ETHIC_E};
/* 各法規頁的主視覺標題（法規名稱＋修正日期） */
var LAW_TITLE = {
  J:'舊律師法：民國99年1月27日修正之《律師法》',
  K:'新律師法：民國114年5月28日修正之《律師法》',
  F:'《律師法》新舊條文對照',
  L:'舊倫理規範：民國98年9月19日修正之《律師倫理規範》',
  M:'新倫理規範：民國115年4月18日修正之《律師倫理規範》',
  E:'《律師倫理規範》新舊條文對照'
};
/* 各法規之來源（來源名稱直接作為超連結） */
var LAW_SOURCE = {
  J:'（來源：<a href="https://www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=01806" target="_blank" rel="noopener">立法院法律系統</a>）',
  K:'（來源：<a href="https://www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=01806" target="_blank" rel="noopener">立法院法律系統</a>）',
  F:'（來源：<a href="https://www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=01806" target="_blank" rel="noopener">立法院法律系統</a>）',
  L:'（來源：<a href="https://www.twba.org.tw/regulation/morale/65bfe5e5-1a32-47db-b2b2-3783369c8e60" target="_blank" rel="noopener">全國律師聯合會</a>）',
  M:'（來源：<a href="https://www.twba.org.tw/regulation/morale/65bfe5e5-1a32-47db-b2b2-3783369c8e60" target="_blank" rel="noopener">全國律師聯合會</a>）',
  E:'（來源：<a href="https://www.twba.org.tw/regulation/morale/65bfe5e5-1a32-47db-b2b2-3783369c8e60" target="_blank" rel="noopener">全國律師聯合會</a>）'
};

/* 新舊倫理規範條號對應（新→舊；null 表示新增，舊法無對應） */
var ETHIC_MAP = (function(){
  var m = [];
  for(var i=1;i<=16;i++) m.push([String(i), String(i)]);       /* 1–16 條號相同 */
  m.push(['17', null]);                                        /* 新增 */
  for(var i=18;i<=31;i++) m.push([String(i), String(i-1)]);    /* 18–31 ← 17–30 */
  m.push(['32','30-1'], ['33','30-2'], ['34','31'], ['35',null]);
  for(var i=36;i<=42;i++) m.push([String(i), String(i-4)]);    /* 36–42 ← 32–38 */
  /* 舊規範原第38條（利害衝突）於95年9月23日修正時刪除，新規範無對應條文；
     其後之第38條為檔案保存義務（＝新規範第42條），二者不可混淆。
     此列緊接於「新第42條 ← 原第38條」之後，便於對照同條號之新舊內容 */
  m.push([null, '38-原']);
  for(var i=43;i<=51;i++) m.push([String(i), String(i-4)]);    /* 43–51 ← 39–47 */
  m.push(['52','47-1'], ['53','48'], ['53-1',null], ['54','49'], ['55','50']);
  return m;
})();

/* 新舊律師法條號對應（新→舊）。
   依立法院第9屆第7會期第12次會議議案關係文書之律師法修正草案條文對照表整理。
   每列為 [新條號, 舊條文參照]；舊條文參照為 null 表示新增（舊法無對應），
   否則為陣列，各元素為 [舊條號, 項款加註（草案僅參照特定項款時）]。
   新條號為 null 表示該列僅有舊條文（新法無對應條文）。 */
var ACT_MAP = (function(){
  var m = [];
  function nw(no, olds){ m.push([no===null?null:String(no), olds||null]); }
  function adds(a,b){ for(var i=a;i<=b;i++) nw(i, null); } /* 連號之新增條文 */
  nw(1,[['1']]); nw(2,[['2']]); nw(3,[['3'],['5']]); nw(4,[['7'],['10']]); nw(5,[['4']]); nw(6,[['6']]);
  /* 舊法第10條為刪除條文，依版面需求併列於舊法第7條下方；articleHtml() 仍顯示「第10條（刪除）」。 */
  adds(7,8);
  nw(9,[['4','第二項及第三項']]);
  adds(10,18);
  nw(19,[['9'],['11']]); nw(20,null); nw(21,[['20']]); adds(22,23);
  nw('23-1', null);                                 /* 民國114年5月28日修正時增訂 */
  nw(24,[['21']]); adds(25,26);
  nw(27,[['8']]); nw(28,[['37-1']]); nw(29,[['38']]); nw(30,[['22']]); nw(31,[['23']]);
  nw(32,[['24']]); nw(33,[['25']]); nw(34,[['26']]); nw(35,[['27']]); adds(36,37);
  nw(38,[['28']]); nw(39,[['29']]); nw(40,[['30'],['35']]); nw(41,[['31']]); nw(42,null);
  nw(43,[['32']]); nw(44,[['33']]); nw(45,[['34']]); nw(46,[['36']]); nw(47,[['37']]);
  adds(48,50);
  nw(51,[['11','第二項至第四項']]); nw(52,[['12']]); nw(53,[['13']]); adds(54,55);
  nw(56,[['14']]); nw(57,[['15']]); nw(58,[['16']]); nw(59,[['17']]); nw(60,[['18']]); nw(61,[['19']]);
  nw(62,[['12']]); nw(63,null); nw(64,[['13','第一項第二款及第二項']]); adds(65,67);
  nw(68,[['15']]); nw(69,[['16']]); nw(70,[['17']]); nw(71,[['18']]); nw(72,[['19']]);
  nw(73,[['39']]); adds(74,75); nw(76,[['40']]); nw(77,null); nw(78,[['41']]); nw(79,[['42']]); nw(80,[['43']]);
  adds(81,83); nw(84,[['52','第二項']]); adds(85,100); nw(101,[['44']]); adds(102,113);
  for(var i=0;i<13;i++) nw(114+i, [['47-'+(i+1)]]); /* 114–126 ← 47-1–47-13 */
  nw(null,[['47-14']]);                             /* 舊法第47條之14，新法無單獨對應條文 */
  nw(127,[['48']]); nw(128,[['49']]); nw(129,[['50']]); nw(130,[['50-1']]); nw(131,null);
  nw(132,[['20-1']]); nw(133,[['45']]); nw(134,[['46']]); nw(135,[['47']]); nw(136,null);
  nw(137,[['51']]); adds(138,144); nw(145,[['52']]); nw(146,[['53']]);
  return m;
})();

/* 「其它」：其他與律師懲戒相關之規範（列標題與來源；body 為選填之補充內容） */
/* 《法律扶助法》新舊對照：直接由 DATA.laws.O／N 產生，
   故與其他法典一樣自帶「已引用」底色（u-o／u-n）與「懲戒案例 →」按鈕，
   不必在此重打條文，改條文只需改 #db 之 laws。 */
/* 對照表的空儲存格佔位元素。
   官網主題若有 td:empty{border:0}（相當常見的寫法）之類的規則，完全空白的
   儲存格就會失去框線——徵狀正是「有的格線消失」，且一定發生在沒有對應條文
   的那一側。塞一個無尺寸的 span 使其不再符合 :empty，即可避開；
   同時上方的框線宣告一律加 !important，雙保險。 */
var CMP_BLANK = '<span class="db-cmp-blank" aria-hidden="true"></span>';

function fzCompareHtml(){
  function art(k, no){
    var L = DATA.laws[k];
    if(!L) return '';
    for(var i=0;i<L.articles.length;i++) if(L.articles[i].no===no) return articleHtml(k, L.articles[i]);
    return '';
  }
  return '<p class="db-law-note-fixed">此處僅摘錄與本資料庫相關的條文，全文請見來源網站。</p>'+
    '<div class="db-cmp-scroll"><table class="db-cmp-table"><thead><tr>'+
      '<th class="db-ch-o">新《法律扶助法》（民國104年6月15日修正）</th>'+
      '<th class="db-ch-n">舊《法律扶助法》（民國98年12月15日修正）</th>'+
    '</tr></thead><tbody>'+
    '<tr><td>'+(art('O','26')||CMP_BLANK)+'</td><td>'+(art('N','27')||CMP_BLANK)+'</td></tr>'+
    '<tr><td>'+(art('O','66')||CMP_BLANK)+'</td><td>'+CMP_BLANK+'</td></tr>'+
    '</tbody></table></div>';
}

/* k     ：其它規範之穩定鍵（st.other 與 data-jumpx 用；勿改動，改了會斷掉錨點行為）
   names ：比對用之規範名稱。比對只看名稱、不核對條次，範圍限 cases[].norm
           的顯示文字與 cases[].note；names 從缺者不產生按鈕。
           資料中的規範名稱已統一為正式名稱，故此處只列正式名稱；
           日後資料若又出現異名，於此追加即可。
   《法律扶助法》不設整部按鈕——其條文已在 DATA.laws.N／O 中，
   逐條自帶「懲戒案例 →」，再加一顆整部按鈕只會重複。 */
var LAW_OTHERS = [
  {k:'fz', title:'《法律扶助法》', src:'（來源：<a href="https://www.ly.gov.tw/Pages/ashx/LawRedirect.ashx?CODE=04584" target="_blank" rel="noopener">立法院法律系統</a>）',
   body: fzCompareHtml()},
  {k:'zy', title:'《扶助律師辦理扶助案件應行注意事項》', src:'（來源：<a href="https://www.laf.org.tw/law-detail/35" target="_blank" rel="noopener">法律扶助基金會</a>）',
   names:['扶助律師辦理扶助案件應行注意事項']},
  {k:'cj', title:'《法律扶助酬金計付辦法》', src:'（來源：<a href="https://www.laf.org.tw/law-detail/14" target="_blank" rel="noopener">法律扶助基金會</a>）',
   names:['法律扶助酬金計付辦法']},
  {k:'tz', title:'《律師推展業務規範》', src:'（來源：<a href="https://www.twba.org.tw/regulation/morale/fc625c0d-4ac2-4e3a-b2df-6de1cd655a24" target="_blank" rel="noopener">全國律師聯合會</a>）',
   names:['律師推展業務規範']},
  {k:'ft', title:'《律師訪談證人要點》', src:'（來源：<a href="https://www.twba.org.tw/regulation/bylaws2/f343a676-be17-4110-83af-51873b7a087c" target="_blank" rel="noopener">全國律師聯合會</a>）',
   names:['律師訪談證人要點']},
  {k:'jz', title:'《台北律師公會律師見證規則》', src:'（來源：<a href="https://www.tba.org.tw/about/?group=regulation&amp;category=practicing" target="_blank" rel="noopener">台北律師公會</a>）',
   names:['台北律師公會律師見證規則']},
  {k:'xy', title:'《辯護人辦理偵查中案件資訊揭露指引》', src:'（來源：<a href="https://www.twba.org.tw/news/bdf7af64-c697-4908-9784-aadd34dc103c" target="_blank" rel="noopener">全國律師聯合會</a>）',
   names:['辯護人辦理偵查中案件資訊揭露指引']},
  {k:'xz', title:'《律師事務所及分事務所登記規則》', src:'（來源：<a href="https://www.twba.org.tw/regulation/association/356c1010-14f1-4a4b-bd78-a5c8c90513cc" target="_blank" rel="noopener">全國律師聯合會</a>）',
   names:['律師事務所及分事務所登記規則']}
];

/* 其它規範 → 案件索引（推導值，勿另存一份）。 */
var OTHER_IDX = (function(){
  var out = {};
  LAW_OTHERS.forEach(function(o){
    if(!(o.names && o.names.length)) return;
    var hit = [];
    DATA.cases.forEach(function(c, i){
      var t = (c.norm||[]).map(function(n){ return n[0]; }).join('\u0001') + '\u0001' + (c.note||'');
      for(var a=0;a<o.names.length;a++){
        if(t.indexOf(o.names[a]) >= 0){ hit.push(i); return; }
      }
    });
    out[o.k] = hit;
  });
  return out;
})();

/* 標題列上的「懲戒案例 →」按鈕；無對應案件者不顯示 */
function otherBadge(o){
  if(!(o.k && OTHER_IDX[o.k] && OTHER_IDX[o.k].length)) return '';
  return '<button type="button" class="db-badge" data-jumpx="'+o.k+
    '" title="檢視「違反（或移送）之規範」或「備註」提及本規範之案件（'+
    OTHER_IDX[o.k].length+' 筆）">懲戒案例 →</button>';
}

function actCompareHtml(){
  var J = DATA.laws['J'], K = DATA.laws['K'];
  var kBy = {}, jBy = {};
  K.articles.forEach(function(a){ kBy[a.no] = a; });
  J.articles.forEach(function(a){ jBy[a.no] = a; });
  var rows = [];
  ACT_MAP.forEach(function(pr){
    var ka = pr[0] ? kBy[pr[0]] : null;
    var olds = (pr[1]||[]).map(function(sp){ return {a:jBy[sp[0]], q:sp[1]||null}; })
      .filter(function(o){ return o.a; });
    if(!ka && !olds.length) return;
    if(lawState.usedOnly && !((ka && ka.used) || olds.some(function(o){ return o.a.used; }))) return;
    var right = olds.map(function(o){ return articleHtml('J', o.a); }).join('');
    rows.push('<tr>'+
      '<td>'+(ka ? articleHtml('K', ka) : CMP_BLANK)+'</td>'+
      '<td>'+(right || CMP_BLANK)+'</td>'+
    '</tr>');
  });
  var h = [];
  if(!rows.length){
    h.push('<div class="db-no-result">此法規無曾作為懲戒依據之條文。</div>');
  }else{
    h.push('<div class="db-cmp-scroll"><table class="db-cmp-table"><thead><tr>'+
      '<th class="db-ch-k">新《律師法》（民國114年5月28日公布）</th>'+
      '<th class="db-ch-j">舊《律師法》（民國99年1月27日公布）</th>'+
      '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>');
  }
  return h.join('');
}

function ethicCompareHtml(){
  var L = DATA.laws['L'], M = DATA.laws['M'];
  var mBy = {}, lBy = {};
  M.articles.forEach(function(a){ mBy[a.no] = a; });
  L.articles.forEach(function(a){ lBy[a.no] = a; });
  var rows = [];
  ETHIC_MAP.forEach(function(pr){
    var ma = pr[0] ? mBy[pr[0]] : null;
    var la = pr[1] ? lBy[pr[1]] : null;
    if(!ma && !la) return;
    if(lawState.usedOnly && !((ma && ma.used) || (la && la.used))) return;
    rows.push('<tr>'+
      '<td>'+(ma ? articleHtml('M', ma) : CMP_BLANK)+'</td>'+
      '<td>'+(la ? articleHtml('L', la) : CMP_BLANK)+'</td>'+
    '</tr>');
  });
  var h = [];
  /* 舊倫理規範歷史版本頁之入口（該頁不列於頁首頁籤列） */
  h.push('<div class="db-eh-cta"><button type="button" class="db-eh-cta-btn" data-goto-eh="1">'+
    '瀏覽舊倫理規範歷史版本　&rarr;</button>'+
    '<span class="db-eh-cta-note">舊《律師倫理規範》於全文修正前，共歷經民國 87、92、95、98 年 4 次修正，但全國律師聯合會未提供舊版條文供參照。'+
    '本頁面以最後一版（98 年 9 月 19 日修正）為基礎，並就曾修正之條文，列出修正沿革。</span></div>'+
    '<div id="eh-cta-slot"></div>');
  if(M.preamble){
    h.push('<div class="db-law-preamble"><b>前言</b>　'+esc(M.preamble)+'</div>');
  }
  if(!rows.length){
    h.push('<div class="db-no-result">此法規無曾作為懲戒依據之條文。</div>');
  }else{
    h.push('<div class="db-cmp-scroll"><table class="db-cmp-table"><thead><tr>'+
      '<th class="db-ch-m">新《律師倫理規範》（民國115年4月18日修正）</th>'+
      '<th class="db-ch-l">舊《律師倫理規範》（民國98年9月19日修正）</th>'+
      '</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>');
  }
  return h.join('');
}


/* [JS-ETHIC-HISTORY] 舊倫理規範歷史版本 */
/* ---------- 舊倫理規範歷史版本（獨立頁面，不列於頁首） -----------------
   本頁以民國98年9月19日修正之《律師倫理規範》（＝本資料庫所稱「舊倫理規範」，
   資料取自 #db 之 laws.L）為主體，曾修正之條文另掛「修正沿革」。

   content-meta.json 的 ETHIC_HIST 只存「歷史條文」，現行條文一律取自 laws.L，不另存一份——
   理由同 no 與 patterns[].cases：衍生／重複資料一旦失步即靜默出錯。
   鍵為條號，值：
     h : 各期歷史條文，時間先後排列
         d 期間起日、e 期間迄日（＝下一次修正日）、p 條文（格式同 laws.L 的 paras）
     x : 該條為民國98年9月19日增訂，無歷史條文
     n : 條文層級之附註*/

/* 舊倫理規範的純內容資料由 content-meta.json 提供；renderer 與互動程式仍集中於本區。 */
var ETHIC_DATA = CONTENT_META.ethic;
var EH_DATE = ETHIC_DATA.dateLabels;
var EH_TIMELINE = ETHIC_DATA.timeline;
var ETHIC_HIST = ETHIC_DATA.history;

var EH_NOTE = '本頁以民國98年9月19日修正之《律師倫理規範》（即本資料庫所稱「舊倫理規範」）為主，條文曾經修正者標註「修正沿革」，展開即可對照歷史條文。';
var EH_SOURCE = '（沿革參照：<a href="https://www.twba.org.tw/regulation/morale/65bfe5e5-1a32-47db-b2b2-3783369c8e60" target="_blank" rel="noopener">全國律師聯合會</a>）';
var ehReady = false;

/* 條文內文 HTML：單項時直接輸出，多項時編號；款一律另起一行 */
function ehParasHtml(paras){
  paras = paras || [];
  function ks(p){
    return (p.ks || []).map(function(k){ return '<div class="db-kuan">' + esc(k) + '</div>'; }).join('');
  }
  if(paras.length <= 1){
    var p = paras[0] || {t:'', ks:[]};
    return '<div>' + esc(p.t) + '</div>' + ks(p);
  }
  return '<ol class="db-paras">' + paras.map(function(p){
    return '<li>' + esc(p.t) + ks(p) + '</li>';
  }).join('') + '</ol>';
}

function ehArticleHtml(a){
  var H = ETHIC_HIST[a.no] || null;
  var badge = '';
  if(H && H.x){
    badge = '<span class="db-badge db-eh-new">' + EH_DATE['98'] + '增訂</span>';
  }else if(H && H.h && H.h.length){
    badge = '<button type="button" class="db-badge db-eh-tgl" data-eh="' + a.no + '" aria-expanded="false" ' +
            'aria-controls="eh-h-' + a.no + '" title="展開本條之歷史條文">修正沿革 ' + H.h.length + ' &#9662;</button>';
  }
  var hist = '';
  if(H && (H.n || (H.h && H.h.length))){
    hist = '<div class="db-eh-hist" id="eh-h-' + a.no + '" hidden>';
    if(H.n) hist += '<p class="db-eh-note">' + esc(H.n) + '</p>';
    /* 由晚到早列出：頁面主體是最後一版（民國98年9月19日）條文，歷史版本接在其後，
       愈近的版本愈靠上，閱讀時才是「現行條文往回追」的順序。
       slice() 先複製再反轉，不動 ETHIC_HIST 本身（它按時間先後排列，是資料的原序）。 */
    (H.h || []).slice().reverse().forEach(function(e){
      hist += '<div class="db-eh-ver"><div class="db-eh-vh">' + EH_DATE[e.d] + '修正' +
              '<span>施行至' + EH_DATE[e.e] + '修正前</span></div>' + ehParasHtml(e.p) + '</div>';
    });
    hist += '</div>';
  }
  return '<div class="db-article db-eh-art" id="eh-art-' + a.no + '">' +
         '<h4>第' + esc(a.no) + '條' + badge + '</h4>' + ehParasHtml(a.paras) + hist + '</div>';
}

function ehTimelineHtml(){
  var h = ['<div class="db-eh-time"><b>《律師倫理規範》修正沿革</b><ol>'];
  /* 沿革總表維持編年順序（由早到晚）；只有各條的歷史版本是由晚到早 */
  EH_TIMELINE.forEach(function(r){
    h.push('<li><span class="db-eh-d">' + r[0] + '</span><span class="db-eh-c">' + r[1] +
      (r[2] ? '<span class="db-eh-here">本頁收錄</span>' : '') + '</span></li>');
  });
  h.push('</ol></div>');
  return h.join('');
}

/* 展開／收合單一條文之修正沿革 */
function ehToggle(no, open){
  var box = el('eh-h-' + no);
  var btn = document.querySelector('.db-eh-tgl[data-eh="' + no + '"]');
  if(!box) return;
  if(open === undefined) open = box.hidden;
  box.hidden = !open;
  if(btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function ehSyncAllBtn(){
  var b = el('eh-all');
  if(!b) return;
  var boxes = el('eh-body').querySelectorAll('.db-eh-hist');
  var open = 0;
  for(var i = 0; i < boxes.length; i++) if(!boxes[i].hidden) open++;
  var all = open === boxes.length && boxes.length > 0;
  b.textContent = all ? '收合全部修正沿革' : '展開全部修正沿革';
  b.setAttribute('data-open', all ? '1' : '0');
}

function initEthicHist(){
  if(ehReady) return;
  var L = DATA.laws && DATA.laws['L'];
  if(!L){
    el('eh-body').innerHTML = '<div class="db-no-result">目前無舊倫理規範條文資料。</div>';
    ehReady = true; return;
  }
  el('eh-note').innerHTML = EH_NOTE;
  el('eh-source').innerHTML = EH_SOURCE;
  el('eh-time').innerHTML = ehTimelineHtml();
  var h = [];
  if(L.preamble) h.push('<div class="db-law-preamble"><b>前言</b>　' + esc(L.preamble) + '</div>');
  /* legacy（38-原）為98年9月19日刪除前之原第38條，已列於第38條的修正沿革中，此處不重複 */
  L.articles.forEach(function(a){ if(!a.legacy) h.push(ehArticleHtml(a)); });
  el('eh-body').innerHTML = h.join('');
  el('eh-body').addEventListener('click', function(ev){
    var b = ev.target && ev.target.closest ? ev.target.closest('.db-eh-tgl') : null;
    if(!b) return;
    ehToggle(b.getAttribute('data-eh'));
    ehSyncAllBtn();
  });
  el('eh-all').addEventListener('click', function(){
    var open = el('eh-all').getAttribute('data-open') !== '1';
    var boxes = el('eh-body').querySelectorAll('.db-eh-hist');
    for(var i = 0; i < boxes.length; i++){
      boxes[i].hidden = !open;
      var no = boxes[i].id.slice(5);
      var btn = document.querySelector('.db-eh-tgl[data-eh="' + no + '"]');
      if(btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    ehSyncAllBtn();
  });
  el('eh-back').addEventListener('click', function(){
    el('tabbtn-laws').click();
    if(lawState.ready) selectLaw('E');
  });
  ehSyncAllBtn();
  ehReady = true;
}

/* 「懲戒法規」頁上的入口鈕：law-body 每次重繪都會換新元素，故以委派方式掛載 */
document.addEventListener('click', function(ev){
  var b = ev.target && ev.target.closest ? ev.target.closest('[data-goto-eh]') : null;
  if(!b) return;
  el('tabbtn-ethichist').click();
});

/* 「僅顯示曾作為懲戒依據之條文」核取方塊的擺放位置：
   倫理規範新舊對照頁移到「瀏覽舊倫理規範歷史版本」入口之下（插槽 #eh-cta-slot），
   其餘法規頁維持原位（#law-body 之前）。

   搬移的是同一個元素而非複製一份，change 事件與 lawState.usedOnly 的連動因此完全不變；
   但也正因為是同一個元素，重繪前必須先 homeUsedToggle() 把它移出 law-body，
   否則 law-body.innerHTML 一被覆寫，元素連同事件監聽就一起消失（勾一次即失效）。 */
function homeUsedToggle(){
  var t = el('law-used-toggle'), body = el('law-body');
  if(t && body && t.nextSibling !== body) body.parentNode.insertBefore(t, body);
}
function placeUsedToggle(){
  var t = el('law-used-toggle'), slot = el('eh-cta-slot');
  if(t && slot && t.parentNode !== slot) slot.appendChild(t);
}
/* 「僅顯示曾作為懲戒依據之條文」之色系：
   預設為主色（深藍，與律師法頁的藍色系一致）；倫理規範相關頁（E 新舊對照、
   L 舊倫理規範、M 新倫理規範）改掛 .db-tone-l，換成該頁的紅褐色系。
   只加／移除 class，勾選行為與 lawState.usedOnly 完全不受影響。 */
function toneUsedToggle(){
  var t = el('law-used-toggle');
  if(!t) return;
  var k = lawState.key;
  t.classList.toggle('db-tone-l', k === 'E' || k === 'L' || k === 'M');
}

function renderLawBody(){
  homeUsedToggle();   /* 先移出 law-body，避免下方重繪時被一併清掉 */
  toneUsedToggle();   /* 依目前法規頁套用色系 */
  if(lawState.key === 'F'){
    el('law-title').parentNode.style.display = '';
    el('law-note-fixed').style.display = '';
    el('law-used-toggle').style.display = '';
    el('law-title').textContent = LAW_TITLE.F;
    el('law-note-fixed').innerHTML = LAW_NOTE.F;
    el('law-source').innerHTML = LAW_SOURCE.F;
    el('law-body').innerHTML = actCompareHtml();
    placeUsedToggle();
    return;
  }
  if(lawState.key === 'E'){
    el('law-title').parentNode.style.display = '';
    el('law-note-fixed').style.display = '';
    el('law-used-toggle').style.display = '';
    el('law-title').textContent = LAW_TITLE.E;
    el('law-note-fixed').innerHTML = LAW_NOTE.E;
    el('law-source').innerHTML = LAW_SOURCE.E;
    el('law-body').innerHTML = ethicCompareHtml();
    placeUsedToggle();
    return;
  }
  if(lawState.key === 'X'){
    /* 第一部（法律扶助法）之標題改寫進靜態的 #law-title／#law-source，
       與另兩個頁籤共用同一個 .db-law-title-wrap 節點、同一個位置，
       如此「按鈕列 → 法條標題」的距離在任何環境（含 CMS）下必然一致；
       其餘各部之標題才由 #law-body 產生。 */
    var first = LAW_OTHERS[0];
    el('law-title').parentNode.style.display = '';
    el('law-note-fixed').style.display = 'none';
    el('law-used-toggle').style.display = 'none';
    el('law-title').innerHTML = esc(first.title) + otherBadge(first);
    el('law-source').innerHTML = first.src;
    var hx = [];
    if(first.body) hx.push('<div style="margin:0 0 26px">'+first.body+'</div>');
    LAW_OTHERS.slice(1).forEach(function(o){
      /* id 供錨點 #laws/others/<k> 定位；第一部的標題在靜態的 #law-title 內，
         由 otherAnchorEl() 另行處理，故此處只有第二部以後有 id。 */
      hx.push('<div class="db-law-title-wrap" id="lawother-'+o.k+'"><h2 class="db-law-title">'+esc(o.title)+otherBadge(o)+'</h2><p class="db-law-source">'+o.src+'</p></div>');
      if(o.body) hx.push('<div style="margin:0 0 26px">'+o.body+'</div>');
    });
    el('law-body').innerHTML = hx.join('');
    placeUsedToggle();
    return;
  }
  el('law-title').parentNode.style.display = '';
  el('law-note-fixed').style.display = '';
  el('law-used-toggle').style.display = '';
  var law = DATA.laws[lawState.key];
  el('law-title').textContent = LAW_TITLE[lawState.key] || '';
  el('law-note-fixed').innerHTML = LAW_NOTE[lawState.key] || '';
  el('law-source').innerHTML = LAW_SOURCE[lawState.key] || '';
  var arts = law.articles.filter(function(a){ return lawState.usedOnly ? a.used : true; });
  var h = [];
  if(law.preamble){
    h.push('<div class="db-law-preamble"><b>前言</b>　'+esc(law.preamble)+'</div>');
  }
  if(!arts.length){
    h.push('<div class="db-no-result">此法規無曾作為懲戒依據之條文。</div>');
  }else{
    arts.forEach(function(a){ h.push(articleHtml(lawState.key, a)); });
  }
  el('law-body').innerHTML = h.join('');
  placeUsedToggle();
}

function selectLaw(key){
  lawState.key = key;
  el('lawsel').querySelectorAll('button').forEach(function(b){
    b.classList.toggle('db-cur', b.getAttribute('data-k')===key);
  });
  renderLawBody();
}

function initLaws(){
  if(!DATA.laws){
    el('law-body').innerHTML = '<div class="db-no-result">目前無法規全文資料。</div>';
    lawState.ready = true; return;
  }
  var h = [];
  if(DATA.laws['J'] && DATA.laws['K']){
    h.push('<button type="button" class="db-lf" data-k="F">《律師法》'+
      '<span style="opacity:.7;font-weight:400">新法'+DATA.laws['K'].articles.length+'條・舊法'+DATA.laws['J'].articles.length+'條</span></button>');
  }
  if(DATA.laws['L'] && DATA.laws['M']){
    h.push('<button type="button" class="db-le" data-k="E">《律師倫理規範》'+
      '<span style="opacity:.7;font-weight:400">新法'+DATA.laws['M'].articles.length+'條・舊法'+
      DATA.laws['L'].articles.filter(function(a){ return !a.legacy; }).length+'條</span></button>');
  }
  h.push('<button type="button" class="db-lx" data-k="X">其它<span style="opacity:.7;font-weight:400">其他相關規範共'+LAW_OTHERS.length+'部</span></button>');
  el('lawsel').innerHTML = h.join('');
  el('lawsel').querySelectorAll('button').forEach(function(b){
    b.addEventListener('click', function(){
      var lp = el('tab-laws');
      if(lp) lp.classList.remove('db-no-entry');   /* 使用者自行切換法規頁 → 恢復進場動畫 */
      LAW_TARGET = null;                           /* 換了法典，原本的條文定位不再適用 */
      selectLaw(b.getAttribute('data-k'));
      routePush();
    });
  });
  el('law-used-only').addEventListener('change', function(){
    lawState.usedOnly = el('law-used-only').checked;
    renderLawBody();
    routeReplace();
  });
  lawState.ready = true;
  selectLaw('F');
}

/* ---------- 條文對話框 ---------- */
/* 條項文字中「本文／但書／前段／後段」的分界：
   　本文｜但書 以第一個「但」為界（但字起算歸但書）；
   　前段｜後段 以第一個「；」為界（分號為分隔符號，兩段皆不含）。
   回傳 [起, 迄)；找不到分界字時回 null，此時整項不反白（寧可不標，不亂標）。
   現行資料中會用到的六種組合（J11Ⅰ前段、J21Ⅰ本文／但書、K36本文、L32Ⅰ本文、
   M37Ⅰ本文）皆已逐條核對，第一個「但」「；」即為正確分界。 */
function segRange(t, seg){
  var i;
  if(seg === '本文' || seg === '但書'){
    i = t.indexOf('但');
    if(i < 0) return null;
    return (seg === '本文') ? [0, i] : [i, t.length];
  }
  if(seg === '前段' || seg === '後段'){
    i = t.indexOf('；');
    if(i < 0) return null;
    return (seg === '前段') ? [0, i] : [i+1, t.length];
  }
  return null;
}
/* 產生單一項的內文 HTML；hlKs 為需標示之款號陣列（同時標示該項序文，即「：」以前之文字）；
   seg 為「本文／但書／前段／後段」，只反白該部分（與 hlKs 互斥，同時指定時以 hlKs 為準）。 */
/* tail（選填）：接在「項」文字之後、「款」之前的附加 HTML（目前用於
   「限於情節重大」標籤，位置須與懲戒法規頁的 articleHtml 一致）。 */
function paraInnerHtml(p, hlKs, seg, tail){
  var tHtml;
  if(hlKs && hlKs.length){
    var t = p.t || '';
    var ci = t.indexOf('：');
    tHtml = ci >= 0
      ? '<span class="db-hl-t">'+esc(t.slice(0,ci))+'</span>'+esc(t.slice(ci))
      : '<span class="db-hl-t">'+esc(t)+'</span>';
  }else if(seg){
    var t2 = p.t || '', r = segRange(t2, seg);
    tHtml = r
      ? esc(t2.slice(0, r[0])) + '<span class="db-hl-t">'+esc(t2.slice(r[0], r[1]))+'</span>' + esc(t2.slice(r[1]))
      : esc(t2);
  }else{
    tHtml = esc(p.t);
  }
  return tHtml + (tail || '') + (p.ks||[]).map(function(k, ki){
    var on = hlKs && hlKs.indexOf(ki+1) >= 0;
    return '<div class="db-kuan'+(on?' db-hl':'')+'">'+esc(k)+'</div>';
  }).join('');
}

/* seg 為選填且置於最末，未傳者不做本文／但書的部分反白 */
function openLaw(key, artNo, xiang, ks, anchor, seg){
  if(!(DATA.laws && DATA.laws[key])) return;
  var law = DATA.laws[key];
  var a = null;
  for(var i=0;i<law.articles.length;i++){ if(law.articles[i].no===String(artNo)){ a=law.articles[i]; break; } }
  if(!a) return;
  var ksArr = ks ? String(ks).split(',').map(function(n){ return parseInt(n,10); }).filter(function(n){ return n>0; }) : null;
  if(ksArr && !ksArr.length) ksArr = null;
  /* 指名了本文／但書／前段／後段時，只反白該部分，不再整項套底色 */
  var segHl = /^(本文|但書|前段|後段)$/.test(seg||'') ? seg : '';
  /* 「限於情節重大」標籤：名單與懲戒法規頁共用 SEVERE_ONLY，
     undefined＝本條無標籤；0＝整條；n＝限於第 n 項（與 articleHtml 同一套判讀）。 */
  var sev = (SEVERE_ONLY[key] || {})[a.no];
  var head = a.tag || ('第'+String(artNo)+'條');
  el('modal-title').innerHTML = lawTagGoto(key, lawFullName(key)+head, a.no) +
    '<span class="db-m-title">'+esc(lawTitleVer(law.title))+'</span>';
  var body;
  if(a.deleted){
    body = '<div>（本條刪除）</div>';
  }else if(a.paras.length <= 1){
    var p = a.paras[0] || {t:'',ks:[]};
    /* 只有一項者，「整條」與「限於第1項」是同一件事，兩種寫法都標在這裡 */
    body = '<div>'+paraInnerHtml(p, ksArr, segHl, sev === undefined ? '' : severeTagHtml('條'))+'</div>';
  }else{
    body = '<ol class="db-paras">'+a.paras.map(function(p, i){
      var isX = xiang && String(i+1)===String(xiang);
      /* 有指定款時：款所屬之項為指定項；未指定項則視為第 1 項 */
      var kHere = ksArr && ((xiang && isX) || (!xiang && i===0)) ? ksArr : null;
      /* 本文／但書等亦比照款的認定：指定項者標該項，未指定項者標第 1 項 */
      var sHere = segHl && ((xiang && isX) || (!xiang && i===0)) ? segHl : '';
      var hl = (isX && !ksArr && !segHl) ? ' class="db-hl"' : '';
      /* 限於某一項者標在該項句末（款之前）；整條者不掛在任何一項上，另起一行 */
      return '<li'+hl+'>'+paraInnerHtml(p, kHere, sHere, sev === i + 1 ? severeTagHtml('項') : '')+'</li>';
    }).join('')+'</ol>';
    if(sev === 0) body += '<div class="db-sev-row">'+severeTagHtml('條')+'</div>';
  }
  /* 卡片下方動作列：左為本條的案件檢索，右接本條在對照表中對應的違失態樣。
     ．開啟時若指名了項、款或本文／但書，即以同一套條文比對規則收斂到該項款所屬
       之態樣（自案件清單的條文標籤開啟者屬此）；未指名者（＝自「懲戒法規」頁整條
       開啟）則列出全部相關態樣，故同一條可能並列多顆（例：舊倫理規範第16條）。
     ．順序同「違失態樣」頁（件數多→少）；點擊行為與備註欄、註記卡一致（gotoPattern）。
     ．對照表未收錄本條者不生按鈕，只留原本的案件檢索鈕。 */
  var pids = patIdsOfProvs(key, provsOfParts(a.no, xiang, ksArr, segHl));
  var acts = pids.map(function(pid){
    var pp = PATTERN_BY_ID[pid];
    return pp ? '<button type="button" data-pattern-id="'+esc(pid)+
      '" class="db-m-jump db-m-jump-p" title="前往「違失態樣」頁檢視本態樣之案件">檢視「'+
      esc(pp.name)+'」之案件 →</button>' : '';
  }).join('');
  var jump = a.used
    ? '<button type="button" class="db-m-jump" data-jump="'+key+'|'+a.no+'">檢視引用本條之案件 →</button>'
    : '';
  var foot = (jump || acts) ? '<p class="db-m-acts db-m-acts-law">'+jump+acts+'</p>' : '';
  if(!a.used) foot += '<p class="db-m-note">※ 此條未曾作為本資料庫案件之懲戒依據。</p>';
  el('modal-body').innerHTML = body + foot;
  var pop = el('law-pop');
  pop.removeAttribute('hidden');
  el('modal-body').scrollTop = 0;
  /* 將卡片定位在被點擊的條文按鈕下方（相對於 .db-wrap 容器，非瀏覽器視窗） */
  if(anchor && anchor.getBoundingClientRect){
    var host = pop.offsetParent || document.body;
    var hr = host.getBoundingClientRect(), br = anchor.getBoundingClientRect();
    pop.style.top = (br.bottom - hr.top + 8) + 'px';
    var left = br.left - hr.left;
    var maxLeft = host.clientWidth - pop.offsetWidth - 4;
    pop.style.left = Math.max(4, Math.min(left, maxLeft)) + 'px';
  }else{
    pop.style.top = '80px'; pop.style.left = '4px';
  }
  if(pop.scrollIntoView) pop.scrollIntoView({behavior:'smooth', block:'nearest'});
  el('modal-close').focus();
}
function closeLaw(){ el('law-pop').setAttribute('hidden',''); }

/* ---------- 條文對話框 →「懲戒法規」頁之對應條文 ----------------------
   J／K → 律師法新舊對照（F）；L／M → 倫理規範新舊對照（E）；N／O → 其它（X）。
   目標節點的 id 由 articleHtml() 產生，格式 art-<法典鍵>-<條號>，兩者須一致。
   頁籤切換沿用既有的 tabbtn-laws 點擊流程（initLaws 等一併帶到），
   只以 SUPPRESS_TAB_SCROLL 暫停它的捲動，避免與下面的定位互相拉扯。 */
/* 條文定位：每一條文都由 articleHtml() 直接產生自己的 .db-art-anchor。
   跳轉時不使用 scrollIntoView()，因為對照表外層為 overflow 容器，而 jrf.org.tw
   宿主樣式也可能改變可捲動祖先；scrollIntoView() 可能因此捲錯容器。
   本頁直接取得錨點的文件座標，再用 scrollToInstant() 捲動 window。 */
/* [CMS] 取條文節點：若把整段內容重複貼上（同一 id 出現兩次），getElementById
   只會回傳文件中的第一個，而使用者看到的可能是第二個——捲動因此「數字正確、
   畫面卻不對」。這裡改為取所有同 id 節點中「實際有排版」的那一個。 */
function findArticleEl(id){
  var list = document.querySelectorAll ? document.querySelectorAll('[id="' + id + '"]') : null;
  if(!list || !list.length) return el(id);
  for(var i = 0; i < list.length; i++) if(list[i].offsetParent !== null) return list[i];
  return list[0];
}

/* [JRF] 法條金框：完全獨立於 .db-article／對照表盒模型。
   為避免宿主網站的 outline、animation、overflow 規則介入：
   1. overlay 直接掛在 document.body，position:fixed，不進入對照表 DOM；
   2. 重要樣式全部用 inline !important；
   3. 不使用 CSS animation，透明度由 requestAnimationFrame 手動更新；
   4. 每一影格重新量測目標條文的「可見內容矩形」（排除 .db-art-anchor），
      定位錨點因此不會把金框上緣往頁首方向拉高；
   5. 使用者在 3.2 秒內捲動或版面微調時，金框仍會持續跟著條文。 */
var ART_FLASH_NODE = null;
var ART_FLASH_RAF = 0;
var ART_FLASH_TIMER = 0;
var ART_FLASH_TOKEN = 0;

function clearArticleFlash(){
  ART_FLASH_TOKEN++;
  if(ART_FLASH_TIMER){
    clearTimeout(ART_FLASH_TIMER);
    ART_FLASH_TIMER = 0;
  }
  if(ART_FLASH_RAF){
    (window.cancelAnimationFrame || clearTimeout)(ART_FLASH_RAF);
    ART_FLASH_RAF = 0;
  }
  if(ART_FLASH_NODE && ART_FLASH_NODE.parentNode){
    ART_FLASH_NODE.parentNode.removeChild(ART_FLASH_NODE);
  }
  ART_FLASH_NODE = null;
}

/* 金框的「視覺矩形」不能直接使用 .db-article.getBoundingClientRect()：
   .db-art-anchor 的負 margin 在無 padding/border 的對照表 article 中可能參與
   margin collapse，使 article 的 bounding rect 上緣高於真正可見的條文內容。
   這不影響捲動定位，卻會讓金框向上延伸。
   解法：
   ．左右仍使用 .db-article 本身的 left / width，維持整欄寬的強調框；
   ．上下改取直接子元素中「排除 .db-art-anchor」後的可見內容聯集；
   ．若未取得有效子內容，才退回 article 自身矩形。 */
function articleFlashRect(t){
  var base = t.getBoundingClientRect();
  var top = Infinity, bottom = -Infinity;
  var kids = t.children || [];
  for(var i = 0; i < kids.length; i++){
    var c = kids[i];
    if(c.classList && c.classList.contains('db-art-anchor')) continue;
    if(!c.getBoundingClientRect) continue;
    var r = c.getBoundingClientRect();
    if(!(r.width > 0) || !(r.height > 0)) continue;
    if(r.top < top) top = r.top;
    if(r.bottom > bottom) bottom = r.bottom;
  }

  if(top !== Infinity && bottom > top){
    var pt = 0, pb = 0;
    if(window.getComputedStyle){
      var cs = window.getComputedStyle(t);
      pt = parseFloat(cs.paddingTop) || 0;
      pb = parseFloat(cs.paddingBottom) || 0;
    }
    top -= pt;
    bottom += pb;
    return {
      left: base.left,
      top: top,
      width: base.width,
      height: bottom - top
    };
  }
  return base;
}

function showArticleFlash(t){
  clearArticleFlash();
  if(!t || !document.body || !t.getBoundingClientRect) return;

  var node = document.createElement('span');
  node.className = 'db-art-flash-layer';
  node.setAttribute('aria-hidden', 'true');

  /* all:initial 先清掉宿主對 span 的通用樣式；後續每一項再以 inline !important 指定。 */
  var s = node.style;
  s.setProperty('all', 'initial', 'important');
  s.setProperty('position', 'fixed', 'important');
  s.setProperty('display', 'block', 'important');
  s.setProperty('box-sizing', 'border-box', 'important');
  s.setProperty('margin', '0', 'important');
  s.setProperty('padding', '0', 'important');
  s.setProperty('border', '3px solid #C9A96A', 'important');
  s.setProperty('border-radius', '4px', 'important');
  s.setProperty('background', 'transparent', 'important');
  s.setProperty('pointer-events', 'none', 'important');
  s.setProperty('z-index', '2147483646', 'important');
  s.setProperty('visibility', 'visible', 'important');
  s.setProperty('transform', 'none', 'important');
  s.setProperty('filter', 'none', 'important');
  s.setProperty('clip', 'auto', 'important');
  s.setProperty('clip-path', 'none', 'important');
  s.setProperty('overflow', 'visible', 'important');
  s.setProperty('opacity', '0', 'important');

  document.body.appendChild(node);
  ART_FLASH_NODE = node;

  var token = ++ART_FLASH_TOKEN;
  var start = null;
  var duration = 3200;
  var gap = 6;
  var raf = window.requestAnimationFrame || function(fn){
    return setTimeout(function(){ fn(Date.now()); }, 16);
  };

  function ease01(x){
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  }

  function frame(now){
    if(token !== ART_FLASH_TOKEN || ART_FLASH_NODE !== node || !node.parentNode) return;
    if(!document.documentElement.contains(t)){
      clearArticleFlash();
      return;
    }
    if(start === null) start = now;
    var elapsed = Math.max(0, now - start);
    var p = Math.min(1, elapsed / duration);

    var r = articleFlashRect(t);
    if(!(r.width > 0) || !(r.height > 0)){
      clearArticleFlash();
      return;
    }

    s.setProperty('left', Math.round(r.left - gap) + 'px', 'important');
    s.setProperty('top', Math.round(r.top - gap) + 'px', 'important');
    s.setProperty('width', Math.round(r.width + gap * 2) + 'px', 'important');
    s.setProperty('height', Math.round(r.height + gap * 2) + 'px', 'important');

    var opacity;
    if(p < .20) opacity = ease01(p / .20);
    else if(p <= .62) opacity = 1;
    else opacity = 1 - ease01((p - .62) / .38);
    s.setProperty('opacity', String(Math.max(0, Math.min(1, opacity))), 'important');

    if(p < 1){
      ART_FLASH_RAF = raf(frame);
    }else{
      clearArticleFlash();
    }
  }

  ART_FLASH_RAF = raf(frame);
}

function scheduleArticleFlash(t){
  if(ART_FLASH_TIMER) clearTimeout(ART_FLASH_TIMER);
  ART_FLASH_TIMER = setTimeout(function(){
    ART_FLASH_TIMER = 0;
    showArticleFlash(t);
  }, 300);
}

function gotoLawArticle(key, artNo){
  var tab = LAW_TAB_OF[key];
  if(!tab) return;
  closeLaw();
  /* 暫停進場動畫（見樣式表 .db-no-entry 之註解），須在面板顯示之前掛上 */
  var panel = el('tab-laws');
  if(panel) panel.classList.add('db-no-entry');
  /* 直接切換頁籤，不觸發 tabbtn 的 click 事件——click 會啟動頁籤面板的滑入動畫
     造成「條號先被頁首吃掉一截、再跳下來」。關閉系統動畫時看不到此現象，
     正是因為那個動畫沒有播放。作法與 gotoFilter 相同。 */
  tabs.forEach(function(o){
    var cur = o.btn === el('tabbtn-laws');
    o.btn.setAttribute('aria-selected', cur ? 'true' : 'false');
    o.panel.hidden = !cur;
  });
  if(!lawState.ready) initLaws();
  selectLaw(tab);
  var t = findArticleEl('art-' + key + '-' + artNo);
  if(!t) return;
  var an = t.querySelector ? t.querySelector('.db-art-anchor') : null;
  if(!an) return;
  /* 標準定位流程：同步 --sticky-h → 只讀錨點自身的文件座標 → scrollToInstant。
     不自行扣頁首高度、不用 scrollIntoView，理由見 CSS 的「捲動定位錨點：全檔通則」。 */
  LAW_TARGET = {tab: LAW_TAB_KEY[tab] || '', token: key.toLowerCase() + artNo};
  routePush();
  syncStickyH();
  var y = an.getBoundingClientRect().top + window.pageYOffset;
  scrollToInstant(window.pageXOffset || 0, Math.max(0, Math.round(y)));
  /* 金框稍後才開始，與捲動錯開；overlay 與定位錨點完全獨立。 */
  scheduleArticleFlash(t);
}

/* ---------- 其它規範速覽卡片 ----------------------------------------
   沿用 #law-pop，與條文速覽同一張卡片、同一套定位與關閉行為。
   內容三項：規範名稱、全文連結、跳至案件清單之按鈕。
   全文連結直接由 LAW_OTHERS[].src 解析而得，與「懲戒法規－其它」頁同一來源，
   改連結只需改 LAW_OTHERS 一處。 */
function otherSrcLink(o){
  var m = /href="([^"]+)"/.exec(o.src || '');
  var href = m ? safeHref(m[1].replace(/&amp;/g, '&')) : '';
  return href ? '<a class="db-m-jump" href="' + href + '" target="_blank" rel="noopener">閱讀全文 ↗</a>' : '';
}
function openOther(k, anchor){
  var o = otherByKey(k), pop = el('law-pop');
  if(!o || !pop) return;
  el('modal-title').innerHTML = '<span class="db-tag db-tag-x">' + esc(o.title) + '</span>';
  var n = (OTHER_IDX[o.k] || []).length;
  el('modal-body').innerHTML = '<p class="db-m-acts">' + otherSrcLink(o) +
    (n ? '<button type="button" class="db-m-jump" data-jumpx="' + o.k + '">檢視引用本規範之案件 →</button>' : '') +
    '</p>' +
    (n ? '' : '<p class="db-m-note">※ 本規範未曾作為本資料庫案件之懲戒依據。</p>');
  pop.removeAttribute('hidden');
  el('modal-body').scrollTop = 0;
  if(anchor && anchor.getBoundingClientRect){
    var host = pop.offsetParent || document.body;
    var hr = host.getBoundingClientRect(), br = anchor.getBoundingClientRect();
    pop.style.top = (br.bottom - hr.top + 8) + 'px';
    var left = br.left - hr.left;
    var maxLeft = host.clientWidth - pop.offsetWidth - 4;
    pop.style.left = Math.max(4, Math.min(left, maxLeft)) + 'px';
  }else{
    pop.style.top = '80px'; pop.style.left = '4px';
  }
  if(pop.scrollIntoView) pop.scrollIntoView({behavior:'smooth', block:'nearest'});
  el('modal-close').focus();
}

/* ---------- 表頭欄位說明 ----------------------------------------------
   沿用條文速覽的 #law-pop 漂浮卡片，行為與外觀一致：定位於被點擊的按鈕下方，
   可按 Esc 或卡片上的「關閉」離開。 */
/* 點擊「?」開啟的說明卡片：內文與滑鼠停留的浮字共用 HELP_TIP，只有標題另給，
   兩處才不會各寫一份而日後失步。 */
var HELP_TEXT = {
  norm: {
    title: '違反（或移送）之規範及態樣',
    body: '<p class="db-m-note">'+esc(HELP_TIP.norm)+'</p>'
  }
};
function openHelp(anchor, key){
  var d = HELP_TEXT[key], pop = el('law-pop');
  if(!d || !pop) return;
  if(el('modal-title')) el('modal-title').textContent = d.title;
  el('modal-body').innerHTML = d.body;
  pop.removeAttribute('hidden');
  el('modal-body').scrollTop = 0;
  if(anchor && anchor.getBoundingClientRect){
    var host = pop.offsetParent || document.body;
    var hr = host.getBoundingClientRect(), br = anchor.getBoundingClientRect();
    pop.style.top = (br.bottom - hr.top + 8) + 'px';
    var left = br.left - hr.left;
    var maxLeft = host.clientWidth - pop.offsetWidth - 4;
    pop.style.left = Math.max(4, Math.min(left, maxLeft)) + 'px';
  }else{
    pop.style.top = '80px'; pop.style.left = '4px';
  }
  var cb = el('modal-close');
  if(cb && cb.focus){ try{ cb.focus({preventScroll:true}); }catch(err){ cb.focus(); } }
}
/* 說明鈕的點擊處理併入下方「條文速覽」的同一個委派處理器，
   必須排在「點擊卡片以外即關閉」的判斷之前——否則同一次點擊會先開啟、再被關閉。 */
/* [CMS] 自癒防護：#modal-title 為空 span，部分編輯器儲存文章時會將其刪除，
   導致 openLaw() 存取不到元素而中斷。載入時檢查，若被刪除則自動重建。 */
if(!el('modal-title')){
  var mh = document.querySelector('#law-pop .db-modal-head');
  if(mh){
    var mt = document.createElement('span');
    mt.id = 'modal-title';
    mh.insertBefore(mt, mh.firstChild);
  }
}
/* 同理，若編輯器濾除了 hidden 屬性，載入時強制關閉卡片 */
if(el('law-pop')) closeLaw();
el('modal-close').addEventListener('click', closeLaw);
document.addEventListener('keydown', function(e){
  if(e.key === 'Escape' && el('law-pop') && !el('law-pop').hidden) closeLaw();
});
/* 事件委派：任何帶 data-law 的標籤（button 或備註欄的 span）皆可開啟漂浮卡片 */
document.addEventListener('keydown', function(e){
  if(e.key !== 'Enter' && e.key !== ' ') return;
  var s = e.target.closest ? e.target.closest('span.db-tag[data-law][role="button"]') : null;
  if(s){
    e.preventDefault();
    openLaw(s.getAttribute('data-law'), s.getAttribute('data-art'), s.getAttribute('data-x'), s.getAttribute('data-ks'), s, s.getAttribute('data-seg'));
    return;
  }
  var so = e.target.closest ? e.target.closest('span.db-tag[data-other][role="button"]') : null;
  if(so){
    e.preventDefault();
    openOther(so.getAttribute('data-other'), so);
    return;
  }
  /* 備註欄的態樣連結（span，非 button）須自行處理 Enter／Space */
  var sp = e.target.closest ? e.target.closest('span[data-pattern-id][role="button"]') : null;
  if(sp){
    e.preventDefault();
    gotoPattern(sp.getAttribute('data-pattern-id'));
  }
});
document.addEventListener('click', function(e){
  /* 對話框標題上的法典標籤 → 懲戒法規頁之該條。
     本身不帶 data-law，不會誤入下方的條文速覽分支。 */
  var ga = e.target.closest ? e.target.closest('[data-goto-art]') : null;
  if(ga){
    var gp = ga.getAttribute('data-goto-art').split('|');
    gotoLawArticle(gp[0], gp[1]);
    return;
  }
  var b = e.target.closest ? e.target.closest('.db-tag[data-law]') : null;
  if(b){
    openLaw(b.getAttribute('data-law'), b.getAttribute('data-art'), b.getAttribute('data-x'), b.getAttribute('data-ks'), b, b.getAttribute('data-seg'));
    return;
  }
  /* 其它規範標籤（違反或移送之規範欄、備註欄）→ 規範速覽卡片。
     須早於下方的 data-jumpx，否則卡片內的「檢視引用本規範之案件」按鈕
     與標籤本身會走同一條分支。 */
  var bo = e.target.closest ? e.target.closest('.db-tag[data-other]') : null;
  if(bo){
    openOther(bo.getAttribute('data-other'), bo);
    return;
  }
  /* 表頭欄位說明鈕（須早於下方的「點擊卡片以外即關閉」） */
  var hp = e.target.closest ? e.target.closest('.db-th-help') : null;
  if(hp){
    e.preventDefault();
    openHelp(hp, hp.getAttribute('data-help'));
    return;
  }
  var jx = e.target.closest ? e.target.closest('[data-jumpx]') : null;
  if(jx){
    gotoOther(jx.getAttribute('data-jumpx'));
    return;
  }
  var j = e.target.closest ? e.target.closest('[data-jump]') : null;
  if(j){
    var pair = j.getAttribute('data-jump').split('|');
    gotoFilter(pair[0], pair[1]);
    return;
  }
  /* 態樣名稱 → 跳至違失態樣頁。來源有四：懲戒法規頁註記卡內的 button、法條卡片
     動作列的按鈕、態樣欄的紫色標籤，以及備註欄中由 patLinkify 產生的 span
     （欄寬窄，須可跨行故不用 button）。一律只認 data-pattern-id，不綁外觀類別。 */
  var pb = e.target.closest ? e.target.closest('[data-pattern-id]') : null;
  if(pb){
    /* data-subcat-sel（逗號分隔的子類 id）：跳轉後一併勾選該態樣的這幾列。
       目前只有申訴救濟頁的民眾入口會帶此屬性；未帶者一律維持原行為。 */
    var ssel = pb.getAttribute('data-subcat-sel');
    gotoPattern(pb.getAttribute('data-pattern-id'), ssel ? ssel.split(',') : undefined);
    return;
  }
  /* 點擊卡片以外的任何地方即關閉 */
  var pop = el('law-pop');
  if(pop && !pop.hidden && !pop.contains(e.target)) closeLaw();
});

/* [JS-STATS] 統計 */
/* ---------- 頁籤四：統計 ---------- */
var statsReady = false;
/* 統計純資料集中於 content-meta.json；欄位規則、圖表 renderer 與互動留在本區。 */
var STATS_DATA = CONTENT_META.stats;
var STATS_YEARS = STATS_DATA.years;
var STATS_ROWS = STATS_DATA.rows;
var LAWYER_YEARS = STATS_DATA.lawyerYears;
var LAWYER = STATS_DATA.lawyer;
/* 資料來源分兩段，性質不同，勿混用：
   民國94–99年（2005–2010）法務部無統計，改由本資料庫 #db 之 cases 自行推導——
     有覆審者以覆審日之年度計、無覆審者以原決議日之年度計，結果依覆審後之最終決議歸類；
     舊法「不付懲戒」與新法「不予懲戒」合併計入「不予懲戒」欄；
     本資料庫無性別欄位，故各欄數值一律填入「男」位（偶數索引），「女」位補 0，
     畫面僅顯示男＋女之和，不影響任何呈現。
   民國100–109年（2011–2020）依法務部統計處提供之「律師懲戒人數」表填載（含男女分項）。 */



function statsCell(v, cls){
  function td(list, inner){
    var c = list.filter(function(x){ return x; }).join(' ');
    return '<td'+(c ? ' class="'+c+'"' : '')+'>'+inner+'</td>';
  }
  if(v==null)   return td(['db-na', cls], '');
  if(v==='-')   return td(['db-dash', cls], '-');
  return td([v===0?'db-z':'', cls], v);
}

/* ---------- 統計表欄位定義 ----------
   欄位順序：總計 →【懲戒：由重至輕（除名…研習）】→ 不予懲戒 → 免議 → 不受理 →【暫時停職：予／不予】
   idx    ：STATS_ROWS 之欄位索引；多個索引相加＝男、女合計（暫時停職僅單一欄）
   grp    ：同一 grp 之相鄰欄位於表頭第一列合併為群組標題
   color  ：類別色標，與下方（三）圓餅圖之顏色一一對應，便於兩者對讀
   pre    ：民國109年（含）以前不存在之處分類型，該年度顯示「-」
   sep    ：於本欄左側加分組粗線
   ------------------------------------ */
var STATS_GRP = {punish:'懲戒', suspend:'暫時停職'};
var STATS_COLS = [
  {label:'總計',                  idx:[0,1]},
  /* 懲戒（重 → 輕）；色階沿用圓餅圖：除名紅、停職橙、申誡黃、警告綠、研習藍 */
  {label:'除名',                  idx:[24,25], grp:'punish', color:'#8E1F33', sep:true},
  {label:'停止執行<br>職務併研習', idx:[22,23], grp:'punish', color:'#B73C5A', pre:true},
  {label:'停止<br>執行職務',      idx:[20,21], grp:'punish', color:'#B73C5A'},
  {label:'申誡<br>併研習',        idx:[18,19], grp:'punish', color:'#C98A3E', pre:true},
  {label:'申誡',                  idx:[16,17], grp:'punish', color:'#C98A3E'},
  {label:'警告<br>併研習',        idx:[14,15], grp:'punish', color:'#5E8C6A', pre:true},
  {label:'警告',                  idx:[12,13], grp:'punish', color:'#5E8C6A'},
  {label:'研習',                  idx:[10,11], grp:'punish', color:'#3D7A96', pre:true},
  /* 以下為未受懲戒處分之決議類型：不著色階，僅以分組線與淺灰色標區隔 */
  {label:'不予懲戒',              idx:[4,5],   color:'#9A948E', sep:true},
  {label:'免議',                  idx:[8,9],   sep:true},
  {label:'不受理',                idx:[6,7],   sep:true},
  {label:'予',                    idx:[2],     grp:'suspend', sep:true, pre:true},
  {label:'不予',                  idx:[3],     grp:'suspend', pre:true}
];

/* 由十六進位色碼取得半透明版本，用於表頭淺色底 */
function tint(hex, a){
  var n = parseInt(hex.slice(1), 16);
  return 'rgba('+((n>>16)&255)+','+((n>>8)&255)+','+(n&255)+','+a+')';
}

function renderStatsTable(){
  /* 各欄之年度數值；無資料年度為 null，修法前不存在之類型為 '-' */
  function cellVal(c, y){
    var r = STATS_ROWS[y];
    if(!r) return null;
    if(c.pre && (y-1911) <= 109) return '-';
    var t = 0;
    c.idx.forEach(function(i){ t += r[i]; });
    return t;
  }
  function cls(c){ return c.sep ? 'db-gsep' : ''; }
  /* 表頭儲存格：有 color 者於下緣加類別色條並鋪淺色底 */
  function thAttr(c){
    var list = [cls(c), c.color ? 'db-ckey' : ''].filter(function(x){ return x; });
    var a = list.length ? ' class="'+list.join(' ')+'"' : '';
    if(c.color) a += ' style="border-bottom-color:'+c.color+';background:'+tint(c.color, .10)+'"';
    return a;
  }

  var r1 = ['<tr><th rowspan="2">項目別</th>'], r2 = [];
  var i = 0;
  while(i < STATS_COLS.length){
    var c = STATS_COLS[i];
    if(c.grp){
      var j = i;
      while(j+1 < STATS_COLS.length && STATS_COLS[j+1].grp === c.grp) j++;
      var ghc = cls(c);
      r1.push('<th colspan="'+(j-i+1)+'"'+(ghc?' class="'+ghc+'"':'')+'>'+STATS_GRP[c.grp]+'</th>');
      for(var k=i; k<=j; k++){
        var sc = STATS_COLS[k];
        r2.push('<th'+thAttr(sc)+'>'+sc.label+'</th>');
      }
      i = j+1;
    }else{
      r1.push('<th rowspan="2"'+thAttr(c)+'>'+c.label+'</th>');
      i++;
    }
  }

  var h = ['<table class="db-stats-table"><thead>', r1.join('')+'</tr>', '<tr>'+r2.join('')+'</tr></thead><tbody>'];
  var totals = STATS_COLS.map(function(){ return 0; });
  STATS_YEARS.forEach(function(y){
    var row = ['<tr><th>'+(y-1911)+'年</th>'];
    STATS_COLS.forEach(function(c, n){
      var v = cellVal(c, y);
      if(typeof v === 'number') totals[n] += v;
      row.push(statsCell(v, cls(c)));
    });
    h.push(row.join('')+'</tr>');
  });
  h.push('<tr class="db-sum"><th>總計</th>'+
    STATS_COLS.map(function(c, n){ return statsCell(totals[n], cls(c)); }).join('')+'</tr>');
  h.push('</tbody></table>');
  el('stats-table').innerHTML = h.join('');
}

function svgLineChart(boxId, legendId, series, xLabels){
  var labels = xLabels || STATS_YEARS.map(function(y){ return String(y-1911); });
  var W=720, H=310, R=16, T=20, B=34, n=labels.length;
  var maxV = 1;
  series.forEach(function(s){ s.vals.forEach(function(v){ if(v!=null && v>maxV) maxV=v; }); });
  /* 自動選擇友善刻度 */
  var raw = maxV/5, pw = Math.pow(10, Math.floor(Math.log(raw)/Math.LN10)), nn = raw/pw;
  var step = (nn<=1?1 : nn<=2?2 : nn<=5?5 : 10)*pw;
  var yMax = Math.ceil(maxV/step)*step; if(yMax===maxV) yMax += step;
  var fmt = numFmt;   /* 千分位：共用實作，見檔案上方 numFmt */
  /* 左側留白依 Y 軸最大刻度之字寬自動縮放（數字約 6.3px、逗號約 3.2px），
     小數值圖表左側不再留過多空白 */
  var yl = fmt(yMax), yd = yl.replace(/,/g,'').length;
  var L = Math.round(12 + yd*6.3 + (yl.length-yd)*3.2);
  function X(i){ return L + (W-L-R)*i/(n-1); }
  function Y(v){ return T + (H-T-B)*(1 - v/yMax); }
  var s = ['<svg class="db-chart-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img">'];
  for(var g=0; g<=yMax; g+=step){
    var gy = Y(g);
    s.push('<line x1="'+L+'" y1="'+gy+'" x2="'+(W-R)+'" y2="'+gy+'" stroke="'+(g===0?'#A8A29C':'#EDEAE7')+'" stroke-width="1"/>');
    s.push('<text x="'+(L-8)+'" y="'+(gy+4)+'" text-anchor="end" font-size="11" fill="#5a646e">'+fmt(g)+'</text>');
  }
  var lf = n>10 ? 10.5 : 12;
  labels.forEach(function(lb,i){
    s.push('<text x="'+X(i)+'" y="'+(H-B+20)+'" text-anchor="middle" font-size="'+lf+'" fill="#40484f">'+lb+'</text>');
  });
  /* 折線：缺值處斷線不補 */
  series.forEach(function(sr){
    var seg = [];
    function flush(){
      if(seg.length>=2) s.push('<polyline points="'+seg.join(' ')+'" fill="none" stroke="'+sr.color+'" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"'+(sr.dash?' stroke-dasharray="6 4"':'')+'/>');
      seg = [];
    }
    sr.vals.forEach(function(v,i){
      if(v==null){ flush(); } else { seg.push(X(i)+','+Y(v)); }
    });
    flush();
  });
  /* 資料點：懸停顯示數值（貼近左右邊緣之標籤改變錨點，避免被圖框切掉） */
  series.forEach(function(sr){
    sr.vals.forEach(function(v,i){
      if(v==null) return;
      var x=X(i), y=Y(v), ty=(y<T+18? y+20 : y-10);
      var ta='middle', tx=x;
      if(x > W-R-26){ ta='end'; tx=x+8; }
      else if(x < L+26){ ta='start'; tx=x-8; }
      s.push('<g class="db-pt"><circle cx="'+x+'" cy="'+y+'" r="10" fill="transparent"/>'+
        '<circle cx="'+x+'" cy="'+y+'" r="3.6" fill="#fff" stroke="'+sr.color+'" stroke-width="2"/>'+
        '<text x="'+tx+'" y="'+ty+'" text-anchor="'+ta+'" fill="'+sr.color+'">'+fmt(v)+'</text>'+
        '<title>'+labels[i]+'年 '+sr.name+'：'+fmt(v)+'人</title></g>');
    });
  });
  s.push('</svg>');
  el(boxId).innerHTML = s.join('');
  el(legendId).innerHTML = series.map(function(sr){
    return '<span><i style="background:'+sr.color+'"></i>'+sr.name+'</span>';
  }).join('');
}

/* 圓餅圖：items 為 [{name, color, value}]；逐一計算切片在標籤半徑處的可用寬度，
   足以容納「類型＋百分比」兩行文字者，標籤留在圖內（白字置中）；
   實際計算後仍容不下（如過小切片）才改置圖外並以指線連接，避免直接把所有標籤都移到圖外。
   圖中標籤省略類型名稱中的括號說明（完整名稱仍保留於圖例與滑鼠提示） */
function svgPieChart(boxId, legendId, items){
  var total = 0;
  items.forEach(function(it){ total += (it.value||0); });
  var fmt = numFmt;   /* 千分位：共用實作，見檔案上方 numFmt */
  function stripParen(s){ return String(s).replace(/[（(][^）)]*[）)]/g, '').trim(); }
  /* 粗估文字寬度：全形（中日韓）字元約佔 1 個字級寬，數字、句點、百分比符號等半形字元
     約佔 0.6 個字級寬；藉此判斷切片是否容得下圖內標籤，而非僅憑切片比例高低猜測 */
  function textW(str, fs){
    var w = 0;
    for(var i=0;i<str.length;i++){
      w += (str.charCodeAt(i) >= 0x2E80) ? fs : fs*0.6;
    }
    return w;
  }
  var W=640, H=340, cx=320, cy=170, r=160;
  var s = ['<svg class="db-chart-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img">'];
  var a0 = -Math.PI/2;
  var slices = [];
  items.forEach(function(it){
    if(!it.value || !total) return;
    var frac = it.value/total, a1 = a0 + frac*2*Math.PI;
    slices.push({it:it, a0:a0, a1:a1, am:(a0+a1)/2, frac:frac, pct:(frac*100).toFixed(1)});
    a0 = a1;
  });
  slices.forEach(function(sl){
    sl.ex = cx + r*Math.cos(sl.am);
    sl.ey = cy + r*Math.sin(sl.am);
    sl.side = Math.cos(sl.am) >= 0 ? 1 : -1;
  });
  /* 圓餅圖標籤字級與行高（放大後的兩行文字：類型／百分比） */
  var fsIn = 19, lineH = 22;
  /* 扇形之真實形心（centroid）到圓心的距離：對半角 θ，形心距 = (2R/3)*(sinθ/θ)；
     半角越大（切片越寬），形心越靠近圓心，這樣標籤才會落在切片視覺上的正中央，
     而不是不分寬窄都放在同一個固定半徑上 */
  function centroidDist(R, halfAngle){
    if(halfAngle < 1e-6) return R*2/3;
    return (2*R/3) * (Math.sin(halfAngle)/halfAngle);
  }
  /* 判斷角度是否落在 [a0,a1] 內（a0,a1 可能超過一圈，需先歸一化到同一參考圈） */
  function angleInSector(angle, a0, a1){
    var twoPi = 2*Math.PI, shifted = angle;
    while(shifted < a0 - 1e-6) shifted += twoPi;
    while(shifted > a0 + twoPi) shifted -= twoPi;
    return shifted >= a0 - 1e-6 && shifted <= a1 + 1e-6;
  }
  function pointInSector(px, py, rMax, a0, a1){
    var dx = px-cx, dy = py-cy, dist = Math.sqrt(dx*dx+dy*dy);
    if(dist > rMax) return false;
    return angleInSector(Math.atan2(dy, dx), a0, a1);
  }
  slices.forEach(function(sl){
    var it = sl.it, frac = sl.frac, pct = sl.pct;
    var x0=cx+r*Math.cos(sl.a0), y0=cy+r*Math.sin(sl.a0);
    var x1=cx+r*Math.cos(sl.a1), y1=cy+r*Math.sin(sl.a1);
    var d = frac >= 0.9999
      ? 'M'+cx+' '+(cy-r)+' A'+r+' '+r+' 0 1 1 '+(cx-0.01)+' '+(cy-r)+' Z'
      : 'M'+cx+' '+cy+' L'+x0.toFixed(2)+' '+y0.toFixed(2)+
        ' A'+r+' '+r+' 0 '+(frac>0.5?1:0)+' 1 '+x1.toFixed(2)+' '+y1.toFixed(2)+' Z';
    s.push('<g class="db-pt db-slice"><path d="'+d+'" fill="'+it.color+'" stroke="#fff" stroke-width="2"/>');
    var nameTxt = stripParen(it.name), pctTxt = pct+'%';
    var halfAngle = (sl.a1-sl.a0)/2;
    var cd = centroidDist(r, halfAngle);
    var lx = cx + cd*Math.cos(sl.am), ly = cy + cd*Math.sin(sl.am);
    /* 以標籤實際文字框的四個角落，檢查是否真的落在扇形內（半徑與角度都要符合），
       而不是只比較切片在某個半徑處的開口寬度——那個寬度是垂直於角平分線量測，
       角平分線偏向水平的切片（例如指向左側）會被完全量錯方向 */
    var need = Math.max(textW(nameTxt, fsIn), textW(pctTxt, fsIn)) + 6;
    var hw = need/2, topOff = -20, botOff = 23;
    var corners = [
      [lx-hw, ly+topOff], [lx+hw, ly+topOff],
      [lx-hw, ly+botOff], [lx+hw, ly+botOff]
    ];
    var fits = corners.every(function(c){ return pointInSector(c[0], c[1], r-4, sl.a0, sl.a1); });
    if(fits){
      /* 切片夠寬：標籤留在圖內，白字置中於扇形形心（垂直方向以 ly 為中心，兩行對稱） */
      s.push('<text class="db-pie-lb-in" x="'+lx.toFixed(1)+'" y="'+(ly-5).toFixed(1)+'">'+
        '<tspan x="'+lx.toFixed(1)+'" dy="0">'+esc(nameTxt)+'</tspan>'+
        '<tspan x="'+lx.toFixed(1)+'" dy="'+lineH+'">'+pctTxt+'</tspan></text>');
    } else {
      /* 經計算仍容不下：改以指線拉到圖外標示，並以切片顏色呈現。
         指線以切片邊界點自身的高度（ey）為準，純水平拉出一小段，不加垂直位移 */
      var anchorX = sl.ex + sl.side*30;
      var anchor = sl.side===1 ? 'start' : 'end';
      s.push('<polyline class="db-pie-leader" points="'+sl.ex.toFixed(1)+','+sl.ey.toFixed(1)+' '+
        anchorX.toFixed(1)+','+sl.ey.toFixed(1)+'" stroke="'+it.color+'"/>');
      s.push('<text class="db-pie-lb-out" x="'+anchorX.toFixed(1)+'" y="'+(sl.ey+5).toFixed(1)+
        '" text-anchor="'+anchor+'" fill="'+it.color+'">'+esc(nameTxt)+' '+pctTxt+'</text>');
    }
    s.push('<title>'+it.name+'：'+fmt(it.value)+'人（'+pct+'%）</title></g>');
  });
  s.push('</svg>');
  el(boxId).innerHTML = s.join('');
  el(legendId).innerHTML = items.map(function(it){
    return '<span><i style="background:'+it.color+'"></i>'+it.name+'</span>';
  }).join('');
}

/* 本國律師人數（民國100–114年）。法務部於民國100年前無相關統計，故不收 94–99 年
   （考試及格人數該六年的數值改於備註以文字說明，使三條折線的年度範圍一致）。
   民國100–109年依法務部統計處提供之「本國律師人數」表填載。 */
/* ---------- 各類處分結果：圓餅圖資料（首頁與統計頁共用）----------------
   分類、顏色、年度區間、備註文字全部只有這一份。首頁的「近年懲戒處分結果分布」
   與統計頁「（三）各類懲戒處分結果分布」都由此產生，故兩頁永遠不會對不上。
   ※ 本資料取自法務部年度統計（STATS_ROWS），與案件清單的 658 人次不是同一個
     母體（統計為「確定案件」之人數，資料庫為逐案收錄），數字本就不會相等。 */
/* 各類處分結果：以圓餅圖呈現各類處分之合計。
   kindItems(y0, y1) 產生圓餅圖資料；未帶參數＝所有有資料年度，
   帶參數則僅計入 y0 至 y1（含首尾，西元年）之年度。
   欄位對應（每項為男、女兩欄之和）：
     4,5   不予懲戒          10,11 研習（單獨處分）
     12~15 警告＋警告併研習    16~19 申誡＋申誡併研習
     20~23 停止執行職務＋停止執行職務併研習
     24,25 除名
   ※ 資料為年度統計，故區間以「年」為單位；2020.1.1–2025.12.31 即民國109–114年。 */
function kindItems(y0, y1){
  function sum(idxs){
    var t = 0;
    STATS_YEARS.forEach(function(y){
      var r = STATS_ROWS[y];
      if(!r) return;                                   /* 該年無資料 */
      if(y0 != null && (y < y0 || y > y1)) return;      /* 不在指定區間 */
      idxs.forEach(function(i){ t += r[i]; });
    });
    return t;
  }
  return [
    {name:'不予懲戒', color:'#9A948E', value:sum([4,5])},
    {name:'研習（單獨處分）', color:'#3D7A96', value:sum([10,11])},
    {name:'警告（含併研習）', color:'#5E8C6A', value:sum([12,13,14,15])},
    {name:'申誡（含併研習）', color:'#C98A3E', value:sum([16,17,18,19])},
    {name:'停止執行職務（含併研習）', color:'#B73C5A', value:sum([20,21,22,23])},
    {name:'除名', color:'#8E1F33', value:sum([24,25])}
  ];
}
/* 年度區間切換：同一張圓餅圖依選取區間重繪（分類、顏色完全相同，僅計入年度不同） */
var PIE_RANGES = {
  all:    {y0:null, y1:null},   /* 全部有資料年度 */
  recent: {y0:2020, y1:2025}    /* 2020.1.1–2025.12.31＝民國109–114年 */
};
/* 將有資料年度壓縮成民國年區間文字，如「100–105年、108–114年」；
   資料新增年度後備註會自動跟著更新，毋須手改 */
function rocRangeText(y0, y1){
  var ys = STATS_YEARS.filter(function(y){
    return STATS_ROWS[y] && (y0 == null || (y >= y0 && y <= y1));
  }).map(function(y){ return y - 1911; });
  var out = [], i = 0;
  while(i < ys.length){
    var j = i;
    while(j + 1 < ys.length && ys[j+1] === ys[j] + 1) j++;
    out.push(i === j ? ys[i] + '年' : ys[i] + '–' + ys[j] + '年');
    i = j + 1;
  }
  return out.join('、');
}

function initStats(){
  renderStatsTable();
  function col(a,b){ return STATS_YEARS.map(function(y){ var r=STATS_ROWS[y]; if(!r) return null; return b===undefined ? r[a] : r[a]+r[b]; }); }
      /* 懲戒案件數與人數：
     確定案件數＝表格「總計」欄；
     受懲戒人數＝總計－暫時停職（含予、不予）－不予懲戒－不受理－免議；
     受暫時停職人數＝表格「暫時停職（予）」欄（民國109年含以前無此欄位，不繪點） */
  svgLineChart('chart-total','legend-total',[
    {name:'確定案件數', color:'#2E5F7A', vals:STATS_YEARS.map(function(y){ var r=STATS_ROWS[y]; return r ? r[0]+r[1] : null; })},
    {name:'受懲戒人數', color:'#8E1F33', vals:STATS_YEARS.map(function(y){ var r=STATS_ROWS[y]; if(!r) return null;
      return r[0]+r[1] - r[2] - r[3] - (r[4]+r[5]) - (r[6]+r[7]) - (r[8]+r[9]); })},
    {name:'受暫時停職人數', color:'#9A948E', dash:true, vals:STATS_YEARS.map(function(y){ var r=STATS_ROWS[y];
      if(!r || (y-1911)<=109) return null; return r[2]; })}
  ]);
  function renderKindPie(which){
    var rg = PIE_RANGES[which] || PIE_RANGES.all;
    var items = kindItems(rg.y0, rg.y1);
    var total = 0;
    items.forEach(function(it){ total += it.value; });
    svgPieChart('chart-kind','legend-kind', items);
    FX.pieSwap();
    el('chart-kind-note').innerHTML = '<b>備註</b>　統計年度為民國' + rocRangeText(rg.y0, rg.y1) +
      '，合計 ' + total + ' 人；各類處分結果不含「不受理」、「免議」及「暫時停職」。';
    Object.keys(PIE_RANGES).forEach(function(k){
      var b = el('pie-range-' + k);
      if(!b) return;
      var on = (k === which);
      b.classList.toggle('db-is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  Object.keys(PIE_RANGES).forEach(function(k){
    var b = el('pie-range-' + k);
    if(b) b.addEventListener('click', function(){ renderKindPie(k); });
  });
  renderKindPie('all');
  svgLineChart('chart-lawyer-y','legend-lawyer-y',[
    {name:'考試及格人數', color:'#2E5F7A', vals:LAWYER.exam},
    {name:'新領證人數', color:'#6E9B63', vals:LAWYER.cert},
    {name:'加入公會人數', color:'#B73C5A', vals:LAWYER.join}
  ], LAWYER_YEARS);
  svgLineChart('chart-lawyer-c','legend-lawyer-c',[
    {name:'累計已領證人數', color:'#5A4A85', vals:LAWYER.cumCert},
    {name:'累計加入公會人數', color:'#C08A3A', vals:LAWYER.cumJoin}
  ], LAWYER_YEARS);
  FX.yearBars();
  FX.linePoints();
  FX.scan();
  statsReady = true;
}

/* 頁籤五（資料庫說明）與頁籤六（改革主張）為靜態內容，無對應 JS */
/* [JS-COMPLAINT] 申訴救濟／流程圖／地圖／公會資訊 */
/* ---------- 頁籤七：申訴救濟管道 ---------- */
var complaintReady = false;
/* 公會聯繫資訊與地圖幾何資料由 content-meta.json 提供；搜尋規則與事件處理留在本區。 */
var COMPLAINT_DATA = CONTENT_META.complaint;
var BAR_DATA = COMPLAINT_DATA.barData;
/* 由 buildMap() 於建立地圖時掛上（見該函式內的 pick）；地圖尚未建立時為 no-op，
   使 [JS-ROUTE] 不必判斷申訴頁是否已初始化。 */
var selectBarKey = function(){};
var MAP_REGIONS = COMPLAINT_DATA.mapRegions;

/* 各地方公會 → 案件檢索用地名關鍵字。
   案件資料之單位名稱使用「臺」字（臺北、臺中、臺南、臺東），故此處對應之；
   法律扶助基金會（LAF）非地區公會，以全名檢索其移送之案件。
   全國律師聯合會（TWBA）不提供懲戒案例檢索，因此不列入本表。 */
var BAR_QUERY = {
  TPE:'臺北', KEE:'基隆', ILA:'宜蘭', HSZ:'新竹', TAO:'桃園', MIA:'苗栗',
  TXG:'臺中', CHA:'彰化', NAN:'南投', CYI:'嘉義', YUN:'雲林', TNN:'臺南',
  KHH:'高雄', PIF:'屏東', TTT:'臺東', HUA:'花蓮', LAF:'法律扶助基金會'
};

/* 計算指定關鍵字目前在全部案件中之相符件數；比對邏輯與 matchQuery／gotoCaseSearch
   完全一致（gotoCaseSearch 點擊後會清空四個法條下拉篩選，母體為全部案件） */
function countCasesByQuery(q){
  var ast = queryAst(q);
  if(!ast) return DATA.cases.length;
  var n = 0;
  for(var i=0;i<DATA.cases.length;i++){
    if(matchQuery(i, ast)) n++;
  }
  return n;
}

function renderBarCard(key){
  var d = BAR_DATA[key];
  if(!d){ el('bar-info').innerHTML = '<div class="db-bar-empty">請點選左側地圖上的律師公會，以檢視聯繫資訊。</div>'; return; }
  var rows = [];
  rows.push('<div class="db-bar-row"><span class="db-k">網站</span><span class="db-v">'+
    (safeHref(d.url) ? '<a href="'+safeHref(d.url)+'" target="_blank" rel="noopener">'+esc(d.url)+'</a>' : '（無網站）')+'</span></div>');
  /* 聯繫方式（目前僅法律扶助基金會使用；內容為預先寫好之 HTML，含分會連結） */
  if(d.contact){
    rows.push('<div class="db-bar-row"><span class="db-k">聯繫方式</span><span class="db-v">'+d.contact+'</span></div>');
  }
  if(d.addr && d.addr.length){
    rows.push('<div class="db-bar-row"><span class="db-k">地址</span><span class="db-v">'+
      d.addr.map(esc).join('<br>')+'</span></div>');
  }
  if(d.email){
    rows.push('<div class="db-bar-row"><span class="db-k">電子郵件</span><span class="db-v"><a href="mailto:'+esc(d.email)+'">'+esc(d.email)+'</a></span></div>');
  }
  // 電話與傳真：若資料中有明確的 fax 欄位則優先使用；否則沿用「第一筆為電話、其餘為傳真」的慣例
  if(d.tel && d.tel.length){
    var tels, faxes;
    if(d.fax){ tels = d.tel.slice(); faxes = d.fax.slice(); }
    else { tels = d.tel.slice(0,1); faxes = d.tel.slice(1); }
    var telSpans = function(arr){ return arr.map(function(t){ return '<span class="db-tel">'+esc(t)+'</span>'; }).join(''); };
    if(tels.length){
      rows.push('<div class="db-bar-row"><span class="db-k">電話</span><span class="db-v">'+telSpans(tels)+'</span></div>');
    }
    if(faxes.length){
      rows.push('<div class="db-bar-row"><span class="db-k">傳真</span><span class="db-v">'+telSpans(faxes)+'</span></div>');
    }
  }
  /* 最後一列：懲戒案例檢索按鈕（僅地區公會與法扶），單一置中按鈕，
     點擊後跳至案件清單並以對應關鍵字檢索 */
  var q = BAR_QUERY[key];
  if(q){
    var n = countCasesByQuery(q);
    rows.push('<div class="db-bar-row db-bar-row-case">'+
      '<button type="button" class="db-bar-case-btn" data-barq="'+esc(q)+'">懲戒案例檢索：'+n+'件</button></div>');
  }
  el('bar-info').innerHTML = '<div class="db-bar-card"><div class="db-bar-card-head">'+esc(d.name)+'</div>'+
    '<div class="db-bar-card-body">'+rows.join('')+'</div></div>';
}

/* 跳至「案件清單」頁籤，並以指定地名關鍵字執行檢索
  （法條下拉一併清空，使結果單純為關鍵字檢索的狀態） */
function gotoCaseSearch(q){
  ALL_SRC.forEach(function(s){ el('flt-'+s.key).value = ''; });
  el('flt-q').value = q;
  st.q = q;
  st.page = 1;
  tabs.forEach(function(o){
    var cur = o.btn===el('tabbtn-list');
    o.btn.setAttribute('aria-selected', cur?'true':'false');
    o.panel.hidden = !cur;
  });
  renderList();
  if(q && !FT){
    el('list-count').textContent = '正在載入全文索引…';
    ensureFulltext().then(function(){ routePush(); }).catch(function(){
      el('list-count').textContent = '全文載入失敗，請重新整理後再試。';
    });
  }else routePush();
  /* 與頁籤點擊一致：回到獨立網站頂端。 */
  window.scrollTo(0, 0);
}
/* 事件委派：聯繫資訊卡片內容會動態重建，改於固定容器上監聽按鈕點擊 */
el('bar-info').addEventListener('click', function(e){
  var b = e.target.closest ? e.target.closest('button[data-barq]') : null;
  if(b) gotoCaseSearch(b.getAttribute('data-barq'));
});

/* 互動臺灣地圖 SVG（縣市分色 tab 版），依 16 個律師公會轄區合併縣市：
   新北市＋臺北市 → 台北律師公會；新竹縣＋新竹市 → 新竹律師公會；
   嘉義縣＋嘉義市 → 嘉義律師公會，其餘各公會轄區與縣市界線一一對應。
   （澎湖、金門、馬祖等外島於原始資料庫中無對應公會分區，故地圖不繪出。） */

function buildMap(){
  var svg = el('tw-map');
  var frag = '';
  MAP_REGIONS.forEach(function(r){
    var key=r[0], polys=r[1], lx=r[2], ly=r[3];
    polys.forEach(function(pts){
      frag += '<polygon class="db-region" data-bar="'+key+'" points="'+pts+'" tabindex="0" role="button" aria-label="'+esc(BAR_DATA[key].name)+'"></polygon>';
    });
    frag += '<text class="db-rlabel'+(key==='KEE'?'':' db-big')+'" x="'+lx+'" y="'+(ly+4)+'">'+esc(BAR_DATA[key].name.replace('律師公會',''))+'</text>';
  });
  svg.innerHTML = frag;
  function setHover(key, on){
    if(!key) return;
    svg.querySelectorAll('.db-region[data-bar="'+key+'"]').forEach(function(n){ n.classList.toggle('db-hover', on); });
  }
  /* 地圖區塊與左上兩顆 chip 的選取集中在這一支：原本兩處各清各的 db-cur、
     各自呼叫 renderBarCard，錨點路由要再寫第三份就必然分歧。
     另外掛到模組層的 selectBarKey，供 [JS-ROUTE] 套用 /complaint/…?bar=X。 */
  function pick(key){
    svg.querySelectorAll('.db-region').forEach(function(n){ n.classList.remove('db-cur'); });
    document.querySelectorAll('.db-twba-chip').forEach(function(c){ c.classList.remove('db-cur'); });
    if(key){
      svg.querySelectorAll('.db-region[data-bar="'+key+'"]').forEach(function(n){ n.classList.add('db-cur'); });
      document.querySelectorAll('.db-twba-chip[data-bar="'+key+'"]').forEach(function(n){ n.classList.add('db-cur'); });
    }
    renderBarCard(key);
  }
  selectBarKey = pick;
  /* 地圖使用事件委派：SVG 僅保留一組互動 listener，不再對每個 polygon 個別掛載。 */
  function regionFromEvent(e){
    var n = e.target && e.target.closest ? e.target.closest('.db-region[data-bar]') : null;
    return n && svg.contains(n) ? n : null;
  }
  function activateRegion(n){
    if(!n) return;
    var key = n.getAttribute('data-bar');
    pick(key);
    CP_BAR = key;
    routePush();
  }
  svg.addEventListener('click', function(e){
    activateRegion(regionFromEvent(e));
  });
  svg.addEventListener('keydown', function(e){
    if(e.key!=='Enter' && e.key!==' ') return;
    var n = regionFromEvent(e); if(!n) return;
    e.preventDefault();
    activateRegion(n);
  });
  svg.addEventListener('mouseover', function(e){
    var n = regionFromEvent(e);
    if(n && (!e.relatedTarget || !n.contains(e.relatedTarget))) setHover(n.getAttribute('data-bar'), true);
  });
  svg.addEventListener('mouseout', function(e){
    var n = regionFromEvent(e);
    if(n && (!e.relatedTarget || !n.contains(e.relatedTarget))) setHover(n.getAttribute('data-bar'), false);
  });
  svg.addEventListener('focusin', function(e){ var n=regionFromEvent(e); if(n) setHover(n.getAttribute('data-bar'), true); });
  svg.addEventListener('focusout', function(e){ var n=regionFromEvent(e); if(n) setHover(n.getAttribute('data-bar'), false); });

  /* 左上 chip 亦由共同父容器委派；buildMap 重建 SVG 時不重掛 chip listener。 */
  var chip = document.querySelector('.db-twba-chip');
  var chipHost = chip && chip.parentElement;
  if(chipHost && !chipHost._dbEventsBound){
    chipHost.addEventListener('click', function(e){
      var c = e.target.closest ? e.target.closest('.db-twba-chip[data-bar]') : null;
      if(!c || !chipHost.contains(c)) return;
      svg.querySelectorAll('.db-region').forEach(function(n){ n.classList.remove('db-cur'); });
      document.querySelectorAll('.db-twba-chip').forEach(function(n){ n.classList.remove('db-cur'); });
      pick(c.getAttribute('data-bar'));
      CP_BAR = c.getAttribute('data-bar');
      routePush();
    });
    chipHost._dbEventsBound = true;
  }
}


/* 申訴流程圖。桌機為由左至右的橫式，手機（≤640px）改為由上而下的直式：
   兩份座標各自寫死，不做自動轉置——流程圖的可讀性取決於箭頭走線與標籤位置，
   靠程式轉置只會得到互相穿越的線。共用 box／diamond／path 三個繪圖函式。
   斷點與樣式表的手機規則一致（640px）；改變時會重繪，故轉向後不必重整頁面。 */
var FLOW_MQ = '(max-width:640px)';
function flowIsNarrow(){
  return !!(window.matchMedia && window.matchMedia(FLOW_MQ).matches);
}
function buildFlow(){
  var svg = el('flow-svg');
  var C = {complain:'#EDE7F3', bar:'#DEEAF0', discipline:'#FBE1E7', result:'#E1EBE1', neutral:'#F8EEDA'};
  var CS = {complain:'#7A6B96', bar:'#3D7A96', discipline:'#B73C5A', result:'#5E8C6A', neutral:'#C98A3E'};
  function box(x,y,w,h,text,type,fs){
    fs = fs||12.5;
    var lines = text.split('\n');
    var t = '<g>';
    t += '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="7" fill="'+C[type]+'" stroke="'+CS[type]+'" stroke-width="1.5"/>';
    var startY = y + h/2 - (lines.length-1)*(fs+3)/2 + fs/2 - 1;
    lines.forEach(function(ln,i){
      t += '<text x="'+(x+w/2)+'" y="'+(startY + i*(fs+3))+'" text-anchor="middle" font-size="'+fs+'" fill="#2B2B2E" font-weight="600">'+ln+'</text>';
    });
    return t+'</g>';
  }
  function diamond(cx,cy,w,h,text,type,fs){
    fs = fs||13;
    var t = '<g>';
    t += '<polygon points="'+cx+','+(cy-h/2)+' '+(cx+w/2)+','+cy+' '+cx+','+(cy+h/2)+' '+(cx-w/2)+','+cy+'" fill="'+C[type]+'" stroke="'+CS[type]+'" stroke-width="1.5"/>';
    t += '<text x="'+cx+'" y="'+(cy+fs/2-1)+'" text-anchor="middle" font-size="'+fs+'" fill="#2B2B2E" font-weight="600">'+text+'</text>';
    return t+'</g>';
  }
  function path(d,label,lx,ly){
    var t = '<path d="'+d+'" stroke="#A8A29C" stroke-width="1.6" fill="none" marker-end="url(#arr)"/>';
    if(label){
      var w = label.length*11 + 12;
      t += '<rect x="'+(lx-w/2)+'" y="'+(ly-10)+'" width="'+w+'" height="18" rx="4" fill="#fff" stroke="#E2DEDA" stroke-width="1"/>';
      t += '<text x="'+lx+'" y="'+(ly+3)+'" text-anchor="middle" font-size="11" fill="#6B6F76" font-weight="700">'+label+'</text>';
    }
    return t;
  }
  /* 紅色實線（移付懲戒／請求覆審）：直橫兩式共用 */
  function redPath(d, label, lx, ly){
    var t = '<path d="'+d+'" stroke="#B73C5A" stroke-width="1.8" fill="none" marker-end="url(#arrP)"/>';
    if(label){
      var w = label.length*11 + 12;
      t += '<rect x="'+(lx-w/2)+'" y="'+(ly-9)+'" width="'+w+'" height="18" rx="4" fill="#fff" stroke="#EEB3C0" stroke-width="1"/>';
      t += '<text x="'+lx+'" y="'+(ly+4)+'" text-anchor="middle" font-size="11" fill="#8E1F33" font-weight="700">'+label+'</text>';
    }
    return t;
  }
  var ARR_DEFS = '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#A8A29C"/></marker>' +
    '<marker id="arrD" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#C98A3E"/></marker>' +
    '<marker id="arrP" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#B73C5A"/></marker></defs>';

  /* ---- 橫式（桌機） ---- */
  function buildH(){
  var s = ARR_DEFS;
  // 第一層
  s += diamond(80,234,124,64,'申訴','complain');
  s += box(180,206,120,56,'各地方律師公會','bar');

  // 民眾申覆(菱形) 置於各地方律師公會正下方（同 x 中心 240），下移使上下對稱
  s += diamond(240,346,120,60,'申覆','complain');

  // 成立分支（上排）：律師懲戒委員會 → 覆審（同大小 156×56，中心 y=122，距公會中心 112）
  s += box(400,94,156,56,'律師懲戒委員會','discipline');
  s += box(656,94,156,56,'律師懲戒覆審委員會','discipline');

  // 不成立分支：全國律師聯合會（與律師懲戒委員會同大小、左緣對齊 x=400，中心 y=346，距公會中心 112）
  s += box(400,318,156,56,'全國律師聯合會\n律師倫理風紀委員會','bar',11);

  // 全律會後兩結果框
  s += box(660,286,152,46,'維持原處置\n不予處置','result',12);
  s += box(660,362,152,46,'另為處置','neutral',12.5);

  // 連線：申訴 → 公會
  s += path('M142 234 L180 234');
  // 公會 →（其他處分）：右側小黃框
  s += path('M300 234 L340 234');
  s += box(340,214,90,40,'其他處分','neutral',12);
// 其他處分 → 申覆
  s += '<path d="M385 254 L385 311 L240 311" stroke="#A8A29C" stroke-width="2" fill="none"/>';
  // 公會 →（移付懲戒）律師懲戒委員會：先向上、再向左，自委員會左緣進入；紅色實線，與全律會→懲戒委員會同樣式
  s += '<path d="M240 206 L240 122 L400 122" stroke="#B73C5A" stroke-width="1.8" fill="none" marker-end="url(#arrP)"/>';
  s += '<rect x="287" y="113" width="66" height="18" rx="4" fill="#fff" stroke="#EEB3C0" stroke-width="1"/>';
  s += '<text x="320" y="126" text-anchor="middle" font-size="11" fill="#8E1F33" font-weight="700">移付懲戒</text>';
  // 懲戒委員會 → 覆審（直線）
  s += '<path d="M556 122 L656 122" stroke="#B73C5A" stroke-width="1.8" fill="none" marker-end="url(#arrP)"/>';
  s += '<rect x="569" y="113" width="66" height="18" rx="4" fill="#fff" stroke="#EEB3C0" stroke-width="1"/>';
  s += '<text x="602" y="126" text-anchor="middle" font-size="11" fill="#8E1F33" font-weight="700">請求覆審</text>';
  // 公會 →（不成立）民眾申覆：正下方直線，標籤置於箭頭中點
  s += path('M240 262 L240 316','不成立',240,289);
  // 申覆 → 全律會：直線（縮短）
  s += path('M300 346 L400 346');
  // 全律會 → 維持原處置/不予處置（上）與 另為處置（下）：鏡像箭頭
  s += path('M556 334 L608 334 L608 309 L660 309');
  s += path('M556 358 L608 358 L608 385 L660 385');
  // 全律會 →（移付懲戒）律師懲戒委員會
  s += '<path d="M478 318 L478 150" stroke="#B73C5A" stroke-width="1.8" fill="none" marker-end="url(#arrP)"/>';
  s += '<rect x="445" y="225" width="66" height="18" rx="4" fill="#fff" stroke="#EEB3C0" stroke-width="1"/>';
  s += '<text x="478" y="238" text-anchor="middle" font-size="11" fill="#8E1F33" font-weight="700">移付懲戒</text>';

  svg.setAttribute('viewBox','8 66 814 352');
  svg.innerHTML = s;
  }

  /* ---- 直式（手機）----
     單一主幹由上而下：申訴→公會→其他處分→申覆→全律會→兩種結果；
     「不成立」走左側迴避線直接到申覆，兩條「移付懲戒」（自公會、自全律會）
     分走左右兩條迴避線匯入底部的懲戒委員會，再往下接覆審委員會。 */
  function buildV(){
    var s = ARR_DEFS;
    s += diamond(150,34,120,54,'申訴','complain');
    s += box(80,92,140,44,'各地方律師公會','bar');
    s += box(90,176,120,34,'其他處分','neutral',12);
    s += diamond(150,272,118,58,'申覆','complain');
    s += box(60,336,180,48,'全國律師聯合會\n律師倫理風紀委員會','bar',11);
    /* 兩個結果框左緣留在 x=45 之後，讓左側「移付懲戒」迴避線（x=32）通過而不穿框 */
    s += box(45,440,150,44,'維持原處置\n不予處置','result',12);
    s += box(215,440,135,44,'另為處置','neutral',12.5);
    s += box(110,560,180,44,'律師懲戒委員會','discipline');
    /* 覆審委員會下移 23px：與懲戒委員會之間的箭頭由 46px 加長為 69px（1.5 倍） */
    s += box(110,673,180,44,'律師懲戒覆審委員會','discipline',12);

    s += path('M150 61 L150 92');                    /* 申訴→公會 */
    s += path('M150 136 L150 176');                  /* 公會→其他處分 */
    s += path('M150 210 L150 243');                  /* 其他處分→申覆 */
    s += path('M80 114 L32 114 L32 272 L91 272','不成立',32,193);
    s += path('M150 301 L150 336');                  /* 申覆→全律會 */
    s += path('M120 384 L120 440');                  /* 全律會→維持原處置 */
    s += path('M190 384 L190 412 L282 412 L282 440');/* 全律會→另為處置 */
    /* 兩條移付懲戒與請求覆審維持紅色實線，與橫式版本同一套視覺語彙 */
    s += redPath('M220 114 L360 114 L360 582 L290 582', '移付懲戒', 360, 300);
    s += redPath('M60 360 L32 360 L32 582 L110 582', '移付懲戒', 32, 520);
    s += redPath('M200 604 L200 673', '請求覆審', 200, 638);   /* 標籤置於線段垂直中心 */

    svg.setAttribute('viewBox','0 0 400 729');
    svg.innerHTML = s;
  }
  if(flowIsNarrow()) buildV(); else buildH();
}

/* 視窗跨越 640px 斷點時重繪流程圖（直↔橫）。listener 由 [JS-INIT] 明確啟動。 */
var complaintResponsiveReady = false;
function initComplaintResponsive(){
  if(complaintResponsiveReady || !(window.matchMedia)) return;
  complaintResponsiveReady = true;
  var was = flowIsNarrow();
  onDbResize(function(){
    var now = flowIsNarrow();
    if(now === was) return;
    was = now;
    if(complaintReady) buildFlow();
  });
}

function initBarForm(){
  var table = el('bar-form-table'), btn = el('bar-form-toggle');
  if(!table || !btn) return;

  function setExpanded(expanded){
    table.classList.toggle('db-collapsed', !expanded);
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.textContent = expanded ? '收起 ▲' : '展開全部 ▼';
  }

  if(!btn._dbEventsBound){
    btn.addEventListener('click', function(){
      setExpanded(btn.getAttribute('aria-expanded') !== 'true');
    });
    btn._dbEventsBound = true;
  }

  btn.hidden = false;
  setExpanded(false);
}

/* ---------- 民眾入口：常見情形 → 違失態樣 -------------------------
   本頁面對的是尚不熟悉法律用語的民眾，而違失態樣的名稱取自法條用語，
   直接列出並不好找。故另立一組「常見情形」的白話標題作為導覽：
   點卡片內的態樣名稱即跳至違失態樣頁之該態樣（沿用文件層的
   [data-pattern-id] 委派處理器，行為與其他態樣連結完全一致）。

   維護方式：
   ．本表只是導覽，不是分類——一則情形可對應數個態樣，一個態樣也可以
     出現於數則情形；刻意不求涵蓋全部態樣，也不與七大類（PAT_GROUPS）對應。
   ．關聯一律收永久 ID（p／subs），日後修改態樣名稱不影響本表；
     ID 打錯只會讓該按鈕靜默消失，故由 auditData() 逐則攔下。
   ．態樣名稱與件數一律於渲染時由 PATTERN_BY_ID／SUBCAT_IDX 取得，
     不在此寫死（理由同 articleIndex：另存一份必然有失步的一天）。
   ．subs 指定子類 id 時，跳轉後一併勾選該態樣的這幾列子類（見 gotoPattern
     之第二個參數），顯示的件數也隨之改取勾選後的件數，與跳轉後看到的
     筆數一致。例：「矇蔽、欺誘委託人或司法機關」同時涵蓋對司法機關的欺矇，
     民眾入口只要對委任人的部分，故預先勾選該分類的四列。 */
var PUBLIC_ENTRY = [
  { t:'拖延不辦致當事人權益受損',
    d:'委任後遲遲不提出書狀、錯過法定期限、無故未到庭等。',
    pats:[{p:'P003'}] },
  { t:'對當事人隱瞞實情或提供不實訊息',
    d:'謊報案件進度、隱瞞不利的結果，或就重要風險避而不談。',
    pats:[{p:'P006', subs:['DC01','DC02','DC03','DC04']},{p:'P058'}] },
  { t:'費用未事先講明，或事後不當加收',
    d:'未說明酬金的計算方式，或於約定之外再以各種名目要求付費。',
    pats:[{p:'P015'},{p:'P020'},{p:'P030'}] },
  { t:'款項、文件遲不返還，或趁機取得當事人財產',
    d:'案件結束後不歸還卷證或代收款項，或從中受讓當事人間的權利、標的。',
    pats:[{p:'P027'},{p:'P029'}] },
  { t:'欠缺應有的專業準備，未查明案情或法令',
    d:'未詳閱卷證、未蒐集證據即出庭，或引用已修正、廢止的法令。',
    pats:[{p:'P019'},{p:'P021'}] },
  { t:'洩漏當事人的秘密',
    d:'將委任過程中知悉的事項告知共犯、對造或與案件無關的第三人。',
    pats:[{p:'P012', subs:['SE01','SE02','SE03','SE08']}] },
  { t:'教唆作偽證或提出不實證據',
    d:'指導證人配合說詞，或偽造、變造文書後提出於法院、檢察機關。',
    pats:[{p:'P009'},{p:'P041'}] },
  { t:'不當招攬案件、出借名義或由非律師承辦',
    d:'透過中間人案件、將律師名義供他人使用，或實際辦案的人不具律師資格。',
    pats:[{p:'P010'},{p:'P016'},{p:'P037'}] },
  { t:'法扶或指定辯護案件敷衍、拒辦或另行收費',
    d:'對法律扶助或依法受指定的案件消極應付、拒絕接辦，或另向當事人收取費用。',
    pats:[{p:'P052'},{p:'P023'}] },
  { t:'案件進行中片面終止委任',
    d:'於不利於當事人的時機辭任，或未依規定告知、辦理必要的交接。',
    pats:[{p:'P026'}] },
  { t:'有利益衝突或應迴避的事由',
    d:'曾經替對方辦理過案件，或與對方有特定關係卻未告知、未迴避。',
    pats:[{p:'P004'},{p:'P011'},{p:'P024'}] },
  { t:'律師本身涉犯刑事案件',
    d:'律師故意犯罪，無論與辦案有無關聯，應受懲戒或暫時停職。',
    pats:[{p:'P002'},{p:'P053'}] }
];

/* 民眾入口的態樣連結。刻意不沿用 patTagHtml：該函式產生的是全庫統一的紫色
   態樣標籤，本區則另有配色與等大版面的需求（見 .db-pub-pat 之註解），
   且需帶子類預選（data-subcat-sel）。點擊行為仍由文件層的 [data-pattern-id]
   委派處理器接手，與其餘態樣連結完全一致。
   子類 id 一律先以 SUBCAT_ROWS 核對，打錯者退為「整個態樣」，不至於按下去一片空白。
   ※ 這裡不顯示件數：本區是給尚未熟悉本資料庫的民眾看的入口，件數是「被懲戒
     且引用該條者」，容易被誤讀成發生頻率。件數在態樣頁本來就看得到。 */
function pubPatBtnHtml(e){
  var p = PATTERN_BY_ID[e && e.p];
  if(!p) return '';
  var subs = (Array.isArray(e.subs) ? e.subs : []).filter(function(id){
    return SUBCAT_ROWS[id] && SUBCAT_ROWS[id].patternId === e.p;
  });
  return '<button type="button" class="db-pub-pat" data-pattern-id="'+esc(e.p)+'"'+
    (subs.length ? ' data-subcat-sel="'+esc(subs.join(','))+'"' : '')+
    ' title="檢視「'+esc(p.name)+'」之案件">'+esc(p.name)+'</button>';
}
/* 卡片以 <details> 輸出，展開收合與箭頭方向全由瀏覽器與 CSS 處理，
   本函式只負責產生標記。理由與勿改回 JS 切換的原因見 [CSS-COMPLAINT] 的 .db-pub-t。 */
function renderPublicEntry(){
  var box = el('pub-entry');
  if(!box) return;
  var items = PUBLIC_ENTRY.map(function(e){
    var btns = (e.pats || []).map(pubPatBtnHtml).join('');
    if(!btns) return '';   /* 態樣 id 全數失效時不出空卡片；auditData 會指出 */
    return '<details class="db-pub-item">'+
      '<summary class="db-pub-t">'+
        '<span>'+esc(e.t)+'</span><span class="db-pub-ar" aria-hidden="true">\u25BC</span>'+
      '</summary>'+
      '<div class="db-pub-body">'+
        (e.d ? '<p class="db-pub-d">'+esc(e.d)+'</p>' : '')+
        '<div class="db-pub-pats">'+btns+'</div>'+
      '</div></details>';
  }).join('');
  box.innerHTML =
    '<p class="db-pub-lead">以下整理實務上民眾較常遇到的問題。'+
      '點選標題會展開對應的違失類型，再點擊類型名稱即可看到相關說明跟案例。</p>'+
    '<div class="db-pub-list">'+items+'</div>'+
    '<p class="db-pub-foot">這裡只列出較常見的問題。完整的 '+DATA.patterns.length+
      ' 類違失類型，請見「違失態樣」頁。'+
      '<button type="button" class="db-pub-more" id="pub-more">前往違失態樣 →</button></p>';
  /* 各卡片彼此獨立，不做手風琴（民眾常需要並排比較兩三則情形）；
     <details> 未指定 name 屬性時本來就各自獨立，正合所需，不必額外處理。 */
  /* 「前往違失態樣」：直接觸發頁籤按鈕，此捷徑與使用者自己點頁籤完全相同，
     不另寫一套切頁邏輯。initComplaint 只跑一次，仍以 _dbEventsBound 防重複綁定。 */
  var more = el('pub-more');
  if(more && !more._dbEventsBound){
    more.addEventListener('click', function(){
      var btn = el('tabbtn-pattern');
      if(btn) btn.click();
    });
    more._dbEventsBound = true;
  }
}

/* [JS-CP-NAME] 申訴頁的姓名檢索框。
   不自成一套檢索邏輯：一律轉呼叫案件清單既有的 gotoCaseSearch()，
   與民眾入口的態樣連結同樣只是既有功能的捷徑。 */
function initNameSearch(){
  var input = el('cp-name-q'), btn = el('cp-name-btn');
  if(!input || !btn || btn._dbEventsBound) return;
  function go(){
    var q = String(input.value || '').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');
    if(!q || typeof gotoCaseSearch !== 'function') return;
    gotoCaseSearch(q);       /* 網址由 gotoCaseSearch 內的 routePush() 一併寫入 */
  }
  btn.addEventListener('click', go);
  input.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); go(); } });
  btn._dbEventsBound = true;
}

function initComplaint(){
  renderPublicEntry();
  initNameSearch();
  buildFlow();
  buildMap();
  initBarForm();
  FX.mapIn();
  renderBarCard(null);
  FX.scan();
  complaintReady = true;
}

/* [JS-HEADER] sticky 頁首量測、頁首型態（單列／隱藏標題／收進選單）與選單。
   所有 listener 於 initHeaderBehavior() 啟動。 */
function syncStickyH(){
  var sb = document.querySelector('.db-sticky');
  if(!sb) return;
  var hgt = Math.round(sb.getBoundingClientRect().height);
  if(hgt > 0) document.documentElement.style.setProperty('--sticky-h', hgt+'px');
}

var headerBehaviorReady = false;
function initHeaderBehavior(){
  if(headerBehaviorReady) return;
  headerBehaviorReady = true;

  syncStickyH();
  onDbResize(syncStickyH);
  if(window.ResizeObserver){
    var sbResize = document.querySelector('.db-sticky');
    if(sbResize) new ResizeObserver(syncStickyH).observe(sbResize);
  }

  /* 選單開關：捕獲階段先收合，再由頁籤 handler 捲動，避免 scroll anchoring 把位置拉回頂端。
     收合的呼叫端不只這裡（頁首型態改變時也要收），故把 setOpen 留給 initHeadFit 使用。 */
  var navSetOpen = null;
  (function initMobileNav(){
    var sticky = document.querySelector('.db-sticky');
    var tgl = el('nav-toggle');
    if(!sticky || !tgl) return;
    function setOpen(open){
      sticky.classList.toggle('db-nav-open', open);
      tgl.setAttribute('aria-expanded', open ? 'true' : 'false');
      tgl.setAttribute('aria-label', open ? '關閉選單' : '開啟選單');
      syncStickyH();
    }
    navSetOpen = setOpen;
    tgl.addEventListener('click', function(){
      setOpen(!sticky.classList.contains('db-nav-open'));
    });
    sticky.addEventListener('click', function(e){
      var n = e.target;
      while(n && n !== sticky){
        if(n.classList && n.classList.contains('db-tab-btn')){ setOpen(false); return; }
        n = n.parentNode;
      }
    }, true);
  })();

  /* [JS-HEAD-FIT] 頁首版面：量測後決定三種型態之一，任何寬度下都維持單列。
     　full   ：標題 ＋ 全部頁籤同列（預設，無 class）
     　compact：兩者同列放不下、但頁籤自己排得下一列 → 隱藏標題文字，保留全部頁籤
     　menu   ：頁籤一列也放不下 → 顯示標題，頁籤全數收進右上角「≡」選單
     為什麼用量測而不是寫死的斷點：標題與頁籤的實際寬度取決於字型、字級與宿主
     容器寬度，三者在 CMS 中都不由本檔決定，寫死的 px 門檻必然有失準的一天
     （原本的 1180px 就是如此，才會出現本次「頁首被擠成兩列」）。
     量測方式：暫時加上 .db-head-measure 強制回到完全展開的單列，讀取標題與頁籤的
     自然寬度後立刻移除。加上與移除同在一個工作內完成，中間不會發生繪製，故不閃動。
     每次 resize 都重量，不快取——窄螢幕的字級由媒體查詢調整，快取會失準。 */
  (function initHeadFit(){
    var sticky = document.querySelector('.db-sticky');
    var head = sticky ? sticky.querySelector('.db-head') : null;
    var main = head ? head.querySelector('.db-head-main') : null;
    var nav = el('db-nav');
    if(!sticky || !head || !main || !nav) return;

    function pick(){
      sticky.classList.add('db-head-measure');
      var cs = window.getComputedStyle ? getComputedStyle(head) : null;
      var padL = cs ? (parseFloat(cs.paddingLeft) || 0) : 0;
      var padR = cs ? (parseFloat(cs.paddingRight) || 0) : 0;
      var gap  = cs ? (parseFloat(cs.columnGap) || 0) : 20;
      var avail = head.clientWidth - padL - padR;
      var wTitle = main.getBoundingClientRect().width;
      var wNav = nav.getBoundingClientRect().width;
      sticky.classList.remove('db-head-measure');
      if(!(avail > 0) || !(wNav > 0)) return null;   /* 隱藏或尚未版面化時不判定 */
      /* 2px 餘裕：容器寬在 CMS 中常是小數，剛好等寬時不該來回切換 */
      if(wNav > avail - 2) return 'menu';
      if(wTitle + gap + wNav > avail - 2) return 'compact';
      return 'full';
    }
    function apply(){
      var m = pick();
      if(!m) return;
      sticky.classList.toggle('db-head-compact', m === 'compact');
      sticky.classList.toggle('db-head-menu', m === 'menu');
      /* 由選單型態變寬時，殘留的展開狀態會讓頁籤同時出現在列上與選單中 */
      if(m !== 'menu' && navSetOpen && sticky.classList.contains('db-nav-open')) navSetOpen(false);
      syncStickyH();
    }
    apply();
    onDbResize(apply);
    /* 字型較晚載入完成會改變文字寬度，載入後補量一次；
       不支援 document.fonts 時維持首次量測的結果。 */
    try{ if(document.fonts && document.fonts.ready) document.fonts.ready.then(apply); }catch(e){}
  })();

  /* 頁首標題＝回首頁。直接觸發首頁頁籤按鈕，切換、動畫與捲動一律沿用既有流程。 */
  (function initHeadHome(){
    var btn = el('head-home');
    if(!btn || btn._dbEventsBound) return;
    btn.addEventListener('click', function(){
      var home = el('tabbtn-home');
      if(home) home.click();
    });
    btn._dbEventsBound = true;
  })();
}

/* [JS-ROUTE] 網址路徑：頁面狀態 ⇄ URL，並以瀏覽器上一頁／下一頁來回切換。
   ── 設計要點（改動前務必先讀）─────────────────────────────────────
   1. 語法解析在 DBROUTE.route()（檔案上方，早於資料），意義判讀全在本區。
   2. 寫入分兩種：
        push    ＝「改變看到哪些內容」的動作（切頁籤、檢索、篩選、選態樣、
                   選條文、換頁、開全文）→ 新增一筆歷史，上一頁可回到前一步。
        replace ＝ 純顯示切換（排序方向、覆審欄、只顯示被引用條文）
                   → 只更新網址，不新增歷史。否則按一次排序就多一筆，上一頁難用。
      呼叫端一律用 routePush()／routeReplace()，不要直接碰 history。
   3. 上一頁／下一頁一律走 applyRoute()：它會把狀態「整組」重設為網址所描述的樣子，
      未出現在網址中的參數一律回到預設值。若改成只套用出現的參數，
      回上一頁時會殘留前一頁的檢索條件，畫面與網址不符。
   4. ROUTE_APPLYING 期間所有 routePush／routeReplace 皆略過：
      applyRoute 內部會觸發頁籤 click 與各種 render，那些呼叫端本身也會寫網址，
      不擋住就會在回上一頁時反過來覆寫掉歷史。
   ------------------------------------------------------------------ */
var pathRoutingReady = false;
var ROUTE_APPLYING = false;
var ROUTE_LAST = null;          /* 最後一次由本程式寫入或套用的網址 */
/* 全文彈窗目前開啟的對象；由 initFulltextDialog() 維護，供組字串時取用。 */
var FT_ROUTE = null;
/* 全文彈窗的開啟函式（依案號／姓名），同由 initFulltextDialog() 掛上。 */
var FT_OPEN_BY_NO = null;
var FT_CLOSE = null;
/* 全文彈窗由本程式自行關閉、並呼叫了 history.back() 退回上一筆歷史時為 true。
   該次 popstate 只是「彈窗關了」，頁面其餘部分並未改變，見 applyRoute 開頭的判斷。 */
var FT_CLOSING = false;
/* 申訴救濟頁的段落與公會選取：兩者都是一次性導覽，狀態不存在既有的 state 物件中，
   故於此保存最後一次的選擇，組字串時才有東西可寫。 */
var CP_SEC = '', CP_BAR = '';
/* 懲戒法規頁最後一次定位到的條文／其它規範，理由同上。 */
var LAW_TARGET = null;
/* 本次套用錨點時要「持續貼齊」的頁內位置（回傳文件座標的函式）。
   由 applyXxxRoute() 設定、applyRoute() 末端取用後歸零。 */
var ROUTE_TARGET = null;

var LAW_TAB_KEY = {F:'act', E:'ethics', X:'others'};
var LAW_TAB_OF_KEY = {act:'F', ethics:'E', others:'X'};
var ROUTE_TITLES = {
  home:'律師懲戒案件資料庫',
  list:'案件清單｜律懲資料庫',
  pattern:'違失態樣｜律懲資料庫',
  laws:'懲戒法規｜律懲資料庫',
  stats:'統計與分析｜律懲資料庫',
  about:'資料庫說明｜律懲資料庫',
  reform:'改革主張｜律懲資料庫',
  complaint:'申訴救濟管道｜律懲資料庫',
  ethichist:'懲戒法規｜律懲資料庫'
};
var ROUTE_DESCRIPTIONS = {
  home:'民間司法改革基金會彙整歷年律師懲戒案件，提供案件檢索、違失態樣、懲戒法規、統計分析與申訴救濟資訊。',
  list:'查詢臺灣律師懲戒案件，可依姓名、案號、日期、法條、違失態樣與決議書全文檢索。',
  pattern:'依違失行為分類瀏覽臺灣律師懲戒案例，查看分類說明、相關法規與實際案件。',
  laws:'檢視臺灣律師懲戒相關法規、歷年新舊條文對照與引用案件。',
  stats:'查看臺灣律師懲戒案件的年度件數、懲戒種類與專題分析。',
  about:'臺灣律師懲戒案件資料庫的資料來源、整理方法、欄位說明與授權資訊。',
  reform:'民間司法改革基金會對律師懲戒制度的改革主張。',
  complaint:'說明律師懲戒申訴、救濟流程、應備資料與各地律師公會聯繫方式。',
  ethichist:'檢視舊版律師倫理規範的條文沿革與歷史版本。'
};

function currentTabKey(){
  for(var i = 0; i < tabs.length; i++){
    var b = tabs[i].btn;
    if(b && b.getAttribute('aria-selected') === 'true'){
      var m = /^tabbtn-(.+)$/.exec(b.id || '');
      if(m) return m[1];
    }
  }
  return 'home';
}
function syncRouteMeta(){
  var tab = currentTabKey(), path = routeString().split('?')[0];
  var absolute = location.origin + path;
  document.title = ROUTE_TITLES[tab] || ROUTE_TITLES.home;
  var description = document.querySelector('meta[name="description"]');
  if(description) description.content = ROUTE_DESCRIPTIONS[tab] || ROUTE_DESCRIPTIONS.home;
  var canonical = document.querySelector('link[rel="canonical"]');
  if(canonical) canonical.href = absolute;
  var ogUrl = document.querySelector('meta[property="og:url"]');
  if(ogUrl) ogUrl.content = absolute;
  var ogTitle = document.querySelector('meta[property="og:title"]');
  if(ogTitle) ogTitle.content = document.title;
  var ogDescription = document.querySelector('meta[property="og:description"]');
  if(ogDescription) ogDescription.content = description ? description.content : ROUTE_DESCRIPTIONS.home;
  var twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if(twitterTitle) twitterTitle.content = document.title;
  var twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if(twitterDescription) twitterDescription.content = description ? description.content : ROUTE_DESCRIPTIONS.home;
}

/* ---------- 狀態 → 網址 ---------- */
/* 只寫出「與預設不同」的參數，網址才不會每一頁都拖著一長串預設值。 */
function routeString(){
  var tab = currentTabKey();
  var path = tab === 'home' ? '/' : '/' + encodeURIComponent(tab);
  var query = new URLSearchParams();
  if(tab === 'list'){
    if(st.kind === 'prov') query.set('kind', 'prov');
    if(st.q) query.set('q', st.q);
    if(st.src && st.artIdx >= 0){
      var a = DATA.articleIndex[st.src][st.artIdx];
      if(a) query.set(st.src.toLowerCase(), a.no);
    }
    if(st.other) query.set('other', st.other);
    if(st.grp) query.set('group', st.grp);
    if(st.page > 1) query.set('page', st.page);
    /* 排序只在「與該檢視的預設不同」時寫出。一案多人／一人多案有各自的預設排序
       （setGroup 設定），若一律寫出，光是按下分組圖示網址就會多一段贅字。 */
    var defSort = st.grp ? ((st.grp === 'case' ? 'grpCase' : 'grpName') + '|asc') : 'no|desc';
    if(st.sort + '|' + (st.asc ? 'asc' : 'desc') !== defSort){
      query.set('sort', st.sort + (st.asc ? '-asc' : '-desc'));
    }
    if(revShown.list) query.set('rev', '1');
  }else if(tab === 'pattern'){
    var p = (pst.idx >= 0) ? DATA.patterns[pst.idx] : null;
    if(p){
      path += '/' + encodeURIComponent(p.id);
      var subs = patSubcatSel(p.id);
      if(subs.length) query.set('sub', subs.join(','));
      if(ONLYPAT_SEL[p.id]) query.set('only', '1');
      if(pst.page > 1) query.set('page', pst.page);
      if(!(pst.sort === 'h' && pst.asc === true)) query.set('sort', pst.sort + (pst.asc ? '-asc' : '-desc'));
      if(!revShown.pattern) query.set('rev', '0');
    }
  }else if(tab === 'laws'){
    var lt = LAW_TAB_KEY[lawState.key];
    if(lt){
      path += '/' + encodeURIComponent(lt);
      /* 條文／其它規範只在仍停留於同一個法規分頁時才寫出 */
      if(LAW_TARGET && LAW_TARGET.tab === lt) path += '/' + encodeURIComponent(LAW_TARGET.token);
    }
    if(lawState.usedOnly) query.set('used', '1');
  }else if(tab === 'stats'){
    if(ANA.sub === 'data') path += '/data';
    else if(ANA.art) path += '/articles/' + encodeURIComponent(ANA.art);
  }else if(tab === 'complaint'){
    if(CP_SEC) path += '/' + encodeURIComponent(CP_SEC);
    if(CP_BAR) query.set('bar', CP_BAR);
  }
  if(FT_ROUTE && FT_ROUTE.no){
    query.set('full', FT_ROUTE.no);
    if(FT_ROUTE.name) query.set('name', FT_ROUTE.name);
  }
  var qs = query.toString();
  return path + (qs ? '?' + qs : '');
}
function currentLocationKey(){
  var path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  return path + String(location.search || '');
}
function routeWrite(mode){
  if(ROUTE_APPLYING || !pathRoutingReady) return;
  var url = routeString();
  if(url === currentLocationKey()) return;
  ROUTE_LAST = url;
  try{
    if(mode === 'push' && history.pushState) history.pushState(null, '', url);
    else if(history.replaceState) history.replaceState(null, '', url);
    else location.assign(url);
  }catch(e){}
  syncRouteMeta();
}
function routePush(){ routeWrite('push'); }
function routeReplace(){ routeWrite('replace'); }

/* ---------- 網址 → 狀態 ---------- */
function routeParams(parts){
  /* 回傳 {named:{k:v}, bare:[…]}；參數名不分大小寫，值原樣保留。 */
  var named = {}, bare = [];
  (parts || []).forEach(function(t){
    var e = t.indexOf('=');
    if(e > 0) named[t.slice(0, e).toLowerCase()] = t.slice(e + 1);
    else bare.push(t);
  });
  return {named:named, bare:bare};
}
function showTabByKey(k){
  var btn = el('tabbtn-' + k);
  if(!btn) return false;
  if(btn.getAttribute('aria-selected') !== 'true'){
    SUPPRESS_TAB_SCROLL = true;
    btn.click();
    SUPPRESS_TAB_SCROLL = false;
  }
  return true;
}
function applyListRoute(P){
  /* 一律由預設值重建，未出現在網址中的條件就該消失（見設計要點 3） */
  ALL_SRC.forEach(function(s){ var sel = el('flt-' + s.key); if(sel) sel.value = ''; });
  st.q = P.named.q || '';
  el('flt-q').value = st.q;
  /* 分頁先定。暫時處分分頁沒有法條篩選器，故該分頁一律不還原法條與其它規範的
     條件——手打的網址若兩者並存，看不見的條件會讓件數對不上。 */
  setKind(P.named.kind === 'prov' ? 'prov' : 'disc');
  st.other = (st.kind === 'prov') ? '' : (P.named.other || '');
  if(st.kind !== 'prov'){
    ALL_SRC.forEach(function(s){
      var v = P.named[s.key.toLowerCase()];
      if(v === undefined) return;
      var idx = filterIndexOf(s.key, v);
      if(idx >= 0){ el('flt-' + s.key).value = String(idx); st.other = ''; }
    });
  }
  setGroup(P.named.group === 'case' || P.named.group === 'name' ? P.named.group : '');
  /* 有寫出排序就照套；沒寫出時，分組檢視沿用 setGroup 設定的預設，其餘回到編號降序。 */
  var sm = /^(.+)-(asc|desc)$/.exec(P.named.sort || '');
  if(sm){ st.sort = sm[1]; st.asc = (sm[2] === 'asc'); }
  else if(!st.grp){ st.sort = 'no'; st.asc = false; }
  st.page = Math.max(1, parseInt(P.named.page, 10) || 1);
  setRev('list', P.named.rev === '1');
  renderList();
  if(FT_HILITE) FT_HILITE();
}
function applyPatternRoute(P){
  var pid = null;
  P.bare.forEach(function(t){ if(PATTERN_INDEX_BY_ID[t] != null) pid = t; });
  pst.idx = (pid == null) ? -1 : PATTERN_INDEX_BY_ID[pid];
  pst.expanded = (pst.idx < 0);
  if(pid){
    patSubcatSel(pid).forEach(function(id){ delete SUBCAT_SEL[id]; });
    String(P.named.sub || '').split(',').forEach(function(id){
      if(id && SUBCAT_ROWS[id] && SUBCAT_ROWS[id].patternId === pid) SUBCAT_SEL[id] = true;
    });
    if(P.named.only === '1') ONLYPAT_SEL[pid] = true; else delete ONLYPAT_SEL[pid];
  }
  var sm = /^(.+)-(asc|desc)$/.exec(P.named.sort || '');
  if(sm){ pst.sort = sm[1]; pst.asc = (sm[2] === 'asc'); }
  else { pst.sort = 'h'; pst.asc = true; }
  pst.page = Math.max(1, parseInt(P.named.page, 10) || 1);
  setRev('pattern', P.named.rev !== '0');
  renderPatternList();
  renderPattern();
}
/* 回傳「本次是否已自行定位到頁內某個位置」——是的話就不再貼齊頁首。 */
function applyLawsRoute(P){
  var lt = null, target = null;
  P.bare.forEach(function(t){
    var lower = String(t).toLowerCase();
    if(LAW_TAB_OF_KEY[lower]){ lt = lower; return; }
    target = t;
  });
  if(!lawState.ready) initLaws();
  lawState.usedOnly = (P.named.used === '1');
  var chk = el('law-used-only');
  if(chk) chk.checked = lawState.usedOnly;
  selectLaw(LAW_TAB_OF_KEY[lt] || 'F');
  LAW_TARGET = null;
  if(!target) return false;
  var am = /^([jklmno])(.+)$/i.exec(target);
  if(am && LAW_TAB_OF[am[1].toUpperCase()]){
    LAW_TARGET = {tab: lt || LAW_TAB_KEY[LAW_TAB_OF[am[1].toUpperCase()]], token: target};
    gotoLawArticle(am[1].toUpperCase(), am[2]);
    return true;
  }
  if(otherByKey(target)){
    LAW_TARGET = {tab:'others', token:target};
    selectLaw('X');
    var node = otherAnchorEl(target);
    if(node){
      syncStickyH();
      scrollToInstant(0, Math.max(0, Math.round(node.getBoundingClientRect().top + window.pageYOffset)));
      return true;
    }
  }
  return false;
}
function applyComplaintRoute(P){
  CP_SEC = ''; CP_BAR = '';
  P.bare.forEach(function(t){ if(/^\d+-\d+$/.test(t)) CP_SEC = t; });
  if(P.named.bar && BAR_DATA[P.named.bar]){
    CP_BAR = P.named.bar;
    selectBarKey(CP_BAR);
  }else{
    selectBarKey(null);
  }
  if(!CP_SEC) return false;
  var node = el('cp-' + CP_SEC);
  if(!node) return false;
  var an = node.querySelector ? node.querySelector('.db-cp-anchor') : null;
  /* 定位流程同 gotoLawArticle（見 CSS 的「捲動定位錨點：全檔通則」）。
     差別是實際捲動交給 applyRoute 末端的 DBROUTE.target()＋hold() 持續校正：
     本頁的地圖與流程圖是進站後才建立的，單次捲動會落空（通則第 ③ 點）。 */
  syncStickyH();
  /* 正常情形以節標題內的零淨高度錨點定位（與法規頁條文同一套配方）。
     萬一該錨點不存在（標記被宿主編輯器吃掉、或改版時漏加），改以標題本身
     的座標減去頁首高度定位——結果與錨點法相同，不因少一個 span 就整個失效。 */
  ROUTE_TARGET = an
    ? function(){
        syncStickyH();
        return an.getBoundingClientRect().top + window.pageYOffset;
      }
    : function(){
        syncStickyH();
        var sh = 0;
        try{
          sh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-h')) || 0;
        }catch(e){}
        return node.getBoundingClientRect().top + window.pageYOffset - (sh + 12);
      };
  return true;
}

/* [JS-CP-TOC] 申訴救濟頁導覽列：站內連結以 History API 切換，不重新下載頁面。 */
function initComplaintToc(){
  if(initComplaintToc.ready) return;
  document.addEventListener('click', function(e){
    var a = (e.target && e.target.closest) ? e.target.closest('.db-cp-toc-a[href^="/complaint/"]') : null;
    if(!a) return;
    var url = a.getAttribute('href');
    if(!url) return;
    e.preventDefault();
    /* 同一個目標再點一次仍要重新捲動（使用者可能已自行捲離），故只跳過寫歷史。 */
    if(currentLocationKey() !== url){
      ROUTE_LAST = url;
      if(history.pushState) history.pushState(null, '', url);
      else{ location.assign(url); return; }
    }
    DBROUTE.resume();
    applyRoute(false);
  });
  initComplaintToc.ready = true;
}

function applyRoute(fromLoad){
  var r = DBROUTE.route();
  /* 只是關閉全文彈窗（自行關閉後的 history.back()、或按瀏覽器的上一頁）：
     網址扣掉 full= 之後，與目前畫面狀態組出的錨點完全相同，代表清單、頁次、捲動位置都
     沒有理由變動——只關彈窗，其餘一概不碰。否則會依網址把案件清單整個重畫、並把捲動位置
     拉回頁籤頂端，使用者就回不到開啟全文之前的畫面。
     比對不相符（例如手改網址、同時換了條件）就照常往下走完整套用。 */
  var wasClosing = FT_CLOSING; FT_CLOSING = false;
  if((wasClosing || FT_ROUTE) && r && !(r.full && r.full.no) && FT_CLOSE){
    var keptFt = FT_ROUTE;
    FT_ROUTE = null;                       /* routeString() 會把 FT_ROUTE 寫成 full=，先暫時拿掉再比 */
    var sameState = (routeString() === currentLocationKey());
    FT_ROUTE = keptFt;
    if(sameState){
      ROUTE_APPLYING = true;
      try{ FT_CLOSE(true); }catch(e0){}
      finally{ ROUTE_APPLYING = false; ROUTE_LAST = currentLocationKey(); }
      return;
    }
  }
  var located = false;
  ROUTE_TARGET = null;
  ROUTE_APPLYING = true;
  try{
    if(r && r.scrollOnly){
      /* #0／#db／#top／#資料庫：只捲動，頁籤與各頁狀態一概不動 */
      ROUTE_LAST = currentLocationKey();
      DBROUTE.snap(); DBROUTE.hold(fromLoad ? 1200 : 400);
      return;
    }
    /* 空路徑或不認得的路徑一律退回首頁：否則按上一頁回到根網址時，
       網址已變、畫面卻停在原頁。 */
    var tab = (r && r.tab) ? r.tab : 'home';
    showTabByKey(tab);
    var P = routeParams(r ? r.parts : []);
    if(tab === 'list') applyListRoute(P);
    else if(tab === 'pattern') applyPatternRoute(P);
    else if(tab === 'laws') located = applyLawsRoute(P);
    else if(tab === 'complaint') located = applyComplaintRoute(P);
    else if(tab === 'stats') applyStatsRoute(P);
    /* 全文彈窗：網址有就開、沒有就關，開關一律由網址決定，
       如此上一頁自然就是「關閉彈窗」，下一頁自然是「再開啟」。 */
    if(r && r.full && r.full.no){
      if(FT_OPEN_BY_NO) FT_OPEN_BY_NO(r.full.no, r.full.name);
    }else if(FT_CLOSE){
      FT_CLOSE(true);
    }
  }catch(err){
    if(window.console && console.warn) console.warn('[律師懲戒案件資料庫] 網址套用失敗：', err);
  }finally{
    ROUTE_APPLYING = false;
    ROUTE_LAST = currentLocationKey();
    syncRouteMeta();
    /* 必須在下方量測頁內錨點之前顯示正確面板；同一個 JS 工作尚未結束，瀏覽器
       不會在解除 class 與完成 snap 之間插入繪製，因此不會再閃出錯誤位置。 */
    document.documentElement.classList.remove('db-route-pending');
  }
  if(located && ROUTE_TARGET){
    /* 錨點指向頁內某一節：把「持續貼齊」的目標換成該節，沿用同一套逐格校正，
       版面在其後繼續長高（圖表、字型、外部圖片）也會被追上。
       使用者一旦自行捲動即放手，這點由 DBROUTE 內部的 release 處理。 */
    DBROUTE.target(ROUTE_TARGET);
    DBROUTE.snap();
    DBROUTE.hold(fromLoad ? 1600 : 700);
  }else if(located){
    /* 已自行定位（法規頁的條文跳轉自帶金框與捲動）：停掉貼齊，免得互搶捲軸 */
    DBROUTE.target(null);
    DBROUTE.release();
  }else{
    DBROUTE.target(null);
    DBROUTE.snap();
    DBROUTE.hold(fromLoad ? 1200 : 400);
  }
  ROUTE_TARGET = null;
}

function initPathRouting(){
  if(pathRoutingReady) return;
  pathRoutingReady = true;
  /* 瀏覽器上一頁／下一頁以 popstate 還原完整畫面狀態。 */
  function onNav(){
    var h = currentLocationKey();
    if(h === ROUTE_LAST) return;
    ROUTE_LAST = h;
    DBROUTE.resume();
    applyRoute(false);
  }
  window.addEventListener('popstate', onNav);
  applyRoute(true);
  var initialRoute = DBROUTE.route();
  if(initialRoute && initialRoute.full && !FT){
    ensureFulltext().catch(function(){
      if(window.console && console.error) console.error('[律師懲戒案件資料庫] 無法載入網址指定的全文');
    });
  }
  /* 正規化尾斜線、query 參數順序，並將舊 hash 網址轉成新路徑。 */
  ROUTE_APPLYING = false;
  routeReplace();
}

/* [JS-FULLTEXT] 決議書全文 dialog；建立與事件綁定延後至 [JS-INIT]。 */
var fulltextDialogReady = false;
function initFulltextDialog(){
  if(fulltextDialogReady || !FT) return;
  fulltextDialogReady = true;
  if(!FT) return;                       /* 未附全文資料時完全不介入 */
  var DIALOG_CONTROLLER = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextDialogController;
  var shell = DIALOG_CONTROLLER && DIALOG_CONTROLLER.create ? DIALOG_CONTROLLER.create({id:'ft-dlg'}) : null;
  var dlg = shell ? shell.dialog : document.createElement('dialog');
  if(!shell){
    dlg.id = 'ft-dlg';
    dlg.setAttribute('aria-modal', 'true');
    dlg.innerHTML = '<button type="button" id="ft-x" aria-label="關閉全文">\u00d7</button><div id="ft-body" tabindex="-1"></div>';
    document.body.appendChild(dlg);
  }

  var body = el('ft-body'), lastFocus = null;
  var HIGHLIGHT = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextHighlight;
  /* ftPushed：目前這個彈窗是不是由本程式推進歷史的（決定關閉時能否 history.back()）。
     ftFromRoute：本次開啟是否來自網址套用（來自錨點時不可再寫一次歷史）。 */
  var ftPushed = false, ftFromRoute = false;

  /* 關鍵字反白：以檢索列當下的條件，於內文的文字節點上標示命中處。只處理文字節點，不碰標籤，因此不會破壞原檔的排版與連結。 */
  function hiliteTokens(){
    var q = String((typeof st !== 'undefined' && st.q) || '').trim();
    if(!q) return [];
    /* 依檢索語法取出正向字詞；「不含」的字詞不反白 */
    if(typeof queryAst === 'function') return queryTerms(queryAst(q));
    return q.split(/\s+/).filter(Boolean);
  }
  function clearHilite(){
    if(HIGHLIGHT && HIGHLIGHT_CONTROLLER) return HIGHLIGHT_CONTROLLER.clear();
    var ms = body.querySelectorAll('mark.ft-hit');
    for(var i = 0; i < ms.length; i++){
      var m = ms[i], p = m.parentNode;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    }
  }
  function applyHilite(){
    if(HIGHLIGHT && HIGHLIGHT_CONTROLLER) return HIGHLIGHT_CONTROLLER.apply();
    clearHilite();
    var toks = hiliteTokens();
    if(!toks.length || !body.firstChild) return;
    var re = new RegExp('(' + toks.map(function(t){
      return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|') + ')', 'gi');
    var walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null, false);
    var hits = [], n;
    while((n = walker.nextNode())){
      re.lastIndex = 0;
      if(n.nodeValue && re.test(n.nodeValue)) hits.push(n);
    }
    for(var k = 0; k < hits.length; k++){
      var node = hits[k], s = node.nodeValue, frag = document.createDocumentFragment(), last = 0, m2;
      re.lastIndex = 0;
      while((m2 = re.exec(s))){
        if(!m2[0]){ re.lastIndex++; continue; }
        if(m2.index > last) frag.appendChild(document.createTextNode(s.slice(last, m2.index)));
        var mk = document.createElement('mark');
        mk.className = 'ft-hit';
        mk.textContent = m2[0];
        frag.appendChild(mk);
        last = m2.index + m2[0].length;
      }
      if(last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }
  /* 由檢索摘要列點入時，捲到該段命中處。k 是「彈窗內 .sec mark.ft-hit 的第幾個」，
     由 snipFor() 依同一份全文推算；兩邊對「跨標籤的命中」處理略有出入時，寧可落在
     附近也不報錯（超出範圍則取最後一個）。須在 showModal() 之後呼叫——彈窗開啟前
     #ft-body 沒有版面，量不到位置。 */
  function goHit(k){
    if(HIGHLIGHT && HIGHLIGHT_CONTROLLER) return HIGHLIGHT_CONTROLLER.goHit(k);
    if(k == null || isNaN(k)) return;
    var ms = body.querySelectorAll('.sec mark.ft-hit');
    if(!ms.length) return;
    var m = ms[k] || ms[ms.length - 1];
    var prev = body.querySelector('mark.ft-hit-cur');
    if(prev) prev.classList.remove('ft-hit-cur');
    m.classList.add('ft-hit-cur');
    var top = m.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTop = Math.max(0, top - body.clientHeight / 3);
  }
  var HIGHLIGHT_CONTROLLER = HIGHLIGHT && HIGHLIGHT.create ? HIGHLIGHT.create(body, hiliteTokens) : null;
  /* 供檢索列於條件變動時呼叫；彈窗未開啟時不做事 */
  FT_HILITE = function(){ if(dlg.open) applyHilite(); };

  /* 案號 → 全文 對照表：供彈窗內「原決議／覆審／歷審決議」欄位互相跳轉。
     只收錄本資料庫確實存有全文者，其餘仍以純文字呈現。 */
  /* 案號正規化：去括號、空白與「字」。下列兩份對照表共用同一份規則，
     以免「彈窗內可跳轉、樣態說明卻查不到」這類不一致。 */
  function xrefKey(t){ return String(t || '').replace(/[（）()　\s字]/g, ''); }
  var XREF = (function(){
    var map = {};
    var key = xrefKey;
    function put(t, slot, i){
      var k = key(t);
      if(k && !map[k] && ftHas(slot, i)) map[k] = {slot:slot, i:i};
    }
    for(var i = 0; i < DATA.cases.length; i++){
      var c = DATA.cases[i], j, a;
      a = String(c.caseNo || '').split(/[、，,]/);
      for(j = 0; j < a.length; j++) put(a[j], 'main', i);
      a = String(c.revNo || '').split(/[、，,]/);
      for(j = 0; j < a.length; j++) put(a[j], 'rev', i);
    }
    return function(t){ return map[key(t)] || null; };
  })();

  /* 以案號查該案的決議書全文，供樣態說明的案例案號使用。
     與 XREF 的差別：原決議案號在原決議未收錄全文時退回覆審全文
     （覆審決議書同樣記載完整事實，總比不能點好）。
     覆審案號亦一併收錄（先指向覆審全文，覆審未收錄者退回原決議全文）——
     樣態說明本來就可能引用覆審決議（如 108年度台覆字第12號），漏收會變成
     不能點的純文字。兩輪分開跑：先建完全部原決議案號，再補覆審案號，
     使極少數「甲案之覆審案號與乙案之原決議案號同字同號」時仍以原決議為準。 */
  FT_XREF_CASE = (function(){
    var map = {};
    function put(no, i, first, second){
      var a = String(no || '').split(/[、，,]/);
      for(var j = 0; j < a.length; j++){
        var k = xrefKey(a[j]);
        if(!k || map[k]) continue;
        if(ftHas(first, i))       map[k] = {slot:first,  i:i};
        else if(ftHas(second, i)) map[k] = {slot:second, i:i};
      }
    }
    for(var i = 0; i < DATA.cases.length; i++) put(DATA.cases[i].caseNo, i, 'main', 'rev');
    for(var i2 = 0; i2 < DATA.cases.length; i2++) put(DATA.cases[i2].revNo, i2, 'rev', 'main');
    return function(t){ return map[xrefKey(t)] || null; };
  })();

  var XREF_FIELDS = {'原決議':1, '覆審':1, '歷審決議':1};
  var FULLTEXT_META = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextMeta;

  /* 前導資訊區的顯示欄位與順序。彙編原檔預設只顯示「覆審／原決議／歷審決議」
     與「決議日期」，其餘標為 hide；此處改為依下列順序顯示前四項，
     「作成決議原本日期」與「來源」仍保持隱藏（來源已在標題列的按鈕上）。 */
  var META_SHOW = ['案號', '被付懲戒人', '決議日期', '原決議', '覆審', '歷審決議', '刑事確定判決'];

  /* 案號與被付懲戒人：全文字串內不存，一律由標題條的 .cn／.pname 取值後補回，
     故更正姓名只需改標題條一處。須在 reorderMeta() 之前呼叫，補上的欄位才會納入排序。 */
  function fillMetaHead(){
    if(FULLTEXT_META_CONTROLLER) return FULLTEXT_META_CONTROLLER.fillMetaHead();
    var dl = body.querySelector('.meta'), h2 = body.querySelector('.doc h2');
    if(!dl || !h2) return;
    /* 由後往前插入，故先被付懲戒人、後案號，插完即為「案號、被付懲戒人」之序 */
    var src = [['被付懲戒人', '.pname'], ['案號', '.cn']];
    for(var i = 0; i < src.length; i++){
      if(dl.querySelector('[data-meta-head="' + src[i][0] + '"]')) continue;   /* 防重複 */
      var node = h2.querySelector(src[i][1]);
      var text = node ? (node.textContent || '').trim() : '';
      if(!text) continue;
      var dt = document.createElement('dt');
      dt.textContent = src[i][0];
      dt.setAttribute('data-meta-head', src[i][0]);
      var dd = document.createElement('dd');
      dd.className = 'wide';
      dd.textContent = text;
      dl.insertBefore(dd, dl.firstChild);
      dl.insertBefore(dt, dl.firstChild);
    }
  }
  function reorderMeta(){
    if(FULLTEXT_META_CONTROLLER) return FULLTEXT_META_CONTROLLER.reorderMeta();
    var dl = body.querySelector('.meta');
    if(!dl) return;
    var dts = dl.querySelectorAll('dt'), pairs = [], i, j;
    for(i = 0; i < dts.length; i++){
      var dd = dts[i].nextElementSibling;
      if(dd && dd.tagName === 'DD'){
        pairs.push({label:(dts[i].textContent || '').trim(), dt:dts[i], dd:dd});
      }
    }
    var shown = [], rest = [];
    for(i = 0; i < META_SHOW.length; i++){
      for(j = 0; j < pairs.length; j++) if(pairs[j].label === META_SHOW[i]) shown.push(pairs[j]);
    }
    for(j = 0; j < pairs.length; j++) if(shown.indexOf(pairs[j]) < 0) rest.push(pairs[j]);

    function strip(node, add){
      var cls = (node.className || '').replace(/\bhide\b/g, ' ').replace(/\s+/g, ' ').trim();
      if(add && cls.indexOf(add) < 0) cls = (cls + ' ' + add).replace(/\s+/g, ' ').trim();
      node.className = cls;
    }
    for(i = 0; i < shown.length; i++){
      strip(shown[i].dt, '');
      strip(shown[i].dd, 'wide');    /* wide：固定落在第二欄，避免格線錯位 */
    }
    /* 依既定順序重新排列；隱藏欄位移至末端，不影響版面 */
    for(i = 0; i < shown.length; i++){ dl.appendChild(shown[i].dt); dl.appendChild(shown[i].dd); }
    for(i = 0; i < rest.length; i++){ dl.appendChild(rest[i].dt);  dl.appendChild(rest[i].dd); }
  }
  var CASENO_RE = /\d+年度[^\s、，,；<]*?字第\d+號/g;

  /* 把可跳轉的案號改寫為按鈕；沿用 .db-ft-open 類別，直接由既有的委派處理器接手 */
  function linkifyMeta(){
    if(FULLTEXT_META_CONTROLLER) return FULLTEXT_META_CONTROLLER.linkifyMeta();
    var dts = body.querySelectorAll('.meta dt');
    for(var a = 0; a < dts.length; a++){
      var label = (dts[a].textContent || '').trim();
      if(!XREF_FIELDS[label]) continue;
      var dd = dts[a].nextElementSibling;
      if(!dd || dd.tagName !== 'DD') continue;
      var changed = false;
      var html = dd.innerHTML.replace(CASENO_RE, function(m){
        var hit = XREF(m);
        if(!hit) return m;
        changed = true;
        /* 同 fullTag：不下 title，改以 aria-label 保留給讀屏軟體 */
        return '<button type="button" class="full-xref db-ft-open" data-ft-slot="' + hit.slot +
               '" data-ft-i="' + hit.i + '" aria-label="在本頁閱讀決議書全文">' + m + '</button>';
      });
      if(changed) dd.innerHTML = html;
    }
  }
  var FULLTEXT_META_CONTROLLER = FULLTEXT_META && FULLTEXT_META.create ? FULLTEXT_META.create(body, esc, function(value){ return XREF(value); }) : null;

  /* 開關彈窗時固定背景頁面的捲動位置。
     會造成背景跳動的來源有三：
       1. focus() 預設會把焦點元素捲進可視範圍；
       2. showModal() 使頁面停止捲動、捲軸消失，版面寬度改變；
       3. 本頁嵌入 jrf.org.tw 時另有「量測式置中」程式，會在 resize 後重新校正。
     第 1 點以 preventScroll 處理，第 2、3 點須在當下與下一個繪製週期各校正一次。 */

  function open(slot, i, hitNo){
    if(!FT){
      ensureFulltext().then(function(){ open(slot, i, hitNo); }).catch(function(){
        if(window.console && console.error) console.error('[律師懲戒案件資料庫] 無法開啟全文');
      });
      return;
    }
    var doc = ftDoc(slot, i), c = DATA.cases[i];
    if(!doc || !c) return;
    if(!dlg.open) lastFocus = document.activeElement;   /* 彈窗內跳轉時不覆寫原焦點 */
    var isRev = (slot === 'rev');
    /* 錨點以「案號＋姓名」表示：案號決定是哪一份決議書（原決議與覆審的案號本就不同），
       姓名用於併案（一份決議書含數名律師）時指明是哪一位。 */
    FT_ROUTE = {no: (isRev ? c.revNo : c.caseNo) || '', name: c.name || ''};
    dlg.setAttribute('aria-label', (isRev ? '覆審決議 ' + c.revNo : c.caseNo) + ' ' + c.name + ' 決議書全文');
    keepScroll(function(){
      body.innerHTML = doc;
      fillMetaHead();
      reorderMeta();
      linkifyMeta();
      applyHilite();          /* 依當下的檢索條件標示命中處 */
      if(typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');   /* 極舊瀏覽器：至少讓內容可見 */
      /* 內文捲軸歸零必須排在 showModal() 之後。彈窗尚未開啟時 #ft-body 是
         display:none、沒有版面，此時寫入 scrollTop 不會生效，瀏覽器在開啟後
         會沿用同一元素上次的捲動位置，於是新開的全文停在前一篇的位置。 */
      body.scrollTop = 0;
      focusNoScroll(body);
      goHit(hitNo);
    });
    /* 保險：字體載入或版面重排可能在下一個繪製週期才穩定，再歸零一次 */
    if(window.requestAnimationFrame) window.requestAnimationFrame(function(){ body.scrollTop = 0; goHit(hitNo); });
    if(!ftFromRoute){ ftPushed = true; routePush(); }
  }
  /* fromRoute=true：本次關閉是「上一頁回到沒有 full= 的網址」所致，
     網址已經是對的，不可再動歷史。 */
  function close(fromRoute){
    var wasOpen = dlg.open;
    FT_ROUTE = null;
    keepScroll(function(){
      body.scrollTop = 0;                  /* 趁彈窗仍有版面時先歸零 */
      if(dlg.open){ if(typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }
      body.innerHTML = '';                 /* 釋放記憶體，長文不常駐 DOM */
      focusNoScroll(lastFocus);
    });
    if(fromRoute || !wasOpen) return;
    /* 自行關閉時：若這個彈窗是我們自己推進歷史的，就退回上一筆，
       歷史不會愈疊愈長，「上一頁關閉、下一頁再開啟」也自然成立。
       若是使用者直接以帶 full= 的網址進站（沒有上一筆可退），改為就地改寫網址。 */
    if(ftPushed && window.history && history.back){ ftPushed = false; FT_CLOSING = true; history.back(); }
    else routeReplace();
  }

  /* 依案號（併案時再加姓名）開啟全文，供 [JS-ROUTE] 套用 #…/full=案號/姓名。
     找不到對應案件時靜默略過——網址被改壞不該讓整頁停擺。 */
  FT_OPEN_BY_NO = function(no, name){
    var hit = XREF(no);
    if(!hit) return;
    var i = hit.i;
    if(name){
      for(var k = 0; k < DATA.cases.length; k++){
        var c2 = DATA.cases[k];
        if(c2.name !== name) continue;
        if(xrefKey(hit.slot === 'rev' ? c2.revNo : c2.caseNo) !== xrefKey(no)) continue;
        i = k; break;
      }
    }
    if(dlg.open && FT_ROUTE && FT_ROUTE.no === no && FT_ROUTE.name === (DATA.cases[i] || {}).name) return;
    ftFromRoute = true;
    open(hit.slot, i);
    ftFromRoute = false;
  };
  FT_CLOSE = close;

  /* 事件委派：表格每次重繪都不必重新掛載 */
  var DIALOG_EVENTS = window.DisciplineApp && window.DisciplineApp.modules && window.DisciplineApp.modules.fulltextDialogEvents;
  if(DIALOG_EVENTS && DIALOG_EVENTS.bind){
    DIALOG_EVENTS.bind({
      dialog: dlg,
      open: open,
      close: close,
      getElement: el,
      onNativeClose: function(){
        body.innerHTML = '';
        if(FT_ROUTE){
          FT_ROUTE = null;
          if(ftPushed && window.history && history.back){ ftPushed = false; FT_CLOSING = true; history.back(); }
          else routeReplace();
        }
      }
    });
  }else{
  document.addEventListener('click', function(e){
    var t = e.target;
    var btn = t.closest ? t.closest('.db-ft-open') : null;
    if(btn){
      e.preventDefault();
      var hk = btn.getAttribute('data-ft-hit');   /* 只有檢索摘要列的按鈕帶此屬性 */
      open(btn.getAttribute('data-ft-slot'), parseInt(btn.getAttribute('data-ft-i'), 10), hk == null ? null : parseInt(hk, 10));
      return;
    }
    if(t === el('ft-x') || t === dlg) close();   /* 點標題列的關閉鈕或暗處 */
  });
  /* Esc 關閉走瀏覽器原生流程，不經過 close()，故在此補上同一套善後。 */
  dlg.addEventListener('close', function(){
    body.innerHTML = '';
    if(FT_ROUTE){
      FT_ROUTE = null;
      if(ftPushed && window.history && history.back){ ftPushed = false; FT_CLOSING = true; history.back(); }
      else routeReplace();
    }
  });
  }
}

/* ---------- 「詳覆審」「無全文」標籤的說明浮字 --------------------------
   這兩個標籤只說了結果，沒說原因；使用者最常問的就是「為什麼查不到全文」。
   故在標籤旁掛一段固定說明：舊制下法務部只公告確定案件，且不予懲戒／免議／
   不受理原則上不公告。文字對兩種標籤相同（「詳覆審」之所以只有覆審有全文，
   原因同樣是原決議未確定），不分歧兩套字，避免日後兩處失步。

   四個實作決定：
   1. 浮字節點建在 document.body，不放進儲存格內——.db-table-scroll 是 overflow:clip，
      放在表格裡的絕對定位浮層會被裁掉。
   2. 樣式一律 all:initial ＋ inline !important，理由同 showArticleFlash()：
      宿主 CMS 對 span 另有通用樣式，走 class 會被蓋掉。
   3. 節點在 init 時就建好、不延後到第一次 hover，aria-describedby 才不會指向
      不存在的 id；收起時只把 opacity 歸零並移到畫面外，仍留在無障礙樹中。
   4. 觸發走 document 事件委派（同全文按鈕），表格每次重繪都不必重新掛載；
      hover／focus／click 三路並行，觸控裝置沒有 hover 也點得出來。 */
var FT_TIP_TEXT = '《律師法》於民國 109 年修正以前，依舊《律師懲戒規則》第 25 條規定，' +
  '法務部僅公告「確定案件」的決議書；且就「不予懲戒」、「免議」、「不受理」之情形，' +
  '原則上亦不公告。';
var FT_TIP_NODE = null, FT_TIP_FOR = null, FT_TIP_RAF = 0;

function initFullTagTip(){
  if(FT_TIP_NODE || !document.body) return;

  var n = document.createElement('span');
  n.id = 'db-ft-tip';
  n.setAttribute('role', 'tooltip');
  n.textContent = FT_TIP_TEXT;

  /* all:initial 先清掉宿主對 span 的通用樣式；後續每一項再以 inline !important 指定。 */
  var s = n.style;
  s.setProperty('all', 'initial', 'important');
  s.setProperty('position', 'fixed', 'important');
  s.setProperty('display', 'block', 'important');
  s.setProperty('box-sizing', 'border-box', 'important');
  s.setProperty('left', '-9999px', 'important');
  s.setProperty('top', '0', 'important');
  s.setProperty('width', 'max-content', 'important');
  s.setProperty('margin', '0', 'important');
  s.setProperty('padding', '10px 13px', 'important');
  s.setProperty('border', '1px solid #C9A96A', 'important');
  s.setProperty('border-radius', '6px', 'important');
  s.setProperty('background', '#2B2B2E', 'important');
  s.setProperty('color', '#F7F1E6', 'important');
  s.setProperty('font-family', 'Noto Sans TC,PingFang TC,Microsoft JhengHei,system-ui,sans-serif', 'important');
  s.setProperty('font-size', '13px', 'important');
  s.setProperty('font-weight', '400', 'important');
  s.setProperty('font-style', 'normal', 'important');
  s.setProperty('line-height', '1.85', 'important');
  s.setProperty('letter-spacing', '.02em', 'important');
  s.setProperty('text-align', 'left', 'important');
  /* pre-line：保留文字中的換行（懲戒決定的條文各款需分行），連續空白仍會收合 */
  s.setProperty('white-space', 'pre-line', 'important');
  s.setProperty('word-break', 'break-word', 'important');
  s.setProperty('box-shadow', '0 12px 30px rgba(26,22,18,.32)', 'important');
  s.setProperty('pointer-events', 'none', 'important');
  s.setProperty('z-index', '2147483645', 'important');
  s.setProperty('visibility', 'visible', 'important');
  s.setProperty('transform', 'none', 'important');
  s.setProperty('opacity', '0', 'important');
  s.setProperty('transition', 'opacity .16s', 'important');

  document.body.appendChild(n);
  FT_TIP_NODE = n;

  var raf = window.requestAnimationFrame || function(fn){
    return setTimeout(function(){ fn(Date.now()); }, 16);
  };

  /* 錨定於觸發標籤：預設放上方置中，上方放不下才翻到下方；左右一律夾在視窗內。
     max-width 於此處依視窗寬度即時算出，不寫 min()／calc()——inline style 中
     若瀏覽器不支援該函式，整條宣告會被丟棄，浮字就會失去寬度上限而拉成一長條。 */
  function place(t){
    if(!FT_TIP_NODE || !t || !t.getBoundingClientRect) return;
    var vw = window.innerWidth || document.documentElement.clientWidth || 0;
    var vh = window.innerHeight || document.documentElement.clientHeight || 0;
    var pad = 12, gap = 8;
    var st = FT_TIP_NODE.style;

    st.setProperty('max-width', Math.max(200, Math.min(340, vw - pad * 2)) + 'px', 'important');
    /* 先移回畫面外的固定座標再量測，避免沿用上一輪殘留位置算出錯誤寬高 */
    st.setProperty('left', '-9999px', 'important');
    st.setProperty('top', '0', 'important');

    var w = FT_TIP_NODE.offsetWidth, h = FT_TIP_NODE.offsetHeight;
    var r = t.getBoundingClientRect();

    var left = r.left + r.width / 2 - w / 2;
    if(left + w > vw - pad) left = vw - pad - w;
    if(left < pad) left = pad;

    var top = r.top - h - gap;
    if(top < pad) top = r.bottom + gap;
    if(top + h > vh - pad) top = Math.max(pad, vh - pad - h);

    st.setProperty('left', Math.round(left) + 'px', 'important');
    st.setProperty('top', Math.round(top) + 'px', 'important');
  }

  function show(t){
    if(!t || FT_TIP_FOR === t) return;
    FT_TIP_FOR = t;
    /* data-ft-tip 帶文字者以該文字顯示（"1"＝沿用預設的未公告原因說明）。
       文字要在 place() 之前寫入：浮字的寬高是量出來的，先定位會算錯。 */
    var custom = t.getAttribute ? t.getAttribute('data-ft-tip') : '';
    FT_TIP_NODE.textContent = (custom && custom !== '1') ? custom : FT_TIP_TEXT;
    place(t);
    FT_TIP_NODE.style.setProperty('opacity', '1', 'important');
  }

  function hide(){
    if(!FT_TIP_NODE || !FT_TIP_FOR) return;
    FT_TIP_FOR = null;
    FT_TIP_NODE.style.setProperty('opacity', '0', 'important');
    FT_TIP_NODE.style.setProperty('left', '-9999px', 'important');
  }

  function target(e){
    var t = e && e.target;
    return (t && t.closest) ? t.closest('[data-ft-tip]') : null;
  }
  function toggle(e){
    var t = target(e);
    if(t) show(t); else hide();
  }

  /* hover 與 focus 各管一路；click 是給觸控裝置的（點標籤顯示，點別處收起，
     切換頁籤／翻頁等動作都會先經過這裡而自動收起）。 */
  document.addEventListener('mouseover', toggle);
  document.addEventListener('focusin', toggle);
  /* 欄位說明鈕（data-help）點擊另開說明卡片，故點擊時不再彈浮字——否則同一次點擊
     會出現兩份相同說明。滑鼠停留與鍵盤聚焦仍照常顯示。 */
  document.addEventListener('click', function(e){
    var t = target(e);
    if(t && t.getAttribute && t.getAttribute('data-help')){ hide(); return; }
    toggle(e);
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' || e.keyCode === 27) hide();
  });
  if(document.documentElement) document.documentElement.addEventListener('mouseleave', hide);

  /* 捲動／改變視窗大小時跟著移動（浮字是 fixed，不跟就會與標籤脫節）。
     scroll 走捕獲階段，表格自身的橫向捲動也收得到；校正以 rAF 節流，
     與檔內其它 resize 校正同一作法。標籤已不在文件中（換頁、切頁籤）就直接收起。 */
  function follow(){
    if(!FT_TIP_FOR || FT_TIP_RAF) return;
    FT_TIP_RAF = raf(function(){
      FT_TIP_RAF = 0;
      if(!FT_TIP_FOR) return;
      if(!document.documentElement.contains(FT_TIP_FOR)){ hide(); return; }
      place(FT_TIP_FOR);
    });
  }
  window.addEventListener('scroll', follow, {capture:true, passive:true});
  window.addEventListener('resize', follow);
}

/* [JS-HOME] 首頁（進站著陸頁）
   本區不新增任何資料來源，只做三件事：
   1. 看板四個數字一律在此由 DATA／FT 推導，HTML 內不寫死；
   2. 快速檢索框與「常見查法」標籤一律轉呼叫既有的 gotoCaseSearch()，
      使首頁與案件清單共用同一套檢索狀態，不另立第二套邏輯；
   3. 導覽卡片與按鈕使用一般站內網址；JavaScript 啟用時由 History API 無刷新切換，
      未啟用時仍可由瀏覽器直接前往該網址。 */
var homeReady = false;
/* 處分輕重分布的六個級距：由 HC_OF(h) 的 1–8 合併而來（申誡、警告的「併研習」
   與否在首頁不細分，要細分仍看案件清單的懲戒決定欄）。
   顏色不在此另存：kind 指向 kindItems() 的分類名稱（去掉括號說明），於首頁渲染時
   取用同一個色值，故首頁兩張圓餅圖與統計頁配色一致，改色只需改 kindItems。
   停職分兩級而 kindItems 只有一色，「未滿 1 年」以 tint 比例調淡該色作區分。 */
var SEV_BANDS = [
  {name:'除名',          hcs:[1],   kind:'除名'},
  {name:'停職 1 年以上',  hcs:[2],   kind:'停止執行職務'},
  {name:'停職未滿 1 年',  hcs:[3],   kind:'停止執行職務', tint:0.4},
  {name:'申誡',          hcs:[4,5], kind:'申誡'},
  {name:'警告',          hcs:[6,7], kind:'警告'},
  {name:'僅命研習',       hcs:[8],   kind:'研習'}
];

/* 首頁看板列的「資料更新」一律回頭讀頁尾那一行，不另存第二個日期。
   頁尾的日期是全檔唯一由維護者手動維護的日期字串（見檔首交付方式第 2 點），
   多存一份就會有失步的一天。讀不到或格式不符時回傳空字串，該行即不顯示。 */
function dbUpdatedText(){
  var foot = el('db-foot');
  var m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(foot ? foot.textContent : '');
  if(!m) return '';
  function p2(n){ return (n.length < 2 ? '0' : '') + n; }
  return m[1] + '.' + p2(m[2]) + '.' + p2(m[3]);
}
/* 資料庫說明的時間範圍結束日與頁尾更新日期共用同一來源，只轉為民國格式。 */
function dbUpdatedRocText(){
  var foot = el('db-foot');
  var m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(foot ? foot.textContent : '');
  if(!m) return '';
  return '民國 ' + (parseInt(m[1], 10) - 1911) + ' 年 ' + parseInt(m[2], 10) + ' 月 ' + parseInt(m[3], 10) + ' 日';
}

function initHome(){
  if(homeReady) return;
  homeReady = true;
  var root = el('tab-home');
  if(!root) return;

  /* ── 看板數字：全部推導，切勿改為寫死 ── */
  var seen = {}, nCase = 0, minD = '', maxD = '';
  DATA.cases.forEach(function(c){
    if(c.caseNo && !seen[c.caseNo]){ seen[c.caseNo] = 1; nCase++; }
    [c.date, c.revDate].forEach(function(d){
      if(!d) return;
      if(!minD || d < minD) minD = d;
      if(!maxD || d > maxD) maxD = d;
    });
  });

  /* 成立／不成立：判準與案件清單「懲戒決定」欄的底色同一份 HC_OF——
     hc===0 為非懲戒，其中律聲字（暫停職聲請，h 為 1001／1001.1／1002）
     性質上既非成立也非不成立，另計為第三類，不併入任何一邊。
     三個數字與比例條一律在此由 DATA 推導，HTML 內不寫死。 */
  var nYes = 0, nNo = 0, nTemp = 0;
  DATA.cases.forEach(function(c){
    if(HC_OF(c.h) !== 0){ nYes++; return; }
    if(+c.h >= 1000) nTemp++; else nNo++;
  });

  function put(id, v){ var node = el(id); if(node) node.textContent = v; }
  put('home-n-case', numFmt(nCase));
  put('home-n-person', numFmt(DATA.cases.length));
  put('about-n-person', numFmt(DATA.cases.length));
  put('about-date-end', dbUpdatedRocText() || '\u2014');
  put('home-n-yes', numFmt(nYes));
  put('home-n-no', numFmt(nNo));
  put('home-n-temp', numFmt(nTemp));
  (function(){
    var tot = nYes + nNo + nTemp;
    if(!tot) return;
    [['home-bar-y', nYes], ['home-bar-n', nNo], ['home-bar-t', nTemp]].forEach(function(p){
      var node = el(p[0]);
      if(node) node.style.width = (p[1] / tot * 100) + '%';
    });
  })();
  put('home-n-pat', numFmt(DATA.patterns.length));
  if(minD && maxD){
    var y1 = parseInt(minD.slice(0, 4), 10), y2 = parseInt(maxD.slice(0, 4), 10);
    if(y1 && y2){
      put('home-n-years', String(y2 - y1 + 1));
      put('home-n-range', '民國 ' + (y1 - 1911) + '\u2013' + (y2 - 1911) + ' 年（西元 ' + y1 + '\u2013' + y2 + '）');
    }
  }

  /* ── 資料更新日期（取自頁尾，見 dbUpdatedText）── */
  (function(){
    var node = el('home-updated'), t = dbUpdatedText();
    if(!node) return;
    if(t) node.innerHTML = '資料更新於 <b>' + esc(t) + '</b>';
    else node.style.display = 'none';
  })();

  /* ── 近年懲戒處分結果分布（甜甜圈）──
     資料、分類、顏色、年度區間全部來自 kindItems()／PIE_RANGES，與統計頁同一份，
     故兩頁的數字與配色不可能分歧。切片以 conic-gradient 疊出：逐項累加百分比，
     每一段寫成「色 起% 止%」。 */
  (function(){
    var donut = el('home-kind-donut');
    if(!donut || typeof kindItems !== 'function') return;
    var rg = PIE_RANGES.recent;
    /* 首頁的切片與圖例一律依 HOME_KIND_ORDER 排列（由重到輕，不予懲戒殿後）；
       只在此處重排，kindItems 本身的順序不動，統計頁不受影響。
       比對時去掉括號說明，未列於清單者排在最後。 */
    var HOME_KIND_ORDER = ['除名', '停止執行職務', '申誡', '警告', '研習', '不予懲戒'];
    function kindKey(it){ return String(it.name).replace(/[（(][^）)]*[）)]/g, '').trim(); }
    function kindRank(it){ var i = HOME_KIND_ORDER.indexOf(kindKey(it)); return i < 0 ? HOME_KIND_ORDER.length : i; }
    var items = kindItems(rg.y0, rg.y1).slice().sort(function(a, b){ return kindRank(a) - kindRank(b); });
    var total = 0;
    items.forEach(function(it){ total += (it.value || 0); });
    if(!total) return;
    var acc = 0, segs = [];
    items.forEach(function(it){
      var from = acc / total * 100;
      acc += (it.value || 0);
      var to = acc / total * 100;
      segs.push(it.color + ' ' + from.toFixed(3) + '% ' + to.toFixed(3) + '%');
    });
    donut.style.background = 'conic-gradient(' + segs.join(',') + ')';
    put('home-kind-total', numFmt(total));
    var sub = el('home-kind-sub');
    if(sub) sub.textContent = '民國' + rocRangeText(rg.y0, rg.y1);
    var lg = el('home-kind-legend');
    if(lg){
      /* 圖例與切片同序（見上方 HOME_KIND_ORDER） */
      lg.innerHTML = items.map(function(it){
        var pct = (it.value / total * 100).toFixed(1) + '%';
        return '<div><i style="background:' + esc(it.color) + '"></i>' +
          '<span class="db-lg-n">' + esc(kindKey(it)) + '</span>' +
          '<span class="db-lg-v">' + numFmt(it.value) + '<span class="db-lg-u">人</span></span>' +
          '<span class="db-lg-p">' + pct + '</span></div>';
      }).join('');
    }
  })();

  /* ── 本資料庫處分輕重分布（甜甜圈，中央為合計人數）──
     級距與顏色見 SEV_BANDS；由 HC_OF(h) 推導，與案件清單懲戒決定欄同一個判準。
     計數單位為人：DATA.cases 每筆即一名被付懲戒人（同一人同一事件計一次），
     與左側法務部統計「近 5 年懲戒結果分布」以人數計算的邏輯一致。
     副標的起始年取自全部案件最早的日期（minD），迄年不寫死，以「迄今」表示。
     切片與圖例皆依 SEV_BANDS 由重到輕排列（不依件數排序），以保留輕重秩序。
     切片繪法同左側甜甜圈：conic-gradient 逐項累加百分比。 */
  (function(){
    var pie = el('home-sev-pie'), lg = el('home-sev-legend');
    if(!pie) return;
    var byHc = {};
    DATA.cases.forEach(function(c){
      var hc = HC_OF(c.h);
      if(hc === '' || hc === 0) return;       /* 非懲戒（不予懲戒、免議、不受理、律聲字）不計入 */
      byHc[hc] = (byHc[hc] || 0) + 1;
    });
    /* 色值取自 kindItems（見 SEV_BANDS 註解）；查不到時退回中性灰 */
    var kindColor = {};
    if(typeof kindItems === 'function'){
      kindItems().forEach(function(it){
        kindColor[String(it.name).replace(/[（(][^）)]*[）)]/g, '').trim()] = it.color;
      });
    }
    function tintHex(hex, t){
      var n = parseInt(String(hex).slice(1), 16);
      function mix(c){ return Math.round(c + (255 - c) * t); }
      return '#' + ((1 << 24) | (mix(n >> 16 & 255) << 16) | (mix(n >> 8 & 255) << 8) | mix(n & 255)).toString(16).slice(1);
    }
    var sum = 0;
    var rows = SEV_BANDS.map(function(b){
      var v = 0;
      b.hcs.forEach(function(hc){ v += (byHc[hc] || 0); });
      sum += v;
      var c = kindColor[b.kind] || '#C9C6C2';
      if(b.tint && kindColor[b.kind]) c = tintHex(c, b.tint);
      return {name:b.name, color:c, value:v};
    });
    if(!sum) return;
    var acc = 0, segs = [];
    rows.forEach(function(r){
      var from = acc / sum * 100;
      acc += r.value;
      var to = acc / sum * 100;
      segs.push(r.color + ' ' + from.toFixed(3) + '% ' + to.toFixed(3) + '%');
    });
    pie.style.background = 'conic-gradient(' + segs.join(',') + ')';
    if(lg){
      lg.innerHTML = rows.map(function(r){
        return '<div><i style="background:' + esc(r.color) + '"></i>' +
          '<span class="db-lg-n">' + esc(r.name) + '</span>' +
          '<span class="db-lg-v">' + numFmt(r.value) + '<span class="db-lg-u">人</span></span>' +
          '<span class="db-lg-p">' + (r.value / sum * 100).toFixed(1) + '%</span></div>';
      }).join('');
    }
    put('home-sev-total', numFmt(sum));
    var sub = el('home-sev-sub');
    if(sub && minD) sub.textContent = '民國' + (parseInt(minD.slice(0, 4), 10) - 1911) + '–迄今';
  })();

  /* ── 快速檢索：一律走既有的 gotoCaseSearch() ── */
  function runHomeSearch(q){
    q = String(q || '').trim();
    if(!q || typeof gotoCaseSearch !== 'function') return;
    gotoCaseSearch(q);       /* 網址由 gotoCaseSearch 內的 routePush() 一併寫入 */
  }
  var qIn = el('home-q'), qBtn = el('home-q-btn');
  if(qBtn) qBtn.addEventListener('click', function(){ runHomeSearch(qIn ? qIn.value : ''); });
  if(qIn){
    qIn.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); runHomeSearch(qIn.value); }
    });
  }

  /* ── 事件委派：常見查法標籤、導覽卡片 ── */
  root.addEventListener('click', function(e){
    var t = e.target;
    if(!t || !t.closest) return;
    var tag = t.closest('.db-home-tag');
    if(tag){ runHomeSearch(tag.getAttribute('data-homeq')); return; }
    var go = t.closest('[data-homego]');
    if(go){
      if(pathRoutingReady){
        var url = go.getAttribute('href');
        e.preventDefault();
        if(url && currentLocationKey() !== url){
          ROUTE_LAST = url;
          history.pushState(null, '', url);
        }
        applyRoute(false);
        return;
      }
      var btn = el('tabbtn-' + go.getAttribute('data-homego'));
      if(btn && btn.getAttribute('aria-selected') !== 'true') btn.click();
    }
  });
}

/* [JS-ANALYSIS] 統計與分析：分頁切換、專題分析列表與文章 */
/* ---------- 統計與分析 -------------------------------------------------
   頁籤「統計與分析」下分兩個分頁：專題分析（預設）與統計。
   網址：/stats＝專題分析列表；/stats/articles/文章代號＝開啟該篇；/stats/data＝統計分頁。
   統計圖表沿用原本的延遲初始化（initStats），改為「統計分頁第一次顯示時」才執行：
   預設停在專題分析時統計分頁是隱藏的，不必先畫。

   文章本體是 HTML 中的 <article class="db-ana-art" data-ana-id>；列表項目由
   buildAnaList() 讀取文章標題、日期、第一章以前的段落與第一張圖自動產生。
   新增文章只需加一段 article，不必再同步維護另一份列表內容。
   文中案號與圖表不在 HTML 內寫死決議書位置：第一次開啟該篇時才由 FT_XREF_CASE
   把案號改寫為全文按鈕、由 DATA 繪製圖表（理由同覆轍清單第 1 點）。 */
var ANA = {sub:'analysis', art:''};
var anaEnhanced = {};
function anaArticles(){
  var out = {}, nodes = document.querySelectorAll('#stats-sub-analysis .db-ana-art[data-ana-id]');
  for(var i = 0; i < nodes.length; i++) out[nodes[i].getAttribute('data-ana-id')] = nodes[i];
  return out;
}
function buildAnaList(){
  var list = el('ana-list'), arts = anaArticles();
  if(!list) return;
  list.innerHTML = '';
  Object.keys(arts).forEach(function(id){
    var art = arts[id], body = art.querySelector('.db-ana-body');
    if(!body) return;
    /* 動態圖必須先完成繪製，列表才能複製第一張圖作主視覺。每篇只 enhance 一次。 */
    if(!anaEnhanced[id]){
      anaEnhanced[id] = true;
      safeRun('專題分析文章', function(){ anaEnhance(art); });
    }
    var titleNode = art.querySelector('.db-ana-art-t');
    var dateNode = art.querySelector('.db-ana-art-m time');
    var intro = [], child = body.firstElementChild;
    while(child){
      if(child.matches && (child.matches('h2,h3,.db-ana-h') || /^一[、　\s]/.test((child.textContent || '').trim()))) break;
      if(child.tagName === 'P' && (child.textContent || '').trim()) intro.push((child.textContent || '').replace(/\s+/g, ' ').trim());
      child = child.nextElementSibling;
    }
    var visual = body.querySelector('.db-ana-fig-svg svg, figure img, figure svg, img');
    var li = document.createElement('li'), a = document.createElement('a');
    a.className = 'db-ana-item' + (visual ? '' : ' db-ana-item-no-visual');
    a.setAttribute('data-ana-open', id);
    a.href = '/stats/articles/' + encodeURIComponent(id);
    if(visual){
      var media = document.createElement('span'), clone = visual.cloneNode(true);
      media.className = 'db-ana-item-visual';
      clone.removeAttribute('id');
      if(clone.querySelectorAll) clone.querySelectorAll('[id]').forEach(function(n){ n.removeAttribute('id'); });
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('focusable', 'false');
      if(clone.tagName === 'IMG') clone.alt = '';
      media.appendChild(clone);
      a.appendChild(media);
    }
    var content = document.createElement('span');
    content.className = 'db-ana-item-content';
    content.innerHTML = '<span class="db-ana-item-head"><span class="db-ana-item-t">' + esc(titleNode ? titleNode.textContent.trim() : id) + '</span>' +
      (dateNode ? '<time class="db-ana-item-d" datetime="' + esc(dateNode.getAttribute('datetime') || '') + '">' + esc(dateNode.textContent.trim()) + '</time>' : '') + '</span>' +
      '<span class="db-ana-item-summary">' + intro.map(function(p){ return '<span>' + esc(p) + '</span>'; }).join('') + '</span>' +
      '<span class="db-ana-item-more">閱讀專題 <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M4 12h14M12.5 6.5 18 12l-5.5 5.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path></svg></span>';
    a.appendChild(content);
    li.appendChild(a);
    list.appendChild(li);
  });
}
function anaScrollTop(){
  if(ROUTE_APPLYING) return;               /* 由網址套用時，捲動交給路由模組 */
  scrollToInstant(0, 0);
}
function setStatsSub(sub){
  ANA.sub = (sub === 'data') ? 'data' : 'analysis';
  var bar = el('stats-subtabs');
  if(bar) bar.querySelectorAll('.db-subtab[data-ssub]').forEach(function(b){
    b.setAttribute('aria-pressed', b.getAttribute('data-ssub') === ANA.sub ? 'true' : 'false');
  });
  var pa = el('stats-sub-analysis'), pd = el('stats-sub-data');
  if(pa) pa.hidden = (ANA.sub !== 'analysis');
  if(pd) pd.hidden = (ANA.sub !== 'data');
  if(ANA.sub === 'data' && !statsReady && currentTabKey() === 'stats') safeRun('統計圖表', initStats);
}
/* 頁籤被切到「統計與分析」時由 [JS-TABS] 呼叫 */
function anaOnTabShown(){
  if(ANA.sub === 'data' && !statsReady) safeRun('統計圖表', initStats);
}
function anaShowArticle(id){
  var arts = anaArticles(), a = (id && arts[id]) ? id : '';
  ANA.art = a;
  var list = el('ana-list');
  if(list) list.hidden = !!a;
  for(var k in arts){ if(Object.prototype.hasOwnProperty.call(arts, k)) arts[k].hidden = (k !== a); }
  if(a && !anaEnhanced[a]){
    anaEnhanced[a] = true;
    safeRun('專題分析文章', function(){ anaEnhance(arts[a]); });
  }
  return !!a;
}
/* 套用網址：一律由預設值重建（見 [JS-ROUTE] 設計要點 3） */
function applyStatsRoute(P){
  var data = P.bare.indexOf('data') >= 0;
  var article = P.named.a || '';
  var ai = P.bare.indexOf('articles');
  if(ai >= 0 && P.bare[ai + 1]) article = P.bare[ai + 1];
  anaShowArticle(data ? '' : article);
  setStatsSub(data ? 'data' : 'analysis');
}

/* ---------- 文章內容的後處理 ---------- */
var ANA_NO_RE = /(\d{2,3})\s*年度\s*(律懲|台覆)\s*字\s*第\s*(\d+)\s*號(等)?/g;
/* 圖中圓點的全文開啟屬性：查得全文者才加 .db-ft-open，否則只留浮字 */
function anaFtAttrs(no){
  var hit = (typeof FT_XREF_CASE === 'function') ? FT_XREF_CASE(no) : null;
  return hit ? {cls:' db-ft-open', attrs:' tabindex="0" role="button" data-ft-slot="' + hit.slot + '" data-ft-i="' + hit.i + '"'} : {cls:'', attrs:''};
}
function anaLinkCaseNos(root){
  if(!root || typeof FT_XREF_CASE !== 'function') return;
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), texts = [], n;
  while((n = walker.nextNode())){
    if(n.parentNode && n.parentNode.closest && n.parentNode.closest('button, svg, .db-ana-fig-svg')) continue;
    ANA_NO_RE.lastIndex = 0;
    if(ANA_NO_RE.test(n.nodeValue)) texts.push(n);
  }
  texts.forEach(function(t){
    var s = t.nodeValue, frag = document.createDocumentFragment(), last = 0, m, runs = [];
    ANA_NO_RE.lastIndex = 0;
    while((m = ANA_NO_RE.exec(s))){
      var hit = FT_XREF_CASE(m[1] + '年度' + m[2] + '字第' + m[3] + '號');
      if(!hit) continue;                    /* 查無全文者維持純文字，不做點了沒反應的按鈕 */
      /* 併案的數個案號以頓號相連（例：「102年度律懲字第9號、102年度律懲字第18號」），
         指向同一份決議書，合為一個連結；頓號相連但屬不同決議書者（文中列舉案例）仍分開。 */
      var prev = runs[runs.length - 1];
      if(prev && s.slice(prev.end, m.index) === '、' && prev.hit.slot === hit.slot && prev.hit.i === hit.i){
        prev.end = m.index + m[0].length;
      }else{
        runs.push({start:m.index, end:m.index + m[0].length, hit:hit});
      }
    }
    runs.forEach(function(r){
      if(r.start > last) frag.appendChild(document.createTextNode(s.slice(last, r.start)));
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'db-ana-no db-ft-open';
      b.setAttribute('data-ft-slot', r.hit.slot);
      b.setAttribute('data-ft-i', String(r.hit.i));
      b.title = '開啟決議書全文';
      b.textContent = s.slice(r.start, r.end);
      frag.appendChild(b);
      last = r.end;
    });
    if(!last) return;
    if(last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    t.parentNode.replaceChild(frag, t);
  });
}
function anaMonths(m){
  var y = Math.floor(m / 12), r = m % 12;
  return (y ? y + ' 年' : '') + (y && r ? ' ' : '') + (r ? r + ' 月' : '');
}
var ANA_DIS_COLOR = '#8E1F33', ANA_NON_COLOR = '#2C4A73', ANA_DOT_GREY = '#D5CFC9';

/* 圖一：終局懲戒決議一點一件，依決議日期排列，除名者標紅。
   母體由 DATA 推導（排除暫時處分 IS_PROV），並以文章的 data-ana-asof 為統計截止日，
   日後資料庫新增案件時，圖仍維持文章撰寫時的範圍。
   figure 上的 data-ana-expect 是文中所寫的「件數,除名數」，不符時於主控台提示。 */
function anaFig1(box, asof){
  var idx = [];
  DATA.cases.forEach(function(c, i){
    if(IS_PROV[i]) return;
    if(asof && String(c.date || '') > asof) return;
    idx.push(i);
  });
  idx.sort(function(a, b){
    var da = String(DATA.cases[a].date || ''), db = String(DATA.cases[b].date || '');
    return da < db ? -1 : da > db ? 1 : a - b;
  });
  var COLS = 31, STEP = 11, PAD = 9.1, rows = Math.ceil(idx.length / COLS), nDis = 0;
  var w = PAD * 2 + (COLS - 1) * STEP, h = PAD * 2 + (rows - 1) * STEP, dots = [];
  idx.forEach(function(i, k){
    var c = DATA.cases[i], x = (PAD + (k % COLS) * STEP).toFixed(1), y = (PAD + Math.floor(k / COLS) * STEP).toFixed(1);
    var dis = (HC_OF(c.h) === 1);
    var tip = esc(c.caseNo + '（' + c.date + '）：' + c.decision);
    if(dis){
      nDis++;
      var fa = anaFtAttrs(String(c.caseNo).split(/[、，,]/)[0]);
      dots.push('<g class="db-ana-pt' + fa.cls + '" data-tip="' + tip + '" aria-label="' + tip + '"' + fa.attrs + '>' +
        '<circle cx="' + x + '" cy="' + y + '" r="5" fill="none" stroke="' + ANA_DIS_COLOR + '" stroke-width=".8" opacity=".55"></circle>' +
        '<circle cx="' + x + '" cy="' + y + '" r="3.1" fill="' + ANA_DIS_COLOR + '"></circle></g>');
    }else{
      dots.push('<g class="db-ana-pt" data-tip="' + tip + '" aria-label="' + tip + '">' +
        '<circle cx="' + x + '" cy="' + y + '" r="3.1" fill="' + ANA_DOT_GREY + '"></circle></g>');
    }
  });
  box.innerHTML = '<svg viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" role="img" aria-label="' +
    idx.length + ' 件終局懲戒決議，其中 ' + nDis + ' 件最終除名">' + dots.join('') + '</svg>' +
    '<div class="db-ana-key"><span><i style="background:' + ANA_DIS_COLOR + '"></i>最終除名</span>' +
    '<span><i style="background:' + ANA_DOT_GREY + '"></i>其他終局決議</span></div>';
  var fig = box.closest ? box.closest('figure') : null, exp = fig ? fig.getAttribute('data-ana-expect') : '';
  if(exp && exp !== idx.length + ',' + nDis && window.console && console.warn){
    console.warn('[律師懲戒案件資料庫] 專題分析圖一：資料推導為 ' + idx.length + ' 件／除名 ' + nDis + ' 件，與文中所寫 ' + exp + ' 不符');
  }
}

/* 圖二：律師本人的統計刑度（月）與是否除名。
   刑度是逐案自決議書與刑事判決核對的人工結果，DATA 沒有這個欄位，故於此列出；
   是否除名則一律由 DATA 推導，不在此另存。統計口徑同文中「刑種與刑度」表：
   數罪併罰取應執行刑，未定應執行刑者取最重宣告刑，經減刑者取減刑前宣告刑。
   上排為除名之全部案件（懲戒時刑事判決尚未確定者除外），下排為未除名而刑度 1 年以上者。
   每筆：[案號（併案取第一個）, 月數, 姓名（同一案號有數名被付懲戒人時才填）, 文中標記] */
var ANA_FIG2 = {
  dis: [['102年度律懲字第9號',240],['101年度律懲字第21號',168],['98年度律懲字第8號',144],['106年度律懲字第33號',102],
        ['113年度律懲字第69號',90],['111年度律懲字第50號',66],['112年度律懲字第44號',50],['105年度律懲字第23號',48],
        ['96年度律懲字第19號',46],['109年度律懲字第22號',36],['108年度律懲字第12號',36],['100年度律懲字第8號',34],
        ['109年度律懲字第10號',32],['105年度律懲字第15號',30],['99年度律懲字第13號',28],['111年度律懲字第47號',26],
        ['99年度律懲字第2號',24],['99年度律懲字第22號',24,'張權','（甲）'],['101年度律懲字第16號',24],['103年度律懲字第16號',21],
        ['96年度律懲字第17號',20],['99年度律懲字第15號',20],['99年度律懲字第22號',18,'邱創舜','（乙）'],['98年度律懲字第12號',14],
        ['94年度律懲字第3號',10],['95年度律懲字第3號',10],['111年度律懲字第28號',10]],
  non: [['108年度律懲字第44號',54],['107年度律懲字第31號',36],['106年度律懲字第39號',24,'李慶豐'],['106年度律懲字第39號',24,'陳德峯'],
        ['110年度律懲字第22號',24],['113年度律懲字第23號',24],['98年度律懲字第11號',20],['107年度律懲字第3號',18],
        ['114年度律懲字第8號',18],['101年度律懲字第18號',16],['104年度律懲字第6號',16],['106年度律懲字第19號',16],
        ['100年度律懲字第7號',14],['113年度律懲字第6號',14],['99年度律懲字第4號',12],['103年度律懲字第32號',12],
        ['98年度律懲字第17號',12],['111年度律懲字第46號',12],['106年度律懲字第12號',12]]
};
function anaFig2(box){
  function findCase(no, name){
    var hit = -1, n = 0;
    DATA.cases.forEach(function(c, i){
      if(String(c.caseNo).split(/[、，,]/).indexOf(no) < 0) return;
      if(name && c.name !== name) return;
      hit = i; n++;
    });
    return n === 1 ? hit : -1;
  }
  var X0 = 78, X1 = 742, LO = Math.log(3), HI = Math.log(240);
  function xOf(m){ return X0 + (Math.log(m) - LO) / (HI - LO) * (X1 - X0); }
  var bad = [];
  function lane(list, wantDis, cy){
    var pts = [];
    list.forEach(function(it){
      var i = findCase(it[0], it[2]);
      if(i < 0){ bad.push(it[0] + '：查無唯一對應案件'); return; }
      var c = DATA.cases[i], dis = (HC_OF(c.h) === 1);
      if(dis !== wantDis) bad.push(it[0] + '：除名與否與資料不符');
      pts.push({x:xOf(it[1]), m:it[1], c:c, tag:it[3] || ''});
    });
    pts.sort(function(a, b){ return a.x - b.x; });
    var OFF = [0, -10, 10, -20, 20, -30, 30], start = -1e9, k = 0;
    return pts.map(function(p){
      if(p.x - start > 11){ start = p.x; k = 0; } else k++;
      var y = cy + OFF[k % OFF.length], first = String(p.c.caseNo).split(/[、，,]/)[0];
      var tip = esc(first + p.tag + '｜本人刑度 ' + anaMonths(p.m) + '｜' + p.c.decision);
      var fa = anaFtAttrs(first);
      return '<g class="db-ana-pt' + fa.cls + '" aria-label="' + tip + '"' + fa.attrs + '>' +
        '<title>' + tip + '</title><circle cx="' + p.x.toFixed(1) + '" cy="' + y + '" r="5" fill="' + (wantDis ? ANA_DIS_COLOR : ANA_NON_COLOR) +
        '" fill-opacity=".85"></circle></g>';
    }).join('');
  }
  var ticks = [[3,'3 月'],[6,'6 月'],[12,'1 年'],[24,'2 年'],[60,'5 年'],[120,'10 年'],[240,'20 年']];
  var ax = ticks.map(function(t){
    var x = xOf(t[0]).toFixed(1);
    return '<line x1="' + x + '" y1="24" x2="' + x + '" y2="200" stroke="#E2DEDA" stroke-width="1"></line>' +
           '<text x="' + x + '" y="219" text-anchor="middle" font-size="12" fill="#6B6F76">' + t[1] + '</text>';
  }).join('');
  var lblStyle = ' font-size="14" font-weight="700" fill="#1B3255"', subStyle = ' font-size="11.5" fill="#6B6F76"';
  box.innerHTML = '<svg viewBox="0 0 760 232" role="img" aria-label="刑度 1 年以上案件之懲處結果對照">' + ax +
    '<text x="6" y="66"' + lblStyle + '>除名</text><text x="6" y="84"' + subStyle + '>' + ANA_FIG2.dis.length + ' 件</text>' +
    '<text x="6" y="152"' + lblStyle + '>未除名</text><text x="6" y="170"' + subStyle + '>' + ANA_FIG2.non.length + ' 件</text>' +
    lane(ANA_FIG2.dis, true, 70) + lane(ANA_FIG2.non, false, 156) + '</svg>' +
    '<div class="db-ana-key"><span><i style="background:' + ANA_DIS_COLOR + '"></i>除名</span>' +
    '<span><i style="background:' + ANA_NON_COLOR + '"></i>未除名</span></div>';
  if(bad.length && window.console && console.warn) console.warn('[律師懲戒案件資料庫] 專題分析圖二：' + bad.join('；'));
}

/* 刑度組成橫條與年度趨勢圖的統計值。原本以圖下方的表格充當資料來源；圖已完整
   呈現所有數字後移除重複表格，改由這兩份陣列集中維護，避免資料散在 SVG 字串中。 */
var ANA_BANDS = [
  ['罰金', 4, 0, 0, 1, 3, '0%'],
  ['拘役', 19, 0, 0, 7, 12, '0%'],
  ['有期徒刑 6 月以下', 37, 0, 1, 29, 7, '0%'],
  ['有期徒刑 6 月～1 年', 43, 3, 20, 18, 2, '7%'],
  ['有期徒刑 1 年～2 年', 18, 5, 9, 4, 0, '28%'],
  ['有期徒刑 2 年～5 年', 19, 13, 4, 2, 0, '68%'],
  ['有期徒刑 5 年以上', 6, 6, 0, 0, 0, '100%']
];
var ANA_YEAR_PERIODS = [[94,99], [100,104], [105,109], [110,115]];
function anaFigBands(box){
  var C = [ANA_DIS_COLOR, ANA_NON_COLOR, '#9DB4D0', ANA_DOT_GREY], NAMES = ['除名', '停職 1 年以上', '停職未滿 1 年', '申誡、警告'];
  var h = '<div class="db-ana-bars"><div class="db-ana-barhead" aria-hidden="true"><span></span><span></span><span>除名率</span></div>', prevKind = '';
  ANA_BANDS.forEach(function(r){
    var n = +r[1] || 0, parts = [+r[2] || 0, +r[3] || 0, +r[4] || 0, +r[5] || 0];
    var kind = /有期徒刑/.test(r[0]) ? 'p' : 'o';
    if(prevKind && kind !== prevKind) h += '<div class="db-ana-barsep"></div>';
    prevKind = kind;
    h += '<div class="db-ana-barrow"><span class="db-ana-barlbl">' + esc(r[0].replace(/^有期徒刑\s*/, '有期徒刑 ')) + '<small>' + n + ' 件</small></span><div class="db-ana-bar">';
    parts.forEach(function(v, i){
      var tip = NAMES[i] + ' ' + v + ' 件';
      if(v > 0 && n > 0) h += '<span style="width:' + (v / n * 100).toFixed(1) + '%;background:' + C[i] + '" data-tip="' + tip + '" aria-label="' + tip + '" tabindex="0"></span>';
    });
    h += '</div><span class="db-ana-barpct">' + esc(r[6] || '') + '</span></div>';
  });
  box.innerHTML = h + '</div>';
}
function anaFigYear(box, asof){
  /* 分期以決議日期計算：有覆審者取覆審決議日期，否則取原懲戒決議日期。
     再審議只可能出現在 note／全文等敘述欄位，不讀取、不影響本圖的期別。 */
  var rows = ANA_YEAR_PERIODS.map(function(period){
    var count = 0, disbarred = 0;
    DATA.cases.forEach(function(c, i){
      if(IS_PROV[i]) return;
      var decisionDate = String(c.revDate || c.date || '');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(decisionDate) || (asof && decisionDate > asof)) return;
      var rocYear = parseInt(decisionDate.slice(0, 4), 10) - 1911;
      if(rocYear < period[0] || rocYear > period[1]) return;
      count++;
      if(HC_OF(c.h) === 1) disbarred++;
    });
    return [period[0] + '–' + period[1], count, disbarred,
      count ? (disbarred / count * 100).toFixed(1) + '%' : '0.0%'];
  });
  var W = 680, H = 260, X0 = 70, X1 = 650, Y0 = 210, Y1 = 40, maxN = 0, maxR = 0;
  rows.forEach(function(r){ maxN = Math.max(maxN, +r[1] || 0); maxR = Math.max(maxR, parseFloat(r[3]) || 0); });
  var step = (X1 - X0) / rows.length, bw = Math.min(48, step * 0.34), dw = Math.min(30, step * 0.21), pts = [], labels = [], h = '';
  h += '<line x1="' + X0 + '" y1="' + Y0 + '" x2="' + X1 + '" y2="' + Y0 + '" stroke="#C9C4BF" stroke-width="1"></line>';
  rows.forEach(function(r, i){
    var cx = X0 + step * (i + 0.5), n = +r[1] || 0, dis = +r[2] || 0;
    var bh = (Y0 - Y1 - 40) * n / maxN, dh = (Y0 - Y1 - 40) * dis / maxN, rate = parseFloat(r[3]) || 0;
    var ry = Y1 + 8 + (1 - rate / maxR) * (Y0 - Y1 - 70);
    var caseX = cx - dw / 2 - 3, disX = cx + bw / 2 + 3;
    h += '<rect x="' + (caseX - bw / 2).toFixed(1) + '" y="' + (Y0 - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="#DCE7F3"><title>案件 ' + n + ' 件</title></rect>';
    h += '<rect x="' + (disX - dw / 2).toFixed(1) + '" y="' + (Y0 - Math.max(3, dh)).toFixed(1) + '" width="' + dw.toFixed(1) + '" height="' + Math.max(3, dh).toFixed(1) + '" rx="3" fill="#DFA6AF"><title>除名 ' + dis + ' 件</title></rect>';
    /* 數字最後才畫，確保位於折線之上；案件數放在淺藍長條內側頂部。 */
    labels.push('<text x="' + caseX.toFixed(1) + '" y="' + (Y0 - bh + 16).toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#2C4A73">' + n + ' 件</text>');
    labels.push('<text x="' + disX.toFixed(1) + '" y="' + (Y0 - Math.max(3, dh) - 7).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#A84455">' + dis + ' 件</text>');
    h += '<text x="' + cx.toFixed(1) + '" y="' + (Y0 + 22) + '" text-anchor="middle" font-size="13" fill="#6B6F76">' + esc(r[0]) + '</text>';
    pts.push([cx, ry, r[3]]);
  });
  h += '<polyline points="' + pts.map(function(p){ return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + ANA_DIS_COLOR + '" stroke-width="2.5"></polyline>';
  pts.forEach(function(p){
    h += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5" fill="' + ANA_DIS_COLOR + '"></circle>' +
         '<text x="' + (p[0] + 10).toFixed(1) + '" y="' + (p[1] - 8).toFixed(1) + '" font-size="14" font-weight="700" fill="' + ANA_DIS_COLOR + '">' + esc(p[2]) + '</text>';
  });
  h += labels.join('');
  box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="各期案件數與除名率">' + h + '</svg>' +
    '<div class="db-ana-key"><span><i style="background:#DCE7F3;border-radius:2px"></i>案件數</span><span><i style="background:#DFA6AF;border-radius:2px"></i>除名件數</span><span><i style="background:' + ANA_DIS_COLOR + '"></i>除名率</span></div>';
}

/* 圖表的即時資料標籤。瀏覽器原生 title 會延遲出現，且無法配合目前圖形的
   框選效果，因此改用事件委派；文章內點狀圖與橫條圖共用同一個浮動標籤。 */
var anaBarTipsReady = false;
function initAnaBarTips(){
  if(anaBarTipsReady || !document.body) return;
  anaBarTipsReady = true;
  var tip = document.createElement('div'), active = null;
  tip.id = 'db-ana-bar-tip';
  tip.className = 'db-ana-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  function segment(node){
    /* 點狀圖的列表縮圖不在文章內，刻意不啟用互動浮標。 */
    return node && node.closest ? node.closest('.db-ana-bar span[data-tip], .db-ana-art .db-ana-pt[data-tip]') : null;
  }
  function place(clientX, clientY){
    if(!active || tip.hidden) return;
    var ar = active.getBoundingClientRect();
    var px = typeof clientX === 'number' ? clientX : ar.left + ar.width / 2;
    var py = typeof clientY === 'number' ? clientY : ar.top;
    var tr = tip.getBoundingClientRect(), gap = 12;
    var left = Math.max(8, Math.min((window.innerWidth || 0) - tr.width - 8, px + gap));
    var top = py - tr.height - gap;
    if(top < 8) top = Math.min((window.innerHeight || 0) - tr.height - 8, py + gap);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(Math.max(8, top)) + 'px';
  }
  function show(seg, e){
    if(!seg) return;
    active = seg;
    tip.textContent = seg.getAttribute('data-tip') || '';
    tip.hidden = false;
    seg.setAttribute('aria-describedby', tip.id);
    place(e && e.clientX, e && e.clientY);
  }
  function hide(seg){
    if(seg && seg !== active) return;
    if(active) active.removeAttribute('aria-describedby');
    active = null;
    tip.hidden = true;
  }
  document.addEventListener('pointerover', function(e){
    var seg = segment(e.target);
    if(seg && seg !== active) show(seg, e);
  });
  document.addEventListener('pointermove', function(e){ if(active) place(e.clientX, e.clientY); });
  document.addEventListener('pointerout', function(e){
    var seg = segment(e.target);
    if(seg && (!e.relatedTarget || !seg.contains(e.relatedTarget))) hide(seg);
  });
  document.addEventListener('focusin', function(e){ var seg = segment(e.target); if(seg) show(seg); });
  document.addEventListener('focusout', function(e){ var seg = segment(e.target); if(seg) hide(seg); });
  window.addEventListener('scroll', function(){ hide(); }, {passive:true});
}
function anaEnhance(art){
  var body = art.querySelector('.db-ana-body');
  anaLinkCaseNos(body);
  var asof = art.getAttribute('data-ana-asof') || '';
  var f1 = art.querySelector('#ana-fig1'), f2 = art.querySelector('#ana-fig2');
  if(f1) safeRun('專題分析圖一', function(){ anaFig1(f1, asof); });
  if(f2) safeRun('專題分析圖二', function(){ anaFig2(f2); });
  var fb = art.querySelector('#ana-fig-bands'), fy = art.querySelector('#ana-fig-year');
  if(fb) safeRun('專題分析刑度組成圖', function(){ anaFigBands(fb); });
  if(fy) safeRun('專題分析年度圖', function(){ anaFigYear(fy, asof); });
}

function initAnalysis(){
  if(initAnalysis.ready) return;
  initAnaBarTips();
  buildAnaList();
  var bar = el('stats-subtabs');
  if(bar) bar.addEventListener('click', function(e){
    var b = e.target.closest ? e.target.closest('.db-subtab[data-ssub]') : null;
    if(!b) return;
    var sub = b.getAttribute('data-ssub');
    if(sub === ANA.sub && !(sub === 'analysis' && ANA.art)) return;
    if(sub === 'analysis') anaShowArticle('');      /* 再按一次「專題分析」＝回到列表 */
    setStatsSub(sub);
    routePush();
  });
  var pa = el('stats-sub-analysis');
  if(pa){
    pa.addEventListener('click', function(e){
      var t = e.target;
      var item = t.closest ? t.closest('[data-ana-open]') : null;
      if(item){
        e.preventDefault();
        if(anaShowArticle(item.getAttribute('data-ana-open'))){ anaScrollTop(); routePush(); }
        return;
      }
      var back = t.closest ? t.closest('.db-ana-back') : null;
      if(back){ e.preventDefault(); anaShowArticle(''); anaScrollTop(); routePush(); }
    });
    /* 圖中圓點以鍵盤操作：Enter／空白鍵等同點選（點選本身由全文彈窗的委派處理器接手） */
    pa.addEventListener('keydown', function(e){
      if(e.key !== 'Enter' && e.key !== ' ') return;
      var pt = e.target.closest ? e.target.closest('.db-ana-pt') : null;
      if(!pt) return;
      e.preventDefault();
      pt.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));
    });
  }
  setStatsSub(ANA.sub);
  anaShowArticle(ANA.art);
  initAnalysis.ready = true;
}

/* [JS-INIT] 所有主要 module 定義完成後，統一在此啟動副作用與首次 render。 */
function initAppModules(){
  safeRun('頁面捲軸', initPageScrollbar);
  initHeaderBehavior();
  initComplaintResponsive();
  FX.initParallax();
  initFulltextDeferredClick();
  initFulltextDialog();
  safeRun('全文標籤說明浮字', initFullTagTip);

  var footDate = el('db-foot-date');
  if(footDate){
    footDate.textContent = '2026年10月15日';
    footDate.setAttribute('datetime', '2026-10-15');
  }

  safeRun('違失態樣初始清單', renderPatternList);
  safeRun('案件清單', renderList);
  /* 預設頁面改為首頁；申訴救濟管道與其餘頁籤一律於點擊該頁籤時才初始化。 */
  if(el('tabbtn-home') && el('tab-home')){
    safeRun('首頁', initHome);
  }else{
    var fallbackBtn = el('tabbtn-list');
    if(fallbackBtn) safeRun('預設頁籤退回案件清單', function(){ fallbackBtn.click(); });
  }
  safeRun('共用視覺效果', function(){ FX.refresh(); });
  safeRun('預設頁籤進場', function(){
    var defPanel = el('tab-home') || el('tab-list');
    FX.settleTab(defPanel);
    FX.tabRise(defPanel);
  });
  safeRun('網址路由', initPathRouting);
  /* 若路由初始化在進入 applyRoute 前即發生非預期錯誤，仍不可讓內容永久隱藏。 */
  document.documentElement.classList.remove('db-route-pending');
}

initAppModules();
})();
}
/* 所有資料節點由 load-data.js 建立後才載入本檔，因此可直接啟動。 */
try{ __boot(); }
catch(err){
  DB_STATUS.lastError = String(err && err.stack ? err.stack : err);
  if(window.console && console.error) console.error('[律師懲戒案件資料庫] 主程式啟動失敗：', err);
}
})();

/**
 * 餐廳評分簿・後端（多餐廳版）
 * 貼在「綁定試算表」的 Apps Script（試算表 → 擴充功能 → Apps Script）。
 * 會自動建立五張工作表：restaurants（餐廳）、items（品項）、votes（評分與備註）、members（留言身分）、
 * places（「找餐廳」的餐廳資料；第一次由網頁自動把 places.json 匯入，之後詳情頁的修改直接寫在這裡）。
 * 舊版沒有餐廳欄位的品項，會自動歸入「茶六」。
 */

var DEFAULT_RID = "r_chaliu";
var DEFAULT_RNAME = "茶六";

var HEADERS = {
  restaurants: ["id", "name", "createdAt"],
  items: ["id", "name", "createdAt", "restaurantId"],
  votes: ["itemId", "member", "rating", "note", "updatedAt"],
  members: ["name"],
  // key＝「店名|縣市」；tags、picks 用「、」隔開；post1、post2 是原貼文網址（只收 https）；createdAt 越大越新
  places: ["key", "name", "county", "district", "tags", "map", "rating", "ratingDate", "hours", "closed", "price", "address", "feature", "picks", "post1", "post2", "createdAt"]
};
// 這些欄位一律當純文字，避免有人輸入「=...」被當成公式執行
var TEXT_COLS = { restaurants: [1, 2], items: [1, 2, 4], votes: [1, 2, 3, 4], members: [1], places: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] };
var RATINGS = ["超好吃", "好吃", "普通", "有點雷"];
var LIMIT = { restaurants: 30, items: 500, members: 30, votes: 8000, places: 600 };
// 詳情頁允許修改的欄位與它在 places 工作表的第幾欄（其他欄位一律拒絕）
// （tags、post1、post2 不在詳情頁的編輯鈕裡，只給搬家程式整批寫入）
var PLACE_FIELDS = { tags: 5, rating: 7, ratingDate: 8, hours: 9, closed: 10, price: 11, address: 12, feature: 13, picks: 14, post1: 15, post2: 16 };
var BAD_NAMES = ["__proto__", "constructor", "prototype"];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function textFormat_(sh, name) {
  TEXT_COLS[name].forEach(function (c) {
    sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat("@");
  });
}

function sh_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
    textFormat_(sh, name);
    if (name === "restaurants") sh.appendRow([DEFAULT_RID, DEFAULT_RNAME, Date.now()]);
  } else if (sh.getLastColumn() < HEADERS[name].length) {
    // 舊版工作表少了新欄位：補上標題
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    textFormat_(sh, name);
  }
  return sh;
}

function rows_(name) {
  var sh = sh_(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, HEADERS[name].length).getValues();
}

function effRid_(row) {
  return String(row[3] || "") || DEFAULT_RID;
}

function state_() {
  var restaurants = rows_("restaurants")
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { id: String(r[0]), name: String(r[1]) }; });
  var items = rows_("items")
    .filter(function (r) { return r[0]; })
    .map(function (r) { return { id: String(r[0]), name: String(r[1]), at: Number(r[2]) || 0, rid: effRid_(r) }; });
  var votes = rows_("votes")
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) {
      return { itemId: String(r[0]), member: String(r[1]), r: String(r[2] || ""), n: String(r[3] || ""), t: Number(r[4]) || 0 };
    });
  var members = rows_("members").map(function (r) { return String(r[0]); }).filter(Boolean);
  var places = rows_("places")
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r, i) { var p = placeObj_(r); p.i = i; return p; })
    .sort(function (a, b) { return (b.at - a.at) || (a.i - b.i); })
    .map(function (p) { delete p.i; delete p.at; return p; });
  return { restaurants: restaurants, items: items, votes: votes, members: members, places: places };
}

function placeObj_(r) {
  function s(i) { return String(r[i] == null ? "" : r[i]); }
  function list(i) { return s(i) ? s(i).split("、").filter(Boolean) : []; }
  return {
    name: s(1), county: s(2), district: s(3), tags: list(4), map: s(5),
    rating: Number(s(6)) || 0, ratingDate: s(7), hours: s(8), closed: s(9), price: s(10),
    address: s(11), feature: s(12), picks: list(13),
    posts: [s(14), s(15)].filter(function (u) { return /^https:\/\//.test(u); }),
    at: Number(r[16]) || 0
  };
}

function validName_(s, max) {
  s = String(s == null ? "" : s).trim();
  if (!s || s.length > max) return "";
  if (BAD_NAMES.indexOf(s) >= 0) return "";
  return s;
}
function validId_(id) {
  id = String(id || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) throw new Error("代碼不正確");
  return id;
}
function newId_(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 餐廳 ---------- */
function findRestaurantRow_(id) {
  var rows = rows_("restaurants");
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) return i + 2;
  return 0;
}
function findRestaurantIdByName_(name) {
  var key = name.toLowerCase();
  var rows = rows_("restaurants");
  for (var i = 0; i < rows.length; i++) if (String(rows[i][1]).trim().toLowerCase() === key) return String(rows[i][0]);
  return "";
}

function addRestaurant_(id, name) {
  id = validId_(id);
  name = validName_(name, 20);
  if (!name) throw new Error("餐廳名稱不正確");
  if (findRestaurantRow_(id) || findRestaurantIdByName_(name)) return;
  if (rows_("restaurants").length >= LIMIT.restaurants) throw new Error("餐廳數量已達上限");
  sh_("restaurants").appendRow([id, name, Date.now()]);
}

function renameRestaurant_(id, name) {
  id = validId_(id);
  name = validName_(name, 20);
  if (!name) throw new Error("餐廳名稱不正確");
  var row = findRestaurantRow_(id);
  if (!row) throw new Error("找不到這間餐廳");
  var other = findRestaurantIdByName_(name);
  if (other && other !== id) throw new Error("已經有同名的餐廳");
  sh_("restaurants").getRange(row, 2).setValue(name);
}

function delRestaurant_(id) {
  id = validId_(id);
  var rrows = rows_("restaurants");
  if (rrows.length <= 1) throw new Error("至少要保留一間餐廳");
  var row = findRestaurantRow_(id);
  if (!row) return;
  var is = sh_("items");
  var irows = rows_("items");
  var gone = {};
  for (var i = irows.length - 1; i >= 0; i--) {
    if (effRid_(irows[i]) === id) {
      gone[String(irows[i][0])] = true;
      is.deleteRow(i + 2);
    }
  }
  var vs = sh_("votes");
  var vrows = rows_("votes");
  for (var j = vrows.length - 1; j >= 0; j--) {
    if (gone[String(vrows[j][0])]) vs.deleteRow(j + 2);
  }
  sh_("restaurants").deleteRow(row);
}

/* ---------- 品項與評分 ---------- */
function findItemRow_(id) {
  var rows = rows_("items");
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) return i + 2;
  return 0;
}
function findItemIdByName_(name, rid) {
  var key = name.toLowerCase();
  var rows = rows_("items");
  for (var i = 0; i < rows.length; i++) {
    if (effRid_(rows[i]) === rid && String(rows[i][1]).trim().toLowerCase() === key) return String(rows[i][0]);
  }
  return "";
}
function findVoteRow_(itemId, member) {
  var rows = rows_("votes");
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === itemId && String(rows[i][1]) === member) return i + 2;
  }
  return 0;
}

function ensureMember_(name) {
  var rows = rows_("members");
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === name) return;
  if (rows.length >= LIMIT.members) throw new Error("身分數量已達上限");
  sh_("members").appendRow([name]);
}

function addItem_(id, name, rid) {
  id = validId_(id);
  name = validName_(name, 40);
  if (!name) throw new Error("品項名稱不正確");
  rid = rid ? String(rid) : DEFAULT_RID;
  if (!findRestaurantRow_(rid)) throw new Error("找不到這間餐廳");
  if (findItemRow_(id) || findItemIdByName_(name, rid)) return;
  if (rows_("items").length >= LIMIT.items) throw new Error("品項數量已達上限");
  sh_("items").appendRow([id, name, Date.now(), rid]);
}

function delItem_(id) {
  id = String(id || "");
  var row = findItemRow_(id);
  if (row) sh_("items").deleteRow(row);
  var vs = sh_("votes");
  var rows = rows_("votes");
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][0]) === id) vs.deleteRow(i + 2);
  }
}

function setVote_(itemId, member, r, n, t) {
  itemId = String(itemId || "");
  if (!findItemRow_(itemId)) return;
  member = validName_(member, 12);
  if (!member) throw new Error("身分名稱不正確");
  r = RATINGS.indexOf(r) >= 0 ? r : "";
  n = String(n == null ? "" : n).slice(0, 300);
  t = Number(t) || Date.now();
  ensureMember_(member);
  var sh = sh_("votes");
  var row = findVoteRow_(itemId, member);
  if (!r && !n) {
    if (row) sh.deleteRow(row);
    return;
  }
  var vals = [itemId, member, r, n, t];
  if (row) {
    sh.getRange(row, 1, 1, 5).setValues([vals]);
  } else {
    if (rows_("votes").length >= LIMIT.votes) throw new Error("評分筆數已達上限");
    sh.appendRow(vals);
  }
}

/* ---------- 找餐廳：詳情頁修改單一欄位（key＝「店名|縣市」，空字串代表清空） ---------- */
function placeValue_(field, value) {
  if (!Object.prototype.hasOwnProperty.call(PLACE_FIELDS, field)) throw new Error("這個欄位不能修改");
  value = String(value == null ? "" : value).trim().slice(0, 500);
  if (field === "rating" && value !== "" && !(Number(value) >= 0 && Number(value) <= 5)) throw new Error("星數要在 0 到 5 之間");
  if (field === "ratingDate" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式不正確");
  if ((field === "post1" || field === "post2") && value !== "" && !/^https:\/\//.test(value)) throw new Error("貼文網址要以 https 開頭");
  return value;
}

// 一次改很多間店的多個欄位（給搬家程式用）：list 是 [{ key:"店名|縣市", fields:{ 欄位:值 } }]，一次最多 100 間
function setPlaces_(list) {
  if (!Array.isArray(list)) throw new Error("資料格式不正確");
  var rows = rows_("places");
  var at = {};
  rows.forEach(function (r, i) { at[String(r[0])] = i; });
  var changed = false;
  list.slice(0, 100).forEach(function (x) {
    if (!x || typeof x !== "object" || !x.fields || typeof x.fields !== "object") return;
    var i = at[String(x.key)];
    if (i === undefined) return;
    Object.keys(x.fields).forEach(function (f) {
      var v = placeValue_(f, x.fields[f]);
      rows[i][PLACE_FIELDS[f] - 1] = v;
      changed = true;
    });
  });
  if (changed) sh_("places").getRange(2, 1, rows.length, HEADERS.places.length).setValues(rows);
}

function setPlace_(key, field, value) {
  key = String(key == null ? "" : key).trim();
  if (!key || key.length > 80 || key.indexOf("|") < 0) throw new Error("店家代碼不正確");
  field = String(field || "");
  value = placeValue_(field, value);
  var rows = rows_("places");
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      sh_("places").getRange(i + 2, PLACE_FIELDS[field]).setValue(value);
      return;
    }
  }
  throw new Error("找不到這間店");
}

// 把 places.json 的店家匯入 places 工作表（已存在的店不會被覆蓋，所以重複匯入也安全；一次最多 60 間）
function importPlaces_(list) {
  if (!Array.isArray(list)) throw new Error("資料格式不正確");
  var sh = sh_("places");
  var have = {};
  var rows = rows_("places");
  rows.forEach(function (r) { have[String(r[0])] = true; });
  function txt(v, max) { return String(v == null ? "" : v).trim().slice(0, max); }
  function joined(a, max) {
    return (Array.isArray(a) ? a : []).map(function (t) { return txt(t, 40).replace(/、/g, "，"); }).filter(Boolean).join("、").slice(0, max);
  }
  var add = [];
  list.slice(0, 60).forEach(function (x) {
    if (!x || typeof x !== "object") return;
    var name = validName_(x.name, 60);
    if (!name) return;
    var county = txt(x.county, 12);
    var key = name + "|" + county;
    if (have[key]) return;
    have[key] = true;
    var rating = Number(x.rating) >= 0 && Number(x.rating) <= 5 ? String(Number(x.rating) || "") : "";
    var date = /^\d{4}-\d{2}-\d{2}$/.test(String(x.ratingDate || "")) ? String(x.ratingDate) : "";
    var posts = (Array.isArray(x.posts) ? x.posts : []).map(function (u) { return txt(u, 300); })
      .filter(function (u) { return /^https:\/\//.test(u); });
    add.push([key, name, county, txt(x.district, 20), joined(x.tags, 200), txt(x.map, 300), rating, date,
      txt(x.hours, 500), txt(x.closed, 500), txt(x.price, 500), txt(x.address, 500), txt(x.feature, 500), joined(x.picks, 500),
      posts[0] || "", posts[1] || "", Number(x.at) || Date.now()]);
  });
  if (!add.length) return;
  if (rows.length + add.length > LIMIT.places) throw new Error("店家數量已達上限");
  var first = sh.getLastRow() + 1, last = first + add.length - 1;
  if (last > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), last - sh.getMaxRows());
  sh.getRange(first, 1, add.length, HEADERS.places.length).setValues(add);
}

// 第一次連線時，把手機裡原本的資料合併上來
// （同名餐廳、同名品項合併；同一人同一品項以較新的為準）
function import_(restaurants, items) {
  function ridByName(rname) {
    rname = validName_(rname, 20);
    if (!rname) return DEFAULT_RID;
    var rid = findRestaurantIdByName_(rname);
    if (!rid) {
      rid = newId_("r");
      addRestaurant_(rid, rname);
    }
    return rid;
  }
  (Array.isArray(restaurants) ? restaurants : []).slice(0, 30).forEach(function (x) {
    ridByName(x && x.name);
  });
  if (!Array.isArray(items)) return;
  items.slice(0, 200).forEach(function (x) {
    var name = validName_(x && x.name, 40);
    if (!name) return;
    var rid = x.restaurant ? ridByName(x.restaurant) : DEFAULT_RID;
    if (!findRestaurantRow_(rid)) return;
    var id = findItemIdByName_(name, rid);
    if (!id) {
      id = newId_("i");
      addItem_(id, name, rid);
    }
    var v = x.votes && typeof x.votes === "object" ? x.votes : {};
    Object.keys(v).slice(0, 30).forEach(function (m) {
      var member = validName_(m, 12);
      var e = v[m];
      if (!member || !e || typeof e !== "object") return;
      var row = findVoteRow_(id, member);
      var old = row ? (Number(sh_("votes").getRange(row, 5).getValue()) || 0) : -1;
      if ((Number(e.t) || 0) > old) setVote_(id, member, e.r, e.n, e.t);
    });
  });
}

/* ---------- 手機分享：把 IG／Threads 貼文網址丟進來，由 Gemini 分析後直接新增一間店 ----------
   需要在 Apps Script「專案設定 → 指令碼屬性」新增 GEMINI_API_KEY（Gemini 金鑰，只存在 Google 後台，不放程式碼）。 */
var SHARE_HOSTS = /^(www\.)?(instagram\.com|threads\.net|threads\.com)$/;
var SHARE_DAILY_MAX = 40;
var GEMINI_MODELS = ["gemini-2.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];

// 整理成乾淨的貼文網址（拿掉追蹤參數）；不是 IG／Threads 的 https 網址就回傳空字串
function cleanShareUrl_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  var m = s.match(/https:\/\/[^\s]+/);
  if (!m) return "";
  var u = m[0].replace(/[?#].*$/, "");
  var h = u.match(/^https:\/\/([^\/]+)(\/.*)?$/);
  if (!h || !SHARE_HOSTS.test(h[1].toLowerCase())) return "";
  u = "https://" + h[1].toLowerCase() + (h[2] || "/");
  return u.length > 300 ? "" : u;
}

function metaOf_(html, prop) {
  var re1 = new RegExp('<meta[^>]*(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', "i");
  var re2 = new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', "i");
  var m = html.match(re1) || html.match(re2);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(Number(d)); }) : "";
}

var FETCH_LOG_ = [];

// 從網頁 HTML 的 og 標籤取出貼文標題與說明；是登入牆或內容太少就回傳空字串
function textFromHtml_(html) {
  html = String(html || "");
  var t = metaOf_(html, "og:title"), d = metaOf_(html, "og:description") || metaOf_(html, "description");
  if (/^(instagram|login)/i.test(t.trim())) t = "";
  if (/建立帳號或登入|Create an account or log in|Log in to Instagram|^Login/i.test(d)) { d = ""; FETCH_LOG_.push("instagram=登入牆"); }
  if (d.trim().length > 15 || (t && (t + d).length > 30)) return ("Title: " + t + "\nDescription: " + d).slice(0, 4000);
  return "";
}
function get_(url, ua) {
  var host = url.replace(/^https:\/\/(www\.)?/, "").split("/")[0];
  var r;
  try {
    r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { "User-Agent": ua, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8" } });
  } catch (e) {
    FETCH_LOG_.push(host + "=錯誤：" + String(e && e.message || e).slice(0, 80));
    throw e;
  }
  var code = r.getResponseCode();
  FETCH_LOG_.push(host + "=" + code);
  return code === 200 ? r.getContentText() : "";
}

// 抓貼文文字：先試 Meta 爬蟲（og 標籤），再用 Jina Reader 備援；都抓不到回傳空字串
function fetchPostText_(url) {
  var crawler = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
  try {
    var fromMeta = textFromHtml_(get_(url, crawler));
    if (fromMeta) return fromMeta;
  } catch (e) {}
  if (/threads\.(net|com)\//.test(url)) {
    try {
      var o = JSON.parse(get_("https://www.threads.net/oembed?url=" + encodeURIComponent(url), crawler) || "{}");
      var ot = "Author: " + (o.author_name || "") + "\nTitle: " + (o.title || "") + "\nHTML: " + (o.html || "");
      if (ot.length > 60) return ot.slice(0, 4000);
    } catch (e) {}
  }
  try {
    var txt = get_("https://r.jina.ai/" + url, "Mozilla/5.0");
    if (txt.length > 50 && !/Just a moment|Access Denied|AbuseAlleviation|login • instagram/i.test(txt)) return txt.slice(0, 4000);
  } catch (e) {}
  return "";
}

function gemini_(prompt) {
  var key = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!key) throw new Error("後端還沒設定 Gemini 金鑰（指令碼屬性 GEMINI_API_KEY）");
  var last = "";
  for (var i = 0; i < GEMINI_MODELS.length; i++) {
    var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODELS[i] + ":generateContent", {
      method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { "x-goog-api-key": key },
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
    });
    if (r.getResponseCode() === 200) {
      try {
        var data = JSON.parse(JSON.parse(r.getContentText()).candidates[0].content.parts[0].text);
        if (Array.isArray(data)) data = data[0];
        if (data && typeof data === "object") return data;
      } catch (e) {}
    }
    last = GEMINI_MODELS[i] + ": " + r.getResponseCode();
  }
  throw new Error("Gemini 暫時無法使用（" + last + "），請稍後再試");
}

function normCounty_(c) {
  c = String(c == null ? "" : c).trim().replace(/臺/g, "台");
  return c.replace(/^(台北|台中|台南|高雄)市$/, "$1").slice(0, 12);
}

// 回傳給「捷徑」顯示的訊息；成功或失敗都用 ok:true 帶 message，真的出錯才丟例外
function share_(rawUrl, pageHtml) {
  var url = cleanShareUrl_(rawUrl);
  if (!url) throw new Error("這不是 Instagram 或 Threads 的貼文網址");
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  var cnt = props.getProperty("SHARE_DAY") === day ? Number(props.getProperty("SHARE_COUNT") || 0) : 0;
  if (cnt >= SHARE_DAILY_MAX) throw new Error("今天分享的次數已達上限，明天再試");
  props.setProperties({ SHARE_DAY: day, SHARE_COUNT: String(cnt + 1) });

  var dup = rows_("places").filter(function (r) { return String(r[14]) === url || String(r[15]) === url; })[0];
  if (dup) return "這篇貼文已經收錄過了：" + dup[1];

  FETCH_LOG_ = [];
  var text = "";
  if (typeof pageHtml === "string" && pageHtml.length > 50) { // 手機先抓好的貼文網頁
    text = textFromHtml_(pageHtml.slice(0, 2000000));
    FETCH_LOG_.push("手機傳來" + pageHtml.length + "字" + (text ? "" : "，但讀不到貼文內容：" + pageHtml.replace(/\s+/g, " ").slice(0, 60)));
  } else {
    FETCH_LOG_.push("沒收到手機傳的網頁（" + (pageHtml === undefined ? "沒有 html 欄位" : typeof pageHtml + "，長度" + String(pageHtml == null ? 0 : (pageHtml.length || JSON.stringify(pageHtml).length))) + "）");
  }
  if (!text) text = fetchPostText_(url);
  if (!text) throw new Error("讀不到這篇貼文的內容（可能是影片、私人帳號或暫時被擋）。診斷：" + (FETCH_LOG_.join("、") || "沒有連線紀錄"));

  var info = gemini_("你是餐廳資訊整理專家。下面是一篇 IG/Threads 貼文內容，請只根據貼文內容整理，貼文沒寫的欄位一律留空字串，不要猜測、不要編造。\n" +
    "【貼文內容】\n" + text + "\n\n請輸出 JSON：\n" +
    '- "isRestaurant": 這篇是否在介紹一間特定的餐廳／店家（true 或 false；介紹多間店或與美食無關就填 false）\n' +
    '- "name": 店名（繁體中文或原文，不含分店字樣以外的多餘文字）\n' +
    '- "county": 縣市，例：台南、高雄、台北市、新北市（貼文沒寫、也無法由地址判斷就空字串）\n' +
    '- "district": 區，例：中西區（沒寫就空字串）\n' +
    '- "address": 貼文明確寫出的完整地址，沒寫就空字串\n' +
    '- "feature": 這間店的特色，1～2 句繁體中文（氣氛、料理風格、賣點），不要放餐點清單\n' +
    '- "picks": 貼文中推薦的餐點名稱陣列（只放餐點名，每個不超過 12 字，最多 8 個）\n' +
    '- "hours": 營業時間，時間用「～」。只有一種營業模式就只寫時間（例：11:30～14:30、17:00～21:00）；平日、假日等不同模式則每種一行（用換行字元），每行開頭寫週幾（例：週一至週五 11:00～15:00、17:00～22:00\\n週六至週日 11:00～22:00）。沒寫就空字串\n' +
    '- "closed": 公休日，例：週二。若營業時間已涵蓋週一到週日每一天（例如平日加六日、或每日營業）就填「無公休」；營業時間和公休日都沒寫才填空字串\n' +
    '- "cuisine": 這間店屬於哪一國料理，只能填「日式料理」「中式料理」「韓式料理」「泰式料理」「義式料理」「印度料理」「美式料理」「越式料理」「法式料理」「台式料理」其中之一；貼文明確提到或能明確判斷才填，無法判斷就空字串\n' +
    '- "foodTypes": 食物類型標籤陣列，最多 3 個、每個不超過 6 字，例：拉麵、燒肉、火鍋、咖喱（一律寫「咖喱」，不寫「咖哩」）、丼飯、牛排、壽喜燒、甜點、早午餐、宵夜、餐酒館。例：日式拉麵店 → cuisine 填「日式料理」、foodTypes 填 ["拉麵"]；印度咖哩店 → cuisine 填「印度料理」、foodTypes 填 ["咖喱"]');
  if (info.isRestaurant === false || !validName_(info.name, 60)) throw new Error("這篇看起來不是介紹單一間餐廳，沒有新增。診斷：" + FETCH_LOG_.join("、") + "｜讀到" + text.length + "字：" + text.replace(/\s+/g, " ").slice(0, 100));

  // 價位另外問一次（只看人均／價位線索，查不到就留空）
  var price = "";
  try {
    var pr = gemini_("下面是一間餐廳的 IG/Threads 貼文內容。請只根據貼文裡明確寫出的價格資訊，估計「每人消費價位區間」。貼文沒有任何價格線索就回傳空字串，不要猜測。\n" +
      "【貼文內容】\n" + text + "\n\n輸出 JSON：{\"price\": \"例：$200-400；沒有線索就空字串\"}");
    price = String(pr.price == null ? "" : pr.price).trim().slice(0, 40);
  } catch (e) {}

  var name = validName_(info.name, 60);
  var cuisine = String(info.cuisine == null ? "" : info.cuisine).trim();
  if (!/^(日|中|韓|泰|義|美|越|法|台)式料理$|^印度料理$/.test(cuisine)) cuisine = "";
  var tagList = (cuisine ? [cuisine] : []);
  (Array.isArray(info.foodTypes) ? info.foodTypes : []).slice(0, 3).forEach(function (t) {
    t = String(t == null ? "" : t).trim().replace(/咖哩/g, "咖喱").replace(/、/g, "，").slice(0, 6);
    if (t && tagList.indexOf(t) < 0) tagList.push(t);
  });
  var county = normCounty_(info.county);
  var key = name + "|" + county;
  var hours = String(info.hours || "").trim().slice(0, 500);
  var closed = String(info.closed || "").trim().slice(0, 500);
  // 營業時間已涵蓋整週（平日＋六日／每天／週一至週日）時，沒寫公休日就視為無公休
  if (!closed && hours && (/每天|每日|週一至週日|週日至週六|全週/.test(hours) || (/平日|週一至週五/.test(hours) && /六日|週六至週日|週末|假日/.test(hours)))) closed = "無公休";
  var picks = (Array.isArray(info.picks) ? info.picks : []).map(function (x) { return String(x).trim().slice(0, 12).replace(/、/g, "，"); }).filter(Boolean).slice(0, 8).join("、");
  var addr = String(info.address || "").trim().slice(0, 500);
  var q = [county, String(info.district || "").trim(), name, addr].filter(Boolean).join(" ");
  var map = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var rows = rows_("places");
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === key) { // 店已存在：只補貼文連結
        if (!rows[i][14]) { sh_("places").getRange(i + 2, 15).setValue(url); return "「" + name + "」已經有了，已把這篇貼文加到它的貼文連結"; }
        if (!rows[i][15]) { sh_("places").getRange(i + 2, 16).setValue(url); return "「" + name + "」已經有了，已把這篇貼文加到它的貼文連結"; }
        return "「" + name + "」已經有了，而且已經有 2 篇貼文連結，這篇沒有新增";
      }
    }
    if (rows.length >= LIMIT.places) throw new Error("店家數量已達上限");
    // 找相似的店（店名去掉分店字樣、括號、空白後相同或互相包含，且縣市相同或其中一邊沒填）
    var simName = function (s) { return String(s).toLowerCase().replace(/[（(][^）)]*[）)]/g, "").replace(/(分店|總店|本店|門市|店)$/, "").replace(/[\s\-_·・.,，、]/g, ""); };
    var mine = simName(name), similar = [];
    rows.forEach(function (r) {
      var o = simName(r[1]);
      if (!o || !mine || (r[2] && county && String(r[2]) !== county)) return;
      if (o === mine || (Math.min(o.length, mine.length) >= 3 && (o.indexOf(mine) >= 0 || mine.indexOf(o) >= 0))) similar.push(String(r[1]) + "（" + [r[2], r[3]].filter(Boolean).join("") + "）");
    });
    var sh = sh_("places");
    var row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    sh.getRange(row, 1, 1, HEADERS.places.length).setValues([[key, name, county, String(info.district || "").trim().slice(0, 20), tagList.join("、"), map, "", "",
      hours, closed, price, addr,
      String(info.feature || "").trim().slice(0, 500), picks, url, "", Date.now()]]);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
  var where = [county, String(info.district || "").trim()].filter(Boolean).join("");
  return "已新增「" + name + "」" + (where ? "（" + where + "）" : "（縣市沒讀到，請到詳情頁確認）") +
    (cuisine ? "，種類：" + tagList.join("、") : "，⚠ 判斷不出是哪一國料理，請之後自己標") +
    "。Google 星數之後再補" + (hours ? "" : "，貼文沒寫營業時間") +
    (similar.length ? "\n⚠ 資料庫已有相似的店：" + similar.slice(0, 3).join("、") + "，請確認是否重複" : "");
}

/* ---------- 智慧搜尋：把一句話交給 Gemini，拆成縣市、區、種類、關鍵字（只回傳條件，比對由網頁自己做） ---------- */
var SEARCH_DAILY_MAX = 300;
function search_(q) {
  q = String(q == null ? "" : q).replace(/\s+/g, " ").trim().slice(0, 100);
  if (!q) throw new Error("請輸入要搜尋的內容");
  var props = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  var cnt = props.getProperty("SEARCH_DAY") === day ? Number(props.getProperty("SEARCH_COUNT") || 0) : 0;
  if (cnt >= SEARCH_DAILY_MAX) throw new Error("今天的智慧搜尋次數已達上限");
  props.setProperties({ SEARCH_DAY: day, SEARCH_COUNT: String(cnt + 1) });

  var counties = {}, districts = {}, tags = {};
  rows_("places").forEach(function (r) {
    if (r[2]) counties[r[2]] = 1;
    if (r[3]) districts[r[3]] = 1;
    String(r[4] || "").split("、").forEach(function (t) { if (t) tags[t] = 1; });
  });
  var info = gemini_("你是餐廳資料庫的搜尋助手。使用者用一句話描述想找的餐廳，請拆解成篩選條件。\n" +
    "【使用者輸入】" + q + "\n\n" +
    "【資料庫現有的縣市】" + Object.keys(counties).join("、") + "\n" +
    "【資料庫現有的區】" + Object.keys(districts).join("、") + "\n" +
    "【資料庫現有的種類標籤】" + Object.keys(tags).join("、") + "\n\n" +
    "請輸出 JSON：\n" +
    '- "counties": 使用者提到的縣市陣列，必須用資料庫現有的寫法（例：使用者寫「台南市」「臺南」都要寫成「台南」；「新竹」若資料庫是「新竹市」就寫「新竹市」）。沒提到就空陣列\n' +
    '- "districts": 使用者提到的區陣列，必須用資料庫現有的寫法。沒提到就空陣列\n' +
    '- "types": 使用者想吃的料理或食物類型陣列。盡量對應資料庫現有的種類標籤（例：拉麵、燒肉、火鍋、咖喱；「咖哩」要寫「咖喱」；「日本料理」寫「日式料理」）；資料庫沒有的種類也可以照使用者的意思寫（例：鍋貼）。沒提到就空陣列\n' +
    '- "keywords": 其他特定店名、餐點名稱或特色字詞陣列（不要重複放縣市、區、種類，也不要把營業時間、星數的要求放進來）。沒有就空陣列\n' +
    '- "closeAfter": 使用者要求「營業到比某時間更晚」時填 24 小時制 HH:MM（例：「營業超過 21 點」「開到很晚」→ 21:00；「宵夜、深夜」→ 22:00；「營業到凌晨」→ 24:00）。沒要求就空字串\n' +
    '- "openAt": 使用者要求「某個時間點有在營業」時填 24 小時制 HH:MM（例：「晚上十點還有開」→ 22:00；「早上七點就有開」→ 07:00）。沒要求就空字串\n' +
    '- "openBefore": 使用者要求「很早開門、比某時間更早開始營業」時填 HH:MM（例：「早上八點前就開」→ 08:00；「早餐」→ 10:00）。沒要求就空字串\n' +
    '- "minRating": 使用者要求 Google 星數至少多少時填數字（例：「4.5 星以上」→ 4.5；「高評價」→ 4.3）。沒要求就填 0\n' +
    '- "understood": 一句話繁體中文，白話說明你理解的條件，例：台南、高雄的拉麵。完全看不懂就空字串');
  function hhmm(v) {
    var m = String(v == null ? "" : v).trim().match(/^(\d{1,2}):(\d{2})$/);
    return m && Number(m[1]) <= 24 && Number(m[2]) < 60 ? ("0" + m[1]).slice(-2) + ":" + m[2] : "";
  }
  function list(v) {
    return (Array.isArray(v) ? v : []).map(function (x) { return String(x == null ? "" : x).trim().slice(0, 20); }).filter(Boolean).slice(0, 10);
  }
  return {
    counties: list(info.counties).map(normCounty_), districts: list(info.districts), types: list(info.types).map(function (t) { return t.replace(/咖哩/g, "咖喱"); }),
    keywords: list(info.keywords), closeAfter: hhmm(info.closeAfter), openAt: hhmm(info.openAt), openBefore: hhmm(info.openBefore),
    minRating: Math.max(0, Math.min(5, Number(info.minRating) || 0)), understood: String(info.understood || "").trim().slice(0, 100)
  };
}

// 在 Apps Script 編輯器上方選這個函式按「執行」：第一次會要求授權「連到外部網站」，執行後看「執行記錄」
function testShare() {
  var url = "https://www.instagram.com/p/DAe0f2oS-0K/";
  var t = fetchPostText_(url);
  Logger.log("連線紀錄：" + FETCH_LOG_.join("、"));
  Logger.log("讀到的文字長度：" + t.length + "\n" + t.slice(0, 200));
  Logger.log("Gemini 金鑰：" + (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") ? "已設定" : "沒有設定"));
}

function handle_(op) {
  switch (op && op.op) {
    case "addRestaurant": addRestaurant_(op.id, op.name); break;
    case "renameRestaurant": renameRestaurant_(op.id, op.name); break;
    case "delRestaurant": delRestaurant_(op.id); break;
    case "addItem": addItem_(op.id, op.name, op.rid); break;
    case "delItem": delItem_(op.id); break;
    case "setVote": setVote_(op.itemId, op.member, op.r, op.n, op.t); break;
    case "import": import_(op.restaurants, op.items); break;
    case "setPlace": setPlace_(op.key, op.field, op.value); break;
    case "importPlaces": importPlaces_(op.places); break;
    case "setPlaces": setPlaces_(op.list); break;
    default: throw new Error("不支援的操作");
  }
}

function doGet() {
  return json_({ ok: true, state: state_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var op = JSON.parse(e.postData.contents);
    if (op && op.op === "searchPlaces") { // 智慧搜尋：只讀資料、問 Gemini，不佔鎖
      try {
        return json_({ ok: true, intent: search_(op.q) });
      } catch (err) {
        return json_({ ok: false, error: String(err && err.message || err) });
      }
    }
    if (op && op.op === "shareUrl") { // 抓貼文與問 Gemini 要等一陣子，不佔著鎖；只有寫入試算表時才上鎖
      try {
        return json_({ ok: true, message: share_(op.url, op.html) });
      } catch (err) { // 失敗也帶 message，捷徑只要取同一個欄位顯示
        var why = String(err && err.message || err);
        return json_({ ok: false, error: why, message: "沒有新增：" + why });
      }
    }
    lock.waitLock(15000);
    handle_(op);
    return json_({ ok: true, state: state_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

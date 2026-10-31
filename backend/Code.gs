/**
 * 餐廳評分簿・後端（多餐廳版）
 * 貼在「綁定試算表」的 Apps Script（試算表 → 擴充功能 → Apps Script）。
 * 會自動建立五張工作表：restaurants（餐廳）、items（品項）、votes（評分與備註）、members（留言身分）、
 * placeEdits（「找餐廳」詳情頁手動修改的欄位，疊加在網站的 places.json 之上）。
 * 舊版沒有餐廳欄位的品項，會自動歸入「茶六」。
 */

var DEFAULT_RID = "r_chaliu";
var DEFAULT_RNAME = "茶六";

var HEADERS = {
  restaurants: ["id", "name", "createdAt"],
  items: ["id", "name", "createdAt", "restaurantId"],
  votes: ["itemId", "member", "rating", "note", "updatedAt"],
  members: ["name"],
  placeEdits: ["key", "field", "value", "updatedAt"]
};
// 這些欄位一律當純文字，避免有人輸入「=...」被當成公式執行
var TEXT_COLS = { restaurants: [1, 2], items: [1, 2, 4], votes: [1, 2, 3, 4], members: [1], placeEdits: [1, 2, 3] };
var RATINGS = ["超好吃", "好吃", "普通", "有點雷"];
var LIMIT = { restaurants: 30, items: 500, members: 30, votes: 8000, placeEdits: 3000 };
// 詳情頁允許修改的欄位（其他欄位一律拒絕）
var PLACE_FIELDS = { rating: 1, ratingDate: 1, hours: 1, closed: 1, price: 1, address: 1, feature: 1, picks: 1 };
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
  var placeEdits = rows_("placeEdits")
    .filter(function (r) { return r[0] && r[1]; })
    .map(function (r) { return { k: String(r[0]), f: String(r[1]), v: String(r[2] == null ? "" : r[2]), t: Number(r[3]) || 0 }; });
  return { restaurants: restaurants, items: items, votes: votes, members: members, placeEdits: placeEdits };
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

/* ---------- 找餐廳詳情頁的手動修改（key＝「店名|縣市」，一個欄位一列，空字串代表清空） ---------- */
function setPlace_(key, field, value, t) {
  key = String(key == null ? "" : key).trim();
  if (!key || key.length > 80 || key.indexOf("|") < 0) throw new Error("店家代碼不正確");
  field = String(field || "");
  if (!Object.prototype.hasOwnProperty.call(PLACE_FIELDS, field)) throw new Error("這個欄位不能修改");
  value = String(value == null ? "" : value).trim().slice(0, 500);
  if (field === "rating" && value !== "" && !(Number(value) >= 0 && Number(value) <= 5)) throw new Error("星數要在 0 到 5 之間");
  if (field === "ratingDate" && value !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("日期格式不正確");
  t = Number(t) || Date.now();
  var sh = sh_("placeEdits");
  var rows = rows_("placeEdits");
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === key && String(rows[i][1]) === field) {
      sh.getRange(i + 2, 1, 1, 4).setValues([[key, field, value, t]]);
      return;
    }
  }
  if (rows.length >= LIMIT.placeEdits) throw new Error("修改筆數已達上限");
  sh.appendRow([key, field, value, t]);
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

function handle_(op) {
  switch (op && op.op) {
    case "addRestaurant": addRestaurant_(op.id, op.name); break;
    case "renameRestaurant": renameRestaurant_(op.id, op.name); break;
    case "delRestaurant": delRestaurant_(op.id); break;
    case "addItem": addItem_(op.id, op.name, op.rid); break;
    case "delItem": delItem_(op.id); break;
    case "setVote": setVote_(op.itemId, op.member, op.r, op.n, op.t); break;
    case "import": import_(op.restaurants, op.items); break;
    case "setPlace": setPlace_(op.key, op.field, op.value, op.t); break;
    default: throw new Error("不支援的操作");
  }
}

function doGet() {
  return json_({ ok: true, state: state_() });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var op = JSON.parse(e.postData.contents);
    handle_(op);
    return json_({ ok: true, state: state_() });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

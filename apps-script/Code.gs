/**
 * PND53 WHT Input — Google Apps Script backend
 * -------------------------------------------------------------
 * Bind this script to the "SLC PND53 WHT" spreadsheet
 * (Extensions → Apps Script) and deploy it as a Web App.
 *
 * Sheets used
 *   Input     : A Ref | B Date | C Payee ID | D Name | E Type | F Rate | G Amount | H WHT
 *   Payee 53  : "Payee ID" column + "ชื่อสำหรับกรอกข้อมูล" column (falls back to B / L)
 *
 * Every request must carry the API key stored in Script Properties (API_KEY).
 * Run setupApiKey() once from the editor to create it.
 */

const CONFIG = {
  SPREADSHEET_ID: '',            // leave blank when the script is bound to the sheet
  INPUT_SHEET: 'Input',
  PAYEE_SHEET: 'Payee 53',
  DEFAULT_TYPES: ['ค่าบริการ', 'ค่าขนส่ง', 'ค่าประกัน'],
  DEFAULT_RATES: [1, 3, 5],      // percent
  BE_OFFSET: 543
};

const COL = { REF: 1, DATE: 2, PAYEE_ID: 3, NAME: 4, TYPE: 5, RATE: 6, AMOUNT: 7, WHT: 8 };
const NUM_COLS = 8;

/* ============================ HTTP entry points ============================ */

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Invalid JSON body' });
  }
  return handle_(body);
}

function handle_(p) {
  try {
    checkKey_(p.key);
    switch (p.action) {
      case 'ping':    return json_({ ok: true, data: 'pong' });
      case 'init':    return json_({ ok: true, data: init_() });
      case 'list':    return json_({ ok: true, data: listEntries_() });
      case 'nextRef': return json_({ ok: true, data: nextRef_(Number(p.year)) });
      case 'create':  return json_({ ok: true, data: withLock_(() => createEntry_(p.entry)) });
      case 'update':  return json_({ ok: true, data: withLock_(() => updateEntry_(p.entry)) });
      case 'payees':  return json_({ ok: true, data: getPayees_() });
      case 'createPayee': return json_({ ok: true, data: withLock_(() => createPayee_(p.payee)) });
      default:        return json_({ ok: false, error: 'Unknown action: ' + p.action });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================================ Security ================================ */

/** Run once from the Apps Script editor. The key is printed in the execution log. */
function setupApiKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('API key: ' + key);
  return key;
}

function checkKey_(provided) {
  const key = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!key) throw new Error('API_KEY is not set. Run setupApiKey() in the Apps Script editor.');
  if (String(provided || '') !== key) throw new Error('Unauthorized');
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ================================= Sheets ================================= */

function ss_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function tz_() { return ss_().getSpreadsheetTimeZone(); }

/* ================================= Payees ================================= */

/* Payee 53 layout (A–M). Columns are matched by header text; these are the fallbacks. */
const PCOL = { SEQ: 1, ID: 2, PREFIX: 3, NAME: 4, TAX: 5, BRANCH: 6, ADDR: 7, SUB: 8,
               DIST: 9, PROV: 10, ZIP: 11, FULLNAME: 12, FULLADDR: 13 };
const PHEAD = {
  SEQ: h => h === 'ลำดับ',
  ID: h => h.toLowerCase() === 'payee id',
  PREFIX: h => h.indexOf('คำนำหน้า') === 0,
  NAME: h => h.indexOf('ชื่อของ') === 0,
  TAX: h => h.indexOf('เลขประจำตัวผู้เสียภาษี') === 0,
  BRANCH: h => h.indexOf('สาขา') === 0,
  ADDR: h => h === 'ที่อยู่',
  SUB: h => h.indexOf('ตำบล') === 0,
  DIST: h => h.indexOf('อำเภอ') === 0,
  PROV: h => h.indexOf('จังหวัด') === 0,
  ZIP: h => h.indexOf('รหัสไปรษณีย์') === 0,
  FULLNAME: h => h.indexOf('ชื่อสำหรับกรอกข้อมูล') === 0,
  FULLADDR: h => h.indexOf('ที่อยู่สำหรับกรอกข้อมูล') === 0
};
const DEFAULT_PREFIXES = ['บจก.', 'บมจ.', 'หจก.', 'นาย', 'นาง', 'นางสาว'];

function payeeCols_(sh) {
  const lastCol = Math.max(sh.getLastColumn(), 13);
  const header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0]
    .map(h => String(h).replace(/\s+/g, ' ').trim());
  const cols = {};
  Object.keys(PCOL).forEach(k => {
    const i = header.findIndex(PHEAD[k]);
    cols[k] = i >= 0 ? i + 1 : PCOL[k];
  });
  return cols;
}

function getPayees_() {
  const sh = sheet_(CONFIG.PAYEE_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const C = payeeCols_(sh);
  const width = Math.max(sh.getLastColumn(), 13);
  const values = sh.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const get = (r, k) => String(r[C[k] - 1] || '').trim();
  const out = [];
  values.forEach((r, i) => {
    const id = get(r, 'ID');
    if (!id) return;
    const fullName = get(r, 'FULLNAME') || [get(r, 'PREFIX'), get(r, 'NAME')].filter(String).join(' ');
    out.push({
      row: i + 2, seq: get(r, 'SEQ'), id: id, name: fullName,
      prefix: get(r, 'PREFIX'), shortName: get(r, 'NAME'), taxId: get(r, 'TAX'), branch: get(r, 'BRANCH'),
      address: get(r, 'ADDR'), subdistrict: get(r, 'SUB'), district: get(r, 'DIST'),
      province: get(r, 'PROV'), zip: get(r, 'ZIP'), fullAddress: get(r, 'FULLADDR')
    });
  });
  return out;
}

/* ---------------------------- new payee ---------------------------- */

const isBangkok_ = p => /^(กรุงเทพ|กทม)/.test(String(p || '').trim());

function buildFullName_(prefix, name) {
  prefix = String(prefix || '').trim(); name = String(name || '').trim();
  switch (prefix) {
    case 'บจก.': return 'บริษัท ' + name + ' จำกัด';
    case 'บมจ.': return 'บริษัท ' + name + ' จำกัด (มหาชน)';
    case 'หจก.': return 'ห้างหุ้นส่วนจำกัด ' + name;
    case 'หสม.': return 'ห้างหุ้นส่วนสามัญ ' + name;
    case 'นาย': case 'นาง': case 'นางสาว': return prefix + name;
    default: return (prefix ? prefix + ' ' : '') + name;
  }
}

function buildFullAddress_(p) {
  const bkk = isBangkok_(p.province);
  return [
    p.address,
    p.subdistrict ? (bkk ? 'แขวง' : 'ต.') + p.subdistrict : '',
    p.district ? (bkk ? 'เขต' : 'อ.') + p.district : '',
    p.province ? (bkk ? 'กรุงเทพมหานคร' : 'จ.' + p.province) : '',
    p.zip
  ].map(s => String(s || '').trim()).filter(String).join(' ');
}

/** Thai 13-digit tax ID checksum. */
function validTaxId_(digits) {
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(digits[12]);
}

const fmtTaxId_ = d => d[0] + '-' + d.slice(1, 5) + '-' + d.slice(5, 10) + '-' + d.slice(10, 12) + '-' + d[12];

function createPayee_(p) {
  if (!p) throw new Error('Missing payee');
  const s = k => String(p[k] == null ? '' : p[k]).trim();
  const existing = getPayees_();

  const id = s('id');
  if (!id) throw new Error('กรุณาระบุ Payee ID');
  if (id.length > 20) throw new Error('Payee ID ยาวเกินไป');
  if (existing.some(x => x.id === id)) throw new Error('Payee ID ' + id + ' มีอยู่แล้ว');

  const name = s('shortName');
  if (!name) throw new Error('กรุณาระบุชื่อผู้มีเงินได้');

  const tax = s('taxId').replace(/\D/g, '');
  if (tax.length !== 13) throw new Error('เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
  if (!validTaxId_(tax) && !p.allowInvalidTaxId) throw new Error('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (checksum)');

  const branchDigits = s('branch').replace(/\D/g, '') || '0';
  if (branchDigits.length > 5) throw new Error('สาขาที่ต้องไม่เกิน 5 หลัก');
  const branch = branchDigits.padStart(5, '0');

  const dup = existing.find(x => x.taxId.replace(/\D/g, '') === tax &&
    (x.branch.replace(/\D/g, '') || '0').padStart(5, '0') === branch);
  if (dup) throw new Error('เลขผู้เสียภาษีและสาขานี้มีอยู่แล้ว (Payee ID ' + dup.id + ')');

  const zip = s('zip');
  if (zip && !/^\d{5}$/.test(zip)) throw new Error('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
  if (!s('address')) throw new Error('กรุณาระบุที่อยู่');
  if (!s('province')) throw new Error('กรุณาระบุจังหวัด');

  const rec = {
    id: id, prefix: s('prefix'), shortName: name, taxId: fmtTaxId_(tax), branch: branch,
    address: s('address'), subdistrict: s('subdistrict'), district: s('district'),
    province: s('province'), zip: zip
  };
  rec.fullName = s('fullName') || buildFullName_(rec.prefix, rec.shortName);
  rec.fullAddress = s('fullAddress') || buildFullAddress_(rec);

  const sh = sheet_(CONFIG.PAYEE_SHEET);
  const C = payeeCols_(sh);
  const last = lastDataRow_(sh, C.ID);
  const row = last + 1;
  ensureRowExists_(sh, row);

  const width = Math.max(sh.getLastColumn(), 13);
  if (last >= 2) {
    sh.getRange(last, 1, 1, width)
      .copyTo(sh.getRange(row, 1, 1, width), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  const tplF = last >= 2 ? sh.getRange(last, 1, 1, width).getFormulasR1C1()[0] : [];
  const rowF = sh.getRange(row, 1, 1, width).getFormulasR1C1()[0];

  const maxSeq = existing.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0);
  const values = {
    SEQ: maxSeq + 1, ID: rec.id, PREFIX: rec.prefix, NAME: rec.shortName, TAX: rec.taxId,
    BRANCH: rec.branch, ADDR: rec.address, SUB: rec.subdistrict, DIST: rec.district,
    PROV: rec.province, ZIP: rec.zip, FULLNAME: rec.fullName, FULLADDR: rec.fullAddress
  };
  const TEXT = { TAX: 1, BRANCH: 1, ZIP: 1 };   // keep leading zeros
  Object.keys(values).forEach(k => {
    const col = C[k];
    const cell = sh.getRange(row, col);
    if (rowF[col - 1]) return;                               // formula already there
    if (tplF[col - 1]) { cell.setFormulaR1C1(tplF[col - 1]); return; }
    if (TEXT[k]) cell.setNumberFormat('@');
    cell.setValue(values[k]);
  });
  SpreadsheetApp.flush();
  return getPayees_().find(x => x.id === rec.id) || rec;
}

/* ============================= Date helpers =============================== */

/** Returns {d, m, y} with y in Buddhist Era, or null. */
function parseCellDate_(value, display) {
  if (value instanceof Date && !isNaN(value)) {
    const parts = Utilities.formatDate(value, tz_(), 'd/M/yyyy').split('/').map(Number);
    let y = parts[2];
    if (y < 2400) y += CONFIG.BE_OFFSET; // stored as a Gregorian date
    return { d: parts[0], m: parts[1], y: y };
  }
  return parseDateText_(String(display || value || ''));
}

/** Parses "d/m/yyyy" (B.E.). Accepts "/", "-" or "." as separators. */
function parseDateText_(s) {
  const m = String(s).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!m) return null;
  let d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (y < 2400) y += CONFIG.BE_OFFSET;
  const g = new Date(y - CONFIG.BE_OFFSET, mo - 1, d);
  if (g.getFullYear() !== y - CONFIG.BE_OFFSET || g.getMonth() !== mo - 1 || g.getDate() !== d) return null;
  return { d: d, m: mo, y: y };
}

function fmtDate_(o) { return o.d + '/' + o.m + '/' + o.y; }

function todayBE_() {
  const parts = Utilities.formatDate(new Date(), tz_(), 'd/M/yyyy').split('/').map(Number);
  return { d: parts[0], m: parts[1], y: parts[2] + CONFIG.BE_OFFSET };
}

/* ============================== Number helpers ============================ */

function toNumber_(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v || '').replace(/[,%\s฿]/g, ''));
  return isNaN(n) ? 0 : n;
}

function round2_(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/** Rate cell → percent number (0.03 → 3, "3.00%" → 3). */
function ratePercent_(value, display) {
  if (typeof value === 'number') return round2_(value <= 1 ? value * 100 : value);
  return round2_(toNumber_(display || value));
}

/* ============================== Input rows ================================ */

function readEntries_() {
  const sh = sheet_(CONFIG.INPUT_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  const range = sh.getRange(2, 1, lastRow - 1, NUM_COLS);
  const values = range.getValues();
  const display = range.getDisplayValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i], dv = display[i];
    const ref = String(dv[COL.REF - 1] || '').trim();
    if (!ref) continue;
    const date = parseCellDate_(v[COL.DATE - 1], dv[COL.DATE - 1]);
    out.push({
      row: i + 2,
      ref: ref,
      date: date ? fmtDate_(date) : dv[COL.DATE - 1],
      d: date ? date.d : null, m: date ? date.m : null, y: date ? date.y : null,
      payeeId: String(dv[COL.PAYEE_ID - 1] || '').trim(),
      name: String(dv[COL.NAME - 1] || '').trim(),
      type: String(dv[COL.TYPE - 1] || '').trim(),
      rate: ratePercent_(v[COL.RATE - 1], dv[COL.RATE - 1]),
      amount: round2_(toNumber_(v[COL.AMOUNT - 1])),
      wht: round2_(toNumber_(v[COL.WHT - 1]))
    });
  }
  return out;
}

/** Last row (≥2) whose key column is not blank; 1 if there is none. */
function lastDataRow_(sh, keyCol) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 1;
  const refs = sh.getRange(2, keyCol || COL.REF, lastRow - 1, 1).getDisplayValues();
  for (let i = refs.length - 1; i >= 0; i--) {
    if (String(refs[i][0]).trim()) return i + 2;
  }
  return 1;
}

/** Entries dated in the current or previous month (relative to today). */
function listEntries_() {
  const t = todayBE_();
  const prev = t.m === 1 ? { m: 12, y: t.y - 1 } : { m: t.m - 1, y: t.y };
  const entries = readEntries_().filter(e =>
    (e.y === t.y && e.m === t.m) || (e.y === prev.y && e.m === prev.m));
  entries.sort((a, b) => (b.y - a.y) || (b.m - a.m) || (b.d - a.d) || String(b.ref).localeCompare(String(a.ref)));
  return {
    current: { m: t.m, y: t.y },
    previous: prev,
    entries: entries
  };
}

/** Next Ref for a B.E. year: YYYY + 3-digit running number, e.g. 2569001. */
function nextRef_(beYear) {
  if (!beYear || beYear < 2400 || beYear > 2800) beYear = todayBE_().y;
  const prefix = String(beYear);
  let max = 0;
  const sh = sheet_(CONFIG.INPUT_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    sh.getRange(2, COL.REF, lastRow - 1, 1).getDisplayValues().forEach(r => {
      const ref = String(r[0]).trim();
      if (ref.length === 7 && ref.indexOf(prefix) === 0) {
        const seq = Number(ref.slice(4));
        if (!isNaN(seq) && seq > max) max = seq;
      }
    });
  }
  if (max >= 999) throw new Error('Ref numbers for ' + beYear + ' are used up (999).');
  return prefix + String(max + 1).padStart(3, '0');
}

function init_() {
  const all = readEntries_();
  const types = CONFIG.DEFAULT_TYPES.slice();
  all.forEach(e => { if (e.type && types.indexOf(e.type) < 0) types.push(e.type); });
  const t = todayBE_();
  const payees = getPayees_();
  const prefixes = DEFAULT_PREFIXES.slice();
  payees.forEach(p => { if (p.prefix && prefixes.indexOf(p.prefix) < 0) prefixes.push(p.prefix); });
  return {
    payees: payees,
    prefixes: prefixes,
    types: types,
    rates: CONFIG.DEFAULT_RATES,
    today: t,
    nextRef: nextRef_(t.y),
    list: listEntries_()
  };
}

/* ============================ Create / Update ============================= */

function validate_(entry) {
  if (!entry) throw new Error('Missing entry');
  const date = parseDateText_(entry.date);
  if (!date) throw new Error('วันที่ไม่ถูกต้อง (ใช้รูปแบบ วว/ดด/ปปปป พ.ศ.)');
  if (date.y < 2500 || date.y > 2700) throw new Error('ปี พ.ศ. ไม่ถูกต้อง');

  const payeeId = String(entry.payeeId || '').trim();
  const payee = getPayees_().find(p => p.id === payeeId);
  if (!payee) throw new Error('ไม่พบ Payee ID: ' + payeeId);

  const type = String(entry.type || '').trim();
  if (!type) throw new Error('กรุณาระบุประเภทเงินได้ (Type)');
  if (type.length > 100) throw new Error('Type ยาวเกินไป');

  const rate = round2_(toNumber_(entry.rate));
  if (!(rate > 0 && rate <= 100)) throw new Error('อัตราภาษี (Rate) ไม่ถูกต้อง');

  const amount = round2_(toNumber_(entry.amount));
  if (!(amount > 0)) throw new Error('จำนวนเงิน (Amount) ต้องมากกว่า 0');

  return {
    date: date,
    payeeId: payeeId,
    name: payee.name,
    type: type,
    rate: rate,
    amount: amount,
    wht: round2_(amount * rate / 100)
  };
}

/**
 * Writes one row. `tplRow` is a row whose formats/formulas are reused:
 * if Name (D) or WHT (H) hold formulas there, the formula is kept instead of a value.
 */
function writeRow_(sh, row, tplRow, ref, e) {
  if (tplRow >= 2 && tplRow !== row) {
    sh.getRange(tplRow, 1, 1, NUM_COLS)
      .copyTo(sh.getRange(row, 1, 1, NUM_COLS), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  const tplFormulas = tplRow >= 2 ? sh.getRange(tplRow, 1, 1, NUM_COLS).getFormulasR1C1()[0] : [];
  const rowFormulas = sh.getRange(row, 1, 1, NUM_COLS).getFormulasR1C1()[0];
  const tplDate = tplRow >= 2 ? sh.getRange(tplRow, COL.DATE).getValue() : null;

  sh.getRange(row, COL.REF).setValue(Number(ref));

  // Date: follow the existing column — real date cell or text
  const dateCell = sh.getRange(row, COL.DATE);
  if (tplDate instanceof Date) {
    dateCell.setValue(new Date(e.date.y - CONFIG.BE_OFFSET, e.date.m - 1, e.date.d));
  } else {
    dateCell.setNumberFormat('@').setValue(fmtDate_(e.date));
  }

  sh.getRange(row, COL.PAYEE_ID).setValue(e.payeeId);
  setValueOrFormula_(sh, row, COL.NAME, e.name, rowFormulas, tplFormulas);
  sh.getRange(row, COL.TYPE).setValue(e.type);
  sh.getRange(row, COL.RATE).setValue(e.rate / 100).setNumberFormat('0.00%');
  sh.getRange(row, COL.AMOUNT).setValue(e.amount).setNumberFormat('#,##0.00');
  setValueOrFormula_(sh, row, COL.WHT, e.wht, rowFormulas, tplFormulas);
}

function setValueOrFormula_(sh, row, col, value, rowFormulas, tplFormulas) {
  const cell = sh.getRange(row, col);
  if (rowFormulas[col - 1]) return;                      // formula already in this row → keep it
  if (tplFormulas[col - 1]) { cell.setFormulaR1C1(tplFormulas[col - 1]); return; }
  cell.setValue(value);
}

/**
 * If the last entry sits on the sheet's final row, there is no row to write into.
 * Add blank row(s) at the bottom first (they inherit the formatting of the row above).
 */
function ensureRowExists_(sh, row) {
  const maxRows = sh.getMaxRows();
  if (row > maxRows) {
    sh.insertRowsAfter(maxRows, row - maxRows);
    SpreadsheetApp.flush();
  }
}

function rowToEntry_(sh, row) {
  const found = readEntries_().find(x => x.row === row);
  return found || null;
}

function createEntry_(entry) {
  const e = validate_(entry);
  const sh = sheet_(CONFIG.INPUT_SHEET);
  const ref = nextRef_(e.date.y);
  const last = lastDataRow_(sh);
  const row = last + 1;
  ensureRowExists_(sh, row);
  writeRow_(sh, row, last, ref, e);
  SpreadsheetApp.flush();
  return rowToEntry_(sh, row);
}

function updateEntry_(entry) {
  const ref = String((entry && entry.ref) || '').trim();
  if (!ref) throw new Error('Missing Ref');
  const e = validate_(entry);
  const sh = sheet_(CONFIG.INPUT_SHEET);
  const target = readEntries_().find(x => x.ref === ref);
  if (!target) throw new Error('ไม่พบรายการ Ref: ' + ref);
  writeRow_(sh, target.row, target.row, ref, e);
  SpreadsheetApp.flush();
  return rowToEntry_(sh, target.row);
}

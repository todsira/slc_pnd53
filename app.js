/* PND53 WHT Input — front end (GitHub Pages) */
(function () {
  'use strict';
  // Must equal PAGE_VERSION in index.html (checked there to catch mismatched / cached files)
  if (typeof window !== 'undefined') window.APP_VERSION = '5';

  /* ============================ pure helpers ============================ */
  const BE = 543;
  const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
                     'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

  function parseAmount(s) {
    const t = String(s == null ? '' : s).replace(/[,\s฿]/g, '');
    if (t === '' || !/^\d*\.?\d*$/.test(t)) return NaN;
    return Number(t);
  }

  function fmtMoney(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function calcWht(amount, ratePct) {
    if (!(amount > 0) || !(ratePct > 0)) return 0;
    return round2(amount * ratePct / 100);
  }

  /** "d/m/yyyy" in B.E. → {d,m,y} or null. Rejects impossible dates. */
  function parseBEDate(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    if (y < 2500 || y > 2700) return null;
    const g = new Date(y - BE, mo - 1, d);
    if (g.getFullYear() !== y - BE || g.getMonth() !== mo - 1 || g.getDate() !== d) return null;
    return { d, m: mo, y };
  }

  function todayBE() {
    const n = new Date();
    return { d: n.getDate(), m: n.getMonth() + 1, y: n.getFullYear() + BE };
  }

  const fmtDate = o => `${o.d}/${o.m}/${o.y}`;
  const pad2 = n => String(n).padStart(2, '0');
  const fmtDateInput = o => `${pad2(o.d)}/${pad2(o.m)}/${o.y}`;

  /** Auto-insert slashes while typing digits. */
  function maskDate(v) {
    const digits = String(v).replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return digits.slice(0, 2) + '/' + digits.slice(2);
    return digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
  }

  function nextRefFrom(refs, beYear) {
    const prefix = String(beYear);
    let max = 0;
    refs.forEach(r => {
      r = String(r);
      if (r.length === 7 && r.startsWith(prefix)) max = Math.max(max, Number(r.slice(4)) || 0);
    });
    return prefix + String(max + 1).padStart(3, '0');
  }

  const escapeHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---- payee helpers (same rules as Code.gs) ---- */
  function validTaxId(digits) {
    if (!/^\d{13}$/.test(digits)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
    return (11 - (sum % 11)) % 10 === Number(digits[12]);
  }

  /** Formats as you type: 0-1955-52000-64-1 */
  function maskTaxId(v) {
    const d = String(v).replace(/\D/g, '').slice(0, 13);
    const parts = [d.slice(0, 1), d.slice(1, 5), d.slice(5, 10), d.slice(10, 12), d.slice(12, 13)];
    return parts.filter(Boolean).join('-');
  }

  const isBangkok = p => /^(กรุงเทพ|กทม)/.test(String(p || '').trim());

  function buildFullName(prefix, name) {
    prefix = String(prefix || '').trim(); name = String(name || '').trim();
    if (!name) return '';
    switch (prefix) {
      case 'บจก.': return 'บริษัท ' + name + ' จำกัด';
      case 'บมจ.': return 'บริษัท ' + name + ' จำกัด (มหาชน)';
      case 'หจก.': return 'ห้างหุ้นส่วนจำกัด ' + name;
      case 'หสม.': return 'ห้างหุ้นส่วนสามัญ ' + name;
      case 'นาย': case 'นาง': case 'นางสาว': return prefix + name;
      default: return (prefix ? prefix + ' ' : '') + name;
    }
  }

  function buildFullAddress(p) {
    const bkk = isBangkok(p.province);
    return [
      p.address,
      p.subdistrict ? (bkk ? 'แขวง' : 'ต.') + p.subdistrict : '',
      p.district ? (bkk ? 'เขต' : 'อ.') + p.district : '',
      p.province ? (bkk ? 'กรุงเทพมหานคร' : 'จ.' + p.province) : '',
      p.zip
    ].map(s => String(s || '').trim()).filter(Boolean).join(' ');
  }

  const helpers = { round2, parseAmount, fmtMoney, calcWht, parseBEDate, maskDate, nextRefFrom, fmtDate,
    validTaxId, maskTaxId, buildFullName, buildFullAddress };
  if (typeof module !== 'undefined' && module.exports) { module.exports = helpers; return; }

  /* ================================ state ================================ */
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const KEY_STORE = 'pnd53_api_key';
  const state = {
    payees: [], types: [], rates: [1, 3, 5], prefixes: ['บจก.', 'บมจ.', 'หจก.', 'นาย', 'นาง', 'นางสาว'],
    list: { current: null, previous: null, entries: [] },
    filter: 'all', rate: 3, editing: null, pending: null,
    refCache: {}
  };

  const $ = id => document.getElementById(id);
  const el = {
    form: $('entryForm'), formCard: $('formCard'), formTitle: $('formTitle'), editBanner: $('editBanner'),
    ref: $('fRef'), refHint: $('refHint'), date: $('fDate'), payee: $('fPayee'), name: $('fName'),
    type: $('fType'), typeCustom: $('fTypeCustom'), rateChips: $('rateChips'), rateCustom: $('fRateCustom'),
    amount: $('fAmount'), wht: $('fWht'), submit: $('btnSubmit'), reset: $('btnReset'),
    listTitle: $('listTitle'), tabs: $('monthTabs'), body: $('listBody'), foot: $('listFoot'),
    confirm: $('confirmOverlay'), confirmTitle: $('confirmTitle'), confirmList: $('confirmList'),
    btnConfirm: $('btnConfirm'), btnCancel: $('btnCancel'), confirmWarn: $('confirmWarn'),
    keyOverlay: $('keyOverlay'), keyInput: $('keyInput'), toast: $('toast')
  };

  /* ================================= API ================================= */
  function getKey() { try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return state.memKey || ''; } }
  function setKey(k) { state.memKey = k; try { localStorage.setItem(KEY_STORE, k); } catch (e) { /* private mode */ } }

  async function api(action, payload) {
    if (DEMO) return demoApi(action, payload || {});
    const res = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify(Object.assign({ action, key: getKey() }, payload || {}))
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (!j.ok) {
      if (/Unauthorized|API_KEY/.test(j.error)) openKeyModal();
      throw new Error(j.error);
    }
    return j.data;
  }

  /* --------------------------- demo backend --------------------------- */
  const demo = (() => {
    const t = todayBE();
    const prevM = t.m === 1 ? 12 : t.m - 1, prevY = t.m === 1 ? t.y - 1 : t.y;
    const mk = (seq, id, prefix, shortName, taxId, province, district, subdistrict) => {
      const p = { seq: String(seq), id, prefix, shortName, taxId, branch: '00000', address: '99 หมู่ 1',
        subdistrict, district, province, zip: '10000' };
      p.name = p.fullName = buildFullName(prefix, shortName);
      p.fullAddress = buildFullAddress(p);
      return p;
    };
    const payees = [
      mk(1, '53อพ01', 'บจก.', 'ตัวอย่าง หนึ่ง', '0-1055-00000-01-1', 'สระบุรี', 'เมือง', 'ปากเพรียว'),
      mk(2, '53ขส02', 'บจก.', 'ขนส่งตัวอย่าง', '0-1055-00000-02-0', 'กรุงเทพมหานคร', 'บางรัก', 'สีลม'),
      mk(3, '53ปก03', 'บมจ.', 'ประกันตัวอย่าง', '0-1075-00000-03-9', 'กรุงเทพมหานคร', 'ปทุมวัน', 'ลุมพินี')
    ];
    const entries = [
      { ref: prevY + '001', d: 5, m: prevM, y: prevY, payeeId: '53อพ01', type: 'ค่าบริการ', rate: 3, amount: 125000 },
      { ref: prevY + '002', d: 18, m: prevM, y: prevY, payeeId: '53ขส02', type: 'ค่าขนส่ง', rate: 1, amount: 48250.5 },
      { ref: t.y + (prevY === t.y ? '003' : '001'), d: 2, m: t.m, y: t.y, payeeId: '53ปก03', type: 'ค่าประกัน', rate: 1, amount: 15890 }
    ].map(e => Object.assign(e, { date: fmtDate(e), name: payees.find(p => p.id === e.payeeId).name, wht: calcWht(e.amount, e.rate) }));
    return { payees, entries, t, prev: { m: prevM, y: prevY } };
  })();

  function demoApi(action, p) {
    const list = () => ({ current: { m: demo.t.m, y: demo.t.y }, previous: demo.prev,
      entries: demo.entries.slice().sort((a, b) => (b.y - a.y) || (b.m - a.m) || (b.d - a.d)) });
    const norm = e => {
      const d = parseBEDate(e.date); if (!d) throw new Error('วันที่ไม่ถูกต้อง');
      const payee = demo.payees.find(x => x.id === e.payeeId); if (!payee) throw new Error('ไม่พบ Payee ID');
      return Object.assign({}, d, { date: fmtDate(d), payeeId: payee.id, name: payee.name, type: e.type,
        rate: +e.rate, amount: round2(e.amount), wht: calcWht(+e.amount, +e.rate) });
    };
    return new Promise((resolve, reject) => setTimeout(() => {
      try {
        if (action === 'payees') resolve(demo.payees.slice());
        else if (action === 'createPayee') {
          const q = p.payee, tax = String(q.taxId).replace(/\D/g, '');
          if (!q.id) throw new Error('กรุณาระบุ Payee ID');
          if (demo.payees.some(x => x.id === q.id)) throw new Error('Payee ID ' + q.id + ' มีอยู่แล้ว');
          if (!validTaxId(tax) && !q.allowInvalidTaxId) throw new Error('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (checksum)');
          const rec = Object.assign({}, q, { seq: String(demo.payees.length + 1), taxId: maskTaxId(tax),
            branch: String(q.branch || '0').padStart(5, '0') });
          rec.fullName = rec.fullName || buildFullName(rec.prefix, rec.shortName);
          rec.fullAddress = rec.fullAddress || buildFullAddress(rec);
          rec.name = rec.fullName;
          demo.payees.push(rec); resolve(rec);
        }
        else if (action === 'init') resolve({ payees: demo.payees, types: ['ค่าบริการ', 'ค่าขนส่ง', 'ค่าประกัน'],
          prefixes: ['บจก.', 'บมจ.', 'หจก.', 'นาย', 'นาง', 'นางสาว'],
          rates: [1, 3, 5], today: demo.t, nextRef: nextRefFrom(demo.entries.map(e => e.ref), demo.t.y), list: list() });
        else if (action === 'list') resolve(list());
        else if (action === 'nextRef') resolve(nextRefFrom(demo.entries.map(e => e.ref), +p.year));
        else if (action === 'create') {
          const e = norm(p.entry); e.ref = nextRefFrom(demo.entries.map(x => x.ref), e.y);
          demo.entries.push(e); resolve(e);
        } else if (action === 'update') {
          const i = demo.entries.findIndex(x => x.ref === p.entry.ref); if (i < 0) throw new Error('ไม่พบรายการ');
          const e = norm(p.entry); e.ref = p.entry.ref; demo.entries[i] = e; resolve(e);
        } else throw new Error('Unknown action');
      } catch (err) { reject(err); }
    }, 250));
  }

  /* ================================= UI ================================= */
  let toastTimer;
  function toast(msg, isError) {
    el.toast.textContent = msg;
    el.toast.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.className = 'toast'; }, isError ? 5000 : 3000);
  }

  function fillPayees() {
    el.payee.innerHTML = '<option value="">— เลือกผู้รับเงิน —</option>' +
      state.payees.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.id)} — ${escapeHtml(p.name)}</option>`).join('');
    syncPayeeInput();
  }

  /** Every payee gets every field as a string, so older backends (id + name only) can't break the UI. */
  function normPayees(list) {
    const F = ['seq', 'id', 'name', 'prefix', 'shortName', 'taxId', 'branch', 'address',
               'subdistrict', 'district', 'province', 'zip', 'fullName', 'fullAddress'];
    return (Array.isArray(list) ? list : []).map(p => {
      const o = {};
      F.forEach(k => { o[k] = p && p[k] != null ? String(p[k]) : ''; });
      if (!o.name) o.name = o.fullName || [o.prefix, o.shortName].filter(Boolean).join(' ');
      if (!o.fullName) o.fullName = o.name;
      return o;
    }).filter(p => p.id);
  }

  /* ---------------- searchable Payee box (drives the hidden <select>) ---------------- */
  const combo = { input: $('fPayeeInput'), list: $('fPayeeList'), toggle: $('fPayeeToggle'), items: [], active: -1 };

  function payeeLabel(id) {
    if (!id) return '';
    const p = state.payees.find(x => x.id === id);
    if (p) return `${p.id} — ${p.name}`;
    const opt = Array.from(el.payee.options).find(o => o.value === id);
    return opt ? opt.textContent : id;
  }
  function syncPayeeInput() { combo.input.value = payeeLabel(el.payee.value); }

  function highlight(text, q) {
    text = String(text || '');
    const i = q ? text.toLowerCase().indexOf(q) : -1;
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + q.length)) + '</mark>' + escapeHtml(text.slice(i + q.length));
  }

  /** Ranked matches on ID, name (with or without prefix) and tax ID. */
  function searchPayees(raw) {
    const q = String(raw || '').trim().toLowerCase();
    if (!q) return state.payees.slice();
    const qDigits = q.replace(/\D/g, '');
    const words = q.split(/\s+/).filter(Boolean);
    const out = [];
    state.payees.forEach(p => {
      const id = p.id.toLowerCase(), name = String(p.name || '').toLowerCase();
      const short = String(p.shortName || '').toLowerCase(), tax = String(p.taxId || '').replace(/\D/g, '');
      const hay = id + ' ' + name + ' ' + short;
      let s = -1;
      if (id === q) s = 0;
      else if (id.startsWith(q)) s = 1;
      else if (short.startsWith(q) || name.startsWith(q)) s = 2;
      else if (id.includes(q)) s = 3;
      else if (name.includes(q) || short.includes(q)) s = 4;
      else if (qDigits.length >= 3 && qDigits.length === q.replace(/[\s-]/g, '').length && tax.includes(qDigits)) s = 5;
      else if (words.length > 1 && words.every(w => hay.includes(w))) s = 6;
      if (s >= 0) out.push([s, p]);
    });
    return out.sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }

  function renderCombo(raw) {
    const q = String(raw || '').trim().toLowerCase();
    combo.items = searchPayees(q).slice(0, 50);
    const cur = combo.items.findIndex(p => p.id === el.payee.value);
    combo.active = q ? (combo.items.length ? 0 : -1) : cur;
    combo.list.innerHTML = combo.items.length
      ? combo.items.map((p, i) => `<li role="option" id="pOpt${i}" data-i="${i}" aria-selected="${i === combo.active}">
          <span class="cid">${highlight(p.id, q)}</span><span>${highlight(p.name, q)}</span>
          <span class="ctax">${escapeHtml(p.taxId || '')}</span></li>`).join('')
      : '<li class="none">ไม่พบผู้รับเงินที่ตรงกับคำค้นหา</li>';
    combo.list.hidden = false;
    combo.input.setAttribute('aria-expanded', 'true');
    moveActive(0);
  }

  function moveActive(delta) {
    if (!combo.items.length) return;
    if (delta) combo.active = Math.max(0, Math.min(combo.items.length - 1, combo.active + delta));
    combo.list.querySelectorAll('li[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === combo.active)));
    const li = $('pOpt' + combo.active);
    if (li) { li.scrollIntoView({ block: 'nearest' }); combo.input.setAttribute('aria-activedescendant', li.id); }
  }

  function closeCombo() {
    combo.list.hidden = true;
    combo.input.setAttribute('aria-expanded', 'false');
    combo.input.removeAttribute('aria-activedescendant');
  }

  function choosePayee(p) {
    el.payee.value = p ? p.id : '';
    el.payee.dispatchEvent(new Event('change'));
    closeCombo();
  }

  combo.input.addEventListener('input', () => { combo.input.classList.remove('invalid'); renderCombo(combo.input.value); });
  combo.input.addEventListener('focus', () => { combo.input.select(); renderCombo(''); });
  // Clicking a box that still shows the chosen payee selects the text, so typing replaces it
  combo.input.addEventListener('click', () => {
    if (combo.input.value && combo.input.value === payeeLabel(el.payee.value)) combo.input.select();
    if (combo.list.hidden) renderCombo('');
  });
  combo.input.addEventListener('keydown', e => {
    const open = !combo.list.hidden;
    if (e.key === 'ArrowDown') { e.preventDefault(); open ? moveActive(1) : renderCombo(''); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (open) moveActive(-1); }
    else if (e.key === 'Enter' && open) {
      e.preventDefault();                       // don't submit the form
      if (combo.active >= 0) choosePayee(combo.items[combo.active]);
    }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); closeCombo(); syncPayeeInput(); }
  });
  combo.input.addEventListener('blur', () => {
    setTimeout(() => {
      closeCombo();
      const typed = combo.input.value.trim();
      if (!typed) { if (el.payee.value) choosePayee(null); return; }
      if (typed === payeeLabel(el.payee.value)) return;
      const exact = state.payees.find(p => p.id.toLowerCase() === typed.toLowerCase());
      if (exact) { choosePayee(exact); return; }
      const hits = searchPayees(typed);
      if (hits.length === 1) choosePayee(hits[0]);   // only one possible match → take it
      else syncPayeeInput();                           // otherwise keep the previous choice
    }, 120);
  });
  combo.list.addEventListener('mousedown', e => {
    e.preventDefault();                              // keep focus so blur doesn't fire first
    const li = e.target.closest('li[data-i]');
    if (li) choosePayee(combo.items[Number(li.dataset.i)]);
  });
  combo.toggle.addEventListener('mousedown', e => {
    e.preventDefault();
    if (!combo.list.hidden) closeCombo();
    else { combo.input.focus(); renderCombo(''); }
  });

  function fillTypes() {
    el.type.innerHTML = state.types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') +
      '<option value="__custom">อื่นๆ (ระบุเอง)</option>';
  }

  function fillRates() {
    el.rateChips.innerHTML = state.rates.map(r =>
      `<button type="button" class="chip mono" data-rate="${r}">${r}%</button>`).join('') +
      '<button type="button" class="chip" data-rate="custom">อื่นๆ</button>';
  }

  function setRate(r) {
    state.rate = r;
    el.rateChips.querySelectorAll('.chip').forEach(c =>
      c.setAttribute('aria-pressed', String(c.dataset.rate === String(r))));
    el.rateCustom.hidden = r !== 'custom';
    if (r === 'custom') el.rateCustom.focus();
    updateWht();
  }

  function currentRate() {
    if (state.rate === 'custom') { const n = parseAmount(el.rateCustom.value); return n > 0 && n <= 100 ? n : NaN; }
    return Number(state.rate);
  }

  function currentType() {
    return el.type.value === '__custom' ? el.typeCustom.value.trim() : el.type.value;
  }

  function updateWht() {
    el.wht.value = fmtMoney(calcWht(parseAmount(el.amount.value), currentRate()));
  }

  async function updateRefPreview() {
    if (state.editing) return;
    const d = parseBEDate(el.date.value);
    if (!d) { el.ref.value = ''; el.refHint.textContent = 'ปี พ.ศ. + เลขลำดับ 3 หลัก'; return; }
    el.refHint.textContent = 'เลขที่คาดว่าจะได้ (ยืนยันตอนบันทึก)';
    if (state.refCache[d.y]) { el.ref.value = state.refCache[d.y]; return; }
    try {
      const ref = await api('nextRef', { year: d.y });
      state.refCache[d.y] = ref;
      if (parseBEDate(el.date.value) && parseBEDate(el.date.value).y === d.y) el.ref.value = ref;
    } catch (e) { el.ref.value = ''; }
  }

  function resetForm() {
    state.editing = null;
    el.formCard.classList.remove('editing');
    el.formTitle.textContent = 'เพิ่มรายการใหม่';
    el.submit.textContent = 'บันทึก';
    el.reset.textContent = 'ล้างข้อมูล';
    el.date.value = fmtDateInput(todayBE());
    el.payee.value = ''; el.name.value = ''; syncPayeeInput();
    el.type.selectedIndex = 0; el.typeCustom.hidden = true; el.typeCustom.value = '';
    el.rateCustom.value = ''; setRate(3);
    el.amount.value = ''; updateWht();
    [el.date, combo.input, el.amount, el.typeCustom, el.rateCustom].forEach(x => x.classList.remove('invalid'));
    updateRefPreview();
    renderList();
  }

  function startEdit(ref) {
    const e = state.list.entries.find(x => String(x.ref) === String(ref));
    if (!e) return;
    state.editing = e;
    el.formCard.classList.add('editing');
    el.formTitle.textContent = 'แก้ไขรายการ';
    el.editBanner.textContent = `กำลังแก้ไขรายการ Ref ${e.ref} — กด "ยกเลิกการแก้ไข" เพื่อกลับไปเพิ่มรายการใหม่`;
    el.submit.textContent = 'บันทึกการแก้ไข';
    el.reset.textContent = 'ยกเลิกการแก้ไข';
    el.ref.value = e.ref; el.refHint.textContent = 'เลขที่เดิม (ไม่เปลี่ยน)';
    el.date.value = e.d ? fmtDateInput(e) : e.date;
    if (!state.payees.some(p => p.id === e.payeeId)) {
      el.payee.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(e.payeeId)}">${escapeHtml(e.payeeId)} — (ไม่พบใน Payee 53)</option>`);
    }
    el.payee.value = e.payeeId; el.name.value = e.name; syncPayeeInput();
    if (state.types.includes(e.type)) { el.type.value = e.type; el.typeCustom.hidden = true; }
    else { el.type.value = '__custom'; el.typeCustom.hidden = false; el.typeCustom.value = e.type; }
    if (state.rates.includes(e.rate)) setRate(e.rate);
    else { el.rateCustom.value = e.rate; setRate('custom'); }
    el.amount.value = fmtMoney(e.amount); updateWht();
    renderList();
    el.formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function collect() {
    const bad = [];
    const mark = (input, ok) => { input.classList.toggle('invalid', !ok); if (!ok) bad.push(input); };
    const d = parseBEDate(el.date.value); mark(el.date, !!d);
    const payee = state.payees.find(p => p.id === el.payee.value) ||
      (state.editing && el.payee.value === state.editing.payeeId ? { id: state.editing.payeeId, name: state.editing.name } : null);
    mark(combo.input, !!payee);
    const type = currentType(); if (el.type.value === '__custom') mark(el.typeCustom, !!type);
    const rate = currentRate(); if (state.rate === 'custom') mark(el.rateCustom, !isNaN(rate));
    const amount = round2(parseAmount(el.amount.value)); mark(el.amount, amount > 0);
    if (bad.length) {
      bad[0].focus();
      toast(!d ? 'วันที่ไม่ถูกต้อง — ใช้รูปแบบ วว/ดด/ปปปป (พ.ศ.)' : 'กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', true);
      return null;
    }
    return { ref: state.editing ? state.editing.ref : null, date: fmtDate(d), payeeId: payee.id, name: payee.name,
      type, rate, amount, wht: calcWht(amount, rate) };
  }

  function openConfirm(entry) {
    const isEdit = !!entry.ref;
    const rows = [
      ['เลขที่อ้างอิง', isEdit ? entry.ref : (el.ref.value ? el.ref.value + ' (โดยประมาณ)' : 'ออกเลขอัตโนมัติ')],
      ['วันที่', entry.date],
      ['Payee ID', entry.payeeId],
      ['ชื่อผู้มีเงินได้', entry.name],
      ['ประเภทเงินได้', entry.type],
      ['อัตราภาษี', entry.rate + '%'],
      ['จำนวนเงิน', fmtMoney(entry.amount) + ' บาท'],
      ['ภาษีที่หัก', fmtMoney(entry.wht) + ' บาท']
    ];
    openDialog({
      title: isEdit ? 'ยืนยันการแก้ไขข้อมูล' : 'ยืนยันการบันทึกข้อมูล',
      rows, confirmLabel: isEdit ? 'ยืนยันการแก้ไข' : 'ยืนยันการบันทึก',
      run: async () => {
        const saved = await api(isEdit ? 'update' : 'create', { entry });
        toast(isEdit ? `แก้ไขรายการ ${saved.ref} เรียบร้อยแล้ว` : `บันทึกเรียบร้อย เลขที่อ้างอิง ${saved.ref}`);
        state.refCache = {};
        await loadList();
        resetForm();
      }
    });
  }

  /** Generic Thai confirmation popup. opts: {title, rows, warn, confirmLabel, run} */
  function openDialog(opts) {
    state.pending = opts;
    el.confirmTitle.textContent = opts.title;
    el.confirmList.innerHTML = opts.rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v || '-')}</dd>`).join('');
    el.confirmWarn.hidden = !opts.warn;
    el.confirmWarn.textContent = opts.warn || '';
    el.btnConfirm.textContent = opts.confirmLabel;
    el.confirm.classList.add('open');
    el.btnConfirm.focus();
  }

  function closeConfirm() { el.confirm.classList.remove('open'); state.pending = null; }

  async function doSave() {
    const opts = state.pending;
    if (!opts) return;
    el.btnConfirm.disabled = true; el.btnCancel.disabled = true; el.btnConfirm.textContent = 'กำลังบันทึก…';
    try {
      await opts.run();
      closeConfirm();
    } catch (err) {
      toast('บันทึกไม่สำเร็จ: ' + err.message, true);
      el.btnConfirm.textContent = opts.confirmLabel;
    } finally {
      el.btnConfirm.disabled = false; el.btnCancel.disabled = false;
    }
  }

  /* =============================== Payee tab =============================== */
  const PROVINCES = ['กรุงเทพมหานคร','กระบี่','กาญจนบุรี','กาฬสินธุ์','กำแพงเพชร','ขอนแก่น','จันทบุรี','ฉะเชิงเทรา',
    'ชลบุรี','ชัยนาท','ชัยภูมิ','ชุมพร','เชียงราย','เชียงใหม่','ตรัง','ตราด','ตาก','นครนายก','นครปฐม','นครพนม',
    'นครราชสีมา','นครศรีธรรมราช','นครสวรรค์','นนทบุรี','นราธิวาส','น่าน','บึงกาฬ','บุรีรัมย์','ปทุมธานี',
    'ประจวบคีรีขันธ์','ปราจีนบุรี','ปัตตานี','พระนครศรีอยุธยา','พะเยา','พังงา','พัทลุง','พิจิตร','พิษณุโลก',
    'เพชรบุรี','เพชรบูรณ์','แพร่','ภูเก็ต','มหาสารคาม','มุกดาหาร','แม่ฮ่องสอน','ยโสธร','ยะลา','ร้อยเอ็ด',
    'ระนอง','ระยอง','ราชบุรี','ลพบุรี','ลำปาง','ลำพูน','เลย','ศรีสะเกษ','สกลนคร','สงขลา','สตูล','สมุทรปราการ',
    'สมุทรสงคราม','สมุทรสาคร','สระแก้ว','สระบุรี','สิงห์บุรี','สุโขทัย','สุพรรณบุรี','สุราษฎร์ธานี','สุรินทร์',
    'หนองคาย','หนองบัวลำภู','อ่างทอง','อำนาจเจริญ','อุดรธานี','อุตรดิตถ์','อุทัยธานี','อุบลราชธานี'];

  const pel = {
    form: $('payeeForm'), id: $('pId'), idHint: $('pIdHint'), prefix: $('pPrefix'), prefixCustom: $('pPrefixCustom'),
    name: $('pName'), tax: $('pTax'), taxHint: $('pTaxHint'), branch: $('pBranch'), addr: $('pAddr'),
    sub: $('pSub'), subLabel: $('pSubLabel'), dist: $('pDist'), distLabel: $('pDistLabel'), prov: $('pProv'),
    zip: $('pZip'), fullName: $('pFullName'), fullAddr: $('pFullAddr'), reset: $('pReset'),
    search: $('payeeSearch'), body: $('payeeBody'), count: $('payeeCount')
  };
  // "touched" = user typed in the auto-built field, so stop overwriting it
  const auto = { fullName: true, fullAddr: true };

  function fillPrefixes() {
    pel.prefix.innerHTML = state.prefixes.map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('') +
      '<option value="__custom">อื่นๆ (ระบุเอง)</option>';
    $('provList').innerHTML = PROVINCES.map(p => `<option value="${p}">`).join('');
  }

  const payeePrefix = () => pel.prefix.value === '__custom' ? pel.prefixCustom.value.trim() : pel.prefix.value;
  const payeeAddrParts = () => ({ address: pel.addr.value.trim(), subdistrict: pel.sub.value.trim(),
    district: pel.dist.value.trim(), province: pel.prov.value.trim(), zip: pel.zip.value.trim() });

  function refreshPayeeAuto() {
    if (auto.fullName) pel.fullName.value = buildFullName(payeePrefix(), pel.name.value);
    if (auto.fullAddr) pel.fullAddr.value = buildFullAddress(payeeAddrParts());
    const bkk = isBangkok(pel.prov.value);
    pel.subLabel.textContent = bkk ? 'แขวง' : 'ตำบล / แขวง';
    pel.distLabel.textContent = bkk ? 'เขต' : 'อำเภอ / เขต';
  }

  function checkPayeeId() {
    const id = pel.id.value.trim();
    const taken = id && state.payees.some(p => p.id === id);
    pel.idHint.textContent = !id ? 'ห้ามซ้ำกับที่มีอยู่' : taken ? `มี ${id} อยู่แล้ว` : 'ใช้ได้';
    pel.idHint.className = 'hint' + (!id ? '' : taken ? ' err' : ' ok');
    return id && !taken;
  }

  function checkTax() {
    const d = pel.tax.value.replace(/\D/g, '');
    if (!d) { pel.taxHint.textContent = ''; pel.taxHint.className = 'hint'; return 'empty'; }
    if (d.length < 13) { pel.taxHint.textContent = `กรอกแล้ว ${d.length}/13 หลัก`; pel.taxHint.className = 'hint'; return 'short'; }
    const branch = (pel.branch.value.replace(/\D/g, '') || '0').padStart(5, '0');
    const dup = state.payees.find(p => p.taxId.replace(/\D/g, '') === d &&
      (p.branch.replace(/\D/g, '') || '0').padStart(5, '0') === branch);
    if (dup) { pel.taxHint.textContent = `เลขนี้และสาขานี้มีอยู่แล้ว (${dup.id})`; pel.taxHint.className = 'hint err'; return 'dup'; }
    if (!validTaxId(d)) { pel.taxHint.textContent = 'เลขตรวจสอบไม่ตรง — โปรดตรวจสอบอีกครั้ง'; pel.taxHint.className = 'hint warn'; return 'checksum'; }
    pel.taxHint.textContent = 'เลขถูกต้อง'; pel.taxHint.className = 'hint ok'; return 'ok';
  }

  function resetPayeeForm() {
    pel.form.reset();
    pel.prefix.selectedIndex = 0; pel.prefixCustom.hidden = true;
    pel.branch.value = '00000';
    auto.fullName = auto.fullAddr = true;
    pel.form.querySelectorAll('.invalid').forEach(x => x.classList.remove('invalid'));
    checkPayeeId(); checkTax(); refreshPayeeAuto();
  }

  function renderPayees(highlightId) {
    const q = pel.search.value.trim().toLowerCase();
    const rows = state.payees.filter(p => !q ||
      [p.id, p.name, p.shortName, p.taxId].some(v => String(v || '').toLowerCase().includes(q)));
    pel.count.textContent = `รายชื่อ Payee 53 (${state.payees.length})`;
    if (!rows.length) { pel.body.innerHTML = '<tr><td colspan="7" class="empty">ไม่พบรายชื่อ</td></tr>'; return; }
    pel.body.innerHTML = rows.slice().reverse().map(p => `
      <tr class="${p.id === highlightId ? 'is-new' : ''}">
        <td class="mono">${escapeHtml(p.seq)}</td>
        <td class="mono">${escapeHtml(p.id)}</td>
        <td class="name">${escapeHtml(p.name)}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(p.taxId)}</td>
        <td class="mono">${escapeHtml(p.branch)}</td>
        <td style="min-width:240px">${escapeHtml(p.fullAddress)}</td>
        <td><button type="button" class="btn small" data-use="${escapeHtml(p.id)}">ใช้บันทึกภาษี</button></td>
      </tr>`).join('');
  }

  function submitPayee() {
    const bad = [];
    const mark = (input, ok) => { input.classList.toggle('invalid', !ok); if (!ok) bad.push(input); };
    mark(pel.id, checkPayeeId());
    if (pel.prefix.value === '__custom') mark(pel.prefixCustom, !!payeePrefix());
    mark(pel.name, !!pel.name.value.trim());
    const tax = checkTax();
    mark(pel.tax, tax === 'ok' || tax === 'checksum');
    mark(pel.branch, /^\d{1,5}$/.test(pel.branch.value.trim()));
    mark(pel.addr, !!pel.addr.value.trim());
    mark(pel.prov, !!pel.prov.value.trim());
    mark(pel.zip, !pel.zip.value.trim() || /^\d{5}$/.test(pel.zip.value.trim()));
    if (bad.length) { bad[0].focus(); toast('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง', true); return; }

    const payee = Object.assign({
      id: pel.id.value.trim(), prefix: payeePrefix(), shortName: pel.name.value.trim(),
      taxId: pel.tax.value.replace(/\D/g, ''), branch: pel.branch.value.trim().padStart(5, '0'),
      fullName: pel.fullName.value.trim(), fullAddress: pel.fullAddr.value.trim(),
      allowInvalidTaxId: tax === 'checksum'
    }, payeeAddrParts());

    openDialog({
      title: 'ยืนยันการเพิ่มผู้มีเงินได้',
      rows: [
        ['Payee ID', payee.id], ['คำนำหน้า', payee.prefix], ['ชื่อ', payee.shortName],
        ['เลขผู้เสียภาษี', maskTaxId(payee.taxId)], ['สาขาที่', payee.branch],
        ['ชื่อสำหรับกรอกข้อมูล', payee.fullName], ['ที่อยู่สำหรับกรอกข้อมูล', payee.fullAddress]
      ],
      warn: tax === 'checksum' ? 'คำเตือน: เลขประจำตัวผู้เสียภาษีไม่ผ่านการตรวจสอบ checksum — ยืนยันเฉพาะเมื่อมั่นใจว่าเลขถูกต้อง' : '',
      confirmLabel: 'ยืนยันการเพิ่ม',
      run: async () => {
        const saved = await api('createPayee', { payee });
        state.payees = normPayees(await api('payees'));
        fillPayees(); renderPayees(saved.id); resetPayeeForm();
        toast(`เพิ่ม Payee ${saved.id} เรียบร้อยแล้ว`);
      }
    });
  }

  function showView(v) {
    document.querySelectorAll('.viewtab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === v)));
    $('viewWht').hidden = v !== 'wht';
    $('viewPayee').hidden = v !== 'payee';
  }

  /* ------------------------------- list ------------------------------- */
  function renderTabs() {
    const L = state.list;
    if (!L.current) { el.tabs.innerHTML = ''; return; }
    const tabs = [['all', 'ทั้งหมด'],
      ['cur', `${TH_MONTHS[L.current.m - 1]} ${L.current.y}`],
      ['prev', `${TH_MONTHS[L.previous.m - 1]} ${L.previous.y}`]];
    el.tabs.innerHTML = tabs.map(([k, t]) =>
      `<button type="button" class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${t}</button>`).join('');
    el.listTitle.textContent = 'รายการเดือนปัจจุบันและเดือนก่อน';
  }

  function renderList() {
    const L = state.list;
    let rows = L.entries || [];
    if (state.filter === 'cur') rows = rows.filter(e => e.m === L.current.m && e.y === L.current.y);
    if (state.filter === 'prev') rows = rows.filter(e => e.m === L.previous.m && e.y === L.previous.y);
    if (!rows.length) {
      el.body.innerHTML = '<tr><td colspan="9" class="empty">ยังไม่มีรายการในช่วงนี้</td></tr>';
      el.foot.innerHTML = '';
      return;
    }
    const editingRef = state.editing && String(state.editing.ref);
    el.body.innerHTML = rows.map(e => `
      <tr class="${String(e.ref) === editingRef ? 'is-editing' : ''}">
        <td class="mono">${escapeHtml(e.ref)}</td>
        <td class="mono" style="white-space:nowrap">${escapeHtml(e.date)}</td>
        <td class="mono">${escapeHtml(e.payeeId)}</td>
        <td class="name">${escapeHtml(e.name)}</td>
        <td>${escapeHtml(e.type)}</td>
        <td class="num">${Number(e.rate).toFixed(2)}%</td>
        <td class="num">${fmtMoney(e.amount)}</td>
        <td class="num">${fmtMoney(e.wht)}</td>
        <td><button type="button" class="btn small" data-edit="${escapeHtml(e.ref)}">แก้ไข</button></td>
      </tr>`).join('');
    const sumA = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
    const sumW = rows.reduce((s, e) => s + Number(e.wht || 0), 0);
    el.foot.innerHTML = `<tr><td colspan="6">รวม ${rows.length} รายการ</td>
      <td class="num">${fmtMoney(sumA)}</td><td class="num">${fmtMoney(sumW)}</td><td></td></tr>`;
  }

  async function loadList() {
    state.list = await api('list');
    renderTabs(); renderList();
  }

  /* ------------------------------ key modal ------------------------------ */
  function openKeyModal() {
    if (DEMO) { toast('โหมดทดลอง: ยังไม่ได้ตั้งค่า API_URL ใน config.js'); return; }
    el.keyInput.value = getKey();
    el.keyOverlay.classList.add('open');
    el.keyInput.focus();
  }

  /* ================================ events ================================ */
  el.date.addEventListener('input', () => {
    const pos = el.date.value.length;
    el.date.value = maskDate(el.date.value);
    if (pos === el.date.value.length) el.date.setSelectionRange(pos, pos);
    if (parseBEDate(el.date.value)) { el.date.classList.remove('invalid'); updateRefPreview(); }
  });
  el.date.addEventListener('blur', () => {
    if (el.date.value) el.date.classList.toggle('invalid', !parseBEDate(el.date.value));
    updateRefPreview();
  });

  el.payee.addEventListener('change', () => {
    const p = state.payees.find(x => x.id === el.payee.value);
    el.name.value = p ? p.name : (state.editing && el.payee.value === state.editing.payeeId ? state.editing.name : '');
    combo.input.classList.remove('invalid');
    syncPayeeInput();
  });

  el.type.addEventListener('change', () => {
    el.typeCustom.hidden = el.type.value !== '__custom';
    if (!el.typeCustom.hidden) el.typeCustom.focus();
  });

  el.rateChips.addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    setRate(b.dataset.rate === 'custom' ? 'custom' : Number(b.dataset.rate));
  });
  el.rateCustom.addEventListener('input', updateWht);

  el.amount.addEventListener('input', () => {
    el.amount.value = el.amount.value.replace(/[^\d.,]/g, '');
    updateWht();
  });
  el.amount.addEventListener('blur', () => {
    const n = parseAmount(el.amount.value);
    if (n > 0) { el.amount.value = fmtMoney(round2(n)); el.amount.classList.remove('invalid'); }
    updateWht();
  });
  el.amount.addEventListener('focus', () => { el.amount.value = el.amount.value.replace(/,/g, ''); });

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    const entry = collect();
    if (entry) openConfirm(entry);
  });
  el.reset.addEventListener('click', resetForm);

  el.btnConfirm.addEventListener('click', doSave);
  el.btnCancel.addEventListener('click', closeConfirm);
  el.confirm.addEventListener('click', e => { if (e.target === el.confirm && !el.btnCancel.disabled) closeConfirm(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (el.confirm.classList.contains('open') && !el.btnCancel.disabled) closeConfirm(); el.keyOverlay.classList.remove('open'); }
  });

  el.body.addEventListener('click', e => {
    const b = e.target.closest('[data-edit]'); if (b) startEdit(b.dataset.edit);
  });
  el.tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-filter]'); if (!b) return;
    state.filter = b.dataset.filter; renderTabs(); renderList();
  });
  $('btnRefresh').addEventListener('click', () => loadList().then(() => toast('อัปเดตรายการแล้ว')).catch(err => toast(err.message, true)));

  $('btnKey').addEventListener('click', openKeyModal);
  $('btnKeyCancel').addEventListener('click', () => el.keyOverlay.classList.remove('open'));
  $('btnKeySave').addEventListener('click', () => {
    setKey(el.keyInput.value.trim());
    el.keyOverlay.classList.remove('open');
    init();
  });

  /* ---- payee tab events ---- */
  document.querySelector('.viewtabs').addEventListener('click', e => {
    const t = e.target.closest('.viewtab'); if (t) showView(t.dataset.view);
  });
  pel.id.addEventListener('input', () => { pel.id.classList.remove('invalid'); checkPayeeId(); });
  pel.prefix.addEventListener('change', () => {
    pel.prefixCustom.hidden = pel.prefix.value !== '__custom';
    if (!pel.prefixCustom.hidden) pel.prefixCustom.focus();
    refreshPayeeAuto();
  });
  [pel.prefixCustom, pel.name, pel.addr, pel.sub, pel.dist, pel.prov, pel.zip]
    .forEach(i => i.addEventListener('input', () => { i.classList.remove('invalid'); refreshPayeeAuto(); }));
  pel.tax.addEventListener('input', () => { pel.tax.value = maskTaxId(pel.tax.value); pel.tax.classList.remove('invalid'); checkTax(); });
  pel.branch.addEventListener('input', () => { pel.branch.value = pel.branch.value.replace(/\D/g, ''); checkTax(); });
  pel.branch.addEventListener('blur', () => { pel.branch.value = (pel.branch.value || '0').padStart(5, '0'); checkTax(); });
  pel.zip.addEventListener('input', () => { pel.zip.value = pel.zip.value.replace(/\D/g, ''); refreshPayeeAuto(); });
  pel.fullName.addEventListener('input', () => { auto.fullName = !pel.fullName.value; });
  pel.fullAddr.addEventListener('input', () => { auto.fullAddr = !pel.fullAddr.value; });
  pel.form.addEventListener('submit', e => { e.preventDefault(); submitPayee(); });
  pel.reset.addEventListener('click', resetPayeeForm);
  pel.search.addEventListener('input', () => renderPayees());
  pel.body.addEventListener('click', e => {
    const b = e.target.closest('[data-use]'); if (!b) return;
    if (state.editing) resetForm();
    el.payee.value = b.dataset.use;
    el.payee.dispatchEvent(new Event('change'));
    showView('wht');
    el.formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ================================= init ================================= */
  async function init() {
    if (CFG.TITLE) { $('appTitle').textContent = CFG.TITLE; document.title = CFG.TITLE; }
    $('demoBadge').hidden = !DEMO;
    if (!DEMO && !getKey()) { openKeyModal(); return; }
    try {
      const data = await api('init');
      state.payees = normPayees(data.payees);
      state.types = data.types && data.types.length ? data.types : ['ค่าบริการ', 'ค่าขนส่ง', 'ค่าประกัน'];
      state.rates = data.rates || [1, 3, 5];
      state.list = data.list;
      if (data.today && data.nextRef) state.refCache[data.today.y] = data.nextRef;
      if (data.prefixes && data.prefixes.length) state.prefixes = data.prefixes;
      fillPayees(); fillTypes(); fillRates(); fillPrefixes(); renderTabs();
      resetForm(); resetPayeeForm(); renderPayees();
    } catch (err) {
      el.body.innerHTML = `<tr><td colspan="9" class="empty">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message)}</td></tr>`;
      toast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, true);
    }
  }

  init();
})();

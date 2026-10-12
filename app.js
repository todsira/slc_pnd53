/* PND53 WHT Input — front end (GitHub Pages) */
(function () {
  'use strict';

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

  const helpers = { round2, parseAmount, fmtMoney, calcWht, parseBEDate, maskDate, nextRefFrom, fmtDate };
  if (typeof module !== 'undefined' && module.exports) { module.exports = helpers; return; }

  /* ================================ state ================================ */
  const CFG = window.APP_CONFIG || {};
  const DEMO = !CFG.API_URL;
  const KEY_STORE = 'pnd53_api_key';
  const state = {
    payees: [], types: [], rates: [1, 3, 5],
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
    btnConfirm: $('btnConfirm'), btnCancel: $('btnCancel'),
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
    const payees = [
      { id: '53อพ01', name: 'บริษัท ตัวอย่าง หนึ่ง จำกัด' },
      { id: '53ขส02', name: 'บริษัท ขนส่งตัวอย่าง จำกัด' },
      { id: '53ปก03', name: 'บริษัท ประกันตัวอย่าง จำกัด (มหาชน)' }
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
        if (action === 'init') resolve({ payees: demo.payees, types: ['ค่าบริการ', 'ค่าขนส่ง', 'ค่าประกัน'],
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
  }

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
    el.payee.value = ''; el.name.value = '';
    el.type.selectedIndex = 0; el.typeCustom.hidden = true; el.typeCustom.value = '';
    el.rateCustom.value = ''; setRate(3);
    el.amount.value = ''; updateWht();
    [el.date, el.payee, el.amount, el.typeCustom, el.rateCustom].forEach(x => x.classList.remove('invalid'));
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
    el.payee.value = e.payeeId; el.name.value = e.name;
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
    mark(el.payee, !!payee);
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
    state.pending = entry;
    const isEdit = !!entry.ref;
    el.confirmTitle.textContent = isEdit ? 'ยืนยันการแก้ไขข้อมูล' : 'ยืนยันการบันทึกข้อมูล';
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
    el.confirmList.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    el.btnConfirm.textContent = isEdit ? 'ยืนยันการแก้ไข' : 'ยืนยันการบันทึก';
    el.confirm.classList.add('open');
    el.btnConfirm.focus();
  }

  function closeConfirm() { el.confirm.classList.remove('open'); state.pending = null; }

  async function doSave() {
    const entry = state.pending;
    if (!entry) return;
    el.btnConfirm.disabled = true; el.btnCancel.disabled = true; el.btnConfirm.textContent = 'กำลังบันทึก…';
    try {
      const isEdit = !!entry.ref;
      const saved = await api(isEdit ? 'update' : 'create', { entry });
      closeConfirm();
      toast(isEdit ? `แก้ไขรายการ ${saved.ref} เรียบร้อยแล้ว` : `บันทึกเรียบร้อย เลขที่อ้างอิง ${saved.ref}`);
      state.refCache = {};
      await loadList();
      resetForm();
    } catch (err) {
      toast('บันทึกไม่สำเร็จ: ' + err.message, true);
      el.btnConfirm.textContent = entry.ref ? 'ยืนยันการแก้ไข' : 'ยืนยันการบันทึก';
    } finally {
      el.btnConfirm.disabled = false; el.btnCancel.disabled = false;
    }
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
    el.payee.classList.remove('invalid');
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

  /* ================================= init ================================= */
  async function init() {
    if (CFG.TITLE) { $('appTitle').textContent = CFG.TITLE; document.title = CFG.TITLE; }
    $('demoBadge').hidden = !DEMO;
    if (!DEMO && !getKey()) { openKeyModal(); return; }
    try {
      const data = await api('init');
      state.payees = data.payees || [];
      state.types = data.types && data.types.length ? data.types : ['ค่าบริการ', 'ค่าขนส่ง', 'ค่าประกัน'];
      state.rates = data.rates || [1, 3, 5];
      state.list = data.list;
      if (data.today && data.nextRef) state.refCache[data.today.y] = data.nextRef;
      fillPayees(); fillTypes(); fillRates(); renderTabs();
      resetForm();
    } catch (err) {
      el.body.innerHTML = `<tr><td colspan="9" class="empty">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(err.message)}</td></tr>`;
      toast('โหลดข้อมูลไม่สำเร็จ: ' + err.message, true);
    }
  }

  init();
})();

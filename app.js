/* app.js — wires the form to the receipt engine. No framework, no build step.
   Money never touches Intl/parseFloat-dependent formatting here: every value is normalised by
   receipt/layout.js so the preview, the PNG and the copied text can never disagree. */
(function () {
  'use strict';

  var L = window.ReceiptLayout;
  var T = window.ReceiptText;
  var D = window.ReceiptDraw;
  var G = window.ReceiptGen;

  var KEY_FORM = 'struk-thermal:v1';
  var KEY_PROFILES = 'struk-thermal:profiles';
  var KEY_HISTORY = 'struk-thermal:history';
  var KEY_PREFS = 'struk-thermal:prefs';
  var MAX_HISTORY = 20;
  var SAVE_DEBOUNCE = 250;

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* The browser resolves the CSS stack; measuring and drawing must both use this exact string. */
  var FONT = L.FAMILY;
  var measureCtx = document.createElement('canvas').getContext('2d');
  function measure(text, size, bold) {
    measureCtx.font = (bold ? 'bold ' : '') + size + 'px ' + FONT;
    return measureCtx.measureText(String(text)).width;
  }

  var canvas = $('#receipt');
  var sheetFrame = $('#sheetFrame');
  var toastEl = $('#toast');
  var itemsWrap = $('#items');
  var form = $('#form');
  var lastLayout = null;
  var lastInput = null;
  var toastTimer = null;
  var saveTimer = null;

  /* ---------------- helpers ---------------- */

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  /* Accepts "12.500", "12500", "12 500" and 12.500,5 alike; rejects anything non-numeric. */
  function toNumber(raw) {
    if (raw == null) { return 0; }
    var s = String(raw).trim().replace(/\s|\.(?=\d{3}\b)/g, '').replace(',', '.');
    if (s === '') { return 0; }
    var n = Number(s);
    return isFinite(n) ? n : 0;
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function setValue(id, value) {
    var el = document.getElementById(id);
    if (el) { el.value = value == null ? '' : String(value); }
  }
  function valueOf(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function copy(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(label + ' disalin'); },
        function () { toast('Gagal menyalin'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(label + ' disalin'); }
      catch (e) { toast('Gagal menyalin'); }
      document.body.removeChild(ta);
    }
  }

  /* ---------------- items ---------------- */

  function addItem(data) {
    var d = data || { name: '', qty: 1, price: '' };
    var row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML =
      '<input class="it-name" type="text" maxlength="40" placeholder="Nama barang" aria-label="Nama barang">' +
      '<input class="it-qty" type="text" inputmode="decimal" placeholder="1" aria-label="Jumlah" value="1">' +
      '<input class="it-price" type="text" inputmode="numeric" placeholder="0" aria-label="Harga satuan">' +
      '<button type="button" class="item-del btn" title="Hapus item" aria-label="Hapus item">&times;</button>' +
      '<div class="line-total"></div>';
    row.querySelector('.it-name').value = d.name || '';
    row.querySelector('.it-qty').value = d.qty == null ? '1' : String(d.qty);
    row.querySelector('.it-price').value = d.price == null ? '' : String(d.price);
    row.querySelector('.item-del').addEventListener('click', function () {
      row.remove();
      if (!itemsWrap.children.length) { addItem(); }
      render();
    });
    itemsWrap.appendChild(row);
    return row;
  }

  function readItems() {
    return $$('#items .item-row').map(function (row) {
      return {
        name: row.querySelector('.it-name').value.trim(),
        qty: toNumber(row.querySelector('.it-qty').value),
        price: toNumber(row.querySelector('.it-price').value)
      };
    }).filter(function (it) { return it.name || it.qty || it.price; });
  }

  function refreshRowTotals(items) {
    var rows = $$('#items .item-row');
    rows.forEach(function (row, i) {
      var it = items[i] || { qty: 0, price: 0 };
      var el = row.querySelector('.line-total');
      el.textContent = it.name ? (L.qtyText(it.qty) + ' x ' + L.money(it.price) + ' = ' + L.money(it.qty * it.price)) : '';
    });
  }

  /* ---------------- form <-> model ---------------- */

  function readForm() {
    var footer = {
      line1: valueOf('storeFooter') || 'Terima kasih sudah berbelanja',
      line2: valueOf('storeFooter2'),
      line3: ''
    };
    return {
      paper: valueOf('paper') || '58',
      numberStyle: 'comma',
      store: {
        name: valueOf('storeName') || 'TOKO SAYA',
        line2: valueOf('storeLine2'),
        line3: valueOf('storeLine3'),
        city: valueOf('storeAddress'),
        npwp: valueOf('storeNpwp'),
        logo: valueOf('storeLogo')
      },
      customer: {
        label: valueOf('custLabel'),
        addr1: valueOf('custAddr1'),
        addr2: valueOf('custAddr2')
      },
      meta: {
        code: valueOf('metaCode'),
        datetime: valueOf('metaDatetime'),
        cashier: valueOf('storeCashier')
      },
      items: readItems(),
      payment: {
        method: valueOf('method') || 'TUNAI',
        cash: toNumber(valueOf('cash')),
        taxPercent: toNumber(valueOf('taxPercent')),
        taxInclusive: true,
        discountType: valueOf('discountType') || 'amount',
        discountValue: toNumber(valueOf('discountValue'))
      },
      footer: footer
    };
  }

  function writeForm(input, opts) {
    opts = opts || {};
    var s = input.store || {}, c = input.customer || {}, m = input.meta || {}, p = input.payment || {};
    setValue('storeName', s.name); setValue('storeLine2', s.line2); setValue('storeLine3', s.line3);
    setValue('storeAddress', s.city); setValue('storeNpwp', s.npwp); setValue('storeLogo', s.logo);
    setValue('storeCashier', m.cashier);
    setValue('metaCode', m.code); setValue('metaDatetime', m.datetime);
    setValue('custLabel', c.label); setValue('custAddr1', c.addr1); setValue('custAddr2', c.addr2);
    setValue('paper', input.paper || '58');
    setValue('method', p.method || 'TUNAI'); setValue('cash', p.cash || '');
    setValue('taxPercent', p.taxPercent || ''); setValue('discountType', p.discountType || 'amount');
    setValue('discountValue', p.discountValue || '');
    var f = input.footer || {};
    setValue('storeFooter', f.line1); setValue('storeFooter2', f.line2);
    if (opts.items !== false) {
      itemsWrap.innerHTML = '';
      (input.items && input.items.length ? input.items : [{}]).forEach(function (it) { addItem(it); });
    }
  }

  /* ---------------- render ---------------- */

  function render() {
    var input = readForm();
    lastInput = input;
    refreshRowTotals(input.items);

    var layout = L.buildLayout(input, measure, { fontFamily: FONT });
    lastLayout = layout;
    D.draw(canvas, layout, { scale: 2 });

    $('#paperChip').textContent = layout.paper.label;
    var t = layout.totals;
    $('#sumGross').textContent = L.money(t.gross);
    $('#sumDiscount').textContent = L.money(t.discount);
    $('#sumDiscountLabel').textContent = L.discountLabel(input.payment);
    $('#sumDpp').textContent = L.money(t.dpp);
    $('#sumTax').textContent = L.money(t.ppn);
    $('#sumTotal').textContent = L.money(t.total);
    $('#sumChange').textContent = L.money(t.change);

    if (input.payment.cash && t.due > 0) {
      $('#previewHint').textContent = 'Uang diterima kurang ' + L.money(t.due) + ' dari total. Struk tetap dicetak dengan status kurang.';
    } else {
      $('#previewHint').textContent = 'Angka dihitung ulang dari item, jadi total tidak bisa beda dengan hitungan sendiri.';
    }

    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) { clearTimeout(saveTimer); }
    saveTimer = setTimeout(function () { store(KEY_FORM, readForm()); }, SAVE_DEBOUNCE);
  }

  /* ---------------- outputs ---------------- */

  function downloadPng() {
    var url = canvas.toDataURL('image/png');
    var name = (valueOf('storeName') || 'struk').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var stamp = (valueOf('metaDatetime') || '').replace(/[^0-9]/g, '').slice(0, 12) || Date.now();
    var a = document.createElement('a');
    a.href = url;
    a.download = 'struk-' + (name || 'toko') + '-' + stamp + '.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    var img = document.createElement('img');
    img.src = url;
    img.alt = 'Struk ' + (valueOf('storeName') || '');
    sheetFrame.innerHTML = '';
    sheetFrame.appendChild(img);
    toast('PNG diunduh');
  }

  /* ---------------- history ---------------- */

  function history() { return load(KEY_HISTORY, []) || []; }

  function saveToHistory() {
    var input = readForm();
    if (!input.items.length) { toast('Isi minimal satu item dulu'); return; }
    var list = history();
    list.unshift({
      at: Date.now(),
      input: input,
      total: L.computeTotals(input.items, input.payment).total
    });
    store(KEY_HISTORY, list.slice(0, MAX_HISTORY));
    renderHistory();
    toast('Tersimpan ke riwayat');
  }

  function renderHistory() {
    var list = history();
    var wrap = $('#historyList');
    wrap.innerHTML = '';
    $('#historyEmpty').hidden = list.length > 0;
    list.forEach(function (entry, idx) {
      var li = document.createElement('li');
      var inp = entry.input || {};
      var meta = inp.meta || {};
      var head = document.createElement('div');
      head.className = 'h-top';
      var no = document.createElement('span');
      no.className = 'h-no';
      no.textContent = (inp.store && inp.store.name ? inp.store.name : 'Struk');
      var tot = document.createElement('span');
      tot.className = 'h-tot';
      tot.textContent = L.money(entry.total || 0);
      head.appendChild(no); head.appendChild(tot);
      var sub = document.createElement('div');
      sub.className = 'h-meta';
      sub.textContent = (meta.datetime || '-') + ' · ' + ((inp.items || []).length) + ' item';
      var act = document.createElement('div');
      act.className = 'h-act';
      var loadBtn = document.createElement('button');
      loadBtn.type = 'button'; loadBtn.className = 'btn btn-quiet btn-sm'; loadBtn.textContent = 'Muat';
      loadBtn.addEventListener('click', function () { writeForm(entry.input); render(); toast('Struk dimuat'); });
      var delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'btn btn-quiet btn-sm'; delBtn.textContent = 'Hapus';
      delBtn.addEventListener('click', function () {
        var l = history();
        l.splice(idx, 1);
        store(KEY_HISTORY, l);
        renderHistory();
      });
      act.appendChild(loadBtn); act.appendChild(delBtn);
      li.appendChild(head); li.appendChild(sub); li.appendChild(act);
      wrap.appendChild(li);
    });
  }

  /* ---------------- store profiles ---------------- */

  function profiles() { return load(KEY_PROFILES, {}) || {}; }

  function renderProfiles(selected) {
    var sel = $('#storeProfiles');
    var data = profiles();
    sel.innerHTML = '<option value="">Profil tersimpan...</option>';
    Object.keys(data).forEach(function (name) {
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    if (selected && data[selected]) { sel.value = selected; }
  }

  function saveProfile() {
    var name = (valueOf('storeName') || '').trim();
    if (!name) { toast('Isi nama toko dulu'); return; }
    var data = profiles();
    data[name] = {
      name: name,
      line2: valueOf('storeLine2'),
      line3: valueOf('storeLine3'),
      city: valueOf('storeAddress'),
      npwp: valueOf('storeNpwp'),
      logo: valueOf('storeLogo')
    };
    store(KEY_PROFILES, data);
    renderProfiles(name);
    toast('Profil "' + name + '" disimpan');
  }

  function applyProfile(name) {
    var data = profiles();
    var p = data[name];
    if (!p) { return; }
    setValue('storeName', p.name); setValue('storeLine2', p.line2); setValue('storeLine3', p.line3);
    setValue('storeAddress', p.city); setValue('storeNpwp', p.npwp); setValue('storeLogo', p.logo);
    render();
    toast('Profil dimuat');
  }

  /* ---------------- quick cash ---------------- */

  function buildQuickCash() {
    var total = lastLayout ? lastLayout.totals.total : 0;
    var wrap = $('#quickCash');
    wrap.innerHTML = '';
    var base = Math.max(5000, Math.ceil((total || 5000) / 5000) * 5000);
    var options = [];
    for (var i = 0; i < 3; i++) {
      var v = base + i * 5000;
      if (options.indexOf(v) === -1) { options.push(v); }
    }
    options.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-quiet btn-sm';
      b.textContent = L.money(v);
      b.addEventListener('click', function () { setValue('cash', String(v)); render(); });
      wrap.appendChild(b);
    });
  }

  /* ---------------- demo / reset ---------------- */

  function fillDemo() {
    var input = G.randomReceipt({ paper: valueOf('paper') || '58' });
    input.payment.cash = G.friendlyCash(L.computeTotals(input.items, input.payment).total);
    writeForm(input);
    render();
    toast('Contoh data diisi');
  }

  function fillRandom() {
    var input = G.randomReceipt({ paper: valueOf('paper') || '58' });
    input.payment.cash = G.friendlyCash(L.computeTotals(input.items, input.payment).total);
    writeForm(input);
    render();
  }

  function resetForm() {
    try { localStorage.removeItem(KEY_FORM); } catch (e) {}
    form.reset();
    itemsWrap.innerHTML = '';
    addItem();
    render();
    toast('Formulir dikosongkan');
  }

  /* ---------------- theme / install ---------------- */

  function applyPrefs(prefs) {
    document.documentElement.setAttribute('data-theme', prefs.theme || 'light');
    var btn = $('#btnTheme');
    var dark = (prefs.theme || 'light') === 'dark';
    btn.textContent = dark ? 'Mode terang' : 'Mode gelap';
    btn.setAttribute('aria-pressed', String(dark));
  }

  function wireTheme() {
    $('#btnTheme').addEventListener('click', function () {
      var prefs = load(KEY_PREFS, {}) || {};
      prefs.theme = (prefs.theme === 'dark') ? 'light' : 'dark';
      store(KEY_PREFS, prefs);
      applyPrefs(prefs);
    });
  }

  function wireInstall() {
    var promptEvent = null;
    var btn = $('#btnInstall');
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      promptEvent = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', function () {
      if (!promptEvent) { return; }
      promptEvent.prompt();
      promptEvent.userChoice.then(function () { promptEvent = null; btn.hidden = true; });
    });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    applyPrefs(load(KEY_PREFS, {}) || {});
    wireTheme();
    wireInstall();

    var saved = load(KEY_FORM, null);
    if (saved) {
      writeForm(saved);
    } else {
      /* Seed the first receipt with a paid cash amount, the same way the random/demo paths do.
         Booting with an empty cash field printed "TUNAI : 0 / KURANG : ..." on a fresh visit,
         which reads like a bug rather than an unpaid transaction. */
      var first = G.randomReceipt({ paper: '58' });
      first.payment.cash = G.friendlyCash(L.computeTotals(first.items, first.payment).total);
      writeForm(first);
    }
    renderProfiles();
    renderHistory();

    form.addEventListener('input', function () { render(); });
    form.addEventListener('change', function () { render(); buildQuickCash(); });

    $('#btnAddItem').addEventListener('click', function () { addItem(); render(); });
    $('#btnDuplicate').addEventListener('click', function () {
      var rows = $$('#items .item-row');
      if (!rows.length) { addItem(); render(); return; }
      var last = rows[rows.length - 1];
      addItem({
        name: last.querySelector('.it-name').value,
        qty: last.querySelector('.it-qty').value,
        price: last.querySelector('.it-price').value
      });
      render();
    });

    $('#btnRandom').addEventListener('click', fillRandom);
    $('#btnPng').addEventListener('click', downloadPng);
    $('#btnCopyText').addEventListener('click', function () {
      copy(T.buildText(readForm()), 'Teks struk');
    });
    $('#btnCopyTotal').addEventListener('click', function () {
      var t = lastLayout ? lastLayout.totals : L.computeTotals([], {});
      copy(L.money(t.total), 'Total');
    });
    $('#btnSaveHistory').addEventListener('click', saveToHistory);
    $('#btnClearHistory').addEventListener('click', function () {
      store(KEY_HISTORY, []);
      renderHistory();
      toast('Riwayat dikosongkan');
    });

    $('#btnSaveStore').addEventListener('click', saveProfile);
    $('#storeProfiles').addEventListener('change', function (e) { applyProfile(e.target.value); });
    $('#btnDeleteStore').addEventListener('click', function () {
      var name = $('#storeProfiles').value;
      if (!name) { toast('Pilih profil dulu'); return; }
      var data = profiles();
      delete data[name];
      store(KEY_PROFILES, data);
      renderProfiles();
      toast('Profil dihapus');
    });

    $('#btnNewCode').addEventListener('click', function () {
      var dt = valueOf('metaDatetime') || G.nowLocal();
      setValue('metaDatetime', dt);
      setValue('metaCode', G.randomCode(dt, valueOf('storeCashier') || G.pick(G.KASIR)));
      render();
    });
    $('#btnNow').addEventListener('click', function () {
      setValue('metaDatetime', G.nowLocal());
      render();
    });

    $('#btnDemo').addEventListener('click', fillDemo);
    $('#btnReset').addEventListener('click', resetForm);

    /* First paint: without this the canvas stays the static HTML placeholder and the summary keeps
       the "0" it was shipped with — the form is populated but nothing is drawn until the user types. */
    render();
    buildQuickCash();

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
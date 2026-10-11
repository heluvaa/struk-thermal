/* receipt/text.js — the same receipt as fixed-column plain text (copy / WhatsApp / share). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./layout.js')); }
  else { root.ReceiptText = factory(root.ReceiptLayout); }
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  function money(v, style) { return L.money(v, style); }
  function wrapLine(s, n) {
    var words = String(s == null ? '' : s).split(/\s+/).filter(Boolean), out = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (t.length <= n) { cur = t; }
      else { if (cur) { out.push(cur); } cur = w; }
    });
    if (cur) { out.push(cur); }
    return out.length ? out : [''];
  }
  function rule(n, ch) { return (ch || '-').repeat(n); }

  function buildText(input) {
    var src = input || {};
    var paper = L.PAPERS[src.paper] || L.PAPERS['58'];
    var n = paper.cols;
    var style = src.numberStyle === 'dot' ? 'dot' : 'comma';
    var mv = function (v) { return money(v, style); };
    var store = src.store || {}, cust = src.customer || {}, meta = src.meta || {};
    var pay = src.payment || {}, foot = src.footer || {};
    var items = Array.isArray(src.items) ? src.items : [];
    var t = L.computeTotals(items, pay);
    var out = [];
    var nameW = 16, totalW = 9, unitW = n - nameW - totalW;
    var dash = rule(n), heavy = rule(n, '=');

    function itemRow(name, unit, total) {
      var a = wrapLine(String(name).toUpperCase(), nameW);
      var rows = Math.max(a.length, 1);
      var i;
      for (i = 0; i < rows; i++) {
        var left = (a[i] || '').padEnd(nameW);
        var u = (i === 0 ? unit : '').padStart(unitW - 1);
        var tt = (i === 0 ? total : '').padStart(totalW);
        out.push((left + u + ' ' + tt).slice(0, n));
      }
    }

    if (store.name) { out = out.concat(wrapLine(store.name, n)); }
    [store.line2, store.line3, store.line4, store.city].filter(Boolean).forEach(function (l) {
      out = out.concat(wrapLine(l, n));
    });
    if (store.npwp) { out.push('NPWP:' + store.npwp); }
    out.push(heavy);
    if (cust.label) { out.push(cust.label); }
    [cust.addr1, cust.addr2].filter(Boolean).forEach(function (l) { out = out.concat(wrapLine(l, n)); });
    if (cust.label || cust.addr1 || cust.addr2) { out.push(dash); }
    if (meta.code) { out = out.concat(wrapLine(meta.code, n)); }
    else {
      if (meta.datetime) { out.push(L.humanDate(meta.datetime)); }
      if (meta.cashier) { out.push('KASIR: ' + meta.cashier); }
    }
    out.push(dash);
    items.forEach(function (it) {
      var q = Number(it.qty) || 0, price = Number(it.price) || 0;
      itemRow(it.name || '(tanpa nama)', mv(price), mv(Math.round(q * price)));
      if (Math.abs(q) > 1e-9) { out.push('  ' + L.qtyText(q) + ' x ' + mv(price)); }
    });
    if (!items.length) { out.push('BELUM ADA ITEM'); }
    out.push(dash);
    if (t.discount) {
      out.push('HARGA JUAL : ' + mv(t.gross));
      out.push(L.discountLabel(pay) + ' : -' + mv(t.discount));
      out.push('SETELAH DISKON : ' + mv(t.base));
    } else {
      out.push('HARGA JUAL : ' + mv(t.gross));
    }
    out.push(heavy);
    out.push('TOTAL : ' + mv(t.total));
    var method = String(pay.method || 'TUNAI').toUpperCase();
    if (method === 'TUNAI') {
      out.push('TUNAI : ' + mv(t.paid));
      out.push(t.due > 0 ? 'KURANG : ' + mv(t.due) : 'KEMBALI : ' + mv(t.change));
    } else {
      out.push(method + ' : ' + mv(t.total));
      out.push('STATUS : LUNAS');
    }
    if (Number(pay.taxPercent) > 0) {
      out.push('PPN : DPP= ' + mv(t.dpp) + '  PPN= ' + mv(t.ppn));
    }
    out.push(heavy);
    [foot.line1, foot.line2, foot.line3].filter(Boolean).forEach(function (l) {
      out = out.concat(wrapLine(l, n));
    });
    return out.join('\n');
  }

  return { buildText: buildText, wrapLine: wrapLine };
});

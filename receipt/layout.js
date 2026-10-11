/* receipt/layout.js — pure layout engine for thermal receipts (minimarket style).
   Browser: window.ReceiptLayout  |  Node: module.exports
   No DOM access: text measurement is injected as measure(text, sizePx, bold). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.ReceiptLayout = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PAPERS = {
    '58': { id: '58', label: '58 mm', widthMm: 58, widthPx: 384, cols: 32, margin: 10, base: 18, title: 22 },
    '80': { id: '80', label: '80 mm', widthMm: 80, widthPx: 576, cols: 48, margin: 14, base: 18, title: 24 }
  };

  var FAMILY = 'ui-monospace, "DejaVu Sans Mono", "Courier New", Courier, monospace';
  var INK = '#111111';

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(num(v) * 100) / 100; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Thousands grouping: 'comma' -> 7,500,000 (Indonesian receipt style), 'dot' -> 7.500.000 */
  function group(v, style) {
    var sep = style === 'dot' ? '.' : ',';
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }
  function moneyPlain(v, style) {
    var n = Math.round(num(v));
    var s = group(Math.abs(n), style);
    return (n < 0 ? '-' : '') + s;
  }
  /* Two-decimal Indonesian form (comma decimal separator) — unused by default layout, kept for tax lines. */
  function moneyDp(v) {
    var n = round2(v), neg = n < 0, a = Math.abs(n);
    var whole = Math.floor(a), frac = Math.round((a - whole) * 100);
    return (neg ? '-' : '') + group(whole, 'dot') + ',' + pad2(frac);
  }
  function moneyWithRp(v, style) { return 'Rp ' + moneyPlain(v, style); }
  function qtyText(v) {
    var n = num(v);
    if (Math.abs(n - Math.round(n)) < 1e-9) { return String(Math.round(n)); }
    return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
  }
  function humanDate(v) {
    if (!v) { return '-'; }
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) { return String(v); }
    return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5];
  }
  function stamp(v) {
    var m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})/);
    return m ? m[1] + m[2] + m[3] : '000000';
  }

  /* Single source of truth for every number printed on the receipt.
     taxInclusive (default true): printed TOTAL already contains PPN, so DPP/PPN are derived
     from it — that is how minimarket receipts print them. */
  function computeTotals(items, payment) {
    var list = Array.isArray(items) ? items : [];
    var p = payment || {};
    var gross = 0;
    list.forEach(function (it) { gross += round2(num(it.qty) * num(it.price)); });
    gross = round2(gross);

    var discount = p.discountType === 'percent'
      ? round2(gross * num(p.discountValue) / 100)
      : round2(num(p.discountValue));
    if (discount < 0) { discount = 0; }
    if (discount > gross) { discount = gross; }

    var base = round2(gross - discount);
    var rate = num(p.taxPercent) / 100;
    var inclusive = p.taxInclusive !== false;
    var dpp, ppn, total;
    if (rate > 0 && inclusive) {
      total = base;
      dpp = Math.round(base / (1 + rate));
      ppn = Math.round(base - dpp);
    } else if (rate > 0) {
      dpp = base;
      ppn = Math.round(base * rate);
      total = round2(base + ppn);
    } else {
      dpp = 0; ppn = 0; total = base;
    }

    var cash = round2(num(p.cash));
    var isCash = !p.method || String(p.method).toUpperCase() === 'TUNAI';
    var paid = isCash ? cash : total;
    return {
      gross: gross, discount: discount, base: base, dpp: dpp, ppn: ppn, total: total,
      cash: cash, paid: paid, change: round2(Math.max(0, paid - total)),
      due: round2(Math.max(0, total - paid))
    };
  }

  function discountLabel(p) {
    if (p && p.discountType === 'percent') { return 'DISKON ' + qtyText(p.discountValue) + '%'; }
    return 'DISKON';
  }

  /* buildLayout(input, measure) -> { width, height, paper, ops, totals, stats } */
  function buildLayout(input, measure, opts) {
    opts = opts || {};
    var src = input || {};
    /* Single source of truth for the canvas face: whatever measures the text must also draw it,
       otherwise every column shifts by the width difference between the two faces. */
    var fontFamily = opts.fontFamily || FAMILY;
    var paper = PAPERS[src.paper] || PAPERS['58'];
    var style = src.numberStyle === 'dot' ? 'dot' : 'comma';
    var W = paper.widthPx, M = paper.margin;
    var contentW = W - 2 * M;
    var BASE = paper.base;
    var ops = [];
    var y = M;
    var stats = { truncated: 0, items: 0, lines: 0 };

    function mv(v) { return moneyPlain(v, style); }
    function widthOf(text, size, bold) { return measure(String(text == null ? '' : text), size, !!bold); }

    function wrap(text, size, bold, maxW) {
      var words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
      var out = [], cur = '', i, w, trial, part, c;
      for (i = 0; i < words.length; i++) {
        w = words[i];
        trial = cur ? cur + ' ' + w : w;
        if (widthOf(trial, size, bold) <= maxW) { cur = trial; continue; }
        if (cur) { out.push(cur); cur = ''; }
        if (widthOf(w, size, bold) > maxW) {
          part = '';
          for (c = 0; c < w.length; c++) {
            if (part && widthOf(part + w[c], size, bold) > maxW) { out.push(part); part = ''; }
            part += w[c];
          }
          cur = part;
        } else { cur = w; }
      }
      if (cur) { out.push(cur); }
      return out.length ? out : [''];
    }

    function fit(text, size, bold, maxW) {
      var t = String(text == null ? '' : text);
      if (widthOf(t, size, bold) <= maxW) { return t; }
      stats.truncated++;
      while (t.length > 1 && widthOf(t + '..', size, bold) > maxW) { t = t.slice(0, -1); }
      return t + '..';
    }

    function line(text, opts) {
      opts = opts || {};
      var size = opts.size || BASE, gap = Math.round(size * 1.36), maxW = opts.maxWidth || contentW;
      var align = opts.align || 'left';
      var x = align === 'center' ? Math.round(W / 2) : (align === 'right' ? W - M : M);
      if (opts.gapBefore) { y += Math.round(gap * 0.4); }
      var rows = opts.nowrap ? [fit(text, size, opts.bold, maxW)] : wrap(text, size, opts.bold, maxW);
      rows.forEach(function (r) {
        ops.push({ t: 'text', text: r, x: x, y: y, size: size, bold: !!opts.bold, align: align });
        stats.lines++;
        y += gap;
      });
      if (opts.gapAfter) { y += Math.round(gap * 0.3); }
    }

    function rule(kind) {
      var heavy = kind === 'heavy';
      ops.push({
        t: 'hr', y: Math.round(y + (heavy ? 2 : 5)),
        x1: M, x2: W - M, style: heavy ? 'solid' : 'dashed', width: heavy ? 2 : 1
      });
      y += Math.round(heavy ? 10 : 13);
    }

    /* 'LABEL : value' — the minimarket style, values sit right after the colon. */
    function colon(label, value, opts) {
      opts = opts || {};
      var size = opts.size || BASE;
      var lw = widthOf(label + ' : ', size, opts.bold);
      if (lw + widthOf(value, size, opts.bold) <= contentW) {
        line(label + ' : ' + value, { size: size, bold: opts.bold, gapBefore: opts.gapBefore, gapAfter: opts.gapAfter });
      } else {
        line(label + ' :', { size: size, bold: opts.bold, gapBefore: opts.gapBefore });
        line(value, { size: size, bold: opts.bold, align: 'right', gapAfter: opts.gapAfter });
      }
    }

    /* three-column item row: name | unit price | line total */
    function itemRow(name, unit, total) {
      var size = BASE, gap = Math.round(size * 1.36);
      var nameW = Math.round(contentW * 0.46);
      var totalW = Math.round(contentW * 0.24);
      var unitW = contentW - nameW - totalW;
      var nameLines = wrap(name, size, false, nameW);
      var unitLines = wrap(unit, size, false, unitW - 6);
      var totalLines = wrap(total, size, false, totalW);
      var rows = Math.max(nameLines.length, unitLines.length, totalLines.length);
      var unitX = M + nameW + Math.round(unitW / 2);
      var i;
      for (i = 0; i < rows; i++) {
        ops.push({ t: 'text', text: nameLines[i] || '', x: M, y: y, size: size, align: 'left' });
        ops.push({ t: 'text', text: unitLines[i] || '', x: unitX, y: y, size: size, align: 'center' });
        ops.push({ t: 'text', text: totalLines[i] || '', x: W - M, y: y, size: size, align: 'right' });
        stats.lines += 3;
        y += gap;
      }
    }

    var store = src.store || {};
    var cust = src.customer || {};
    var meta = src.meta || {};
    var pay = src.payment || {};
    var items = Array.isArray(src.items) ? src.items : [];
    var foot = src.footer || {};
    var t = computeTotals(items, pay);
    var logo = String(store.logo || '').trim();
    var logoW = logo ? Math.min(contentW * 0.36, widthOf(logo, paper.base - 1, true) + 14) : 0;

    /* ---- store header ---- */
    /* The brand mark takes the top-right corner, but only when the store name is short enough to
       stay on ONE row next to it. A longer legal name (58 mm paper has ~32 mono columns; the box
       eats a third of them) would otherwise be forced into a mid-word wrap, so in that case the
       box sits on its own row above the name and the name uses the full width. Measuring the fit
       instead of assuming it is what keeps the header from looking broken at either length. */
    var nameSize = paper.title;
    var nameFitsBesideLogo = !logo || widthOf(store.name || '', nameSize, true) <= contentW - logoW - 8;
    if (logo && !nameFitsBesideLogo) {
      var markW = Math.min(contentW, logoW + 40);
      var markH = Math.round(nameSize * 1.3);
      ops.push({ t: 'rs', x: M, y: M - 2, w: markW, h: markH, r: 4, w2: 2 });
      ops.push({
        t: 'text', text: fit(logo, nameSize - 1, true, markW - 12),
        x: M + Math.round(markW / 2), y: M + 1, size: nameSize - 1, bold: true, align: 'center'
      });
      y = M + markH + Math.round(nameSize * 0.5);
    }
    if (store.name) {
      line(store.name, {
        size: nameSize, bold: true, nowrap: true,
        maxWidth: nameFitsBesideLogo && logo ? contentW - logoW - 8 : contentW,
        gapAfter: true
      });
    }
    [store.line2, store.line3, store.line4, store.city].filter(Boolean).forEach(function (l) {
      line(l, { size: BASE - 2, nowrap: true });
    });
    if (store.npwp) { line('NPWP:' + store.npwp, { size: BASE - 3 }); }

    if (logo && nameFitsBesideLogo) {
      var logoH = Math.round((paper.title + 4) * 1.5);
      var logoTop = M - 2;
      ops.push({ t: 'rs', x: W - M - logoW, y: logoTop, w: logoW, h: logoH, r: 4, w2: 2 });
      ops.push({
        t: 'text', text: fit(logo, paper.base - 1, true, logoW - 12),
        x: W - M - Math.round(logoW / 2), y: logoTop + 5, size: paper.base - 1, bold: true, align: 'center'
      });
      /* The box is a placeholder for the store mark: we deliberately do not reproduce any real
         retailer's logo, so it carries the shop's own short mark instead. */
    }

    rule('heavy');

    /* ---- customer block ---- */
    if (cust.label) { line(cust.label, { size: BASE + 1, bold: true }); }
    [cust.addr1, cust.addr2].filter(Boolean).forEach(function (l) { line(l, { size: BASE - 2 }); });
    if (cust.label || cust.addr1 || cust.addr2) { rule('dashed'); }

    /* ---- transaction code line ---- */
    if (meta.code) { line(meta.code, { size: BASE - 1 }); }
    else {
      if (meta.datetime) { line(humanDate(meta.datetime), { size: BASE - 1 }); }
      if (meta.cashier) { line('KASIR: ' + meta.cashier, { size: BASE - 1 }); }
    }
    rule('dashed');

    /* ---- items ---- */
    items.forEach(function (it) {
      stats.items++;
      var q = num(it.qty), price = num(it.price), sum = round2(q * price);
      itemRow(String(it.name || '(tanpa nama)').toUpperCase(), mv(price), mv(sum));
      if (Math.abs(q) > 1e-9) {
        line('  ' + qtyText(q) + ' x ' + mv(price), { size: BASE - 3 });
      }
    });
    if (!items.length) { line('BELUM ADA ITEM', { size: BASE - 2, align: 'center' }); }
    rule('dashed');

    /* ---- rebate / tax summary ---- */
    if (t.discount) {
      colon('HARGA JUAL', mv(t.gross));
      colon(discountLabel(pay), '-' + mv(t.discount));
      colon('SETELAH DISKON', mv(t.base));
    } else {
      colon('HARGA JUAL', mv(t.gross));
    }
    rule('heavy');

    colon('TOTAL', mv(t.total), { bold: true, size: BASE + 2 });
    var method = String(pay.method || 'TUNAI').toUpperCase();
    if (method === 'TUNAI') {
      colon('TUNAI', mv(t.paid));
      if (t.due > 0) { colon('KURANG', mv(t.due), { bold: true }); }
      else { colon('KEMBALI', mv(t.change)); }
    } else {
      colon(method, mv(t.total));
      colon('STATUS', 'LUNAS', { bold: true });
    }
    if (num(pay.taxPercent) > 0) {
      colon('PPN', 'DPP= ' + mv(t.dpp) + '  PPN= ' + mv(t.ppn), { size: BASE - 1 });
    }
    rule('heavy');

    /* ---- footer ---- */
    /* Footer is the small-print block: shrink until each support line fits on one row, the way
       it is printed on real receipts, instead of wrapping mid-phone-number. */
    [foot.line1, foot.line2, foot.line3].filter(Boolean).forEach(function (l) {
      var size = BASE - 4;
      while (size > 9 && widthOf(l, size, false) > contentW) { size -= 1; }
      line(l, { size: size, align: 'center', nowrap: true });
    });

    y += M + Math.round(26);
    return {
      width: W, height: Math.round(y), paper: paper, ops: ops,
      totals: t, stats: stats, fontFamily: fontFamily, family: fontFamily, scale: 1, numberStyle: style
    };
  }

  return {
    PAPERS: PAPERS, FAMILY: FAMILY, INK: INK,
    money: moneyPlain, moneyWithRp: moneyWithRp, moneyDp: moneyDp, qtyText: qtyText,
    humanDate: humanDate, stamp: stamp, group: group, pad2: pad2,
    computeTotals: computeTotals, discountLabel: discountLabel, buildLayout: buildLayout
  };
});

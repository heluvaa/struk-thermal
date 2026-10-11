/* receipt/gen.js — randomises the fields that are supposed to vary per receipt.
   Fixed: store identity + the product (Fanta 250ml @ 6.400).
   Browser: window.ReceiptGen  |  Node: module.exports */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.ReceiptGen = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KASIR = ['ALFIN', 'RANI', 'DEDI', 'SITI', 'BAGUS', 'YUNI', 'RIZAL', 'NOVA', 'TEGAR', 'WULAN'];

  var JALAN = [
    'JL. IR. H. JUANDA', 'JL. KEBON SIRIH', 'JL. SABANG', 'JL. GATOT SUBROTO',
    'JL. KYAI HAJI WAHID HASYIM', 'JL. RADEN SALEH', 'JL. JAKSA', 'JL. CEMPAKA PUTIH BARAT',
    'JL. SALEMBA RAYA', 'JL. KRAMAT RAYA', 'JL. PECENONGAN', 'JL. WAHID HASYIM'
  ];
  var KEC = [
    'KEC GAMBIR, KOTA JAKARTA PUSAT', 'KEC MENTENG, KOTA JAKARTA PUSAT',
    'KEC TANAH ABANG, KOTA JAKARTA PUSAT', 'KEC CEMPAKA PUTIH, KOTA JAKARTA PUSAT',
    'KEC KEMAYORAN, KOTA JAKARTA PUSAT', 'KEC SAWAH BESAR, KOTA JAKARTA PUSAT'
  ];
  var AREA = ['PENJARINGAN', 'PLUIT', 'TANJUNG PRIOK', 'CILINCING', 'KELAPA GADING', 'PADEMANGAN', 'KOJA'];

  function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* Local-time datetime string for <input type=datetime-local> (YYYY-MM-DDTHH:MM). */
  function randomDatetime(daysBack) {
    daysBack = daysBack || 21;
    var d = new Date();
    d.setDate(d.getDate() - rnd(0, daysBack));
    d.setHours(rnd(7, 21), rnd(0, 59), 0, 0);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function datetimeLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function nowLocal() { return datetimeLocal(new Date()); }

  function randomCustomer() {
    var rt = rnd(1, 15), rw = rnd(1, 12);
    return {
      label: 'JUANDA 0' + rnd(210000000, 219999999),
      addr1: pick(JALAN) + ' RT ' + pad2(rt) + ' RW ' + pad2(rw),
      addr2: pick(KEC) + ', ' + rnd(10110, 14470)
    };
  }

  /* Minimarket-style transaction code: DD,MM,YY-HH:MM/a,b,c/TxxD nnnnnn/KASIR/0n */
  function randomCode(datetime, kasir) {
    var m = String(datetime || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) { return ''; }
    var ddmmyy = m[3] + ',' + m[2] + ',' + m[1].slice(2);
    var hhmm = m[4] + ':' + m[5];
    var till = 'T' + String(rnd(1, 9)) + rnd(1, 9) + 'D';
    return ddmmyy + '-' + hhmm + '/' + rnd(1, 9) + ',' + rnd(1, 9) + ',' + rnd(1, 20) +
      '/' + till + ' ' + rnd(100000, 999999) + '/' + kasir + '/0' + rnd(1, 9);
  }

  function fixedStore() {
    /* Header order mirrors a real minimarket receipt: the legal entity sits top-left, the address
       block under it, the tax number last — and the brand mark goes in the box top-right. Keeping
       them distinct is what stops the header reading like the same word printed twice. */
    return {
      name: 'PT. SINAR RITEL NUSANTARA',
      line2: 'GEDUNG MENARA KENCANA LT. 2',
      line3: 'BOULEVARD PANTAI INDAH KAPUK',
      city: 'JAKARTA UTARA',
      npwp: '01.' + rnd(100, 999) + '.' + rnd(100, 999) + '.' + rnd(1, 9) + '-' + rnd(100, 999) + '.000',
      logo: 'MINIMARKET'
    };
  }

  /* The only product in this generator: Fanta 250ml @ Rp 6.400. */
  function fantaItem(qty) {
    return { name: 'FANTA 250ML', qty: qty || rnd(1, 3), price: 6400 };
  }

  /* Round a total up to a friendly cash amount (nearest 5.000 above it). */
  function friendlyCash(total) {
    var step = 5000;
    return Math.ceil((total + 1) / step) * step;
  }

  function randomReceipt(prev) {
    var base = prev || {};
    var store = fixedStore();
    var kasir = pick(KASIR);
    var datetime = randomDatetime(21);
    var qty = rnd(1, 3);
    return {
      paper: base.paper || '58',
      numberStyle: base.numberStyle || 'comma',
      store: store,
      customer: randomCustomer(),
      meta: {
        datetime: datetime,
        code: randomCode(datetime, kasir),
        datenumber: randomDatetime(120),
        cashier: kasir,
        note: ''
      },
      items: [fantaItem(qty)],
      payment: { method: 'TUNAI', cash: 0, taxPercent: 11, taxInclusive: true, discountType: 'amount', discountValue: 0 },
      footer: {
        line1: 'LAYANAN KONSUMEN SMS 0811 1500 280',
        line2: 'CALL 1500 280 - KONTAK@MINIMARKET.CO.ID'
      },
      _qty: qty
    };
  }

  return {
    KASIR: KASIR, JALAN: JALAN, KEC: KEC, AREA: AREA,
    rnd: rnd, pick: pick, pad2: pad2,
    randomDatetime: randomDatetime, datetimeLocal: datetimeLocal, nowLocal: nowLocal,
    randomCustomer: randomCustomer, randomCode: randomCode,
    fixedStore: fixedStore, fantaItem: fantaItem, friendlyCash: friendlyCash,
    randomReceipt: randomReceipt
  };
});

/* receipt/draw.js — renders a layout op-list onto a 2D canvas (browser or @napi-rs/canvas). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./layout.js')); }
  else { root.ReceiptDraw = factory(root.ReceiptLayout); }
})(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var INK = L.INK;
  /* Fallback only. The face actually used comes from layout.fontFamily, which is injected by the
     caller (the same string the measuring context used). Hard-coding a different family here is
     what makes text measure one width and render at another. */
  var FALLBACK_FAMILY = L.FAMILY;

  function fontStr(size, bold, family) {
    return (bold ? 'bold ' : '') + size + 'px ' + (family || FALLBACK_FAMILY);
  }

  function measureFactory(ctx) {
    return function (text, size, bold, family) {
      ctx.font = fontStr(size, bold, family);
      return ctx.measureText(String(text)).width;
    };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function draw(canvas, layout, opts) {
    opts = opts || {};
    var scale = opts.scale || 1;
    var ctx = canvas.getContext('2d');
    canvas.width = Math.round(layout.width * scale);
    canvas.height = Math.round(layout.height * scale);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;

    layout.ops.forEach(function (op) {
      if (op.t === 'text') {
        ctx.font = fontStr(op.size, op.bold, layout.fontFamily);
        ctx.textAlign = op.align === 'center' ? 'center' : (op.align === 'right' ? 'right' : 'left');
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = INK;
        ctx.fillText(op.text, op.x, op.y + Math.round(op.size * 0.85));
      } else if (op.t === 'hr') {
        ctx.beginPath();
        if (typeof ctx.setLineDash === 'function') {
          ctx.setLineDash(op.style === 'dashed' ? [5, 4] : []);
        }
        ctx.lineWidth = op.width || 1;
        ctx.moveTo(op.x1, op.y);
        ctx.lineTo(op.x2, op.y);
        ctx.stroke();
        if (typeof ctx.setLineDash === 'function') { ctx.setLineDash([]); }
      } else if (op.t === 'rs') {
        ctx.lineWidth = op.w2 || 2;
        if (typeof ctx.setLineDash === 'function') { ctx.setLineDash([]); }
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r || 4);
        ctx.stroke();
      }
    });
    return canvas;
  }

  return { draw: draw, measureFactory: measureFactory, fontStr: fontStr, FALLBACK_FAMILY: FALLBACK_FAMILY, roundRectPath: roundRectPath };
});

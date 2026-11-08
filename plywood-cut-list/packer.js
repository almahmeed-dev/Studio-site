/*
 * Plywood cut-list packer. Plain JavaScript, no dependencies, runs in the
 * browser (window.CutListPacker) and in Node (module.exports) for tests.
 *
 * Geometry: the sheet is `length` along x and `width` along y. A part that is
 * not turned keeps its length along the sheet length. Every layout is a
 * guillotine layout: each free rectangle is split by one straight cut that
 * runs edge to edge across it, and every cut removes `kerf` of material.
 *
 * The search is a heuristic. It tries several part orders, fit rules and split
 * rules and keeps the best result it finds. It does not prove an optimum.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CutListPacker = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EPS = 1e-6;

  var ORDERS = {
    area: function (a, b) { return b.l * b.w - a.l * a.w || Math.max(b.l, b.w) - Math.max(a.l, a.w); },
    longSide: function (a, b) { return Math.max(b.l, b.w) - Math.max(a.l, a.w) || b.l * b.w - a.l * a.w; },
    shortSide: function (a, b) { return Math.min(b.l, b.w) - Math.min(a.l, a.w) || b.l * b.w - a.l * a.w; },
    perimeter: function (a, b) { return (b.l + b.w) - (a.l + a.w) || b.l * b.w - a.l * a.w; },
    length: function (a, b) { return b.l - a.l || b.w - a.w; },
    width: function (a, b) { return b.w - a.w || b.l - a.l; }
  };

  // Lower score is a better fit for a part of size (pw, ph) in free rect r.
  var FITS = {
    bestShortSide: function (r, pw, ph) {
      var dw = r.w - pw, dh = r.h - ph;
      return [Math.min(dw, dh), Math.max(dw, dh)];
    },
    bestArea: function (r, pw, ph) {
      var dw = r.w - pw, dh = r.h - ph;
      return [r.w * r.h - pw * ph, Math.min(dw, dh)];
    },
    bestLongSide: function (r, pw, ph) {
      var dw = r.w - pw, dh = r.h - ph;
      return [Math.max(dw, dh), Math.min(dw, dh)];
    }
  };

  // Returns true when the leftover should be split with a full-width cut
  // (the strip below the part spans the whole free rect).
  var SPLITS = {
    shorterLeftover: function (r, pw, ph) { return r.w - pw <= r.h - ph; },
    longerLeftover: function (r, pw, ph) { return r.w - pw > r.h - ph; },
    maxArea: function (r, pw, ph) {
      // Keep the largest single leftover rectangle.
      var horiz = Math.max((r.w - pw) * ph, r.w * (r.h - ph));
      var vert = Math.max((r.w - pw) * r.h, pw * (r.h - ph));
      return horiz >= vert;
    },
    minArea: function (r, pw, ph) {
      var horiz = Math.max((r.w - pw) * ph, r.w * (r.h - ph));
      var vert = Math.max((r.w - pw) * r.h, pw * (r.h - ph));
      return horiz < vert;
    }
  };

  function isPositive(n) {
    return typeof n === "number" && isFinite(n) && n > 0;
  }

  function fitsIn(r, pw, ph) {
    return pw <= r.w + EPS && ph <= r.h + EPS;
  }

  function lexLess(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] < b[i] - EPS) return true;
      if (a[i] > b[i] + EPS) return false;
    }
    return false;
  }

  /** Split free rect r after placing (pw, ph) at its top-left corner. */
  function splitFree(r, pw, ph, kerf, fullWidthCut) {
    var out = [];
    var rw = r.w - pw - kerf; // leftover to the right, after the kerf
    var bh = r.h - ph - kerf; // leftover below, after the kerf
    if (fullWidthCut) {
      if (rw > EPS) out.push({ x: r.x + pw + kerf, y: r.y, w: rw, h: ph });
      if (bh > EPS) out.push({ x: r.x, y: r.y + ph + kerf, w: r.w, h: bh });
    } else {
      if (rw > EPS) out.push({ x: r.x + pw + kerf, y: r.y, w: rw, h: r.h });
      if (bh > EPS) out.push({ x: r.x, y: r.y + ph + kerf, w: pw, h: bh });
    }
    return out;
  }

  function runOnce(pieces, sheet, kerf, allowRotate, fitRule, splitRule) {
    var sheets = [];

    function newSheet() {
      var s = { free: [{ x: 0, y: 0, w: sheet.length, h: sheet.width }], placements: [] };
      sheets.push(s);
      return s;
    }

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var best = null;
      for (var si = 0; si <= sheets.length; si++) {
        var s = si < sheets.length ? sheets[si] : null;
        var frees = s ? s.free : [{ x: 0, y: 0, w: sheet.length, h: sheet.width }];
        for (var fi = 0; fi < frees.length; fi++) {
          var r = frees[fi];
          var options = [{ w: p.l, h: p.w, rotated: false }];
          if (allowRotate && Math.abs(p.l - p.w) > EPS) options.push({ w: p.w, h: p.l, rotated: true });
          for (var oi = 0; oi < options.length; oi++) {
            var o = options[oi];
            if (!fitsIn(r, o.w, o.h)) continue;
            // Prefer existing sheets (lower index) before opening a new one.
            var score = [si].concat(fitRule(r, o.w, o.h));
            if (!best || lexLess(score, best.score)) {
              best = { score: score, si: si, fi: fi, o: o };
            }
          }
        }
        if (best && best.si === si) break; // first sheet with any fit wins
      }
      if (!best) return null; // cannot happen for pre-filtered pieces
      var target = best.si < sheets.length ? sheets[best.si] : newSheet();
      var fr = target.free[best.fi];
      target.free.splice(best.fi, 1);
      var parts = splitFree(fr, best.o.w, best.o.h, kerf, splitRule(fr, best.o.w, best.o.h));
      for (var k = 0; k < parts.length; k++) target.free.push(parts[k]);
      target.placements.push({
        partIndex: p.partIndex,
        copy: p.copy,
        label: p.label,
        x: fr.x,
        y: fr.y,
        w: best.o.w,
        h: best.o.h,
        rotated: best.o.rotated
      });
    }
    return sheets;
  }

  function scoreSheets(sheets) {
    // Fewer sheets first, then the emptiest last sheet (more of it left
    // whole), then the biggest single offcut across the job.
    var last = sheets[sheets.length - 1];
    var lastUsed = 0;
    last.placements.forEach(function (pl) { lastUsed += pl.w * pl.h; });
    var biggest = 0;
    sheets.forEach(function (s) {
      s.free.forEach(function (f) { biggest = Math.max(biggest, f.w * f.h); });
    });
    return [sheets.length, lastUsed, -biggest];
  }

  /**
   * pack(input)
   *   input.sheet   { length, width } (same unit as parts)
   *   input.kerf    number >= 0
   *   input.allowRotate  boolean (default true)
   *   input.parts   [{ label, length, width, qty }]
   *   input.minOffcut  smallest side for a leftover to be listed as an offcut
   * Returns { sheets, oversize, invalid, stats }.
   */
  function pack(input) {
    var sheet = input.sheet || {};
    var kerf = Number(input.kerf) || 0;
    var allowRotate = input.allowRotate !== false;
    var minOffcut = Number(input.minOffcut) || 0;
    if (!isPositive(sheet.length) || !isPositive(sheet.width)) {
      throw new Error("Sheet length and width must be positive numbers.");
    }
    if (!(kerf >= 0) || !isFinite(kerf)) throw new Error("Kerf must be zero or more.");

    var pieces = [];
    var oversize = [];
    var invalid = [];
    (input.parts || []).forEach(function (part, idx) {
      var l = Number(part.length), w = Number(part.width), q = Number(part.qty);
      var label = String(part.label || "Part " + (idx + 1));
      if (!isPositive(l) || !isPositive(w) || !(q >= 1) || Math.floor(q) !== q) {
        invalid.push({ partIndex: idx, label: label });
        return;
      }
      var fitsStraight = l <= sheet.length + EPS && w <= sheet.width + EPS;
      var fitsTurned = allowRotate && w <= sheet.length + EPS && l <= sheet.width + EPS;
      if (!fitsStraight && !fitsTurned) {
        oversize.push({ partIndex: idx, label: label, length: l, width: w, qty: q });
        return;
      }
      for (var c = 0; c < q; c++) pieces.push({ partIndex: idx, copy: c + 1, label: label, l: l, w: w });
    });

    var bestSheets = [];
    var bestScore = null;
    // Big jobs try fewer combinations so the page stays responsive.
    var big = pieces.length > 300;
    var orderNames = big ? ["area", "longSide"] : Object.keys(ORDERS);
    var fitNames = big ? ["bestShortSide", "bestArea"] : Object.keys(FITS);
    if (pieces.length) {
      orderNames.forEach(function (oName) {
        var ordered = pieces.slice().sort(function (a, b) {
          return ORDERS[oName](a, b) || a.partIndex - b.partIndex || a.copy - b.copy;
        });
        fitNames.forEach(function (fName) {
          Object.keys(SPLITS).forEach(function (sName) {
            var result = runOnce(ordered, sheet, kerf, allowRotate, FITS[fName], SPLITS[sName]);
            if (!result) return;
            var sc = scoreSheets(result);
            if (!bestScore || lexLess(sc, bestScore)) {
              bestScore = sc;
              bestSheets = result;
            }
          });
        });
      });
    }

    var sheetArea = sheet.length * sheet.width;
    var partArea = 0;
    var outSheets = bestSheets.map(function (s, i) {
      var used = 0;
      s.placements.forEach(function (pl) { used += pl.w * pl.h; });
      partArea += used;
      var offcuts = s.free
        .filter(function (f) { return Math.min(f.w, f.h) >= minOffcut - EPS; })
        .map(function (f) { return { x: f.x, y: f.y, w: f.w, h: f.h }; })
        .sort(function (a, b) { return b.w * b.h - a.w * a.h; });
      var placements = s.placements.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
      return {
        index: i + 1,
        placements: placements,
        offcuts: offcuts,
        usedArea: used,
        wastePct: sheetArea ? (1 - used / sheetArea) * 100 : 0
      };
    });

    var totalArea = sheetArea * outSheets.length;
    return {
      sheets: outSheets,
      oversize: oversize,
      invalid: invalid,
      stats: {
        sheetCount: outSheets.length,
        pieceCount: pieces.length,
        partArea: partArea,
        sheetArea: totalArea,
        wastePct: totalArea ? (1 - partArea / totalArea) * 100 : 0
      }
    };
  }

  return { pack: pack, EPS: EPS };
});

/*
 * Image to SVG tracer, mubaraklabs.com/image-to-svg/
 * Original code written for MubarakLab in 2026. It contains no third-party
 * code and uses no libraries. (c) 2026 Mubarak Almahmeed. All rights reserved.
 *
 * Pipeline: luminance -> threshold bitmap -> despeckle (connected components)
 * -> pixel-edge contour following (ink 8-connected, holes 4-connected; outer
 * contours wind clockwise on screen, holes counter-clockwise) -> closed-polygon
 * Ramer-Douglas-Peucker simplification -> optional cubic smoothing that keeps
 * sharp corners -> SVG paths with fill-rule="evenodd" so holes stay open.
 *
 * Works as a browser global (ImageToSvgTracer), inside a Web Worker via
 * importScripts, and in Node via require().
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ImageToSvgTracer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SIDE = 1600;

  /* Luminance 0..255 with transparent pixels treated as white paper. */
  function luminance(imageData) {
    var d = imageData.data;
    var n = imageData.width * imageData.height;
    var out = new Uint8Array(n);
    for (var i = 0, p = 0; i < n; i++, p += 4) {
      var y = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
      var a = d[p + 3] / 255;
      out[i] = Math.round(255 - a * (255 - y));
    }
    return out;
  }

  /* 1 = ink (darker than the threshold), 0 = background. */
  function maskFromLuminance(lum, threshold, invert) {
    var n = lum.length;
    var mask = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var ink = lum[i] < threshold ? 1 : 0;
      mask[i] = invert ? 1 - ink : ink;
    }
    return mask;
  }

  /*
   * Removes ink specks (8-connected) smaller than minArea pixels and fills
   * pinholes (4-connected background regions that do not touch the border)
   * smaller than minArea pixels. Modifies and returns mask.
   */
  function despeckle(mask, w, h, minArea) {
    if (!minArea || minArea < 2) return mask;
    var n = w * h;
    var seen = new Uint8Array(n);
    var stack = new Int32Array(n);
    var comp = new Int32Array(n);
    for (var start = 0; start < n; start++) {
      if (seen[start]) continue;
      var value = mask[start];
      var eight = value === 1;
      var sp = 0, count = 0, touchesBorder = false;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp > 0) {
        var idx = stack[--sp];
        comp[count++] = idx;
        var x = idx % w, y = (idx - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true;
        for (var dy = -1; dy <= 1; dy++) {
          var ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (var dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (!eight && dx !== 0 && dy !== 0) continue;
            var nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            var ni = ny * w + nx;
            if (!seen[ni] && mask[ni] === value) {
              seen[ni] = 1;
              stack[sp++] = ni;
            }
          }
        }
      }
      if (count < minArea && (value === 1 || !touchesBorder)) {
        var flip = 1 - value;
        for (var k = 0; k < count; k++) mask[comp[k]] = flip;
      }
    }
    return mask;
  }

  /* Directions: 0 east, 1 south, 2 west, 3 north (y grows downwards). */
  var DX = [1, 0, -1, 0];
  var DY = [0, 1, 0, -1];

  /*
   * Follows the boundary between ink and background along pixel edges, with
   * ink always on the right of the direction of travel. Returns loops of
   * corner points [x0, y0, x1, y1, ...] in pixel-corner coordinates, each
   * with its signed area (positive = outer contour, negative = hole).
   */
  function traceContours(mask, w, h) {
    function ink(x, y) {
      return x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    }
    function canGo(dir, x, y) {
      switch (dir) {
        case 0: return ink(x, y) && !ink(x, y - 1);
        case 1: return ink(x - 1, y) && !ink(x, y);
        case 2: return ink(x - 1, y - 1) && !ink(x - 1, y);
        default: return ink(x, y - 1) && !ink(x - 1, y - 1);
      }
    }
    var stride = w + 1;
    var eastDone = new Uint8Array(stride * (h + 1));
    var loops = [];
    for (var sy = 0; sy < h; sy++) {
      for (var sx = 0; sx < w; sx++) {
        if (eastDone[sy * stride + sx] || !canGo(0, sx, sy)) continue;
        var pts = [];
        var x = sx, y = sy, d = 0;
        do {
          if (d === 0) eastDone[y * stride + x] = 1;
          x += DX[d];
          y += DY[d];
          var left = (d + 3) & 3;
          var nd = canGo(left, x, y) ? left : (canGo(d, x, y) ? d : (d + 1) & 3);
          if (nd !== d) pts.push(x, y);
          d = nd;
        } while (!(x === sx && y === sy && d === 0));
        loops.push({ points: pts, area: signedArea(pts) });
      }
    }
    return loops;
  }

  function signedArea(pts) {
    var n = pts.length / 2, s = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      s += pts[2 * i] * pts[2 * j + 1] - pts[2 * j] * pts[2 * i + 1];
    }
    return s / 2;
  }

  function segDist2(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = ax + t * vx - px, qy = ay + t * vy - py;
    return qx * qx + qy * qy;
  }

  /* Ramer-Douglas-Peucker for a closed polygon, iterative. */
  function simplifyClosed(pts, tolerance) {
    var n = pts.length / 2;
    if (n <= 4 || !(tolerance > 0)) return pts.slice();
    var far = 0, best = -1;
    for (var i = 1; i < n; i++) {
      var ddx = pts[2 * i] - pts[0], ddy = pts[2 * i + 1] - pts[1];
      var dd = ddx * ddx + ddy * ddy;
      if (dd > best) { best = dd; far = i; }
    }
    var keep = new Uint8Array(n);
    keep[0] = 1;
    keep[far] = 1;
    var tol2 = tolerance * tolerance;
    var stack = [0, far, far, n]; /* index n means point 0 again */
    while (stack.length) {
      var b = stack.pop(), a = stack.pop();
      if (b - a < 2) continue;
      var ax = pts[2 * a], ay = pts[2 * a + 1];
      var bi = b % n, bx = pts[2 * bi], by = pts[2 * bi + 1];
      var maxD = -1, idx = -1;
      for (var k = a + 1; k < b; k++) {
        var dist = segDist2(pts[2 * k], pts[2 * k + 1], ax, ay, bx, by);
        if (dist > maxD) { maxD = dist; idx = k; }
      }
      if (maxD > tol2) {
        keep[idx] = 1;
        stack.push(a, idx, idx, b);
      }
    }
    var out = [];
    for (var m = 0; m < n; m++) if (keep[m]) out.push(pts[2 * m], pts[2 * m + 1]);
    return out.length >= 6 ? out : pts.slice();
  }

  function fmt(v, precision) {
    var s = v.toFixed(precision);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  /* One closed subpath. Smooth mode keeps vertices sharper than cornerAngle. */
  function subpath(pts, smooth, cornerAngle, precision) {
    var n = pts.length / 2;
    function P(i) { i = (i + n) % n; return [pts[2 * i], pts[2 * i + 1]]; }
    function f(p) { return fmt(p[0], precision) + ' ' + fmt(p[1], precision); }
    if (!smooth || n < 3) {
      var parts = ['M' + f(P(0))];
      for (var i = 1; i < n; i++) parts.push('L' + f(P(i)));
      return parts.join('') + 'Z';
    }
    var cosLimit = Math.cos(cornerAngle * Math.PI / 180);
    function mid(i) { var a = P(i), b = P(i + 1); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    function isCorner(i) {
      var a = P(i - 1), b = P(i), c = P(i + 1);
      var ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      var lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu === 0 || lv === 0) return true;
      return (ux * vx + uy * vy) / (lu * lv) < cosLimit;
    }
    var corner = [];
    for (var c = 0; c < n; c++) corner.push(isCorner(c));
    var start = mid(n - 1);
    var out = ['M' + f(start)];
    var prev = start;
    for (var j = 0; j < n; j++) {
      var v = P(j), m = mid(j);
      if (corner[j]) {
        out.push('L' + f(v));
        /* Corner to corner is a straight edge; its midpoint adds nothing. */
        if (!corner[(j + 1) % n]) out.push('L' + f(m));
      } else {
        var c1 = [prev[0] + 2 / 3 * (v[0] - prev[0]), prev[1] + 2 / 3 * (v[1] - prev[1])];
        var c2 = [m[0] + 2 / 3 * (v[0] - m[0]), m[1] + 2 / 3 * (v[1] - m[1])];
        out.push('C' + f(c1) + ' ' + f(c2) + ' ' + f(m));
      }
      prev = m;
    }
    return out.join('') + 'Z';
  }

  /*
   * Traces a ready bitmap. Options: tolerance (px, default 1), smooth (bool,
   * default true), cornerAngle (degrees, default 60), precision (default 2).
   */
  function traceMask(mask, w, h, opts) {
    opts = opts || {};
    var tolerance = opts.tolerance == null ? 1 : opts.tolerance;
    var smooth = opts.smooth !== false;
    var cornerAngle = opts.cornerAngle == null ? 60 : opts.cornerAngle;
    var precision = opts.precision == null ? 2 : opts.precision;
    var raw = traceContours(mask, w, h);
    var loops = [], d = [], nodes = 0;
    for (var i = 0; i < raw.length; i++) {
      var pts = simplifyClosed(raw[i].points, tolerance);
      var area = signedArea(pts);
      if (Math.abs(area) < 0.5) continue;
      loops.push({ points: pts, area: area, hole: area < 0 });
      nodes += pts.length / 2;
      d.push(subpath(pts, smooth, cornerAngle, precision));
    }
    return { loops: loops, d: d.join(''), nodes: nodes };
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function safeColor(c, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c.toLowerCase() : fallback;
  }

  /*
   * Full trace of an ImageData-like object {data, width, height}.
   * Options: colors (1 or 2), threshold, threshold2 (lighter cut-off for the
   * back layer in 2-color mode), invert, despeckle (min area, px), color1,
   * color2, plus the traceMask options.
   */
  function trace(imageData, opts) {
    opts = opts || {};
    var w = imageData.width, h = imageData.height;
    var lum = luminance(imageData);
    var t1 = opts.threshold == null ? 128 : opts.threshold;
    var layers = [];
    if (opts.colors === 2) {
      var t2 = Math.max(t1 + 1, opts.threshold2 == null ? 200 : opts.threshold2);
      layers.push({ id: 'layer-1-back', color: safeColor(opts.color2, '#8a8a8a'), threshold: t2 });
      layers.push({ id: 'layer-2-front', color: safeColor(opts.color1, '#111111'), threshold: t1 });
    } else {
      layers.push({ id: 'layer-1', color: safeColor(opts.color1, '#111111'), threshold: t1 });
    }
    var parts = [], shapes = 0, holes = 0, nodes = 0;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var mask = maskFromLuminance(lum, L.threshold, !!opts.invert);
      despeckle(mask, w, h, opts.despeckle | 0);
      var r = traceMask(mask, w, h, opts);
      for (var k = 0; k < r.loops.length; k++) {
        if (r.loops[k].hole) holes++; else shapes++;
      }
      nodes += r.nodes;
      if (r.d) {
        parts.push('<path id="' + L.id + '" fill="' + L.color + '" fill-rule="evenodd" d="' + r.d + '"/>');
      }
    }
    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
      '" viewBox="0 0 ' + w + ' ' + h + '">\n' +
      '<title>' + escapeXml(opts.title || 'Traced image') + '</title>\n' +
      parts.join('\n') + (parts.length ? '\n' : '') + '</svg>\n';
    return { svg: svg, width: w, height: h, shapes: shapes, holes: holes, nodes: nodes };
  }

  /* Size that fits within MAX_SIDE on the long side, never upscaled. */
  function fitSize(w, h, maxSide) {
    maxSide = maxSide || MAX_SIDE;
    var s = Math.min(1, maxSide / Math.max(w, h));
    return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), scaled: s < 1 };
  }

  return {
    MAX_SIDE: MAX_SIDE,
    luminance: luminance,
    maskFromLuminance: maskFromLuminance,
    despeckle: despeckle,
    traceContours: traceContours,
    simplifyClosed: simplifyClosed,
    signedArea: signedArea,
    traceMask: traceMask,
    trace: trace,
    fitSize: fitSize
  };
});

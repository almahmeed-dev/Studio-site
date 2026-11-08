/* Plywood cut list page. No network, no cookies; last inputs in localStorage. */
(function () {
  "use strict";

  var Packer = window.CutListPacker;
  var STORE_KEY = "mubaraklab.plywoodCutList.v1";
  var MAX_ROWS = 20;
  var MAX_QTY = 50;
  var SVG_NS = "http://www.w3.org/2000/svg";

  var PRESETS = {
    "4x8": { in: { length: 96, width: 48 }, mm: { length: 2440, width: 1220 }, name: "4×8 ft" },
    "5x5": { in: { length: 60, width: 60 }, mm: { length: 1525, width: 1525 }, name: "5×5 Baltic birch" }
  };
  var DEFAULT_KERF = { in: 0.125, mm: 3 };
  var MIN_OFFCUT = { in: 2, mm: 50 };
  var UNIT_NAME = { in: "in", mm: "mm" };

  var EXAMPLE = {
    in: [
      { label: "Side", length: "72", width: "11 1/4", qty: "2" },
      { label: "Shelf", length: "34 1/2", width: "11", qty: "4" },
      { label: "Top", length: "36", width: "12", qty: "1" },
      { label: "Toe kick", length: "34 1/2", width: "3", qty: "1" }
    ],
    mm: [
      { label: "Side", length: "1830", width: "286", qty: "2" },
      { label: "Shelf", length: "876", width: "280", qty: "4" },
      { label: "Top", length: "914", width: "305", qty: "1" },
      { label: "Toe kick", length: "876", width: "76", qty: "1" }
    ]
  };

  var $ = function (id) { return document.getElementById(id); };
  var form = $("cut-form");
  var els = {
    preset: $("sheet-preset"),
    length: $("sheet-length"),
    width: $("sheet-width"),
    kerf: $("kerf"),
    rotate: $("allow-rotate"),
    body: $("parts-body"),
    rowTpl: $("part-row"),
    count: $("part-count"),
    status: $("form-status"),
    add: $("add-part"),
    example: $("load-example"),
    clear: $("clear-parts"),
    print: $("print-btn"),
    oversize: $("oversize"),
    summary: $("summary"),
    sheets: $("sheets"),
    list: $("parts-list"),
    printSummary: $("print-summary")
  };

  var state = load() || defaultState();

  function defaultState() {
    return {
      units: "in",
      preset: "4x8",
      sheetLength: "96",
      sheetWidth: "48",
      kerf: "1/8",
      allowRotate: true,
      parts: EXAMPLE.in.map(copyRow)
    };
  }

  function copyRow(r) {
    return { label: r.label, length: r.length, width: r.width, qty: r.qty };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || (s.units !== "in" && s.units !== "mm") || !Array.isArray(s.parts)) return null;
      return {
        units: s.units,
        preset: PRESETS[s.preset] || s.preset === "custom" ? s.preset : "4x8",
        sheetLength: String(s.sheetLength || ""),
        sheetWidth: String(s.sheetWidth || ""),
        kerf: String(s.kerf == null ? "" : s.kerf),
        allowRotate: s.allowRotate !== false,
        parts: s.parts.slice(0, MAX_ROWS).map(function (r) {
          return {
            label: String(r.label || "").slice(0, 40),
            length: String(r.length || ""),
            width: String(r.width || ""),
            qty: String(r.qty || "")
          };
        })
      };
    } catch (e) {
      return null;
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable: the page still works */
    }
  }

  /* ---------- numbers ---------- */

  function parseLength(text, units) {
    var s = String(text == null ? "" : text).trim().toLowerCase();
    if (!s) return NaN;
    s = s.replace(/(inches|inch|in|"|”|mm)$/, "").trim();
    if (units === "mm") {
      s = s.replace(",", ".");
      return /^\d*\.?\d+$|^\d+\.$/.test(s) ? parseFloat(s) : NaN;
    }
    var m = s.match(/^(\d+)(?:\s+|\s*-\s*)(\d+)\s*\/\s*(\d+)$/); // 23 1/2, 23-1/2
    if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : NaN;
    m = s.match(/^(\d+)\s*\/\s*(\d+)$/); // 1/8
    if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : NaN;
    s = s.replace(",", ".");
    return /^\d*\.?\d+$|^\d+\.$/.test(s) ? parseFloat(s) : NaN;
  }

  function trimNum(n, places) {
    return String(Number(n.toFixed(places)));
  }

  function fmt(n, units) {
    if (!isFinite(n)) return "";
    if (units === "mm") return trimNum(n, 1);
    var whole = Math.floor(n + 1e-9);
    var frac = n - whole;
    var sixteenths = Math.round(frac * 16);
    if (Math.abs(frac * 16 - sixteenths) < 1e-6) {
      if (sixteenths === 16) return String(whole + 1);
      if (sixteenths === 0) return String(whole);
      var num = sixteenths, den = 16;
      while (num % 2 === 0) { num /= 2; den /= 2; }
      return (whole ? whole + " " : "") + num + "/" + den;
    }
    return trimNum(n, 3);
  }

  function fmtU(n) {
    return fmt(n, state.units) + (state.units === "mm" ? " mm" : "″");
  }

  function convert(n, from, to) {
    if (from === to) return n;
    return to === "mm" ? n * 25.4 : n / 25.4;
  }

  function roundFor(n, units) {
    return units === "mm" ? Math.round(n * 2) / 2 : Math.round(n * 16) / 16;
  }

  /* ---------- form <-> state ---------- */

  function syncForm() {
    var radios = form.querySelectorAll('input[name="units"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === state.units;
    els.preset.value = state.preset;
    els.length.value = state.sheetLength;
    els.width.value = state.sheetWidth;
    els.kerf.value = state.kerf;
    els.rotate.checked = state.allowRotate;
    var tags = document.querySelectorAll(".unit-tag");
    for (var t = 0; t < tags.length; t++) tags[t].textContent = "(" + UNIT_NAME[state.units] + ")";
    renderRows();
  }

  function renderRows() {
    els.body.textContent = "";
    state.parts.forEach(function (row, i) {
      var tr = els.rowTpl.content.firstElementChild.cloneNode(true);
      tr.querySelector(".cl-rownum").textContent = String(i + 1);
      ["label", "length", "width", "qty"].forEach(function (field) {
        var input = tr.querySelector('[data-field="' + field + '"]');
        var label = tr.querySelector('[data-for="' + field + '"]');
        var id = "part-" + i + "-" + field;
        input.id = id;
        input.value = row[field];
        input.dataset.row = String(i);
        label.htmlFor = id;
        var names = { label: "label", length: "length", width: "width", qty: "quantity" };
        label.textContent = "Part " + (i + 1) + " " + names[field];
        if (field === "label") input.placeholder = "Part " + (i + 1);
        if (field === "qty") input.max = String(MAX_QTY);
      });
      var btn = tr.querySelector('[data-action="remove"]');
      btn.dataset.row = String(i);
      btn.setAttribute("aria-label", "Remove part " + (i + 1) + (row.label ? " (" + row.label + ")" : ""));
      els.body.appendChild(tr);
    });
    els.count.textContent = "(" + state.parts.length + " of " + MAX_ROWS + ")";
    els.add.disabled = state.parts.length >= MAX_ROWS;
  }

  function blankRow() {
    return { label: "", length: "", width: "", qty: "1" };
  }

  function setStatus(text, isError) {
    els.status.textContent = text;
    els.status.classList.toggle("is-error", !!isError);
  }

  function changeUnits(next) {
    var prev = state.units;
    if (next === prev) return;
    function conv(text) {
      var n = parseLength(text, prev);
      return isFinite(n) ? fmt(roundFor(convert(n, prev, next), next), next) : text;
    }
    if (PRESETS[state.preset]) {
      state.sheetLength = fmt(PRESETS[state.preset][next].length, next);
      state.sheetWidth = fmt(PRESETS[state.preset][next].width, next);
    } else {
      state.sheetLength = conv(state.sheetLength);
      state.sheetWidth = conv(state.sheetWidth);
    }
    var k = parseLength(state.kerf, prev);
    state.kerf = Math.abs(k - DEFAULT_KERF[prev]) < 1e-9
      ? fmt(DEFAULT_KERF[next], next)
      : (isFinite(k) ? fmt(next === "mm" ? Math.round(convert(k, prev, next) * 10) / 10 : Math.round(convert(k, prev, next) * 64) / 64, next) : state.kerf);
    state.parts.forEach(function (r) {
      r.length = conv(r.length);
      r.width = conv(r.width);
    });
    state.units = next;
    syncForm();
    save();
    compute();
    setStatus(next === "mm"
      ? "Switched to millimetres. Part sizes were rounded to the nearest 0.5 mm."
      : "Switched to inches. Part sizes were rounded to the nearest 1/16 in.");
  }

  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t.name === "units") {
      changeUnits(t.value);
    } else if (t === els.preset) {
      state.preset = t.value;
      if (PRESETS[t.value]) {
        state.sheetLength = fmt(PRESETS[t.value][state.units].length, state.units);
        state.sheetWidth = fmt(PRESETS[t.value][state.units].width, state.units);
        els.length.value = state.sheetLength;
        els.width.value = state.sheetWidth;
      } else {
        els.length.focus();
      }
      save();
      compute();
    } else if (t === els.rotate) {
      state.allowRotate = t.checked;
      save();
      compute();
    }
  });

  var timer = null;
  form.addEventListener("input", function (e) {
    var t = e.target;
    if (t === els.length || t === els.width) {
      state[t === els.length ? "sheetLength" : "sheetWidth"] = t.value;
      if (state.preset !== "custom") {
        state.preset = "custom";
        els.preset.value = "custom";
      }
    } else if (t === els.kerf) {
      state.kerf = t.value;
    } else if (t.dataset && t.dataset.field) {
      var row = state.parts[Number(t.dataset.row)];
      if (row) row[t.dataset.field] = t.value;
      if (t.dataset.field === "label") {
        var btn = els.body.querySelector('[data-action="remove"][data-row="' + t.dataset.row + '"]');
        if (btn) btn.setAttribute("aria-label", "Remove part " + (Number(t.dataset.row) + 1) + (t.value ? " (" + t.value + ")" : ""));
      }
    } else {
      return;
    }
    save();
    clearTimeout(timer);
    timer = setTimeout(compute, 350);
  });

  els.body.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    var i = Number(btn.dataset.row);
    var removed = state.parts[i];
    state.parts.splice(i, 1);
    if (!state.parts.length) state.parts.push(blankRow());
    renderRows();
    save();
    compute();
    var next = els.body.querySelector('[data-row="' + Math.min(i, state.parts.length - 1) + '"][data-field="label"]');
    if (next) next.focus();
    setStatus("Removed part " + (i + 1) + (removed && removed.label ? " (" + removed.label + ")" : "") + ".");
  });

  els.add.addEventListener("click", function () {
    if (state.parts.length >= MAX_ROWS) return;
    state.parts.push(blankRow());
    renderRows();
    save();
    var input = els.body.querySelector('[data-row="' + (state.parts.length - 1) + '"][data-field="label"]');
    if (input) input.focus();
  });

  els.example.addEventListener("click", function () {
    state.parts = EXAMPLE[state.units].map(copyRow);
    renderRows();
    save();
    compute();
    setStatus("Loaded the bookcase example.");
  });

  els.clear.addEventListener("click", function () {
    state.parts = [blankRow()];
    renderRows();
    save();
    compute();
    var input = els.body.querySelector('[data-field="label"]');
    if (input) input.focus();
    setStatus("Cleared the parts list.");
  });

  els.print.addEventListener("click", function () {
    compute();
    window.print();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    clearTimeout(timer);
    var ok = compute();
    if (ok) {
      var heading = $("results-heading");
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  });

  /* ---------- compute ---------- */

  function markInvalid(input, bad) {
    if (!input) return;
    if (bad) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function compute() {
    var u = state.units;
    var errors = [];
    var sheet = { length: parseLength(state.sheetLength, u), width: parseLength(state.sheetWidth, u) };
    var kerf = String(state.kerf).trim() === "" ? 0 : parseLength(state.kerf, u);
    markInvalid(els.length, !(sheet.length > 0));
    markInvalid(els.width, !(sheet.width > 0));
    markInvalid(els.kerf, !(kerf >= 0));
    if (!(sheet.length > 0) || !(sheet.width > 0)) errors.push("Enter a sheet length and width.");
    if (!(kerf >= 0)) errors.push("Enter the kerf as a number, for example " + (u === "mm" ? "3" : "1/8") + ".");
    if (kerf > 0 && sheet.width > 0 && kerf >= Math.min(sheet.length, sheet.width) / 4) errors.push("The kerf looks too large for this sheet.");

    var parts = [];
    var badRows = [];
    var pieces = 0;
    state.parts.forEach(function (r, i) {
      var empty = !r.label.trim() && !r.length.trim() && !r.width.trim();
      var l = parseLength(r.length, u), w = parseLength(r.width, u);
      var q = Number(String(r.qty).trim() || "1");
      var lBad = !empty && !(l > 0), wBad = !empty && !(w > 0);
      var qBad = !empty && !(q >= 1 && q <= MAX_QTY && Math.floor(q) === q);
      var row = els.body.querySelectorAll("tr")[i];
      if (row) {
        markInvalid(row.querySelector('[data-field="length"]'), lBad);
        markInvalid(row.querySelector('[data-field="width"]'), wBad);
        markInvalid(row.querySelector('[data-field="qty"]'), qBad);
      }
      if (empty) return;
      if (lBad || wBad || qBad) {
        badRows.push(i + 1);
        return;
      }
      pieces += q;
      parts.push({ row: i + 1, label: r.label.trim() || "Part " + (i + 1), length: l, width: w, qty: q });
    });
    if (badRows.length) {
      errors.push("Check part " + badRows.join(", ") + ": length and width must be numbers above zero and quantity a whole number from 1 to " + MAX_QTY + ".");
    }

    if (errors.length && (!(sheet.length > 0) || !(sheet.width > 0) || !(kerf >= 0))) {
      clearResults("Fix the sheet settings above to see a layout.");
      setStatus(errors.join(" "), true);
      return false;
    }
    if (!parts.length) {
      clearResults("Add at least one part with a length and width.");
      setStatus(errors.join(" "), errors.length > 0);
      return false;
    }

    var result = Packer.pack({
      sheet: sheet,
      kerf: kerf,
      allowRotate: state.allowRotate,
      minOffcut: MIN_OFFCUT[u],
      parts: parts
    });
    renderResults(result, parts, sheet, kerf);
    if (errors.length) {
      setStatus(errors.join(" "), true);
    } else {
      var s = result.stats;
      setStatus(s.pieceCount + " piece" + (s.pieceCount === 1 ? "" : "s") + " on " + s.sheetCount + " sheet" + (s.sheetCount === 1 ? "" : "s") +
        (s.sheetCount ? ", " + trimNum(s.wastePct, 1) + "% waste" : "") +
        (result.oversize.length ? ". " + result.oversize.length + " part" + (result.oversize.length === 1 ? " is" : "s are") + " larger than the sheet." : "."));
    }
    return true;
  }

  /* ---------- rendering ---------- */

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, attrs[k]);
    if (text != null) node.textContent = text;
    return node;
  }

  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] != null) node.setAttribute(k, String(attrs[k]));
    if (text != null) node.textContent = text;
    return node;
  }

  function clearResults(message) {
    els.oversize.textContent = "";
    els.summary.textContent = "";
    els.sheets.textContent = "";
    els.list.textContent = "";
    els.sheets.appendChild(el("p", { "class": "cl-empty" }, message));
  }

  function sizeText(l, w) {
    return fmt(l, state.units) + " × " + fmt(w, state.units);
  }

  function stat(value, label) {
    var d = el("div", { "class": "cl-stat" });
    d.appendChild(el("strong", null, value));
    d.appendChild(el("span", null, label));
    return d;
  }

  function renderResults(result, parts, sheet, kerf) {
    var u = state.units;
    els.oversize.textContent = "";
    els.summary.textContent = "";
    els.sheets.textContent = "";
    els.list.textContent = "";

    els.printSummary.textContent = "Sheet " + sizeText(sheet.length, sheet.width) + " " + UNIT_NAME[u] +
      " (length × width) · kerf " + fmt(kerf, u) + " " + UNIT_NAME[u] +
      " · parts " + (state.allowRotate ? "may turn 90°" : "keep their length along the sheet length") +
      " · " + new Date().toLocaleDateString();

    if (result.oversize.length) {
      var box = el("div", { "class": "cl-warn" });
      box.appendChild(el("p", null, "Not placed: larger than the " + sizeText(sheet.length, sheet.width) + " " + UNIT_NAME[u] + " sheet" +
        (state.allowRotate ? " in either direction" : " (turning is off)") + "."));
      var ul = el("ul");
      result.oversize.forEach(function (o) {
        var p = parts[o.partIndex];
        ul.appendChild(el("li", null, "Part " + p.row + ", " + p.label + ": " + sizeText(o.length, o.width) + " " + UNIT_NAME[u] + " × " + o.qty));
      });
      box.appendChild(ul);
      els.oversize.appendChild(box);
    }

    var st = result.stats;
    var offcutTotal = result.sheets.reduce(function (n, s) { return n + s.offcuts.length; }, 0);
    els.summary.appendChild(stat(String(st.sheetCount), st.sheetCount === 1 ? "sheet" : "sheets"));
    els.summary.appendChild(stat(String(st.pieceCount), "pieces placed"));
    els.summary.appendChild(stat(st.sheetCount ? trimNum(st.wastePct, 1) + "%" : "–", "waste"));
    els.summary.appendChild(stat(String(offcutTotal), "offcuts ≥ " + fmt(MIN_OFFCUT[u], u) + " " + UNIT_NAME[u]));

    if (!result.sheets.length) {
      els.sheets.appendChild(el("p", { "class": "cl-empty" }, "No parts fit on this sheet."));
    }
    result.sheets.forEach(function (s) {
      els.sheets.appendChild(renderSheet(s, result.sheets.length, parts, sheet));
    });

    renderPartsList(result, parts);
  }

  function renderSheet(s, total, parts, sheet) {
    var u = state.units;
    var wrap = el("section", { "class": "cl-sheet", "aria-labelledby": "sheet-h-" + s.index });
    var fig = el("div", { "class": "cl-sheet-figure" });
    var h = el("h3", { id: "sheet-h-" + s.index }, "Sheet " + s.index + " of " + total + " ");
    h.appendChild(el("span", null, trimNum(100 - s.wastePct, 1) + "% used · " + s.placements.length + " piece" + (s.placements.length === 1 ? "" : "s")));
    fig.appendChild(h);
    fig.appendChild(drawSheet(s, parts, sheet));

    var legend = el("ul", { "class": "cl-legend", "aria-hidden": "true" });
    var li1 = el("li");
    li1.appendChild(el("span", { "class": "cl-swatch" }));
    li1.appendChild(document.createTextNode("Part (label, then length × width)"));
    var li2 = el("li");
    li2.appendChild(el("span", { "class": "cl-swatch offcut" }));
    li2.appendChild(document.createTextNode("Offcut"));
    legend.appendChild(li1);
    legend.appendChild(li2);
    legend.appendChild(el("li", null, "↻ turned 90°"));
    fig.appendChild(legend);
    wrap.appendChild(fig);

    var table = el("table", { "class": "cl-table" });
    table.appendChild(el("caption", null, "Pieces on sheet " + s.index + " (" + UNIT_NAME[u] + "; position from the top-left corner)"));
    var thead = el("thead");
    var hr = el("tr");
    ["Part", "Label", "Length × width", "From left", "From top", "Turned"].forEach(function (t, i) {
      hr.appendChild(el("th", { scope: "col", "class": i >= 3 && i <= 4 ? "num" : null }, t));
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = el("tbody");
    s.placements.forEach(function (p) {
      var part = parts[p.partIndex];
      var tr = el("tr");
      tr.appendChild(el("th", { scope: "row" }, String(part.row) + (part.qty > 1 ? "." + p.copy : "")));
      tr.appendChild(el("td", null, part.label));
      tr.appendChild(el("td", null, sizeText(part.length, part.width)));
      tr.appendChild(el("td", { "class": "num" }, fmt(p.x, u)));
      tr.appendChild(el("td", { "class": "num" }, fmt(p.y, u)));
      tr.appendChild(el("td", null, p.rotated ? "Yes" : "No"));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    var scroll = el("div", { "class": "cl-table-scroll" });
    scroll.appendChild(table);
    wrap.appendChild(scroll);

    var oc = el("p", { "class": "cl-hint" });
    if (s.offcuts.length) {
      oc.textContent = "Offcuts (long side × short side, " + UNIT_NAME[u] + "): " + s.offcuts.map(function (o) {
        return sizeText(Math.max(o.w, o.h), Math.min(o.w, o.h));
      }).join("; ") + ".";
    } else {
      oc.textContent = "No offcuts of " + fmt(MIN_OFFCUT[u], u) + " " + UNIT_NAME[u] + " or more on this sheet.";
    }
    wrap.appendChild(oc);
    return wrap;
  }

  function drawSheet(s, parts, sheet) {
    var u = state.units;
    var L = sheet.length, W = sheet.width;
    var base = Math.max(L, W) / 55;
    var pad = base * 2.2;
    var svg = svgEl("svg", {
      "class": "cl-svg",
      viewBox: [-pad, -pad, L + pad * 1.4, W + pad * 1.4].map(function (n) { return trimNum(n, 3); }).join(" "),
      role: "img",
      "aria-labelledby": "sheet-t-" + s.index + " sheet-d-" + s.index
    });
    svg.appendChild(svgEl("title", { id: "sheet-t-" + s.index }, "Sheet " + s.index + " layout"));
    svg.appendChild(svgEl("desc", { id: "sheet-d-" + s.index },
      sizeText(L, W) + " " + UNIT_NAME[u] + " sheet with " + s.placements.length + " pieces and " + s.offcuts.length +
      " offcuts. The table below lists every piece and position."));

    var stroke = Math.max(L, W) / 900;
    svg.appendChild(svgEl("rect", { "class": "sheet", x: 0, y: 0, width: L, height: W, "stroke-width": stroke * 2 }));

    // Sheet dimensions
    svg.appendChild(svgEl("text", { "class": "dim-text", x: L / 2, y: -pad * 0.35, "text-anchor": "middle", "font-size": base * 1.1 }, fmtU(L)));
    svg.appendChild(svgEl("text", {
      "class": "dim-text", x: 0, y: 0, "text-anchor": "middle", "font-size": base * 1.1,
      transform: "translate(" + trimNum(-pad * 0.35, 3) + " " + trimNum(W / 2, 3) + ") rotate(-90)"
    }, fmtU(W)));

    s.offcuts.forEach(function (o) {
      svg.appendChild(svgEl("rect", { "class": "offcut", x: o.x, y: o.y, width: o.w, height: o.h, "stroke-width": stroke }));
      addBoxText(svg, o, [sizeText(Math.max(o.w, o.h), Math.min(o.w, o.h))], base, "offcut-text");
    });

    s.placements.forEach(function (p) {
      var part = parts[p.partIndex];
      var g = svgEl("g");
      g.appendChild(svgEl("title", null, part.label + " " + sizeText(part.length, part.width) + " " + UNIT_NAME[u] + (p.rotated ? ", turned" : "")));
      g.appendChild(svgEl("rect", { "class": "part", x: p.x, y: p.y, width: p.w, height: p.h, "stroke-width": stroke }));
      var tag = String(part.row) + (part.qty > 1 ? "." + p.copy : "");
      addBoxText(g, p, [part.label + (p.rotated ? " ↻" : ""), sizeText(part.length, part.width)], base, null, tag);
      svg.appendChild(g);
    });
    return svg;
  }

  // Writes up to two lines centred in box r, shrinking or falling back to a
  // short tag when the box is too small. Tall boxes get vertical text.
  function addBoxText(parent, r, lines, base, cls, tag) {
    var vertical = r.h > r.w * 1.4;
    var along = vertical ? r.h : r.w;
    var across = vertical ? r.w : r.h;
    var longest = lines.reduce(function (m, t) { return Math.max(m, t.length); }, 1);
    var fs = Math.min(base, along * 0.9 / (longest * 0.58), across * 0.8 / (lines.length * 1.25));
    if (fs < base * 0.45) {
      lines = [lines[lines.length - 1]];
      fs = Math.min(base, along * 0.9 / (lines[0].length * 0.58), across * 0.8 / 1.25);
    }
    if (fs < base * 0.45 && tag) {
      lines = [tag];
      fs = Math.min(base, along * 0.9 / (tag.length * 0.62), across * 0.8 / 1.25);
    }
    if (fs < base * 0.3) return;
    var cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    var text = svgEl("text", {
      x: 0, y: 0, "text-anchor": "middle", "font-size": trimNum(fs, 3), "class": cls,
      transform: "translate(" + trimNum(cx, 3) + " " + trimNum(cy, 3) + ")" + (vertical ? " rotate(-90)" : "")
    });
    var lh = fs * 1.2;
    var start = -((lines.length - 1) * lh) / 2 + fs * 0.35;
    lines.forEach(function (t, i) {
      text.appendChild(svgEl("tspan", { x: 0, y: trimNum(start + i * lh, 3), "font-weight": i === 0 && lines.length > 1 ? "600" : null }, t));
    });
    parent.appendChild(text);
  }

  function renderPartsList(result, parts) {
    var u = state.units;
    var placed = {};
    var where = {};
    result.sheets.forEach(function (s) {
      s.placements.forEach(function (p) {
        placed[p.partIndex] = (placed[p.partIndex] || 0) + 1;
        where[p.partIndex] = where[p.partIndex] || [];
        if (where[p.partIndex].indexOf(s.index) < 0) where[p.partIndex].push(s.index);
      });
    });
    var thead = el("thead");
    var hr = el("tr");
    ["Part", "Label", "Length (" + UNIT_NAME[u] + ")", "Width (" + UNIT_NAME[u] + ")", "Qty", "Placed", "Sheet"].forEach(function (t, i) {
      hr.appendChild(el("th", { scope: "col", "class": i >= 2 && i <= 5 ? "num" : null }, t));
    });
    thead.appendChild(hr);
    els.list.appendChild(thead);
    var tb = el("tbody");
    parts.forEach(function (p, i) {
      var tr = el("tr");
      tr.appendChild(el("th", { scope: "row" }, String(p.row)));
      tr.appendChild(el("td", null, p.label));
      tr.appendChild(el("td", { "class": "num" }, fmt(p.length, u)));
      tr.appendChild(el("td", { "class": "num" }, fmt(p.width, u)));
      tr.appendChild(el("td", { "class": "num" }, String(p.qty)));
      var n = placed[i] || 0;
      tr.appendChild(el("td", { "class": "num" + (n < p.qty ? " is-missing" : "") }, n < p.qty ? n + " (too large)" : String(n)));
      tr.appendChild(el("td", null, where[i] ? where[i].join(", ") : "–"));
      tb.appendChild(tr);
    });
    els.list.appendChild(tb);
  }

  syncForm();
  compute();
  setStatus("");
})();

/* Image to SVG page script. Original code, (c) 2026 Mubarak Almahmeed.
 * Everything happens on this device: the picture is read with the File API,
 * drawn to a canvas, traced by tracer.js (in a Web Worker when available) and
 * saved through a Blob URL. There is no upload or network code here, and the
 * page's Content Security Policy blocks network connections. */
(function () {
  'use strict';

  var Tracer = window.ImageToSvgTracer;
  var STORE_KEY = 'mubaraklabs.image-to-svg.settings.v1';
  var DEFAULTS = {
    colors: 1, threshold: 128, threshold2: 200, invert: false,
    despeckle: 16, smooth: true, detail: '1', color1: '#111111', color2: '#8a8a8a'
  };

  function $(id) { return document.getElementById(id); }
  var el = {
    form: $('controls'), file: $('file'), drop: $('dropzone'), sample: $('sample'),
    status: $('status'), sizeNote: $('size-note'), work: $('workspace'),
    original: $('original-img'), result: $('result-img'), stats: $('stats'),
    download: $('download'), reset: $('reset-settings'),
    threshold: $('threshold'), thresholdOut: $('threshold-out'),
    threshold2: $('threshold2'), threshold2Out: $('threshold2-out'),
    twoColor: $('two-color-controls'), thresholdLabel: $('threshold-label'), color1Label: $('color1-label'),
    invert: $('invert'), despeckle: $('despeckle'), despeckleOut: $('despeckle-out'),
    smooth: $('smooth'), detail: $('detail'), color1: $('color1'), color2: $('color2')
  };

  var settings = loadSettings();
  var source = null;          /* { imageData, name } */
  var originalUrl = null, resultUrl = null;
  var jobId = 0, timer = 0, worker = null;

  /* ---------- settings (optional localStorage, settings only) ---------- */
  function loadSettings() {
    var s = {};
    try { s = JSON.parse(window.localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    var out = {};
    for (var k in DEFAULTS) out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : DEFAULTS[k];
    return out;
  }
  function saveSettings() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* storage off: fine */ }
  }
  function applySettingsToForm() {
    var radios = el.form.querySelectorAll('input[name="colors"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = Number(radios[i].value) === Number(settings.colors);
    el.threshold.value = settings.threshold;
    el.threshold2.value = settings.threshold2;
    el.invert.checked = !!settings.invert;
    el.despeckle.value = settings.despeckle;
    el.smooth.checked = !!settings.smooth;
    el.detail.value = String(settings.detail);
    el.color1.value = settings.color1;
    el.color2.value = settings.color2;
    syncOutputs();
  }
  function readForm() {
    var checked = el.form.querySelector('input[name="colors"]:checked');
    settings.colors = checked ? Number(checked.value) : 1;
    settings.threshold = Number(el.threshold.value);
    settings.threshold2 = Number(el.threshold2.value);
    if (settings.colors === 2 && settings.threshold2 <= settings.threshold) {
      settings.threshold2 = Math.min(255, settings.threshold + 1);
      el.threshold2.value = settings.threshold2;
    }
    settings.invert = el.invert.checked;
    settings.despeckle = Number(el.despeckle.value);
    settings.smooth = el.smooth.checked;
    settings.detail = el.detail.value;
    settings.color1 = el.color1.value;
    settings.color2 = el.color2.value;
    syncOutputs();
    saveSettings();
  }
  function syncOutputs() {
    el.thresholdOut.value = el.threshold.value;
    el.threshold2Out.value = el.threshold2.value;
    var sp = Number(el.despeckle.value);
    el.despeckleOut.value = sp === 0 ? 'off' : sp + ' px';
    var two = Number(settings.colors) === 2;
    el.twoColor.hidden = !two;
    el.thresholdLabel.textContent = two ? 'Dark layer threshold' : 'Threshold';
    el.color1Label.textContent = two ? 'Front layer color' : 'Shape color';
  }
  function traceOptions() {
    return {
      colors: Number(settings.colors) === 2 ? 2 : 1,
      threshold: Number(settings.threshold),
      threshold2: Number(settings.threshold2),
      invert: !!settings.invert,
      despeckle: Number(settings.despeckle),
      smooth: !!settings.smooth,
      tolerance: Number(settings.detail) || 1,
      color1: settings.color1,
      color2: settings.color2,
      title: source ? source.name + ' (traced)' : 'Traced image'
    };
  }

  /* ---------- tracing ---------- */
  function startWorker() {
    if (!window.Worker) return;
    try {
      worker = new Worker('tracer-worker.js');
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.id !== jobId) return;
        if (m.ok) showResult(m.result); else fail('Tracing failed: ' + m.error);
      };
      worker.onerror = function () {
        worker = null;
        if (source) scheduleTrace(0);
      };
    } catch (e) { worker = null; }
  }

  function sendImage() {
    if (!worker || !source) return;
    var copy = new Uint8ClampedArray(source.imageData.data);
    worker.postMessage({ type: 'image', buffer: copy.buffer, width: source.imageData.width, height: source.imageData.height }, [copy.buffer]);
  }

  function scheduleTrace(delay) {
    if (!source) return;
    clearTimeout(timer);
    timer = setTimeout(runTrace, delay == null ? 120 : delay);
  }

  function runTrace() {
    var id = ++jobId;
    var opts = traceOptions();
    setStatus('Tracing…');
    el.work.setAttribute('aria-busy', 'true');
    if (worker) {
      worker.postMessage({ type: 'trace', id: id, options: opts });
    } else {
      setTimeout(function () {
        if (id !== jobId) return;
        try { showResult(Tracer.trace(source.imageData, opts)); } catch (e) { fail('Tracing failed: ' + e.message); }
      }, 0);
    }
  }

  function showResult(r) {
    el.work.setAttribute('aria-busy', 'false');
    var blob = new Blob([r.svg], { type: 'image/svg+xml' });
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(blob);
    el.result.src = resultUrl;
    el.result.alt = 'SVG trace preview of ' + source.name + ': ' + r.shapes + ' filled ' +
      plural(r.shapes, 'shape') + ' with ' + r.holes + ' ' + plural(r.holes, 'hole') + '.';
    el.download.href = resultUrl;
    el.download.download = safeName(source.name) + '-traced.svg';
    el.download.removeAttribute('aria-disabled');
    el.download.classList.remove('is-disabled');
    var kb = blob.size / 1024;
    el.stats.textContent = r.shapes + ' ' + plural(r.shapes, 'shape') + ', ' + r.holes + ' ' + plural(r.holes, 'hole') +
      ', ' + r.nodes + ' nodes · ' + (kb < 1024 ? kb.toFixed(1) + ' KB' : (kb / 1024).toFixed(2) + ' MB') +
      ' · ' + r.width + ' × ' + r.height + ' px';
    setStatus(r.shapes === 0 ? 'No shapes found. Try moving the threshold or switching Invert.' : 'Trace ready. Download the SVG when it looks right.');
  }

  function fail(msg) {
    el.work.setAttribute('aria-busy', 'false');
    setStatus(msg);
  }

  /* ---------- loading pictures ---------- */
  function loadFile(file) {
    if (!file) return;
    if (file.type && file.type.indexOf('image/') !== 0) {
      setStatus('That file is not an image. Choose a JPEG, PNG, WebP or GIF picture.');
      return;
    }
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    originalUrl = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { useImage(img, file.name || 'image'); };
    img.onerror = function () {
      setStatus('This browser cannot open that file. Try saving it as a JPEG or PNG first.');
    };
    setStatus('Opening ' + (file.name || 'image') + '…');
    img.src = originalUrl;
  }

  function useImage(img, name) {
    var w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) { setStatus('That image has no pixels to trace.'); return; }
    var fit = Tracer.fitSize(w0, h0, Tracer.MAX_SIDE);
    var canvas = document.createElement('canvas');
    canvas.width = fit.width;
    canvas.height = fit.height;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, fit.width, fit.height);
    var data;
    try { data = ctx.getImageData(0, 0, fit.width, fit.height); }
    catch (e) { setStatus('This browser would not let the page read that image.'); return; }
    source = { imageData: data, name: name };
    el.original.src = img.src;
    el.original.alt = 'Original image: ' + name;
    el.sizeNote.textContent = fit.scaled
      ? 'Resized from ' + w0 + ' × ' + h0 + ' to ' + fit.width + ' × ' + fit.height + ' px (the 1600 px cap on the long side).'
      : 'Traced at its full size, ' + w0 + ' × ' + h0 + ' px (within the 1600 px cap).';
    el.work.hidden = false;
    sendImage();
    scheduleTrace(0);
  }

  function useSample() {
    var c = document.createElement('canvas');
    c.width = 900; c.height = 600;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 900, 600);
    g.fillStyle = '#1b1b1b';
    /* five-point star */
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? 70 : 170, a = -Math.PI / 2 + i * Math.PI / 5;
      g.lineTo(220 + r * Math.cos(a), 300 + r * Math.sin(a));
    }
    g.closePath(); g.fill();
    /* ring with a hole, and a dot inside it */
    g.beginPath(); g.arc(640, 230, 150, 0, Math.PI * 2); g.arc(640, 230, 95, 0, Math.PI * 2, true); g.fill();
    g.beginPath(); g.arc(640, 230, 40, 0, Math.PI * 2); g.fill();
    /* a mid-grey bar for the two-color mode */
    g.fillStyle = '#9a9a9a'; g.fillRect(470, 450, 340, 70);
    /* a few specks for the despeckle slider */
    g.fillStyle = '#1b1b1b';
    [[90, 70], [820, 560], [430, 90], [60, 540]].forEach(function (p) { g.fillRect(p[0], p[1], 3, 3); });
    c.toBlob(function (blob) {
      if (!blob) return;
      var file;
      try { file = new File([blob], 'sample.png', { type: 'image/png' }); }
      catch (e) { file = blob; file.name = 'sample.png'; }
      loadFile(file);
    }, 'image/png');
  }

  /* ---------- helpers ---------- */
  function setStatus(t) { el.status.textContent = t; }
  function plural(n, word) { return n === 1 ? word : word + 's'; }
  function safeName(name) {
    var base = String(name).replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'image').slice(0, 60);
  }

  /* ---------- events ---------- */
  el.file.addEventListener('change', function () { loadFile(el.file.files && el.file.files[0]); el.file.value = ''; });
  el.sample.addEventListener('click', useSample);
  ['dragenter', 'dragover'].forEach(function (t) {
    el.drop.addEventListener(t, function (e) { e.preventDefault(); el.drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    el.drop.addEventListener(t, function () { el.drop.classList.remove('is-over'); });
  });
  el.drop.addEventListener('drop', function (e) {
    e.preventDefault();
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(f);
  });
  document.addEventListener('paste', function (e) {
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image/') === 0) { loadFile(items[i].getAsFile()); e.preventDefault(); return; }
    }
  });
  el.form.addEventListener('input', function () { readForm(); scheduleTrace(); });
  el.form.addEventListener('change', function () { readForm(); scheduleTrace(); });
  el.form.addEventListener('submit', function (e) { e.preventDefault(); });
  el.reset.addEventListener('click', function () {
    for (var k in DEFAULTS) settings[k] = DEFAULTS[k];
    applySettingsToForm();
    saveSettings();
    scheduleTrace(0);
  });
  el.download.addEventListener('click', function (e) {
    if (el.download.getAttribute('aria-disabled') === 'true') e.preventDefault();
  });

  applySettingsToForm();
  startWorker();
})();

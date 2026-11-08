/* Image to SVG worker. Original code, (c) 2026 Mubarak Almahmeed. Keeps the
 * page responsive while tracing. Receives pixels from the page only; it has no
 * network code. */
'use strict';
importScripts('tracer.js');

var image = null;

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === 'image') {
    image = { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height };
    return;
  }
  if (msg.type === 'trace' && image) {
    try {
      var r = self.ImageToSvgTracer.trace(image, msg.options);
      self.postMessage({ id: msg.id, ok: true, result: r });
    } catch (err) {
      self.postMessage({ id: msg.id, ok: false, error: String(err && err.message || err) });
    }
  }
};

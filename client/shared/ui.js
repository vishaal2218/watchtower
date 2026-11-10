/* DOM helpers shared by the pages. User-controlled text (folder names, paths)
   is only ever assigned through textContent. Exposes window.WTUI. */
(function (global) {
  'use strict';

  var doc = global.document;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Static icon geometry (24x24 viewBox, stroked).
  var ICONS = {
    menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1',
      'M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    sync: ['M20 11a8 8 0 0 0-14.3-4.9L4 8', 'M4 3v5h5', 'M4 13a8 8 0 0 0 14.3 4.9L20 16', 'M20 21v-5h-5'],
    folder: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'],
    folderPlus: ['M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z',
      'M12 10.5v5', 'M9.5 13h5'],
    close: ['M6 6l12 12', 'M18 6L6 18'],
    chevron: ['M9 6l6 6-6 6'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4']
  };

  function icon(name, className) {
    var svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    (ICONS[name] || []).forEach(function (d) {
      var p = doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    });
    return svg;
  }

  /** el('button', { class: 'x', onclick: fn, title: '...' }, [children | 'text']) */
  function el(tag, attrs, children) {
    var node = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      var value = attrs[key];
      if (value === undefined || value === null || value === false) return;
      if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'checked' || key === 'disabled' || key === 'value' || key === 'selected') node[key] = value;
      else if (key === 'style') node.style.cssText = value;
      else node.setAttribute(key, value === true ? '' : value);
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function fileUrlToPath(url) {
    var p = decodeURIComponent(String(url).replace(/^file:\/\/(localhost)?/i, ''));
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
    return p;
  }

  /** Absolute paths from a drop event, whichever format the host provides. */
  function droppedPaths(dataTransfer) {
    var out = [];
    Array.prototype.forEach.call(dataTransfer.files || [], function (f) {
      if (f.path) out.push(f.path);
    });
    if (out.length) return out;
    String(dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).forEach(function (line) {
      if (/^file:/i.test(line)) out.push(fileUrlToPath(line.trim()));
    });
    if (out.length) return out;
    String(dataTransfer.getData('text/plain') || '').split(/\r?\n/).forEach(function (line) {
      var s = line.trim();
      if (/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(s)) out.push(s);
    });
    return out;
  }

  global.WTUI = { icon: icon, el: el, clear: clear, droppedPaths: droppedPaths, fileUrlToPath: fileUrlToPath };
})(window);

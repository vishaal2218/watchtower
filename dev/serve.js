'use strict';

// Development preview: serves the extension's pages to an ordinary browser,
// injecting dev/mock-cep.js (a fake CEP runtime, Node shims and a canned
// engine) before anything else runs. Not part of the installed extension.
//
//   node dev/serve.js [port]      then open /client/panel/index.html etc.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5577);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/plain', '.css': 'text/css', '.json': 'application/json' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/dev/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      let body = data;
      if (rel.startsWith('/client/') && rel.endsWith('.html')) {
        body = String(data).replace('<head>', '<head>\n  <script src="/dev/mock-cep.js"></script>');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    });
  })
  .listen(PORT, '127.0.0.1', () => {
    process.stdout.write('Watchtower dev preview on http://localhost:' + PORT + '/\n');
  });

'use strict';

// Static checks for code that runs inside the hosts, where the runtimes are
// older than the Node used for tests:
//   lib/ and client/  -> CEP 9 (Premiere/After Effects 2020): Chromium 61, Node 8
//   host/*.jsx        -> ExtendScript (ES3)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RAW_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']');

const CEP_FORBIDDEN = [
  [/\?\.[\w([]/, 'optional chaining (Chromium 80+)'],
  [/\?\?/, 'nullish coalescing (Chromium 80+)'],
  [/\.finally\(/, 'Promise.prototype.finally (Chromium 63+)'],
  [/\.flat(Map)?\(/, 'Array.prototype.flat (Chromium 69+)'],
  [/Object\.fromEntries/, 'Object.fromEntries (Node 12+)'],
  [/withFileTypes/, 'readdir withFileTypes (Node 10.10+)'],
  [/fs\.promises|require\('fs\/promises'\)/, 'fs.promises (Node 10+)'],
  [/\brecursive:\s*true/, 'recursive mkdir/rm (Node 10.12+)'],
  [/catch\s*\{/, 'optional catch binding (Chromium 66+)'],
  [RAW_SEPARATORS, 'raw line separator character']
];

const JSX_FORBIDDEN = [
  [/=>/, 'arrow function'],
  [/\b(let|const|class)\s/, 'ES6 declaration'],
  [/`/, 'template literal'],
  [/\.forEach\(|\.map\(|\.filter\(|\.reduce\(|\.some\(/, 'ES5 array method'],
  [/\bJSON\./, 'JSON (absent in ExtendScript)'],
  [/\.trim\(\)/, 'String.prototype.trim'],
  [RAW_SEPARATORS, 'raw line separator character']
];

function files(dir, ext) {
  const out = [];
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...files(full, ext));
    else if (name.endsWith(ext)) out.push(full);
  });
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

let problems = 0;
function report(file, msg) {
  problems += 1;
  process.stdout.write(path.relative(ROOT, file) + ': ' + msg + '\n');
}

function check(list, rules) {
  list.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    try {
      new vm.Script(src, { filename: file });
    } catch (e) {
      report(file, 'syntax error: ' + e.message);
    }
    const code = stripComments(src);
    rules.forEach(([re, why]) => {
      if (re.test(code)) report(file, why);
    });
  });
}

check(files(path.join(ROOT, 'lib'), '.js').concat(files(path.join(ROOT, 'client'), '.js')), CEP_FORBIDDEN);
check(files(path.join(ROOT, 'host'), '.jsx'), JSX_FORBIDDEN);

if (problems) {
  process.stdout.write(problems + ' problem(s)\n');
  process.exit(1);
}
process.stdout.write('OK: host-side code uses only features available in CEP 9 and ExtendScript\n');

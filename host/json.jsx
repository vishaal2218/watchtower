/* ExtendScript has no JSON object. This is a small, strict codec kept in its
   own namespace so it never clobbers a JSON polyfill from another panel. */
var WTJSON = (function () {
    var ESCAPES = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };

    function quote(s) {
        return '"' + s.replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
            if (ESCAPES[c]) { return ESCAPES[c]; }
            var h = c.charCodeAt(0).toString(16);
            while (h.length < 4) { h = '0' + h; }
            return '\\u' + h;
        }) + '"';
    }

    function stringify(v) {
        if (v === null || v === undefined) { return 'null'; }
        var t = typeof v;
        if (t === 'boolean') { return v ? 'true' : 'false'; }
        if (t === 'number') { return isFinite(v) ? String(v) : 'null'; }
        if (t === 'string') { return quote(v); }
        var parts = [];
        var i;
        if (Object.prototype.toString.call(v) === '[object Array]') {
            for (i = 0; i < v.length; i++) { parts.push(stringify(v[i])); }
            return '[' + parts.join(',') + ']';
        }
        if (t === 'object') {
            for (var k in v) {
                if (v.hasOwnProperty(k) && v[k] !== undefined && typeof v[k] !== 'function') {
                    parts.push(quote(k) + ':' + stringify(v[k]));
                }
            }
            return '{' + parts.join(',') + '}';
        }
        return 'null';
    }

    function parse(text) {
        var i = 0;
        var n = text.length;

        function fail(msg) { throw new Error('Invalid JSON (' + msg + ') at ' + i); }
        function ws() {
            while (i < n) {
                var c = text.charAt(i);
                if (c === ' ' || c === '\n' || c === '\r' || c === '\t') { i++; } else { break; }
            }
        }
        function str() {
            var out = '';
            i++;
            while (true) {
                var q = text.indexOf('"', i);
                var b = text.indexOf('\\', i);
                if (q < 0) { fail('unterminated string'); }
                if (b >= 0 && b < q) {
                    out += text.substring(i, b);
                    var e = text.charAt(b + 1);
                    i = b + 2;
                    if (e === 'u') {
                        out += String.fromCharCode(parseInt(text.substr(i, 4), 16));
                        i += 4;
                    } else if (e === 'n') { out += '\n'; }
                    else if (e === 'r') { out += '\r'; }
                    else if (e === 't') { out += '\t'; }
                    else if (e === 'b') { out += '\b'; }
                    else if (e === 'f') { out += '\f'; }
                    else { out += e; }
                } else {
                    out += text.substring(i, q);
                    i = q + 1;
                    return out;
                }
            }
        }
        function num() {
            var start = i;
            while (i < n && '+-0123456789.eE'.indexOf(text.charAt(i)) >= 0) { i++; }
            var v = parseFloat(text.substring(start, i));
            if (isNaN(v)) { fail('bad number'); }
            return v;
        }
        function value() {
            ws();
            var c = text.charAt(i);
            var sep;
            if (c === '{') {
                var o = {};
                i++;
                ws();
                if (text.charAt(i) === '}') { i++; return o; }
                while (true) {
                    ws();
                    if (text.charAt(i) !== '"') { fail('expected key'); }
                    var k = str();
                    ws();
                    if (text.charAt(i++) !== ':') { fail('expected colon'); }
                    o[k] = value();
                    ws();
                    sep = text.charAt(i++);
                    if (sep === '}') { return o; }
                    if (sep !== ',') { fail('expected comma'); }
                }
            }
            if (c === '[') {
                var a = [];
                i++;
                ws();
                if (text.charAt(i) === ']') { i++; return a; }
                while (true) {
                    a.push(value());
                    ws();
                    sep = text.charAt(i++);
                    if (sep === ']') { return a; }
                    if (sep !== ',') { fail('expected comma'); }
                }
            }
            if (c === '"') { return str(); }
            if (text.substr(i, 4) === 'true') { i += 4; return true; }
            if (text.substr(i, 5) === 'false') { i += 5; return false; }
            if (text.substr(i, 4) === 'null') { i += 4; return null; }
            return num();
        }

        var result = value();
        ws();
        if (i < n) { fail('trailing data'); }
        return result;
    }

    return { stringify: stringify, parse: parse };
}());

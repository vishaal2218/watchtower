/* Shared ExtendScript helpers and the single entry point the panels call. */
var WT = (typeof WT !== 'undefined') ? WT : {};
WT.api = WT.api || {};

WT.RECORD_PREFIX = 'wt1:';

WT.pad = function (n) {
    return (n < 10 ? '0' : '') + n;
};

/* Sortable local date-time: "2026-09-28 15:04:05". */
WT.dateStamp = function () {
    var d = new Date();
    return d.getFullYear() + '-' + WT.pad(d.getMonth() + 1) + '-' + WT.pad(d.getDate()) + ' ' +
        WT.pad(d.getHours()) + ':' + WT.pad(d.getMinutes()) + ':' + WT.pad(d.getSeconds());
};

WT.ext = function (p) {
    var m = String(p).match(/\.([^.\\\/]+)$/);
    return m ? m[1].toLowerCase() : '';
};

WT.isLayered = function (p) {
    var e = WT.ext(p);
    return e === 'psd' || e === 'ai';
};

WT.encodeRecord = function (obj) {
    return WT.RECORD_PREFIX + encodeURIComponent(WTJSON.stringify(obj));
};

WT.decodeRecord = function (s) {
    var str = String(s || '');
    if (str.indexOf(WT.RECORD_PREFIX) !== 0) { return null; }
    try {
        return WTJSON.parse(decodeURIComponent(str.substring(WT.RECORD_PREFIX.length)));
    } catch (e) {
        return null;
    }
};

WT.copy = function (obj) {
    var out = {};
    for (var k in obj) {
        if (obj.hasOwnProperty(k)) { out[k] = obj[k]; }
    }
    return out;
};

WT.ensureXMP = function () {
    if (typeof XMPMeta === 'undefined' || ExternalObject.AdobeXMPScript === undefined) {
        ExternalObject.AdobeXMPScript = new ExternalObject('lib:AdobeXMPScript');
    }
};

WT.errorText = function (e) {
    var msg = (e && e.message) ? e.message : String(e);
    if (e && e.line) { msg += ' (line ' + e.line + ')'; }
    return msg;
};

/* Every call from the panels goes through here: a method name plus a JSON
   argument string in, a JSON envelope { ok, data | error } out. */
function WT_call(method, argsJson) {
    try {
        var fn = WT.api[method];
        if (typeof fn !== 'function') { throw new Error('Unknown method: ' + method); }
        var args = argsJson ? WTJSON.parse(argsJson) : {};
        return WTJSON.stringify({ ok: true, data: fn(args || {}) });
    } catch (e) {
        return WTJSON.stringify({ ok: false, error: WT.errorText(e) });
    }
}

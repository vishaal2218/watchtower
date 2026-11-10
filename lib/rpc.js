'use strict';

// Request/response over CEP application events. The background engine
// serves; panels are clients. A transport is { on(type, fn(data)), emit(type, data) }.

function createRpcClient(transport, events, options) {
  const opts = options || {};
  const timeoutMs = opts.timeoutMs || 8000;
  const me = opts.clientId || 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const setT = opts.setTimeout || setTimeout;
  const clearT = opts.clearTimeout || clearTimeout;
  const pending = {};
  let seq = 0;

  transport.on(events.RPC_RESPONSE, (msg) => {
    if (!msg || msg.to !== me) return;
    const p = pending[msg.id];
    if (!p) return;
    delete pending[msg.id];
    clearT(p.timer);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error || 'Request failed'));
  });

  function call(method, params, timeout) {
    return new Promise((resolve, reject) => {
      seq += 1;
      const id = seq;
      const timer = setT(() => {
        delete pending[id];
        const err = new Error('The sync engine did not answer (' + method + ').');
        err.code = 'ETIMEOUT';
        reject(err);
      }, timeout || timeoutMs);
      pending[id] = { resolve, reject, timer };
      transport.emit(events.RPC_REQUEST, { from: me, id, method, params: params || {} });
    });
  }

  return { call, id: me };
}

function serveRpc(transport, events, handlers) {
  transport.on(events.RPC_REQUEST, (msg) => {
    if (!msg || typeof msg.method !== 'string' || !msg.from) return;
    const reply = (ok, payload) =>
      transport.emit(events.RPC_RESPONSE, Object.assign({ to: msg.from, id: msg.id, ok }, payload));
    const handler = Object.prototype.hasOwnProperty.call(handlers, msg.method) ? handlers[msg.method] : null;
    if (typeof handler !== 'function') {
      reply(false, { error: 'Unknown request: ' + msg.method });
      return;
    }
    Promise.resolve()
      .then(() => handler(msg.params && typeof msg.params === 'object' ? msg.params : {}))
      .then(
        (data) => reply(true, { data: data === undefined ? null : data }),
        (err) => reply(false, { error: String((err && err.message) || err) })
      );
  });
}

module.exports = { createRpcClient, serveRpc };

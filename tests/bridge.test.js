'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTree, removeTree } = require('./helpers');
const bridge = require('../lib/host-bridge');
const { createRpcClient, serveRpc } = require('../lib/rpc');
const { createLicenseStore } = require('../lib/license');
const { EVENTS } = require('../lib/constants');

test('script arguments survive quoting, backslashes and line separators', () => {
  const args = { p: 'C:\\Media\\"quoted"\u2028x', n: 'Ω' };
  const literal = bridge.toScriptArg(args);
  assert.ok(!/[\u2028\u2029]/.test(literal));
  // eslint-disable-next-line no-eval
  assert.deepEqual(JSON.parse(eval(literal)), args);
  assert.match(bridge.buildCall('env', {}), /^typeof WT_call === "function" \? WT_call\("env",/);
});

test('envelopes are unwrapped and failures become errors', () => {
  assert.deepEqual(bridge.parseEnvelope('{"ok":true,"data":[1]}'), [1]);
  assert.throws(() => bridge.parseEnvelope('{"ok":false,"error":"boom"}'), /boom/);
  assert.throws(() => bridge.parseEnvelope('EvalScript error.'), /did not run/);
  assert.throws(() => bridge.parseEnvelope(''), /did not run/);
  assert.throws(() => bridge.parseEnvelope('<html>'), /Unexpected reply/);
});

test('the bridge loads host scripts on demand and serialises calls', async () => {
  const scripts = [];
  let loaded = false;
  let running = 0;
  let maxRunning = 0;
  const evalScript = async (s) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setImmediate(r));
    running -= 1;
    scripts.push(s);
    if (s.indexOf('$.evalFile') === 0) {
      loaded = true;
      return 'loaded';
    }
    return loaded ? '{"ok":true,"data":"hi"}' : bridge.NOT_LOADED;
  };
  const b = bridge.createHostBridge(evalScript, ['/ext/host/json.jsx', '/ext/host/common.jsx']);
  const results = await Promise.all([b.env(), b.notify({ message: 'x' })]);
  assert.deepEqual(results, ['hi', 'hi']);
  assert.equal(maxRunning, 1);
  assert.equal(scripts.filter((s) => s.indexOf('$.evalFile') === 0).length, 2);
});

test('a failed host script load is reported', async () => {
  const b = bridge.createHostBridge(async () => 'EvalScript error.', ['/x.jsx']);
  await assert.rejects(b.load(), /Could not load/);
});

function bus() {
  const listeners = {};
  return {
    on: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    emit: (type, data) => (listeners[type] || []).forEach((fn) => setImmediate(() => fn(JSON.parse(JSON.stringify(data)))))
  };
}

test('rpc round-trips results and errors between clients and the server', async () => {
  const b = bus();
  serveRpc(b, EVENTS, {
    add: (p) => p.a + p.b,
    fail: () => {
      throw new Error('nope');
    },
    nothing: () => undefined
  });
  const one = createRpcClient(b, EVENTS);
  const two = createRpcClient(b, EVENTS);
  assert.notEqual(one.id, two.id);
  assert.deepEqual(await Promise.all([one.call('add', { a: 1, b: 2 }), two.call('add', { a: 5, b: 5 })]), [3, 10]);
  await assert.rejects(one.call('fail'), /nope/);
  await assert.rejects(one.call('missing'), /Unknown request/);
  await assert.rejects(one.call('toString'), /Unknown request/, 'prototype methods are not callable');
  assert.equal(await one.call('nothing'), null);
});

test('rpc calls time out when nobody answers', async () => {
  const client = createRpcClient(bus(), EVENTS, { timeoutMs: 5 });
  await assert.rejects(client.call('ping'), (e) => e.code === 'ETIMEOUT');
});

test('licence status and deactivation', (t) => {
  const dir = makeTree({});
  t.after(() => removeTree(dir));
  const lic = createLicenseStore({ fs, dir });
  assert.deepEqual(lic.status(), { activated: false });
  fs.writeFileSync(path.join(dir, 'license.json'), JSON.stringify({ machine: 'Edit-1', activatedAt: '2026-01-01' }));
  assert.deepEqual(lic.status(), { activated: true, machine: 'Edit-1', activatedAt: '2026-01-01' });
  assert.deepEqual(lic.deactivate(), { activated: false });
  assert.deepEqual(lic.status(), { activated: false });
  assert.deepEqual(lic.deactivate(), { activated: false }, 'deactivating twice is harmless');
});

'use strict';

// Promise wrapper around CEP evalScript for the functions in host/*.jsx.
// Calls are serialised: the host runs ExtendScript on its main thread, and
// overlapping requests from one panel only make the host less responsive.

const NOT_LOADED = '__WT_NOT_LOADED__';
const EVAL_ERROR = 'EvalScript error.';

/** Encode call arguments as a JS string literal ExtendScript (ES3) can parse. */
function toScriptArg(args) {
  return JSON.stringify(JSON.stringify(args === undefined ? {} : args))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildCall(method, args) {
  return (
    'typeof WT_call === "function" ? WT_call(' +
    JSON.stringify(method) +
    ',' +
    toScriptArg(args) +
    ') : "' +
    NOT_LOADED +
    '"'
  );
}

function parseEnvelope(out) {
  if (typeof out !== 'string' || !out || out === EVAL_ERROR) {
    throw new Error('The host application did not run the script (it may be busy).');
  }
  let envelope;
  try {
    envelope = JSON.parse(out);
  } catch (e) {
    throw new Error('Unexpected reply from the host: ' + out.slice(0, 200));
  }
  if (!envelope || envelope.ok !== true) throw new Error((envelope && envelope.error) || 'Host call failed.');
  return envelope.data;
}

/**
 * evalScript: (script) => Promise<string>. files: absolute paths of the .jsx
 * files to load, in order.
 */
function createHostBridge(evalScript, files) {
  let chain = Promise.resolve();

  function run(script) {
    const exec = () => evalScript(script);
    const result = chain.then(exec, exec);
    chain = result.catch(() => undefined);
    return result;
  }

  async function load() {
    for (const file of files || []) {
      const out = await run('$.evalFile(' + JSON.stringify(file) + ');"loaded"');
      if (out === EVAL_ERROR) throw new Error('Could not load host script ' + file);
    }
  }

  // Concurrent calls that all find the scripts missing share one reload.
  let reloading = null;
  function reload() {
    if (!reloading) {
      const done = () => {
        reloading = null;
      };
      reloading = load().then(done, (e) => {
        done();
        throw e;
      });
    }
    return reloading;
  }

  async function call(method, args) {
    let out = await run(buildCall(method, args));
    if (out === NOT_LOADED) {
      await reload();
      out = await run(buildCall(method, args));
    }
    return parseEnvelope(out);
  }

  const api = { load, call };
  ['env', 'loadConfig', 'saveConfig', 'mediaItems', 'importBatch', 'notify', 'selectedBins'].forEach((m) => {
    api[m] = (args) => call(m, args || {});
  });
  return api;
}

module.exports = { createHostBridge, toScriptArg, buildCall, parseEnvelope, NOT_LOADED };

'use strict';

// Every timing value here is an implementation decision, not a figure from the
// source documentation. See docs/BUILD_NOTES.md for the rationale behind each.
module.exports = Object.freeze({
  PRODUCT_NAME: 'Watchtower',
  VERSION: '1.6.1',
  BUNDLE_ID: 'watchtower.replica',
  EXTENSION_IDS: Object.freeze({
    PANEL: 'watchtower.replica.panel',
    MANAGER: 'watchtower.replica.manager',
    SETTINGS: 'watchtower.replica.settings',
    ENGINE: 'watchtower.replica.engine'
  }),

  // Sync engine timing
  SCAN_INTERVAL_MS: 4000,
  WATCH_DEBOUNCE_MS: 750,
  STABLE_MS: 3000,
  // Slightly longer than STABLE_MS so one wait is always enough to confirm.
  FORCE_SYNC_SETTLE_MS: 3250,

  // Limits
  MAX_TREE_DEPTH: 32,
  MAX_DETECT_DEPTH: 6,
  MAX_IMPORTS_PER_CALL: 500,
  MIN_SEQ_DIGITS_AUTO: 3,

  // RPC between panels and the background engine
  RPC_TIMEOUT_MS: 8000,
  FORCE_SYNC_TIMEOUT_MS: 120000,
  EVENTS: Object.freeze({
    RPC_REQUEST: 'watchtower.replica.rpc.request',
    RPC_RESPONSE: 'watchtower.replica.rpc.response',
    STATE: 'watchtower.replica.state',
    PREFILL: 'watchtower.replica.manager.prefill',
    // Automation entry point (Spell Book or any other controller).
    COMMAND: 'watchtower.command',
    JUMPER_ANALYZE: 'watchtower.replica.jumper.analyze'
  }),

  // Automation command identifiers, verbatim from the specification.
  COMMANDS: Object.freeze({
    SHOW: 'Show Watchtower',
    OPEN_MANAGER: 'Open watch folders manager',
    SYNC: 'Sync watch folders',
    TOGGLE: 'Toggle auto-sync'
  }),

  NO_LABEL: -1
});

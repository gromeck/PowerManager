// SPDX-License-Identifier: GPL-3.0-or-later

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(resolve(__dirname, '../web/powermanager.js'), 'utf8');

function harness(initial) {
  let App;
  const context = vm.createContext({
    HTMLElement: class {},
    customElements: { define: (_name, type) => { App = type; } },
    AbortSignal,
    fetch: (...args) => context.request(...args),
  });
  vm.runInContext(source, context);
  const app = new App();
  app.states = new Map([['MAIN', initial]]);
  app.logLines = [];
  app.logPaused = false;
  const message = { textContent: '' };
  const log = { textContent: '', scrollHeight: 0, scrollTop: 0, clientHeight: 240 };
  app.querySelector = selector => selector === '#live-log' ? log : message;
  app.render = () => {};
  app.connect = () => { app.reconnected = true; };
  return { app, context, message, log };
}

test('log strips terminal colours, treats HTML as text and bounds the buffer', () => {
  const { app, log } = harness('OFF');
  app.appendLog('\x1b[31m[W] <img src=x>\x1b[0m');
  assert.match(log.textContent, /\[W\] <img src=x>/);
  assert.ok(!log.textContent.includes('\x1b'));
  for (let i = 0; i < 510; i++) app.appendLog(`line ${i}`);
  assert.equal(app.logLines.length, 500);
  assert.match(app.logLines[0], /line 10$/);
  const previous = log.textContent;
  app.logPaused = true;
  app.appendLog('while paused');
  assert.equal(log.textContent, previous);
  app.logPaused = false;
  app.renderLog();
  assert.match(log.textContent, /while paused$/);
});

test('theme control applies the selected colour scheme', () => {
  const { app, context } = harness('OFF');
  const button = { textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  context.document = { documentElement: { dataset: {} } };
  app.querySelector = selector => selector === '#theme-toggle' ? button : null;

  app.theme = 'dark';
  app.applyTheme();
  assert.equal(context.document.documentElement.dataset.theme, 'dark');
  assert.equal(button.textContent, 'Light mode');
  assert.equal(button.attributes['aria-pressed'], 'true');

  app.theme = 'light';
  app.applyTheme();
  assert.equal(context.document.documentElement.dataset.theme, 'light');
  assert.equal(button.textContent, 'Dark mode');
  assert.equal(button.attributes['aria-pressed'], 'false');
});

for (const [initial, action, next] of [['OFF', 'TOGGLE', 'ON'], ['ON', 'OFF', 'OFF']]) {
  test(`${action}: a stale GET must not overwrite a newer live event`, async () => {
    const { app, context } = harness(initial);
    const calls = [];
    context.request = async (url, options) => {
      calls.push([url, options.method]);
      if (options.method === 'POST') {
        // Reproduce the observed ordering: live event before the HTTP reply.
        app.accept({ id: 'switch/MAIN', state: next });
        return { ok: true };
      }
      return { ok: true, json: async () => ({ id: 'switch/MAIN', state: initial }) };
    };
    await app.command('MAIN', action);
    assert.equal(app.states.get('MAIN'), next);
    assert.deepEqual(calls, [[`/button/MAIN%20${action}/press`, 'POST']]);
    assert.equal(app.busy, false);
  });
}

test('HTTP success is not an optimistic state change; delayed events still update', async () => {
  const { app, context } = harness('OFF');
  context.request = async () => ({ ok: true });
  await app.command('MAIN', 'ON');
  assert.equal(app.states.get('MAIN'), 'OFF');
  app.accept({ id: 'switch/MAIN', state: 'ON' });
  assert.equal(app.states.get('MAIN'), 'ON');
  app.accept({ id: 'switch/CH 1', state: 'OFF' });
  assert.equal(app.states.get('CH 1'), 'OFF');
});

test('an HTTP failure reconnects without inventing a new state', async () => {
  const { app, context, message } = harness('OFF');
  context.request = async () => ({ ok: false, status: 503 });
  await app.command('MAIN', 'ON');
  assert.equal(app.states.get('MAIN'), 'OFF');
  assert.equal(app.reconnected, true);
  assert.match(message.textContent, /Command not confirmed/);
  assert.equal(app.busy, false);
});

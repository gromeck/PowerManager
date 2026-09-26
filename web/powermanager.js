// SPDX-License-Identifier: GPL-3.0-or-later

// Local frontend for ESPHome's existing event stream and guarded button actions.
const channels = ["MAIN", "CH 1", "CH 2", "CH 3", "CH 4", "CH 5", "CH 6", "CH 7"];
const firmwareVersion = "development (not built)";

class PowerManager extends HTMLElement {
  connectedCallback() {
    document.title = "PowerManager";
    document.documentElement.lang = "en";
    if (!document.querySelector('meta[name="viewport"]')) {
      const viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width, initial-scale=1";
      document.head.append(viewport);
    }
    this.states = new Map();
    this.connected = false;
    this.ioReady = false;
    this.busy = false;
    this.logLines = [];
    this.logPaused = false;
    this.innerHTML = `
      <style>
        :root { color-scheme: light; font: 15px system-ui, sans-serif; }
        :root[data-theme="dark"] { color-scheme: dark; }
        body { margin: 0; background: #f2f5f8; color: #182638; }
        esp-app { display: block; max-width: 680px; margin: 28px auto; padding: 0 12px; }
        header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
        h1 { flex: 1; max-width: 520px; margin: 0; }
        .brand-logo { display: block; width: 100%; aspect-ratio: 1296 / 132;
          background-size: contain; background-repeat: no-repeat; background-position: left center; }
        .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
        #connection { font-size: 13px; color: #586779; white-space: nowrap; }
        .header-status { display: flex; align-items: center; gap: 8px; }
        #theme-toggle { min-width: 88px; }
        .panel { border: 1px solid #d6dee7; border-radius: 10px; overflow: hidden; background: #fff; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px 12px; border-bottom: 1px solid #e5eaf0; text-align: left; }
        thead th { font-size: 12px; color: #586779; background: #f8fafc; }
        tbody tr:last-child > * { border-bottom: 0; }
        tbody tr:first-child { background: #edf4fb; }
        .actions { text-align: right; white-space: nowrap; }
        button { font: inherit; font-size: 12px; font-weight: 650; min-height: 34px;
          padding: 5px 10px; margin-left: 4px; border: 1px solid #b9c7d6;
          border-radius: 5px; color: inherit; background: #fff; cursor: pointer; }
        button:hover:enabled { background: #e4effa; border-color: #3779b6; }
        button:focus-visible { outline: 2px solid #2678c6; outline-offset: 2px; }
        button:disabled { opacity: .38; cursor: not-allowed; }
        .state { display: inline-block; min-width: 40px; padding: 3px 7px;
          border-radius: 4px; font-size: 12px; font-weight: 700; text-align: center; background: #e9edf2; }
        .state.on { background: #d9f3e5; color: #17603a; }
        .state.off { background: #f8dede; color: #8a3030; }
        #io { margin: 12px 0 0; padding: 10px 12px; font-size: 13px; border-radius: 6px;
          background: #fff1d7; color: #704b07; overflow-wrap: anywhere; }
        #io.ok { background: #e4f3eb; color: #17603a; }
        #message { min-height: 20px; margin: 8px 0; font-size: 13px; }
        footer { color: #586779; font-size: 12px; }
        footer a { color: inherit; }
        details { margin: 12px 0; }
        summary { cursor: pointer; font-weight: 600; }
        .log-tools { display: flex; gap: 8px; margin: 10px 0; align-items: center; flex-wrap: wrap; }
        .log-tools small { color: #586779; }
        #live-log { height: 240px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere;
          padding: 10px; border-radius: 6px; background: #141c26; color: #e4ebf3;
          font: 12px/1.5 monospace; }
        @media (max-width: 420px) {
          esp-app { padding: 0 8px; margin: 16px auto; }
          header { flex-wrap: wrap; gap: 8px; }
          h1 { flex-basis: 100%; }
          th, td { padding: 8px 6px; }
          button { padding: 5px 7px; margin-left: 3px; }
        }
        :root[data-theme="dark"] .brand-logo { filter: invert(1); }
        :root[data-theme="dark"] body { background: #141c26; color: #e4ebf3; }
        :root[data-theme="dark"] .panel,
        :root[data-theme="dark"] button { background: #1c2836; border-color: #425267; }
        :root[data-theme="dark"] thead th { background: #192330; }
        :root[data-theme="dark"] th,
        :root[data-theme="dark"] td { border-color: #334154; }
        :root[data-theme="dark"] tbody tr:first-child { background: #24354b; }
        :root[data-theme="dark"] #connection,
        :root[data-theme="dark"] thead th,
        :root[data-theme="dark"] footer { color: #a9b9cc; }
        :root[data-theme="dark"] button:hover:enabled { background: #304861; }
        :root[data-theme="dark"] .state { background: #38475a; }
        :root[data-theme="dark"] .state.on { background: #168552; color: #fff; }
        :root[data-theme="dark"] .state.off { background: #a63b43; color: #fff; }
      </style>
      <header><h1><span class="brand-logo" aria-hidden="true"></span><span class="sr-only">Conrad PowerManager</span></h1><div class="header-status"><button id="theme-toggle" type="button"></button><span id="connection" role="status">Connecting …</span></div></header>
      <div class="panel"><table aria-label="Channels">
        <thead><tr><th scope="col">Channel</th><th scope="col">Status</th><th scope="col" class="actions">Controls</th></tr></thead>
        <tbody>${channels.map(name => `<tr data-channel="${name}">
          <th scope="row">${name}</th><td><span class="state">—</span></td>
          <td class="actions">${["ON", "OFF", "TOGGLE"].map(action =>
            `<button type="button" data-action="${action}" aria-label="${name} ${action}" disabled>${action}</button>`
          ).join("")}</td></tr>`).join("")}</tbody>
      </table></div>
      <p id="io" role="status">Loading I/O status …</p>
      <p id="message" role="status"></p>
      <details id="log-panel">
        <summary>Live log</summary>
        <div class="log-tools">
          <button id="log-pause" type="button" aria-pressed="false">Pause</button>
          <button id="log-clear" type="button">Clear</button>
          <small>Last 500 lines · collected while this page is connected</small>
        </div>
        <pre id="live-log" aria-label="Live device log" tabindex="0"></pre>
      </details>
      <footer><span id="firmware-version"></span> · <a href="https://github.com/gromeck/PowerManager" target="_blank" rel="noopener noreferrer">GitHub</a></footer>`;
    const storedTheme = localStorage.getItem("powermanager-theme");
    this.theme = storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    this.applyTheme();
    this.querySelector("#theme-toggle").addEventListener("click", () => {
      this.theme = this.theme === "dark" ? "light" : "dark";
      localStorage.setItem("powermanager-theme", this.theme);
      this.applyTheme();
    });
    this.querySelector("#firmware-version").textContent = firmwareVersion;
    this.querySelector("#log-pause").addEventListener("click", () => {
      this.logPaused = !this.logPaused;
      this.querySelector("#log-pause").textContent = this.logPaused ? "Resume" : "Pause";
      this.querySelector("#log-pause").setAttribute("aria-pressed", String(this.logPaused));
      if (!this.logPaused) this.renderLog();
    });
    this.querySelector("#log-clear").addEventListener("click", () => {
      this.logLines = [];
      this.renderLog();
    });
    this.querySelector("tbody").addEventListener("click", event => {
      const button = event.target.closest("button");
      if (button && !button.disabled) {
        this.command(button.closest("tr").dataset.channel, button.dataset.action);
      }
    });
    this.connect();
    // A silent network failure need not immediately trigger EventSource.onerror.
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastEvent > 20000) this.connect();
    }, 5000);
  }

  disconnectedCallback() {
    this.events?.close();
    clearInterval(this.watchdog);
  }

  applyTheme() {
    document.documentElement.dataset.theme = this.theme;
    const button = this.querySelector("#theme-toggle");
    button.textContent = this.theme === "dark" ? "Light mode" : "Dark mode";
    button.setAttribute("aria-pressed", String(this.theme === "dark"));
  }

  connect() {
    this.events?.close();
    this.invalidate();
    this.lastEvent = Date.now();
    this.events = new EventSource("/events");
    this.events.onopen = () => {
      this.connected = true;
      this.lastEvent = Date.now();
      this.appendLog("[Browser] Connected to device log stream");
      this.render();
    };
    this.events.onerror = () => this.invalidate();
    this.events.addEventListener("ping", () => { this.lastEvent = Date.now(); });
    // ESPHome sends raw log text, not JSON, in SSE log events.
    this.events.addEventListener("log", event => {
      this.lastEvent = Date.now();
      this.appendLog(event.data);
    });
    this.events.addEventListener("state", event => {
      this.lastEvent = Date.now();
      try { this.accept(JSON.parse(event.data)); }
      catch { this.querySelector("#message").textContent = "Invalid status message received."; }
    });
  }

  invalidate() {
    if (this.connected) this.appendLog("[Browser] Connection lost; waiting to reconnect");
    this.connected = false;
    this.ioReady = false;
    this.states.clear();
    this.querySelector("#io").textContent = "I/O status unknown · connecting …";
    this.querySelector("#io").classList.remove("ok");
    this.render();
  }

  accept(data) {
    if (data.id === "text_sensor/IO Status") {
      if (this.lastIoStatus !== data.state) {
        this.appendLog(`[IO] ${data.state}`);
        this.lastIoStatus = data.state;
      }
      this.ioReady = data.state === "OK - no driver error";
      const status = this.querySelector("#io");
      status.textContent = this.ioReady ? "I/O: ready" : `I/O: ${data.state}`;
      status.classList.toggle("ok", this.ioReady);
    } else if (data.id?.startsWith("switch/") && ["ON", "OFF"].includes(data.state)) {
      if (this.states.get(data.id.slice(7)) !== data.state) {
        this.appendLog(`[State] ${data.id.slice(7)}: ${data.state}`);
      }
      this.states.set(data.id.slice(7), data.state);
    }
    this.render();
  }

  appendLog(message) {
    const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
    // Strip terminal colours; textContent keeps device messages inert.
    const clean = String(message).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    for (const line of clean.split(/\r?\n/)) {
      this.logLines.push(`${time} ${line.slice(0, 2000)}`);
    }
    this.logLines = this.logLines.slice(-500);
    if (!this.logPaused) this.renderLog();
  }

  renderLog() {
    const log = this.querySelector("#live-log");
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.textContent = this.logLines.join("\n");
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  render() {
    this.querySelector("#connection").textContent = this.connected ? "Connected" : "Disconnected";
    for (const row of this.querySelectorAll("tbody tr")) {
      const name = row.dataset.channel;
      const state = this.states.get(name);
      const status = row.querySelector(".state");
      status.textContent = state || "—";
      status.classList.toggle("on", state === "ON");
      status.classList.toggle("off", state === "OFF");
      const canTurnOn = this.ioReady && (name === "MAIN" || this.states.get("MAIN") === "ON");
      for (const button of row.querySelectorAll("button")) {
        const offAction = button.dataset.action === "OFF" || (button.dataset.action === "TOGGLE" && state === "ON");
        button.disabled = !this.connected || this.busy || (!offAction && (!state || !canTurnOn));
      }
    }
  }

  async command(name, action) {
    this.busy = true;
    this.querySelector("#message").textContent = "";
    this.render();
    try {
      const response = await fetch(`/button/${encodeURIComponent(`${name} ${action}`)}/press`, {
        method: "POST", signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Only the event stream updates state. A GET here can return an old
      // snapshot after a newer event and overwrite the confirmed state.
    } catch {
      this.querySelector("#message").textContent = "Command not confirmed. Reloading status.";
      this.connect();
    } finally {
      this.busy = false;
      this.render();
    }
  }
}

customElements.define("esp-app", PowerManager);

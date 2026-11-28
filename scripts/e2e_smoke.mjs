#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_BIN = path.join(ROOT, "server", "target", "debug", process.platform === "win32" ? "server.exe" : "server");

function verifyEsmAndServiceWorker() {
  const roots = [path.join(ROOT, "web", "app.js")];
  const checkPerms = (p, isDir) => {
    const mode = fs.statSync(p).mode;
    const needed = isDir ? 0o005 : 0o004;
    assert.equal(mode & needed, needed, `${p} must be world-${isDir ? "readable/traversable" : "readable"} so non-root Docker user can serve it`);
  };
  const walk = (d) => {
    checkPerms(d, true);
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        checkPerms(p, false);
        if (p.endsWith(".js")) roots.push(p);
      }
    }
  };
  checkPerms(path.join(ROOT, "web"), true);
  for (const e of fs.readdirSync(path.join(ROOT, "web"), { withFileTypes: true })) {
    const p = path.join(ROOT, "web", e.name);
    if (e.isFile()) checkPerms(p, false);
  }
  walk(path.join(ROOT, "web", "js"));

  const swSrc = fs.readFileSync(path.join(ROOT, "web", "sw.js"), "utf8");
  const exportsMap = new Map();
  for (const f of roots) {
    const webRel = "/" + path.relative(path.join(ROOT, "web"), f).replaceAll(path.sep, "/");
    assert.ok(swSrc.includes(webRel), `${webRel} missing from web/sw.js SHELL_ASSETS`);
    const src = fs.readFileSync(f, "utf8");
    const ex = new Set();
    for (const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) ex.add(m[1]);
    for (const m of src.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
      for (const part of m[1].split(",")) {
        const alias = part.trim().split(/\s+as\s+/).pop().trim();
        if (alias) ex.add(alias);
      }
    }
    exportsMap.set(path.resolve(f), ex);
  }
  for (const f of roots) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
      const target = path.resolve(path.dirname(f), m[2]);
      assert.ok(fs.existsSync(target), `Missing import target ${target} from ${f}`);
      const ex = exportsMap.get(target);
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) assert.ok(ex && ex.has(name), `${f} imports missing export '${name}' from ${m[2]}`);
      }
    }
  }
  console.log(`  - ESM & SW cache manifest verified (${roots.length} modules)`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      /* retrying */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Rosie server failed to become healthy in time");
}

function findFirefox() {
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, "firefox");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

class BiDiClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.type === "error") reject(new Error(`${msg.error}: ${msg.message}`));
        else resolve(msg.result);
      } else if (msg.method === "log.entryAdded" && msg.params?.level === "error") {
        this.errors.push(msg.params.text || JSON.stringify(msg.params));
      }
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(context, fnBody) {
    const res = await this.send("script.evaluate", {
      expression: `(() => { ${fnBody} })()`,
      target: { context },
      awaitPromise: true,
      resultOwnership: "none",
    });
    if (res.type === "exception") {
      throw new Error(`Browser eval exception: ${res.exceptionDetails?.text || JSON.stringify(res)}`);
    }
    return unwrapBiDiValue(res.result);
  }
}

function unwrapBiDiValue(v) {
  if (!v) return v;
  if (v.type === "undefined" || v.type === "null") return null;
  if (v.type === "string" || v.type === "number" || v.type === "boolean") return v.value;
  if (v.type === "array") return (v.value || []).map(unwrapBiDiValue);
  if (v.type === "object") {
    const out = {};
    for (const [k, val] of v.value || []) out[k] = unwrapBiDiValue(val);
    return out;
  }
  return v.value ?? v;
}

async function waitForSelector(client, ctx, selector, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await client.eval(ctx, `return !!document.querySelector(${JSON.stringify(selector)})`);
    if (found) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  const diag = await client.eval(
    ctx,
    `return { url: location.href, ready: document.readyState, view: document.getElementById("view")?.innerHTML?.slice(0, 400) || null };`,
  );
  throw new Error(`Timed out waiting for selector '${selector}'. Diag: ${JSON.stringify(diag)} Errors: ${JSON.stringify(client.errors)}`);
}

async function runBrowserSuite(baseUrl) {
  const firefoxBin = findFirefox();
  if (!firefoxBin) {
    if (process.argv.includes("--require-browser")) {
      throw new Error("firefox binary not found on PATH (--require-browser set)");
    }
    console.log("  - Skipping headless Firefox BiDi checks (firefox binary not found)");
    return;
  }

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), "rosie-ff-"));
  const ff = spawn(firefoxBin, ["--headless", "--remote-debugging-port=0", "--no-remote", "-profile", prof, "about:blank"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let ws;
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Timed out waiting for Firefox BiDi WS URL")), 15000);
      const onData = (d) => {
        const m = d.toString().match(/ws:\/\/127\.0\.0\.1:\d+/);
        if (m) {
          clearTimeout(t);
          resolve(`${m[0]}/session`);
        }
      };
      ff.stdout.on("data", onData);
      ff.stderr.on("data", onData);
    });
    ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    const client = new BiDiClient(ws);
    await client.send("session.new", { capabilities: {} });
    const tree = await client.send("browsingContext.getTree", {});
    const ctx = tree.contexts[0].context;
    await client.send("session.subscribe", { events: ["log.entryAdded"], contexts: [ctx] });

    // ---------- 1. Mobile viewport (390x844 touch) ----------
    await client.send("browsingContext.setViewport", {
      context: ctx,
      viewport: { width: 390, height: 844 },
      devicePixelRatio: 2,
    });
    await client.send("browsingContext.navigate", { context: ctx, url: `${baseUrl}/#/`, wait: "complete" });
    await waitForSelector(client, ctx, ".home-split");

    const mobileLayout = await client.eval(
      ctx,
      `
      const nav = getComputedStyle(document.getElementById("nav")).display;
      const bnav = getComputedStyle(document.getElementById("bottom-nav")).display;
      const btabs = [...document.querySelectorAll("#bottom-nav a")].map((a) => {
        const r = a.getBoundingClientRect();
        return { text: a.textContent.trim(), w: r.width, h: r.height, top: Math.round(r.top) };
      });
      const fab = document.getElementById("quick-add-fab").getBoundingClientRect();
      const weekTop = document.querySelector(".home-mobile-top").getBoundingClientRect().top;
      const panelTop = document.querySelector(".panel").getBoundingClientRect().top;
      const mainColTop = document.querySelector(".main-col").getBoundingClientRect().top;
      const overflow = document.documentElement.scrollWidth > window.innerWidth;
      return { nav, bnav, btabs, fabW: fab.width, fabH: fab.height, weekTop, panelTop, mainColTop, overflow };
      `,
    );
    assert.equal(mobileLayout.nav, "none", "Desktop top nav should be hidden on 390px mobile");
    assert.notEqual(mobileLayout.bnav, "none", "Bottom nav should be visible on 390px mobile");
    assert.equal(mobileLayout.btabs.length, 7);
    assert.equal(new Set(mobileLayout.btabs.map((t) => t.top)).size, 1, "Bottom nav tabs should fit on one row");
    for (const tab of mobileLayout.btabs) {
      assert.ok(tab.w >= 44 && tab.h >= 44, `Bottom nav tab '${tab.text}' too small: ${tab.w}x${tab.h}`);
    }
    assert.ok(mobileLayout.fabW >= 44 && mobileLayout.fabH >= 44, "Quick-add FAB should be >= 44x44");
    assert.ok(mobileLayout.weekTop < mobileLayout.panelTop, "Week strip should precede Today Agenda on mobile");
    assert.ok(mobileLayout.panelTop < mobileLayout.mainColTop, "Today Agenda should precede stats/calendar on mobile");
    assert.equal(mobileLayout.overflow, false, "Mobile Home should have zero horizontal overflow");

    // Interactive Quick Add test on mobile: create Pantry item via FAB bottom sheet
    await client.eval(ctx, `document.getElementById("quick-add-fab").click();`);
    await waitForSelector(client, ctx, "[data-quick-add] .quick-tabs");
    await client.eval(
      ctx,
      `
      const btns = [...document.querySelectorAll("[data-quick-add] .quick-tabs button")];
      btns.find((b) => b.textContent === "Pantry").click();
      `,
    );
    await waitForSelector(client, ctx, '[data-quick-add] input[name="name"]');
    await client.eval(
      ctx,
      `
      const form = document.querySelector("[data-quick-add] form");
      form.querySelector('input[name="name"]').value = "Olive oil";
      form.querySelector('input[name="quantity"]').value = "500";
      form.querySelector('input[name="unit"]').value = "ml";
      form.requestSubmit();
      `,
    );
    await new Promise((r) => setTimeout(r, 300));
    const quickClosed = await client.eval(ctx, `return !document.querySelector("[data-quick-add]")`);
    assert.equal(quickClosed, true, "Quick Add sheet should close after creating Pantry item");

    // Check every route on mobile viewport for clean render + zero horizontal overflow
    for (const hash of ["#/pantry", "#/groceries", "#/meals", "#/recipes", "#/chores", "#/expenses", "#/settings"]) {
      await client.eval(ctx, `location.hash = ${JSON.stringify(hash)};`);
      await new Promise((r) => setTimeout(r, 200));
      const check = await client.eval(
        ctx,
        `return { hash: location.hash, overflow: document.documentElement.scrollWidth > window.innerWidth, textLen: document.getElementById("view").textContent.trim().length };`,
      );
      assert.ok(check.textLen > 10, `Route ${hash} rendered empty on mobile`);
      assert.equal(check.overflow, false, `Horizontal overflow detected on mobile route ${hash}`);
    }

    // Exercise Pantry Edit + Search + Filter on mobile
    await client.eval(ctx, `location.hash = "#/pantry";`);
    await waitForSelector(client, ctx, ".pantry-list-wrap");
    await client.eval(
      ctx,
      `
      const s = document.querySelector(".search-input");
      s.value = "olive";
      s.dispatchEvent(new Event("input", { bubbles: true }));
      `,
    );
    const filteredText = await client.eval(ctx, `return document.querySelector(".pantry-list-wrap").textContent;`);
    assert.ok(filteredText.includes("Olive oil"), "Pantry search should keep matching 'Olive oil'");
    // Edit lives in each row's "⋯" menu.
    await client.eval(ctx, `document.querySelector(".pantry-list-wrap .menu-btn").click();`);
    await waitForSelector(client, ctx, ".row-menu");
    await client.eval(ctx, `[...document.querySelectorAll(".row-menu button")].find((b) => b.textContent === "Edit").click();`);
    await waitForSelector(client, ctx, ".modal-backdrop[data-modal]");
    await client.eval(ctx, `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));`);

    // Exercise Chores Board separated Bills + explicit Pay + Undo toast
    await client.eval(ctx, `location.hash = "#/chores";`);
    await waitForSelector(client, ctx, ".view-head .seg");
    await client.eval(
      ctx,
      `[...document.querySelectorAll(".view-head .seg button")].find((b) => b.textContent === "Board").click();`,
    );
    await waitForSelector(client, ctx, ".bills-board");
    const billsInfo = await client.eval(
      ctx,
      `return { hasPaidTag: document.querySelector(".bills-board").textContent.includes("Paid"), hasArrowOnBills: !!document.querySelector(".bills-board button[aria-label='Move forward']") };`,
    );
    assert.equal(billsInfo.hasPaidTag, true, "Bills board should display paid bill tag");
    assert.equal(billsInfo.hasArrowOnBills, false, "Bills board must not use 3-state cycling arrows");

    // ---------- 2. Desktop viewport (1280x800) ----------
    await client.send("browsingContext.setViewport", {
      context: ctx,
      viewport: { width: 1280, height: 800 },
      devicePixelRatio: 1,
    });
    for (const hash of ["#/", "#/pantry", "#/groceries", "#/meals", "#/recipes", "#/chores", "#/expenses", "#/settings"]) {
      await client.eval(ctx, `location.hash = ${JSON.stringify(hash)};`);
      await new Promise((r) => setTimeout(r, 200));
      const check = await client.eval(
        ctx,
        `return { overflow: document.documentElement.scrollWidth > window.innerWidth };`,
      );
      assert.equal(check.overflow, false, `Horizontal overflow detected on desktop route ${hash}`);
    }

    await client.eval(ctx, `location.hash = "#/";`);
    await waitForSelector(client, ctx, ".home-split");
    const desktopLayout = await client.eval(
      ctx,
      `
      const nav = getComputedStyle(document.getElementById("nav")).display;
      const bnav = getComputedStyle(document.getElementById("bottom-nav")).display;
      const calDisplay = getComputedStyle(document.querySelector(".home-cal-wrap")).display;
      const mobileTop = getComputedStyle(document.querySelector(".home-mobile-top")).display;
      const mainRect = document.querySelector(".main-col").getBoundingClientRect();
      const panelRect = document.querySelector(".panel").getBoundingClientRect();
      return { nav, bnav, calDisplay, mobileTop, mainLeft: mainRect.left, panelLeft: panelRect.left };
      `,
    );
    assert.notEqual(desktopLayout.nav, "none", "Desktop top nav should be visible at 1280x800");
    assert.equal(desktopLayout.bnav, "none", "Mobile bottom nav should be hidden at 1280x800");
    assert.notEqual(desktopLayout.calDisplay, "none", "Month calendar should be visible on desktop");
    assert.equal(desktopLayout.mobileTop, "none", "Mobile week strip should be hidden on desktop");
    assert.ok(desktopLayout.panelLeft > desktopLayout.mainLeft, "Desktop split layout should render Panel to the right of Main");

    // Keyboard shortcuts help modal (? and Esc)
    await client.eval(
      ctx,
      `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }));`,
    );
    await waitForSelector(client, ctx, "[data-shortcuts-help]");
    await client.eval(
      ctx,
      `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));`,
    );
    const helpClosed = await client.eval(ctx, `return !document.querySelector("[data-shortcuts-help]")`);
    assert.equal(helpClosed, true, "Esc should dismiss keyboard shortcuts help modal");

    // Chores UI uses Who dropdown + Categories (no points) & busy calendar day expands on hover
    await client.eval(ctx, `location.hash = "#/chores";`);
    await waitForSelector(client, ctx, "form.row select[name='assigned_to']");
    const choreFormCheck = await client.eval(
      ctx,
      `
      const whoSel = document.querySelector("form.row select[name='assigned_to']");
      const catSel = document.querySelector("form.row select[name='category']");
      const pts = document.querySelector("input[name='points']");
      const opts = whoSel ? [...whoSel.options].map((o) => o.value) : [];
      const cats = catSel ? [...catSel.options].map((o) => o.value) : [];
      return { hasWhoDropdown: !!whoSel, opts, hasCleaningCat: cats.includes("Cleaning"), hasPointsInput: !!pts, hasPointsHeader: document.body.textContent.includes("Points") };
      `,
    );
    assert.equal(choreFormCheck.hasWhoDropdown, true, "Chores Who field should be a <select> dropdown");
    assert.ok(choreFormCheck.opts.includes("Sushil"), "Who dropdown should list household members");
    assert.ok(choreFormCheck.opts.includes("__new__"), "Who dropdown should offer '+ Add person…'");
    assert.equal(choreFormCheck.hasCleaningCat, true, "Chores form should offer chore categories");
    assert.equal(choreFormCheck.hasPointsInput, false, "Points input must be removed");
    assert.equal(choreFormCheck.hasPointsHeader, false, "Points leaderboard must be removed");

    // Populate today with 5 chores via API so the calendar day becomes .has-more and test real hover zoom
    const todayStr = await client.eval(ctx, `
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    `);
    for (let i = 1; i <= 5; i++) {
      const r = await fetch(`${baseUrl}/api/chores`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: baseUrl },
        body: JSON.stringify({
          title: `Chore task ${i}`,
          assigned_to: "Sushil",
          priority: "medium",
          status: "todo",
          category: "Cleaning",
          due_date: todayStr,
        }),
      });
      assert.equal(r.status, 201);
    }
    await client.send("browsingContext.navigate", { context: ctx, url: `${baseUrl}/#/`, wait: "complete" });
    await waitForSelector(client, ctx, ".cell.has-more");
    const beforeHover = await client.eval(
      ctx,
      `
      const cell = document.querySelector(".cell.has-more");
      cell.scrollIntoView({ block: "center" });
      const inner = cell.querySelector(".cell-inner").getBoundingClientRect();
      const extraDisp = getComputedStyle(cell.querySelector(".chip-extra")).display;
      return { x: Math.round(inner.left + inner.width / 2), y: Math.round(inner.top + inner.height / 2), h: inner.height, extraDisp };
      `,
    );
    assert.equal(beforeHover.extraDisp, "none", "Extra chips should be hidden before hover");

    await client.send("input.performActions", {
      context: ctx,
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [{ type: "pointerMove", duration: 0, x: beforeHover.x, y: beforeHover.y }],
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));
    const afterHover = await client.eval(
      ctx,
      `
      const cell = document.querySelector(".cell.has-more");
      const inner = cell.querySelector(".cell-inner").getBoundingClientRect();
      const extraDisp = getComputedStyle(cell.querySelector(".chip-extra")).display;
      return { h: inner.height, extraDisp };
      `,
    );
    assert.notEqual(afterHover.extraDisp, "none", "Hovering busy calendar day must reveal all extra chips");
    assert.ok(afterHover.h > beforeHover.h, `Expected hovered calendar cell to enlarge (${afterHover.h} > ${beforeHover.h})`);

    assert.deepEqual(client.errors, [], `Browser console errors observed: ${client.errors.join("; ")}`);
    console.log("  - Firefox headless responsive E2E verified (390x844 mobile + 1280x800 desktop)");
  } finally {
    try { ws?.close(); } catch {}
    ff.kill("SIGKILL");
    fs.rmSync(prof, { recursive: true, force: true });
  }
}

async function runApiSmoke(baseUrl) {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.ok(health.headers.get("content-security-policy"), "CSP header should be set");
  assert.equal(health.headers.get("x-frame-options"), "DENY");
  assert.equal(health.headers.get("cache-control"), "no-cache");

  const idx = await fetch(`${baseUrl}/`);
  assert.equal(idx.status, 200);
  const html = await idx.text();
  assert.ok(html.includes('id="bottom-nav"') && html.includes('id="quick-add-fab"'));

  const hdrs = {
    "Content-Type": "application/json",
    Origin: baseUrl,
  };
  const billRes = await fetch(`${baseUrl}/api/chores`, {
    method: "POST",
    headers: hdrs,
    body: JSON.stringify({
      title: "Internet",
      assigned_to: "Sushil",
      priority: "high",
      status: "todo",
      points: 1,
      due_date: "2026-11-27",
      amount: 45,
      category: "Utilities",
    }),
  });
  assert.equal(billRes.status, 201);
  const { id: billId } = await billRes.json();
  const payRes = await fetch(`${baseUrl}/api/chores/${billId}`, {
    method: "PATCH",
    headers: hdrs,
    body: JSON.stringify({ status: "done" }),
  });
  assert.equal(payRes.status, 200);
  const expRes = await fetch(`${baseUrl}/api/expenses`);
  const exps = await expRes.json();
  assert.ok(exps.some((e) => e.title === "Internet" && e.amount === 45), "Paying bill via API creates linked expense");
  console.log("  - Live HTTP server API & security headers verified");
}

async function main() {
  verifyEsmAndServiceWorker();
  assert.ok(fs.existsSync(SERVER_BIN), `Missing server binary at ${SERVER_BIN} (run cargo build in server/)`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rosie-e2e-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(SERVER_BIN, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: path.join(tmpDir, "rosie-test.db"),
      IMAGE_DIR: path.join(tmpDir, "images"),
      WEB_DIR: path.join(ROOT, "web"),
      ROSIE_PASSWORD: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForHealth(baseUrl);
    await runApiSmoke(baseUrl);
    await runBrowserSuite(baseUrl);
    console.log("E2E smoke suite passed.");
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

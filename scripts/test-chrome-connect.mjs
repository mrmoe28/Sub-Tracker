import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");

function fixture(tabs) {
  let listener;
  const requests = [];
  const opened = [];
  const chrome = {
    runtime: { onMessage: { addListener(value) { listener = value; } } },
    tabs: {
      async query() { return tabs; },
      async create(value) { opened.push(value); },
      async update(id, value) { opened.push({ id, ...value }); },
    },
    windows: { async update() {} },
    cookies: {
      async getAllCookieStores() { return [{ id: "store-1", tabIds: [12] }, { id: "app-store", tabIds: [1] }]; },
      async getAll(query) { requests.push(query); return [{ name: "session", value: "fixture" }]; },
    },
  };
  runInNewContext(source, { chrome, URL });
  return { requests, opened, send(message, sender = { origin: "https://sub.lock28.com", tab: { id: 1 } }) {
    return new Promise((resolve) => {
      if (!listener(message, sender, resolve)) resolve(null);
    });
  } };
}

test("only the trusted app tab may request Chrome sessions", async () => {
  const browser = fixture([{ id: 12, url: "https://merchant.example/account" }]);
  assert.equal(await browser.send({ action: "discover", domain: "merchant.example" }, {
    origin: "https://evil.example", tab: { id: 1 },
  }), null);
  assert.equal(browser.requests.length, 0);
});

test("discovery uses the matching tab's cookie store", async () => {
  const browser = fixture([{ id: 12, url: "https://account.merchant.example/billing" }]);
  const result = await browser.send({ action: "discover", domain: "merchant.example" });
  assert.equal(result.cookies[0].value, "fixture");
  assert.equal(browser.requests[0].domain, "merchant.example");
  assert.equal(browser.requests[0].storeId, "store-1");
});

test("lookalike domains and insecure tabs cannot widen the cookie request", async () => {
  for (const url of ["https://merchant.example.evil.example", "https://notmerchant.example", "http://merchant.example"]) {
    const browser = fixture([{ id: 12, url }]);
    const result = await browser.send({ action: "discover", domain: "merchant.example" });
    assert.equal(result.url, "https://merchant.example/");
    assert.equal(browser.requests[0].domain, "merchant.example");
    assert.equal(browser.requests[0].storeId, "app-store");
  }
});

test("saved Chrome cookies can be discovered without an open merchant tab", async () => {
  const browser = fixture([]);
  const result = await browser.send({ action: "discover", domain: "merchant.example" });
  assert.equal(result.cookies[0].value, "fixture");
  assert.equal(browser.requests[0].storeId, "app-store");
});

test("unknown actions and invalid domains do not read cookies", async () => {
  const browser = fixture([]);
  assert.equal(await browser.send({ action: "dump-cookies" }), null);
  assert.match((await browser.send({ action: "discover", domain: "../secret" })).error, /Invalid/);
  assert.equal(browser.requests.length, 0);
});

test("sign-in handoff opens only the selected HTTPS merchant without exporting cookies", async () => {
  const browser = fixture([]);
  assert.equal((await browser.send({ action: "open", domain: "merchant.example" })).opened, true);
  assert.equal(browser.opened[0].url, "https://merchant.example/");
  assert.equal(browser.requests.length, 0);
  assert.equal(await browser.send({ action: "open", domain: "merchant.example" }, { origin: "https://evil.example", tab: { id: 1 } }), null);
  assert.equal(browser.opened.length, 1);
});

test("sign-in handoff focuses an existing matching tab", async () => {
  const browser = fixture([{ id: 12, windowId: 3, url: "https://merchant.example/account" }]);
  assert.equal((await browser.send({ action: "open", domain: "merchant.example" })).opened, true);
  assert.equal(browser.opened[0].id, 12);
  assert.equal(browser.opened[0].active, true);
  assert.equal(browser.requests.length, 0);
});

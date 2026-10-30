const APP_ORIGIN = "https://sub.lock28.com";

async function discover(domain, sourceTabId, open = false) {
  if (typeof domain !== "string" || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) {
    throw new Error("Invalid merchant domain.");
  }
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((item) => {
    try {
      const url = new URL(item.url);
      return url.protocol === "https:" &&
        (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
    } catch { return false; }
  });
  if (open) {
    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url: `https://${domain}/`, active: true });
    }
    return { opened: true };
  }
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((item) => item.tabIds.includes(tab?.id ?? sourceTabId));
  if (!store) throw new Error("Chrome cookie store not found.");
  const cookies = await chrome.cookies.getAll({ domain, storeId: store.id });
  if (!cookies.length) return { error: "No saved Chrome session was found for this merchant in this browser profile." };
  return { url: tab?.url ?? `https://${domain}/`, cookies };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || sender.origin !== APP_ORIGIN) return false;
  if (message.action === "ping") {
    respond({ connected: true });
    return false;
  }
  if (!["discover", "open"].includes(message.action)) return false;
  discover(message.domain, sender.tab.id, message.action === "open").then(respond).catch((error) => respond({ error: error.message }));
  return true;
});

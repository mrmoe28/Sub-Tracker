const APP_ORIGIN = "https://sub.lock28.com";

async function discover(domain) {
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
  if (!tab) {
    return { error: "No matching merchant tab is open in this Chrome profile. No session was copied." };
  }
  const stores = await chrome.cookies.getAllCookieStores();
  const store = stores.find((item) => item.tabIds.includes(tab.id));
  if (!store) throw new Error("Chrome cookie store not found.");
  const cookies = await chrome.cookies.getAll({ domain, storeId: store.id });
  if (!cookies.length) return { error: "The matching Chrome tab has no saved session." };
  return { url: tab.url, cookies };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!sender.tab || sender.origin !== APP_ORIGIN) return false;
  if (message.action === "ping") {
    respond({ connected: true });
    return false;
  }
  if (message.action !== "discover") return false;
  discover(message.domain).then(respond).catch((error) => respond({ error: error.message }));
  return true;
});

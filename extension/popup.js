const DEFAULT_SERVER = "https://sub.lock28.com";

const $ = (id) => document.getElementById(id);

// Match the server's registrableDomain(): last two labels, three for
// country-code second-level domains like co.uk.
function registrableDomain(host) {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2];
  if (/^(co|com|org|net|gov|edu|ac)$/.test(sld) && parts[parts.length - 1].length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function setStatus(text, cls) {
  const el = $("status");
  el.textContent = text;
  el.className = cls || "";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function load() {
  const { server, token } = await chrome.storage.local.get(["server", "token"]);
  $("server").value = server || DEFAULT_SERVER;
  $("token").value = token || "";
  const tab = await activeTab();
  let host = null;
  try {
    host = new URL(tab.url).hostname;
  } catch {
    host = null;
  }
  $("site").textContent = host ? registrableDomain(host) : "(no site)";
  $("send").disabled = !host || !/^https?:/.test(tab.url);
  if (!token) setStatus("Open Settings and paste your pairing token first.", "err");
}

$("save").addEventListener("click", async () => {
  const server = ($("server").value || DEFAULT_SERVER).replace(/\/+$/, "");
  const token = $("token").value.trim();
  await chrome.storage.local.set({ server, token });
  setStatus("Saved.", "ok");
});

$("send").addEventListener("click", async () => {
  const { server, token } = await chrome.storage.local.get(["server", "token"]);
  if (!token) return setStatus("Paste your pairing token in Settings first.", "err");
  const tab = await activeTab();
  const host = new URL(tab.url).hostname;
  const domain = registrableDomain(host);
  $("send").disabled = true;
  setStatus("Collecting cookies…");
  try {
    // All cookies for the site and its subdomains (e.g. secure.hulu.com).
    const cookies = await chrome.cookies.getAll({ domain });
    const res = await fetch(`${server || DEFAULT_SERVER}/api/connect/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url: tab.url, cookies }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server said ${res.status}`);
    setStatus(`Saved ${data.cookieCount} cookies for ${data.domain}. Now click "Find as me" in Sub-Tracker.`, "ok");
  } catch (err) {
    setStatus(err.message || String(err), "err");
  } finally {
    $("send").disabled = false;
  }
});

load();

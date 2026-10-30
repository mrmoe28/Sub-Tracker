const APP_ORIGIN = "https://sub.lock28.com";

window.addEventListener("message", async (event) => {
  if (event.source !== window || event.origin !== APP_ORIGIN) return;
  const request = event.data;
  if (request?.channel !== "subtracker-request" || typeof request.id !== "string") return;
  if (!["ping", "discover"].includes(request.action)) return;
  try {
    let target;
    if (request.action === "discover") {
      if (typeof request.candidateId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(request.candidateId)) return;
      const response = await fetch(`/api/subscriptions/${request.candidateId}/browser-target`, { cache: "no-store" });
      target = await response.json();
      if (!response.ok) throw new Error(target.error || "Merchant lookup failed.");
    }
    const result = await chrome.runtime.sendMessage({
      action: request.action,
      domain: target?.domain,
    });
    if (result.cookies) {
      const response = await fetch("/api/connect/live-session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: request.candidateId, url: result.url, cookies: result.cookies }),
      });
      const saved = await response.json();
      window.postMessage({ channel: "subtracker-response", id: request.id,
        saved: response.ok && saved.saved, error: saved.error }, APP_ORIGIN);
      return;
    }
    window.postMessage({ channel: "subtracker-response", id: request.id, ...result }, APP_ORIGIN);
  } catch (error) {
    window.postMessage({ channel: "subtracker-response", id: request.id,
      error: error.message || "Chrome connection stopped. Reload Sub-Tracker to reconnect." }, APP_ORIGIN);
  }
});

"use client";

export function discoverChromeSession(candidateId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(new Error("Chrome Connect is not responding. The updated extension must be installed in this Chrome profile."));
    }, 20000);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin ||
          event.data?.channel !== "subtracker-response" || event.data.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.saved) resolve();
      else reject(new Error(event.data.error || "No Chrome session found."));
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: "subtracker-request", action: "discover", candidateId, id }, window.location.origin);
  });
}

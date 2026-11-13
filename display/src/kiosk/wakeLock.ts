/**
 * Keeps the counter screen on. Re-acquired whenever the page becomes visible,
 * because browsers drop the lock when the tab is hidden.
 * Returns false where the API is missing, so the caller can show the hint.
 */
export function keepScreenOn(): { supported: boolean; stop: () => void } {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
  if (!nav.wakeLock) return { supported: false, stop: () => {} };

  let sentinel: { release(): Promise<void> } | null = null;
  let stopped = false;
  const acquire = async () => {
    if (stopped || document.visibilityState !== "visible") return;
    try {
      sentinel = await nav.wakeLock!.request("screen");
    } catch {
      /* low battery or not allowed yet; retried on the next visibility change */
    }
  };
  const onVisible = () => void acquire();
  document.addEventListener("visibilitychange", onVisible);
  void acquire();
  return {
    supported: true,
    stop() {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    },
  };
}

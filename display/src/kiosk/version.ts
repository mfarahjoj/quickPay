/** The build this tab is running, set by vite.config.ts. */
export const BUILD: string = typeof __DISPLAY_BUILD__ === "string" ? __DISPLAY_BUILD__ : "dev";

const DAY_MS = 24 * 60 * 60 * 1000;
const bootedAt = Date.now();

/**
 * Reload only while idle, so a customer mid-payment never sees the screen
 * blank: when the server names a newer build, or once a day.
 */
export function shouldReload(latestBuild: string | null, idle: boolean, nowMs = Date.now()): boolean {
  if (!idle) return false;
  if (latestBuild && latestBuild !== BUILD && BUILD !== "dev") return true;
  return nowMs - bootedAt > DAY_MS;
}

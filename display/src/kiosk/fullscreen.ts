export function canFullscreen(): boolean {
  return typeof document.documentElement.requestFullscreen === "function";
}
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    /* iPad Safari: use Add to Home Screen instead */
  }
}

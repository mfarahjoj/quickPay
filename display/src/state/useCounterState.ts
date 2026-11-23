/**
 * Live state for a paired tablet: the state doc listener, the heartbeat (clock
 * offset, heal path, revocation), and a one-second ticker for countdowns.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { displayHeartbeat, errorReason } from "../api";
import { loadLastError, saveCachedIdle, saveLastError } from "../storage";
import { BUILD } from "../kiosk/version";
import { clockOffset } from "./viewModel";
import type { CounterDisplayState, DisplayCreds } from "../types";

const HEARTBEAT_MS = 60 * 1000;
const STALE_CACHE_MS = 5000;

export interface CounterState {
  state: CounterDisplayState | null;
  stateMissing: boolean;
  revoked: boolean;
  clockReady: boolean;
  nowMs: number;
  reconnecting: boolean;
  latestBuild: string | null;
}

export function useCounterState(creds: DisplayCreds): CounterState {
  const [state, setState] = useState<CounterDisplayState | null>(null);
  const [stateMissing, setStateMissing] = useState(false);
  const [fromCacheSince, setFromCacheSince] = useState<number | null>(null);
  const [revoked, setRevoked] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const [failures, setFailures] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [latestBuild, setLatestBuild] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());

  // The one document this tablet reads.
  useEffect(() => {
    const ref = doc(db, "counterDisplayStates", creds.stateKey);
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        const cached = snap.metadata.fromCache;
        setFromCacheSince((prev) => (cached ? prev ?? Date.now() : null));
        if (snap.exists()) {
          const data = snap.data() as CounterDisplayState;
          setState(data);
          setStateMissing(false);
          saveCachedIdle(data);
        } else if (!cached) {
          // Only the server can say it is gone; an empty cache says nothing.
          setStateMissing(true);
        }
      },
      (err) => console.error("state listener:", err)
    );
  }, [creds.stateKey]);

  // Heartbeat: once at boot (before any timed screen), every minute, and on reconnect.
  useEffect(() => {
    // Per run of this effect: a cancelled run's call in flight must not block the next run's.
    let cancelled = false;
    let inFlight = false;
    const beat = async () => {
      if (inFlight) return;
      inFlight = true;
      const sentAt = Date.now();
      try {
        const lastError = loadLastError();
        const res = await displayHeartbeat(creds, BUILD, lastError);
        if (cancelled) return;
        setOffset(clockOffset(sentAt, Date.now(), res.serverNowMs));
        setLatestBuild(res.latestBuild);
        setFailures(0);
        if (lastError) saveLastError(null);
      } catch (err) {
        if (cancelled) return;
        if (errorReason(err) === "display_revoked") setRevoked(true);
        setFailures((n) => n + 1);
      } finally {
        inFlight = false;
      }
    };
    void beat();
    const timer = window.setInterval(beat, HEARTBEAT_MS);
    const onOnline = () => {
      setOnline(true);
      void beat();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [creds]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const staleCache = fromCacheSince !== null && tick - fromCacheSince > STALE_CACHE_MS;
  return {
    state,
    stateMissing,
    revoked,
    clockReady: offset !== null,
    nowMs: tick + (offset ?? 0),
    reconnecting: !online || staleCache || failures >= 2,
    latestBuild,
  };
}

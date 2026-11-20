import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { isOfflineError } from "../lib/errors";

/**
 * App-wide online/offline state. Combines what the OS reports (Wi-Fi, mobile
 * data, airplane mode) with what our own requests see: a request that never
 * reached the server marks us offline even if the OS thinks a network is up,
 * and any request that reaches the server marks us online again.
 *
 * `onReconnect` listeners fire when we come back online, and every 15 s while
 * the server is unreachable on an otherwise "up" network, so stores re-sync
 * and Realtime re-joins.
 */
type NetworkState = { online: boolean };

export const useNetwork = create<NetworkState>(() => ({ online: true }));

const RETRY_MS = 15_000;
let networkUp = true;
let serverUnreachable = false;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
const reconnectListeners = new Set<() => void>();

function emitReconnect() {
  for (const fn of reconnectListeners) {
    try {
      fn();
    } catch {}
  }
}

function update() {
  const online = networkUp && !serverUnreachable;
  const cameBack = online && !useNetwork.getState().online;
  if (online !== useNetwork.getState().online) useNetwork.setState({ online });
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = networkUp && serverUnreachable ? setInterval(emitReconnect, RETRY_MS) : null;
  if (cameBack) emitReconnect();
}

export const Network = {
  /** Starts watching OS connectivity. Never awaited on the startup path. */
  start() {
    if (started) return;
    started = true;
    NetInfo.addEventListener((s) => {
      const up = s.isConnected !== false && s.isInternetReachable !== false;
      if (up === networkUp) return;
      networkUp = up;
      if (up) serverUnreachable = false; // a new network is a fresh chance to reach the server
      update();
    });
  },
  /** Call with any failed request's error; only network failures count. */
  reportFailure(error: unknown) {
    if (!isOfflineError(error) || serverUnreachable) return;
    serverUnreachable = true;
    update();
  },
  /** Call after any request that reached the server. */
  reportSuccess() {
    if (!serverUnreachable) return;
    serverUnreachable = false;
    update();
  },
  onReconnect(fn: () => void) {
    reconnectListeners.add(fn);
    return () => {
      reconnectListeners.delete(fn);
    };
  },
  get online() {
    return useNetwork.getState().online;
  },
};

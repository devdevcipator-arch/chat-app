"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CallController, IDLE_SNAPSHOT, type CallSnapshot } from "@/lib/call/controller";
import { subscribeToCalls } from "@/lib/call/signaling";
import { createClient } from "@/lib/supabase/client";
import { CallOverlay } from "./call-overlay";
import { IncomingCall } from "./incoming-call";

// Mounted once for every /chat route, so calls ring wherever you are in the
// app and survive navigating between chats.

const CallContext = createContext<CallController | null>(null);

export function CallProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(createClient);
  const [controller, setController] = useState<CallController | null>(null);

  // One controller + one realtime subscription per signed-in user.
  useEffect(() => {
    let current: { controller: CallController; unsubscribe: () => void } | null = null;
    let disposed = false;

    const stop = () => {
      current?.unsubscribe();
      current?.controller.destroy();
      current = null;
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      const token = session?.access_token ?? null;
      // Defer: supabase-js must not be called re-entrantly from this callback.
      setTimeout(() => {
        if (disposed) return;
        if (current && current.controller.meId !== userId) {
          stop();
          setController(null);
        }
        if (userId && !current) {
          const ctrl = new CallController(supabase, userId);
          const unsubscribe = subscribeToCalls(supabase, userId, ctrl.handleSignal, () => void ctrl.resync());
          current = { controller: ctrl, unsubscribe };
          setController(ctrl);
        }
        current?.controller.setAccessToken(token);
      }, 0);
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
      stop();
    };
  }, [supabase]);

  // Leaving the page mid-call: warn first, then hang up on the way out.
  useEffect(() => {
    if (!controller) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (controller.inCall) e.preventDefault();
    };
    const onPageHide = () => controller.handleUnload();
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [controller]);

  return (
    <CallContext.Provider value={controller}>
      {children}
      <IncomingCall />
      <CallOverlay />
    </CallContext.Provider>
  );
}

const noopSubscribe = () => () => {};
const idleSnapshot = () => IDLE_SNAPSHOT;

/** Current call state plus the controller (null until signed in). */
export function useCall(): CallSnapshot & { controller: CallController | null } {
  const controller = useContext(CallContext);
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  return { ...snapshot, controller };
}

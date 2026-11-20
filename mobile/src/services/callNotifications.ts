import { CallRepo } from "../data/calls";
import { storage } from "../lib/storage";
import { PENDING_ACCEPT_KEY } from "../state/calls";

/**
 * Native incoming-call UI via Notifee: a full-screen-intent notification with
 * Accept / Decline that rings over the lock screen while the app is closed.
 * Only loaded when push is compiled in (see services/push.ts).
 */
type Notifee = typeof import("@notifee/react-native");

const CHANNEL_ID = "incoming-calls";

function notifee(): Notifee {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@notifee/react-native") as Notifee;
}

export async function ensureCallChannel() {
  const n = notifee();
  await n.default.createChannel({
    id: CHANNEL_ID,
    name: "Incoming calls",
    importance: n.AndroidImportance.HIGH,
    visibility: n.AndroidVisibility.PUBLIC,
    vibration: true,
    sound: "default",
    bypassDnd: false,
  });
}

export type CallPush = { call_id: string; chat_id: string; caller_name?: string; call_type?: string };

export async function showIncomingCall(data: CallPush) {
  const n = notifee();
  await ensureCallChannel();
  const video = data.call_type === "video";
  await n.default.displayNotification({
    id: `call:${data.call_id}`,
    title: data.caller_name ?? "Incoming call",
    body: video ? "Incoming video call" : "Incoming voice call",
    data: { call_id: data.call_id, chat_id: data.chat_id },
    android: {
      channelId: CHANNEL_ID,
      category: n.AndroidCategory.CALL,
      importance: n.AndroidImportance.HIGH,
      visibility: n.AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      timeoutAfter: 35_000,
      smallIcon: "ic_launcher",
      fullScreenAction: { id: "default", launchActivity: "default" },
      pressAction: { id: "default", launchActivity: "default" },
      actions: [
        { title: "Decline", pressAction: { id: "decline" } },
        { title: "Accept", pressAction: { id: "accept", launchActivity: "default" } },
      ],
    },
    ios: { categoryId: "incoming-call", sound: "default", critical: false },
  });
}

export async function cancelIncomingCall(callId: string) {
  await notifee().default.cancelNotification(`call:${callId}`).catch(() => {});
}

/** Accept / Decline pressed on the notification (foreground or background). */
export async function handleCallAction(actionId: string | undefined, data: Record<string, unknown> | undefined) {
  const callId = typeof data?.call_id === "string" ? data.call_id : null;
  if (!callId) return;
  if (actionId === "decline") {
    await CallRepo.answer(callId, false);
    await cancelIncomingCall(callId);
  } else if (actionId === "accept" || actionId === "default") {
    // The app opens; the call controller picks the ringing call up and answers it.
    storage.set(PENDING_ACCEPT_KEY, callId);
    await cancelIncomingCall(callId);
  }
}

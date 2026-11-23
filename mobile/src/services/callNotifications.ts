import * as Notifications from "expo-notifications";
import { CallRepo } from "../data/calls";
import { Calls } from "../state/calls";
import { usePushPref } from "./push";

/**
 * Native notifications for FCM pushes (Notifee): a full-screen incoming call
 * with Accept / Decline, and high-priority messages. Runs headless while the
 * app is closed. Only loaded when push is compiled in (see services/push.ts).
 */
type Notifee = typeof import("@notifee/react-native");

const CALL_CHANNEL = "calls";
const MESSAGE_CHANNEL = "messages";
const SMALL_ICON = "notification_icon";
const ACCEPT = "accept_call";
const DECLINE = "decline_call";
/** Matches the caller's ring timeout, plus delivery slack. */
const RING_MS = 35_000;
const STALE_CALL_MS = 45_000;
const RING_POLL_MS = 3_000;

function notifee(): Notifee {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@notifee/react-native") as Notifee;
}

export async function ensureCallChannel() {
  const n = notifee();
  await n.default.createChannel({
    id: CALL_CHANNEL,
    name: "Incoming calls",
    importance: n.AndroidImportance.HIGH,
    visibility: n.AndroidVisibility.PUBLIC,
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
    sound: "default",
  });
}

async function ensureMessageChannel() {
  const n = notifee();
  await n.default.createChannel({
    id: MESSAGE_CHANNEL,
    name: "Messages",
    importance: n.AndroidImportance.HIGH,
    vibration: true,
    sound: "default",
  });
}

/** The same event can arrive twice on a cold start (event + initial notification). */
const handledPresses = new Set<string>();

/** Removes the Realtime-driven copy of a notification, if it got there first. */
const dismissLocalCopy = (id: string) => Notifications.dismissNotificationAsync(id).catch(() => {});

export async function isDisplayed(id: string) {
  try {
    const shown = await notifee().default.getDisplayedNotifications();
    return shown.some((item) => item.id === id);
  } catch {
    return false;
  }
}

export type CallPush = {
  callId: string;
  chatId: string;
  callType?: string;
  callerName?: string;
  createdAt?: string;
};

export async function showIncomingCall(data: CallPush) {
  if (!usePushPref.getState().enabled) return;
  const age = data.createdAt ? Date.now() - Date.parse(data.createdAt) : 0;
  if (Number.isFinite(age) && age > STALE_CALL_MS) return; // delivered too late to answer

  const n = notifee();
  await ensureCallChannel();
  const id = `call:${data.callId}`;
  await n.default.displayNotification({
    id,
    title: data.callerName || "Incoming call",
    body: data.callType === "video" ? "Incoming video call" : "Incoming voice call",
    data: { kind: "call", callId: data.callId, chatId: data.chatId },
    android: {
      channelId: CALL_CHANNEL,
      category: n.AndroidCategory.CALL,
      importance: n.AndroidImportance.HIGH,
      visibility: n.AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      loopSound: true,
      timeoutAfter: RING_MS,
      smallIcon: SMALL_ICON,
      color: "#FF4D2E",
      fullScreenAction: { id: "default" },
      pressAction: { id: "default", launchActivity: "default" },
      actions: [
        { title: "Decline", pressAction: { id: DECLINE } },
        { title: "Accept", pressAction: { id: ACCEPT, launchActivity: "default" } },
      ],
    },
  });
  await dismissLocalCopy(id);
  await stopRingingWhenCallEnds(data.callId);
}

/** The caller hung up or it was answered elsewhere: stop ringing this phone. */
async function stopRingingWhenCallEnds(callId: string) {
  const deadline = Date.now() + RING_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RING_POLL_MS));
    if (!(await isDisplayed(`call:${callId}`))) return;
    const row = await CallRepo.fetch(callId).catch(() => undefined);
    if (row && row.status !== "ringing") {
      await cancelIncomingCall(callId);
      return;
    }
  }
  await cancelIncomingCall(callId);
}

export async function cancelIncomingCall(callId: string) {
  await notifee().default.cancelNotification(`call:${callId}`).catch(() => {});
}

export type MessagePush = { messageId: string; chatId: string; title?: string; senderName?: string; preview?: string };

export async function showMessage(data: MessagePush) {
  if (!usePushPref.getState().enabled) return;
  const n = notifee();
  await ensureMessageChannel();
  const id = `msg:${data.messageId}`;
  await n.default.displayNotification({
    id,
    title: data.title || data.senderName || "New message",
    body: data.preview || "New message",
    data: { kind: "message", chatId: data.chatId },
    android: {
      channelId: MESSAGE_CHANNEL,
      importance: n.AndroidImportance.HIGH,
      smallIcon: SMALL_ICON,
      color: "#FF4D2E",
      autoCancel: true,
      pressAction: { id: "default", launchActivity: "default" },
    },
  });
  await dismissLocalCopy(id);
}

// --- Opening a chat ---------------------------------------------------------

let pendingChat: string | null = null;
let navigationReady = false;

function flushPendingChat(attempt = 0) {
  const chatId = pendingChat;
  if (!chatId || !navigationReady) return;
  try {
    // Loaded late: this module also runs headless, with no navigator.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require("expo-router") as typeof import("expo-router");
    router.push({ pathname: "/chat/[id]", params: { id: chatId } });
    pendingChat = null;
  } catch {
    // On a cold start the navigator mounts a moment after sign-in restores.
    if (attempt < 8) setTimeout(() => flushPendingChat(attempt + 1), 500);
  }
}

/** Signed in and the app is running: open whatever notification launched it. */
export async function onAppReady() {
  navigationReady = true;
  try {
    const initial = await notifee().default.getInitialNotification();
    if (initial) await handleNotificationPress(initial.pressAction?.id, initial.notification);
  } catch {}
  flushPendingChat();
}

export function onAppSignedOut() {
  navigationReady = false;
  pendingChat = null;
}

/** A notification or one of its buttons was pressed (foreground or background). */
export async function handleNotificationPress(
  actionId: string | undefined,
  notification: { id?: string; data?: Record<string, unknown> } | undefined,
) {
  const data = notification?.data;
  const key = `${notification?.id}:${actionId}`;
  if (handledPresses.has(key)) return;
  handledPresses.add(key);

  if (data?.kind === "message" && typeof data.chatId === "string") {
    pendingChat = data.chatId;
    flushPendingChat();
    return;
  }
  if (data?.kind !== "call" || typeof data.callId !== "string") return;
  const callId = data.callId;
  if (actionId === DECLINE) {
    await cancelIncomingCall(callId);
    await Calls.declineFromNotification(callId);
  } else if (actionId === ACCEPT) {
    await cancelIncomingCall(callId);
    // Answers now if the call is on screen, or as soon as the app has loaded it.
    await Calls.acceptFromNotification(callId);
  } else {
    // A plain tap only opens the ringing screen; it must never answer.
    await Calls.checkRinging();
  }
}

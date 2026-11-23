import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { AppState, Platform } from "react-native";
import { chatName, messageSnippet, profileName } from "../models/types";
import { Calls, useCall } from "../state/calls";
import { useChats } from "../state/chats";
import { Realtime } from "../state/realtime";
import { PUSH_COMPILED_IN, usePushPref } from "./push";

/**
 * Local notifications (expo-notifications), driven by the app's Realtime
 * channel, so they work with no Firebase project at all:
 *   - a new message in an unmuted chat that isn't open on screen
 *   - an incoming call while the app is in the background
 * Respects Settings → Push notifications. Tapping one opens that chat, or the
 * ringing call. (With the app fully closed only FCM can wake it; that path is
 * services/push.ts, compiled in when a google-services.json exists.)
 */

const MESSAGES = "messages";
const CALLS = "calls";
const CALL_CATEGORY = "incoming-call";
const PUSH_GRACE_MS = 2500;

type Data = { kind?: string; chatId?: string; callId?: string };

let meId: string | null = null;
let offMessage: (() => void) | null = null;
let offCall: (() => void) | null = null;
let offPref: (() => void) | null = null;
let offResponse: ReturnType<typeof Notifications.addNotificationResponseReceivedListener> | null = null;
let setUp: Promise<boolean> | null = null;
let callNotificationId: string | null = null;

const enabled = () => usePushPref.getState().enabled;
const inForeground = () => AppState.currentState === "active";

/** Channels + permission (Android 13+ asks for POST_NOTIFICATIONS here). */
async function prepare(ask: boolean): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(MESSAGES, {
        name: "Messages",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 250, 150, 250],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync(CALLS, {
        name: "Incoming calls",
        importance: Notifications.AndroidImportance.MAX,
        sound: "default",
        vibrationPattern: [0, 500, 1000, 500, 1000, 500],
        enableVibrate: true,
        bypassDnd: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
    await Notifications.setNotificationCategoryAsync(CALL_CATEGORY, [
      { identifier: "decline", buttonTitle: "Decline", options: { opensAppToForeground: false, isDestructive: true } },
      { identifier: "accept", buttonTitle: "Accept", options: { opensAppToForeground: true } },
    ]);
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!ask || !current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch (e) {
    console.warn("Notifications unavailable", e);
    return false;
  }
}

async function ready(): Promise<boolean> {
  setUp ??= prepare(true);
  const ok = await setUp;
  if (!ok) setUp = null; // ask again next time the user turns it on
  return ok;
}

/** In the background FCM may deliver the same item: give it a moment to win. */
async function shownByPush(identifier: string) {
  if (!PUSH_COMPILED_IN || inForeground()) return false;
  await new Promise((resolve) => setTimeout(resolve, PUSH_GRACE_MS));
  const { isDisplayed } = await import("./callNotifications");
  return isDisplayed(identifier);
}

async function show(content: Notifications.NotificationContentInput, channelId: string, identifier?: string) {
  if (!enabled() || !(await ready())) return null;
  if (identifier && (await shownByPush(identifier))) return null;
  try {
    return await Notifications.scheduleNotificationAsync({
      identifier,
      content,
      // Immediate; on Android the channel decides sound, vibration and heads-up.
      trigger: Platform.OS === "android" ? { channelId } : null,
    });
  } catch {
    return null;
  }
}

function onMessage(message: import("../models/types").ChatMessage, isUpdate: boolean) {
  if (isUpdate || !meId || message.senderId === meId || message.type === "system") return;
  const { chats, openChatId } = useChats.getState();
  const chat = chats.find((ch) => ch.chatId === message.chatId);
  if (chat?.isMuted) return;
  // The open conversation already shows it (only while it's actually on screen).
  if (inForeground() && openChatId === message.chatId) return;
  const title = chat ? chatName(chat) : "New message";
  const sender = chat?.type === "group" ? chat.lastMessage?.senderName : null;
  const snippet = messageSnippet(message.type, message.content, message.durationSeconds);
  void show(
    {
      title,
      body: sender ? `${sender}: ${snippet}` : snippet,
      data: { kind: "message", chatId: message.chatId } satisfies Data,
      sound: "default",
    },
    MESSAGES,
    `msg:${message.id}`,
  );
}

function clearCallNotification() {
  const id = callNotificationId;
  callNotificationId = null;
  if (id) void Notifications.dismissNotificationAsync(id).catch(() => {});
}

async function showCall() {
  const { call, peer, isVideo } = useCall.getState();
  if (!call) return;
  const id = `call:${call.id}`;
  callNotificationId = id;
  await show(
    {
      title: profileName(peer),
      body: isVideo ? "Incoming video call" : "Incoming voice call",
      data: { kind: "call", callId: call.id, chatId: call.chatId } satisfies Data,
      categoryIdentifier: CALL_CATEGORY,
      sound: "default",
      sticky: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    CALLS,
    id,
  );
  // Ended while we were posting it.
  if (useCall.getState().phase !== "incoming" || useCall.getState().call?.id !== call.id) clearCallNotification();
}

function openChat(chatId: string) {
  const go = () => {
    try {
      router.push({ pathname: "/chat/[id]", params: { id: chatId } });
      return true;
    } catch {
      return false;
    }
  };
  // On a cold start the navigator mounts a moment after this runs.
  if (!go()) setTimeout(go, 600);
}

function onResponse(response: Notifications.NotificationResponse) {
  const data = (response.notification.request.content.data ?? {}) as Data;
  const action = response.actionIdentifier;
  void Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
  if (data.kind === "call" && data.callId) {
    if (action === "decline") void Calls.declineFromNotification(data.callId);
    else if (action === "accept") void Calls.acceptFromNotification(data.callId);
    else void Calls.checkRinging(); // plain tap: the app opens on the ringing screen
    return;
  }
  if (data.kind === "message" && data.chatId) openChat(data.chatId);
}

// Foreground presentation: banners show while the app is open too (the
// handlers above already skip what's on screen).
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {}

export const LocalNotifications = {
  async attach(userId: string) {
    if (meId === userId) return;
    LocalNotifications.detach();
    meId = userId;
    offMessage = Realtime.onMessage(onMessage);
    offCall = useCall.subscribe((st, prev) => {
      if (st.phase === prev.phase && st.call?.id === prev.call?.id) return;
      if (st.phase === "incoming" && !inForeground()) void showCall();
      else if (st.phase !== "incoming") clearCallNotification();
    });
    offPref = usePushPref.subscribe((st, prev) => {
      if (st.enabled && !prev.enabled) void ready();
      if (!st.enabled) clearCallNotification();
    });
    offResponse = Notifications.addNotificationResponseReceivedListener(onResponse);
    // The tap that launched the app.
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last && meId === userId) {
        Notifications.clearLastNotificationResponse();
        onResponse(last);
      }
    } catch {}
    // Ask on startup / sign-in (Android 13+ permission prompt).
    if (enabled()) void ready();
  },

  detach() {
    offMessage?.();
    offCall?.();
    offPref?.();
    offResponse?.remove();
    offMessage = offCall = offPref = null;
    offResponse = null;
    clearCallNotification();
    meId = null;
  },
};

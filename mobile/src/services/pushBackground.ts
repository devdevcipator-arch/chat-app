import { PUSH_COMPILED_IN } from "./push";

/**
 * Headless handlers. Registered from index.ts before the app component, so
 * an FCM data message can ring the phone while the app is closed or the
 * screen is locked. No-op when push isn't compiled into this build.
 */
if (PUSH_COMPILED_IN) {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const m = require("@react-native-firebase/messaging") as typeof import("@react-native-firebase/messaging");
    const n = require("@notifee/react-native") as typeof import("@notifee/react-native");
    const calls = require("./callNotifications") as typeof import("./callNotifications");
    /* eslint-enable @typescript-eslint/no-require-imports */

    const onData = async (data: Record<string, unknown> | undefined) => {
      if (data?.type === "call" && typeof data.call_id === "string" && typeof data.chat_id === "string") {
        await calls.showIncomingCall(data as unknown as import("./callNotifications").CallPush);
      } else if (data?.type === "call_ended" && typeof data.call_id === "string") {
        await calls.cancelIncomingCall(data.call_id);
      }
    };

    m.setBackgroundMessageHandler(m.getMessaging(), async (message) => onData(message.data));
    n.default.onBackgroundEvent(async ({ type, detail }) => {
      if (type === n.EventType.ACTION_PRESS || type === n.EventType.PRESS) {
        await calls.handleCallAction(detail.pressAction?.id, detail.notification?.data);
      }
    });
    n.default.onForegroundEvent(({ type, detail }) => {
      if (type === n.EventType.ACTION_PRESS || type === n.EventType.PRESS) {
        void calls.handleCallAction(detail.pressAction?.id, detail.notification?.data);
      }
    });
  } catch (e) {
    console.warn("Push handlers unavailable", e);
  }
}

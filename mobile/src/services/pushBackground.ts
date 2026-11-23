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
    const push = require("./callNotifications") as typeof import("./callNotifications");
    /* eslint-enable @typescript-eslint/no-require-imports */

    const onData = async (data: Record<string, unknown> | undefined) => {
      if (typeof data?.chatId !== "string") return;
      if (data.type === "incoming_call" && typeof data.callId === "string") {
        await push.showIncomingCall(data as unknown as import("./callNotifications").CallPush);
      } else if (data.type === "new_message" && typeof data.messageId === "string") {
        await push.showMessage(data as unknown as import("./callNotifications").MessagePush);
      }
    };

    m.setBackgroundMessageHandler(m.getMessaging(), async (message) => onData(message.data));

    const isPress = (type: number) => type === n.EventType.ACTION_PRESS || type === n.EventType.PRESS;
    n.default.onBackgroundEvent(async ({ type, detail }) => {
      if (isPress(type)) await push.handleNotificationPress(detail.pressAction?.id, detail.notification);
    });
    n.default.onForegroundEvent(({ type, detail }) => {
      if (isPress(type)) void push.handleNotificationPress(detail.pressAction?.id, detail.notification);
    });
  } catch (e) {
    console.warn("Push handlers unavailable", e);
  }
}

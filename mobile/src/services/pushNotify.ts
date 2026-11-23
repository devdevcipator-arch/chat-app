import { Api } from "../lib/api";

export type PushNotifyRequest =
  | { type: "incoming_call"; callId: string }
  | { type: "new_message"; messageId: string };

/** Asks the server to wake the recipients. Best-effort: never delays or fails a send. */
export function notifyPush(request: PushNotifyRequest) {
  void Api.post("/api/push/notify", request).catch(() => {});
}

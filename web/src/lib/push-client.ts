// Browser side of /api/push/notify: tells the server a call started or a
// message was sent so it can wake the recipients' phones. Fire-and-forget:
// push is best-effort and must never slow down or fail a send.

export type PushNotifyRequest =
  | { type: "incoming_call"; callId: string }
  | { type: "new_message"; messageId: string };

export function notifyPush(request: PushNotifyRequest) {
  if (typeof window === "undefined") return;
  void fetch("/api/push/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    // Survives the tab closing right after sending.
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => {});
}

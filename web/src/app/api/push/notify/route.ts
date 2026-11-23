import { NextResponse, type NextRequest } from "next/server";
import { dispatchPush, type PushRequest } from "@/lib/push/dispatch";
import { getApiAuth } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const reply = (status: number, body: Record<string, unknown>) =>
  NextResponse.json(body, { status, headers: NO_STORE });

/**
 * POST /api/push/notify
 * Body: { type: "incoming_call", callId } or { type: "new_message", messageId }
 *
 * Called by the sender's web or mobile client (session cookie or Bearer
 * token). The database decides who is notified and supplies the names and
 * preview, so a client can't spoof them. Without Firebase credentials this is
 * a logged no-op (202).
 */
export async function POST(request: NextRequest) {
  const auth = await getApiAuth();
  if (!auth) return reply(401, { error: "Please sign in again." });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: "Invalid request body." });
  }
  const { type, callId, messageId } = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  let push: PushRequest;
  if (type === "incoming_call" && typeof callId === "string" && UUID.test(callId)) {
    push = { callId: callId.toLowerCase() };
  } else if (type === "new_message" && typeof messageId === "string" && UUID.test(messageId)) {
    push = { messageId: messageId.toLowerCase() };
  } else {
    return reply(400, { error: "Invalid push request." });
  }

  const result = await dispatchPush(auth.supabase, push);
  if (result.status === "error") return reply(500, { error: "Couldn't send notifications." });
  return reply(result.status === "sent" ? 200 : 202, result);
}

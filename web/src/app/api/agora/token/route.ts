import { NextResponse, type NextRequest } from "next/server";
import { AGORA_TOKEN_TTL_SECONDS, buildRtcToken, getAgoraConfig } from "@/lib/agora";
import {
  CALL_CHANNEL_PATTERN,
  type AgoraTokenError,
  type AgoraTokenResponse,
} from "@/lib/call/types";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

const fail = (status: number, error: string) =>
  NextResponse.json<AgoraTokenError>({ error }, { status, headers: NO_STORE });

/**
 * POST /api/agora/token
 * Body: { channelName: "call_<chatId>" }
 * Returns a 1-hour Agora RTC publisher token. Only a party to an open
 * (ringing or accepted) call in that chat can get one, so chat membership
 * alone is not enough to join, or listen in on, a call channel.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticated users only.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return fail(401, "Please sign in again.");

  // 2. Validate input.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Invalid request body.");
  }
  const channelName =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).channelName : undefined;
  if (typeof channelName !== "string") return fail(400, "Invalid channel.");
  const match = CALL_CHANNEL_PATTERN.exec(channelName);
  if (!match) return fail(400, "Invalid channel.");
  const chatId = match[1].toLowerCase();

  // 3. The caller must be in an open call in this chat (RLS: own calls only).
  const { data: call, error } = await supabase
    .from("calls")
    .select("id")
    .eq("chat_id", chatId)
    .in("status", ["ringing", "accepted"])
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .limit(1)
    .maybeSingle();
  if (error) return fail(500, "Something went wrong. Please try again.");
  if (!call) return fail(403, "There's no active call in this chat.");

  // 4. Sign.
  const config = getAgoraConfig();
  if (!config) return fail(503, "Voice calls aren't configured yet.");

  try {
    const token = buildRtcToken(config, channelName, userId);
    return NextResponse.json<AgoraTokenResponse>(
      { appId: config.appId, token, channelName, uid: userId, expiresIn: AGORA_TOKEN_TTL_SECONDS },
      { headers: NO_STORE },
    );
  } catch (e) {
    console.error("Agora token build failed:", e instanceof Error ? e.message : e);
    return fail(500, "Couldn't prepare the call. Please try again.");
  }
}

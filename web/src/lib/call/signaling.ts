import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { asCallType, isCallStatus, type CallRow, type CallSignal, type CallType } from "@/lib/call/types";

// Call signaling over Supabase: RPCs change state (server-validated) and
// postgres_changes on `calls` deliver every change to both parties.

type Client = SupabaseClient<Database>;

/** Maps a `calls` row change to a signaling event for user `meId`. */
export function toSignal(meId: string, event: "INSERT" | "UPDATE", call: CallRow): CallSignal | null {
  if (!isCallStatus(call.status)) return null;
  switch (call.status) {
    case "active":
      return null; // group room pings; the room's own UI polls get_group_call
    case "ringing":
      if (event !== "INSERT") return null;
      return call.caller_id === meId ? { type: "call:outgoing", call } : { type: "call:incoming", call };
    case "accepted":
      return { type: "call:accepted", call };
    case "declined":
      return { type: "call:declined", call };
    case "cancelled":
    case "missed":
    case "ended":
      return { type: "call:ended", call };
  }
}

/** Streams signals for every call the user is a party to. Returns an unsubscribe. */
export function subscribeToCalls(
  supabase: Client,
  meId: string,
  onSignal: (signal: CallSignal) => void,
  onSubscribed: () => void,
) {
  const handle = (payload: RealtimePostgresChangesPayload<CallRow>) => {
    if (payload.eventType !== "INSERT" && payload.eventType !== "UPDATE") return;
    const signal = toSignal(meId, payload.eventType, payload.new);
    if (signal) onSignal(signal);
  };

  const channel = supabase
    .channel(`calls:${meId}`)
    .on<CallRow>("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `callee_id=eq.${meId}` }, handle)
    .on<CallRow>("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `caller_id=eq.${meId}` }, handle)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onSubscribed();
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export type StartCallResult =
  | { ok: true; call: CallRow }
  | { ok: false; reason: "callee-busy" | "caller-busy" | "call-full" | "unavailable" | "error" };

export async function startCall(supabase: Client, chatId: string, callType: CallType): Promise<StartCallResult> {
  const { data, error } = await supabase.rpc("start_call", { p_chat_id: chatId, p_call_type: callType });
  if (!error && data) return { ok: true, call: data };
  if (error?.message === "callee busy") return { ok: false, reason: "callee-busy" };
  if (error?.message === "caller busy") return { ok: false, reason: "caller-busy" };
  if (error?.message === "call full") return { ok: false, reason: "call-full" };
  if (error?.code === "P0002") return { ok: false, reason: "unavailable" };
  return { ok: false, reason: "error" };
}

/** Returns the updated call, or null if it is no longer ringing. */
export async function answerCall(supabase: Client, callId: string, accept: boolean) {
  const { data, error } = await supabase.rpc("answer_call", { p_call_id: callId, p_accept: accept });
  return error ? null : data;
}

export async function endCall(supabase: Client, callId: string, timeout = false) {
  const { error } = await supabase.rpc("end_call", { p_call_id: callId, p_timeout: timeout });
  return !error;
}

/** false = the call is closed on the server (the other side hung up). */
export async function heartbeatCall(supabase: Client, callId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc("heartbeat_call", { p_call_id: callId });
  return error ? null : data; // null: network hiccup, try again next beat
}

export type ActiveGroupCall = {
  callId: string;
  callType: CallType;
  startedAt: string;
  participantIds: string[];
};

/** The group's ongoing call, if any (also closes a room everyone abandoned). */
export async function fetchGroupCall(supabase: Client, chatId: string): Promise<ActiveGroupCall | null> {
  const { data, error } = await supabase.rpc("get_group_call", { p_chat_id: chatId });
  const row = error ? null : data?.[0];
  if (!row) return null;
  return {
    callId: row.call_id,
    callType: asCallType(row.call_type),
    startedAt: row.started_at,
    participantIds: row.participant_ids ?? [],
  };
}

/** Fires whenever a call row in this chat changes (group rooms ping it on join/leave). */
export function subscribeToChatCalls(supabase: Client, chatId: string, onChange: () => void) {
  const channel = supabase
    .channel(`chat-calls:${chatId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `chat_id=eq.${chatId}` }, onChange)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** Calls still ringing for me (e.g. they started before this page loaded). */
export async function fetchRingingCalls(supabase: Client, meId: string) {
  const since = new Date(Date.now() - 40_000).toISOString();
  const { data } = await supabase
    .from("calls")
    .select("*")
    .eq("callee_id", meId)
    .eq("status", "ringing")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  return data ?? [];
}

export async function fetchCall(supabase: Client, callId: string) {
  const { data } = await supabase.from("calls").select("*").eq("id", callId).maybeSingle();
  return data;
}

/**
 * Best-effort hang-up while the page is being unloaded, when awaiting a
 * supabase-js call is no longer possible. `keepalive` lets it outlive the page.
 */
export function endCallOnUnload(callId: string, accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return;
  void fetch(`${url}/rest/v1/rpc/end_call`, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ p_call_id: callId, p_timeout: false }),
  }).catch(() => {});
}

import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isCallStatus, type CallRow, type CallSignal } from "@/lib/call/types";

// Call signaling over Supabase: RPCs change state (server-validated) and
// postgres_changes on `calls` deliver every change to both parties.

type Client = SupabaseClient<Database>;

/** Maps a `calls` row change to a signaling event for user `meId`. */
export function toSignal(meId: string, event: "INSERT" | "UPDATE", call: CallRow): CallSignal | null {
  if (!isCallStatus(call.status)) return null;
  switch (call.status) {
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
  | { ok: false; reason: "callee-busy" | "caller-busy" | "unavailable" | "error" };

export async function startCall(supabase: Client, chatId: string): Promise<StartCallResult> {
  const { data, error } = await supabase.rpc("start_call", { p_chat_id: chatId });
  if (!error && data) return { ok: true, call: data };
  if (error?.message === "callee busy") return { ok: false, reason: "callee-busy" };
  if (error?.message === "caller busy") return { ok: false, reason: "caller-busy" };
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

import { Api } from "../lib/api";
import { supabase } from "../lib/supabase";
import { type ActiveGroupCall, type CallRow, callFromRow } from "../models/types";

type Row = Record<string, unknown>;

export type AgoraToken = { appId: string; token: string; channelName: string; uid: string };

/** Why start_call refused: callee-busy | caller-busy | call-full | unavailable | error */
export class StartCallError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Call signaling over Supabase (see web/src/lib/call/signaling.ts): RPCs
 * change state server-side; row changes on `calls` arrive over the app's
 * single Realtime channel (state/realtime.ts).
 */
export const CallRepo = {
  channelName: (chatId: string) => `call_${chatId}`,

  /** 1-on-1: rings the other person. Group: joins (or opens) the room. */
  async start(chatId: string, callType: "voice" | "video"): Promise<CallRow> {
    const { data, error } = await supabase.rpc("start_call", { p_chat_id: chatId, p_call_type: callType });
    if (error) {
      const reason =
        error.message === "callee busy"
          ? "callee-busy"
          : error.message === "caller busy"
            ? "caller-busy"
            : error.message === "call full"
              ? "call-full"
              : error.code === "P0002"
                ? "unavailable"
                : "error";
      throw new StartCallError(reason);
    }
    return callFromRow(data as Row);
  },

  /** The updated call, or null if it is no longer ringing. */
  async answer(callId: string, accept: boolean): Promise<CallRow | null> {
    try {
      const { data, error } = await supabase.rpc("answer_call", { p_call_id: callId, p_accept: accept });
      return error || !data ? null : callFromRow(data as Row);
    } catch {
      return null;
    }
  },

  /** Hang up / cancel (1-on-1) or leave the room (group). */
  async end(callId: string, timeout = false) {
    try {
      await supabase.rpc("end_call", { p_call_id: callId, p_timeout: timeout });
    } catch {}
  },

  /** false = closed on the server; null = network hiccup. */
  async heartbeat(callId: string): Promise<boolean | null> {
    try {
      const { data, error } = await supabase.rpc("heartbeat_call", { p_call_id: callId });
      return error ? null : (data as boolean);
    } catch {
      return null;
    }
  },

  async groupCall(chatId: string): Promise<ActiveGroupCall | null> {
    try {
      const { data, error } = await supabase.rpc("get_group_call", { p_chat_id: chatId });
      const row = !error && Array.isArray(data) ? (data[0] as Row | undefined) : undefined;
      if (!row) return null;
      return {
        callId: String(row.call_id),
        callType: row.call_type === "video" ? "video" : "voice",
        participantIds: Array.isArray(row.participant_ids) ? row.participant_ids.map(String) : [],
      };
    } catch {
      return null;
    }
  },

  /** A call still ringing for me (started before the app was open). */
  async ringingForMe(meId: string): Promise<CallRow | null> {
    try {
      const since = new Date(Date.now() - 40_000).toISOString();
      const { data } = await supabase
        .from("calls")
        .select()
        .eq("callee_id", meId)
        .eq("status", "ringing")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0] ? callFromRow(data[0] as Row) : null;
    } catch {
      return null;
    }
  },

  async fetch(callId: string): Promise<CallRow | null> {
    const { data } = await supabase.from("calls").select().eq("id", callId).maybeSingle();
    return data ? callFromRow(data as Row) : null;
  },

  async token(chatId: string): Promise<AgoraToken> {
    const data = await Api.post("/api/agora/token", { channelName: CallRepo.channelName(chatId) });
    return {
      appId: String(data.appId),
      token: String(data.token),
      channelName: String(data.channelName),
      uid: String(data.uid),
    };
  },

  /** Call history: newest 50, with both parties' profiles and my participation (group rooms). */
  async history(meId: string): Promise<Row[]> {
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, chat_id, caller_id, callee_id, call_type, status, is_group, created_at, answered_at, ended_at, " +
          "caller:profiles!calls_caller_id_fkey(id, username, display_name, avatar_url), " +
          "callee:profiles!calls_callee_id_fkey(id, username, display_name, avatar_url), " +
          "call_participants(user_id)",
      )
      .eq("call_participants.user_id", meId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as unknown as Row[];
  },
};

import type { Database } from "@/lib/database.types";
import type { PublicProfile } from "@/lib/chat";

// Shared (client + server) call types (voice and video).

export type CallRow = Database["public"]["Tables"]["calls"]["Row"];

/** "active" is a group call in progress (group calls never ring). */
export const CALL_STATUSES = ["ringing", "accepted", "declined", "cancelled", "missed", "ended", "active"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export type CallType = "voice" | "video";
export const asCallType = (value: string | null | undefined): CallType => (value === "video" ? "video" : "voice");
export const callTypeOf = (call: Pick<CallRow, "call_type">) => asCallType(call.call_type);

export const isCallStatus = (value: string): value is CallStatus =>
  (CALL_STATUSES as readonly string[]).includes(value);

/** Signaling events derived from `calls` row changes (see the Phase 5 migration). */
export type CallSignal =
  | { type: "call:outgoing"; call: CallRow }
  | { type: "call:incoming"; call: CallRow }
  | { type: "call:accepted"; call: CallRow }
  | { type: "call:declined"; call: CallRow }
  | { type: "call:ended"; call: CallRow };

/** The person on the other end, plus the chat the call belongs to. */
export type CallPeer = PublicProfile & { chatId: string };

/** A group chat to call, with its members (to name everyone in the room). */
export type GroupCallInfo = { chatId: string; title: string; members: PublicProfile[] };

/** Where a call button points. */
export type CallTarget = { kind: "direct"; peer: CallPeer | null } | { kind: "group"; group: GroupCallInfo };

/** Why a call finished, from the local user's point of view. */
export type CallEndReason =
  | "hangup" // someone hung up an active call
  | "declined" // the callee declined
  | "cancelled" // the caller gave up before an answer
  | "no-answer" // ring timeout
  | "busy" // callee is in another call
  | "answered-elsewhere" // accepted/declined in another tab
  | "connection-lost"
  | "mic-error"
  | "error";

export type CallPhase =
  | { phase: "idle" }
  /** Opening the mic and creating the call row. */
  | { phase: "starting"; peer: CallPeer; callType: CallType }
  | { phase: "outgoing"; call: CallRow; peer: CallPeer }
  | { phase: "incoming"; call: CallRow; peer: CallPeer }
  | { phase: "connecting"; call: CallRow; peer: CallPeer }
  | { phase: "active"; call: CallRow; peer: CallPeer; connectedAt: number; reconnecting: boolean }
  /** In a group room. `call` is null until start_call returns. */
  | {
      phase: "group";
      call: CallRow | null;
      group: GroupCallInfo;
      callType: CallType;
      status: "joining" | "live";
      reconnecting: boolean;
    }
  | {
      phase: "ended";
      /** For group calls, a stand-in "peer" named after the group. */
      peer: CallPeer;
      callType: CallType;
      group: boolean;
      reason: CallEndReason;
      message: string;
    };

/** Agora channel names are `call_<chatId>`. */
export const callChannelName = (chatId: string) => `call_${chatId}`;
export const CALL_CHANNEL_PATTERN =
  /^call_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** How long an outgoing call rings before it counts as missed. */
export const RING_TIMEOUT_MS = 30_000;
/** Heartbeat interval while connected (the server treats > 45 s as gone). */
export const HEARTBEAT_MS = 15_000;

// --- /api/agora/token -------------------------------------------------------

export type AgoraTokenRequest = { channelName: string };
export type AgoraTokenResponse = {
  appId: string;
  token: string;
  channelName: string;
  /** Agora string user account: the caller's Supabase user id. */
  uid: string;
  expiresIn: number;
};
export type AgoraTokenError = { error: string };

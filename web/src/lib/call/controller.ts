import type { SupabaseClient } from "@supabase/supabase-js";
import { profileName } from "@/lib/chat";
import type { Database } from "@/lib/database.types";
import type { ICameraVideoTrack, ILocalVideoTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import {
  CallError,
  CallSession,
  screenShareSupported,
  type MediaDevices,
  type RemoteParticipant,
} from "@/lib/call/agora-client";
import { playTone } from "@/lib/call/ringtone";
import {
  answerCall,
  endCall,
  endCallOnUnload,
  fetchCall,
  fetchRingingCalls,
  heartbeatCall,
  joinScreenShareRoom,
  startCall,
  type ScreenShareRoom,
  toSignal,
} from "@/lib/call/signaling";
import {
  HEARTBEAT_MS,
  RING_TIMEOUT_MS,
  callChannelName,
  callTypeOf,
  type CallEndReason,
  type CallPeer,
  type CallPhase,
  type CallRow,
  type CallSignal,
  type CallType,
  type GroupCallInfo,
} from "@/lib/call/types";

// The call state machine (voice and video). Framework-free so its timers and async steps
// never see stale React state; React reads it through useSyncExternalStore.
//
//   idle ─start→ starting ─row→ outgoing ─accepted→ connecting ─peer joined→ active
//   idle ─incoming→ incoming ─accept→ connecting ─peer joined→ active
//   idle ─startGroup→ group(joining) ─channel joined→ group(live)   (no ringing)
//   any non-idle ─(hang up | declined | timeout | drop)→ ended ─2.5 s→ idle

export type MediaState = {
  muted: boolean;
  devices: MediaDevices;
  microphoneId: string | null;
  speakerId: string | null;
  autoplayBlocked: boolean;
  /** Our camera is capturing and published. */
  cameraOn: boolean;
  /** A camera on/off switch is in flight. */
  cameraBusy: boolean;
  cameraId: string | null;
  /** Why video isn't available (permission denied, unplugged...). */
  cameraError: string | null;
  /** The other person is sending video. */
  remoteVideoOn: boolean;
  /** This browser can capture the screen (false on mobile browsers). */
  screenShareSupported: boolean;
  /** We're sharing our screen (it replaces our camera in the call). */
  screenSharing: boolean;
  /** Screen share start/stop in flight (the picker may be open). */
  screenBusy: boolean;
  /** Why screen sharing couldn't start. */
  screenError: string | null;
  /** While sharing: the camera comes back on when sharing stops. */
  cameraResumesAfterShare: boolean;
  /** Everyone else who is sharing their screen right now (user ids). */
  remoteScreenUids: string[];
  /** Bumped whenever a video track appears or goes away, to re-render players. */
  videoVersion: number;
};

export type CallSnapshot = { call: CallPhase; media: MediaState };

const INITIAL_MEDIA: MediaState = {
  muted: false,
  devices: { microphones: [], speakers: [], cameras: [] },
  microphoneId: null,
  speakerId: null,
  autoplayBlocked: false,
  cameraOn: false,
  cameraBusy: false,
  cameraId: null,
  cameraError: null,
  remoteVideoOn: false,
  screenShareSupported: false,
  screenSharing: false,
  screenBusy: false,
  screenError: null,
  cameraResumesAfterShare: false,
  remoteScreenUids: [],
  videoVersion: 0,
};

/** A remote participant, plus whether their video is a shared screen. */
export type CallParticipant = RemoteParticipant & { screen: boolean };

export const IDLE_SNAPSHOT: CallSnapshot = { call: { phase: "idle" }, media: INITIAL_MEDIA };

/** If the media link isn't up this long after an answer, give up. */
const CONNECT_TIMEOUT_MS = 20_000;
const ENDED_BANNER_MS = 2_500;

type Client = SupabaseClient<Database>;
type FinishOptions = { notifyServer?: boolean; timeout?: boolean; message?: string };

export class CallController {
  private snapshot: CallSnapshot = IDLE_SNAPSHOT;
  private listeners = new Set<() => void>();
  private session: CallSession | null = null;
  private screenRoom: ScreenShareRoom | null = null;
  private stopTone: (() => void) | null = null;
  private timers = new Map<"ring" | "connect" | "heartbeat" | "dismiss" | "incoming", number>();
  /** Bumped whenever a call finishes, so in-flight async steps can bail out. */
  private generation = 0;
  private accessToken: string | null = null;
  private destroyed = false;

  constructor(
    private readonly supabase: Client,
    readonly meId: string,
  ) {}

  // --- Store ------------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(call: CallPhase, media: Partial<MediaState> = {}) {
    this.snapshot = { call, media: { ...this.snapshot.media, ...media } };
    this.listeners.forEach((l) => l());
  }

  private setMedia(media: Partial<MediaState>) {
    this.set(this.snapshot.call, media);
  }

  private get call() {
    return this.snapshot.call;
  }

  /** The call row we are currently handling, if any. */
  private get currentRow(): CallRow | null {
    const c = this.call;
    if (c.phase === "group") return c.call;
    return c.phase === "outgoing" || c.phase === "incoming" || c.phase === "connecting" || c.phase === "active"
      ? c.call
      : null;
  }

  get inCall() {
    return this.call.phase !== "idle" && this.call.phase !== "ended";
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  /** Our camera track for the local preview (null while the camera is off). */
  get localVideoTrack(): ICameraVideoTrack | null {
    return this.session?.localVideoTrack ?? null;
  }

  /** The other person's video track (null while they aren't sending video). */
  get remoteVideoTrack(): IRemoteVideoTrack | null {
    return this.session?.remoteVideoTrack ?? null;
  }

  /** Our shared screen while sharing (null otherwise). */
  get localScreenTrack(): ILocalVideoTrack | null {
    return this.session?.screenTrack ?? null;
  }

  /** Everyone else in the room, with their tracks and screen-share flag. */
  get remoteParticipants(): CallParticipant[] {
    const sharing = this.snapshot.media.remoteScreenUids;
    return (this.session?.remoteParticipants ?? []).map((p) => ({
      ...p,
      screen: !!p.videoTrack && sharing.includes(p.uid),
    }));
  }

  // --- User actions -----------------------------------------------------------

  start = async (peer: CallPeer, callType: CallType = "voice") => {
    if (this.inCall || this.destroyed) return;
    this.clearTimer("dismiss");
    const gen = ++this.generation;
    this.set({ phase: "starting", peer, callType }, INITIAL_MEDIA);

    // 1. Devices first: fail fast (and never ring someone) without a mic.
    //    A missing camera doesn't stop a video call; it starts without video.
    const session = await this.openSession(gen, callType === "video");
    if (!session) return;

    // 2. Create the call row (server checks membership and busy state).
    const result = await startCall(this.supabase, peer.chatId, callType);
    if (gen !== this.generation) {
      // Hung up while we were waiting.
      if (result.ok) void endCall(this.supabase, result.call.id);
      return;
    }
    if (!result.ok) {
      const messages = {
        "callee-busy": `${profileName(peer)} is on another call.`,
        "caller-busy": "You're already in a call (maybe in another tab).",
        "call-full": "This call is full.",
        unavailable: "You can't call this chat.",
        error: "Couldn't start the call. Please try again.",
      } as const;
      this.finish(result.reason === "callee-busy" ? "busy" : "error", { message: messages[result.reason] });
      return;
    }

    this.set({ phase: "outgoing", call: result.call, peer });
    this.tone("ringback");
    this.setTimer("ring", RING_TIMEOUT_MS, () => {
      if (this.call.phase === "outgoing") this.finish("no-answer", { notifyServer: true, timeout: true });
    });

    // 3. Join the media channel while it rings, so the answer connects instantly.
    void this.joinChannel(gen, peer.chatId);
  };

  /**
   * Join the group's ongoing call, or start one. There's no ringing: other
   * members see an "ongoing" pill and drop in. If a call is already running,
   * its type wins (joining a video call from the voice button, or vice versa).
   */
  startGroup = async (group: GroupCallInfo, callType: CallType = "voice") => {
    if (this.inCall || this.destroyed) return;
    this.clearTimer("dismiss");
    const gen = ++this.generation;
    const joining = { phase: "group", group, status: "joining", reconnecting: false } as const;
    this.set({ ...joining, call: null, callType }, INITIAL_MEDIA);

    const session = await this.openSession(gen, callType === "video");
    if (!session) return;

    const result = await startCall(this.supabase, group.chatId, callType);
    if (gen !== this.generation) {
      if (result.ok) void endCall(this.supabase, result.call.id); // left while joining
      return;
    }
    if (!result.ok) {
      const messages = {
        "callee-busy": "Someone in the call is busy.",
        "caller-busy": "You're already in a call (maybe in another tab).",
        "call-full": "This call is full.",
        unavailable: "You can't call this group.",
        error: "Couldn't join the call. Please try again.",
      } as const;
      this.finish(result.reason === "caller-busy" ? "busy" : "error", { message: messages[result.reason] });
      return;
    }

    // Joined a call of the other type: match it (camera stays user-controlled).
    const actualType = callTypeOf(result.call);
    if (actualType === "voice" && callType === "video") await session.setCameraEnabled(false).catch(() => {});
    if (gen !== this.generation) return;
    this.set({ ...joining, call: result.call, callType: actualType });
    this.syncVideo();
    this.startConnectedTimers(gen); // heartbeat keeps our seat in the room

    if (!(await this.joinChannel(gen, group.chatId))) return;
    const c = this.call;
    if (gen === this.generation && c.phase === "group") this.set({ ...c, status: "live" });
  };

  accept = async () => {
    const c = this.call;
    if (c.phase !== "incoming") return;
    const gen = this.generation;
    this.stopRinging();
    this.clearTimer("incoming");
    this.set({ phase: "connecting", call: c.call, peer: c.peer }, INITIAL_MEDIA);

    const session = await this.openSession(gen, callTypeOf(c.call) === "video", () => {
      // Decline so the caller isn't left ringing.
      void endCall(this.supabase, c.call.id);
    });
    if (!session) return;

    const answered = await answerCall(this.supabase, c.call.id, true);
    if (gen !== this.generation) return;
    if (!answered) {
      this.finish("cancelled", { message: "This call is no longer available." });
      return;
    }
    this.set({ phase: "connecting", call: answered, peer: c.peer });
    this.startConnectedTimers(gen);
    void this.joinChannel(gen, c.peer.chatId);
  };

  decline = () => {
    const c = this.call;
    if (c.phase !== "incoming") return;
    void answerCall(this.supabase, c.call.id, false);
    this.finish("declined", { message: "Call declined" });
  };

  hangUp = () => {
    const c = this.call;
    switch (c.phase) {
      case "starting":
        this.finish("cancelled", { message: "Call cancelled" });
        break;
      case "outgoing":
        this.finish("cancelled", { notifyServer: true, message: "Call cancelled" });
        break;
      case "incoming":
        this.decline();
        break;
      case "connecting":
      case "active":
        this.finish("hangup", { notifyServer: true });
        break;
      case "group":
        this.finish("hangup", { notifyServer: true, message: "You left the call" });
        break;
      case "ended":
        this.dismiss();
        break;
    }
  };

  dismiss = () => {
    if (this.call.phase !== "ended") return;
    this.clearTimer("dismiss");
    this.set({ phase: "idle" }, INITIAL_MEDIA);
  };

  /** Camera on/off mid-call. Turning it off releases the device entirely. */
  toggleCamera = async () => {
    const session = this.session;
    if (!session || this.snapshot.media.cameraBusy) return;
    const { screenSharing, cameraResumesAfterShare, cameraOn } = this.snapshot.media;
    // While sharing, the button decides whether the camera returns afterwards.
    const enable = screenSharing ? !cameraResumesAfterShare : !cameraOn;
    this.setMedia({ cameraBusy: true, cameraError: null });
    try {
      await session.setCameraEnabled(enable);
    } catch (e) {
      if (this.session === session) {
        this.setMedia({ cameraError: e instanceof CallError ? e.message : "Couldn't start your camera." });
      }
    } finally {
      if (this.session === session) this.syncVideo({ cameraBusy: false });
    }
  };

  setCamera = async (deviceId: string) => {
    const session = this.session;
    if (!session) return;
    const previous = this.snapshot.media.cameraId;
    this.setMedia({ cameraId: deviceId });
    try {
      await session.setCamera(deviceId);
    } catch {
      if (this.session === session) {
        this.setMedia({ cameraId: previous, cameraError: "Couldn't switch to that camera." });
      }
    }
  };

  dismissCameraError = () => this.setMedia({ cameraError: null });

  /**
   * Share screen / stop sharing. The screen replaces our camera while
   * sharing; the mic keeps going throughout. Closing the browser's picker
   * just leaves things as they were.
   */
  toggleScreenShare = async () => {
    const session = this.session;
    if (!session || this.snapshot.media.screenBusy) return;
    this.setMedia({ screenBusy: true, screenError: null });
    try {
      if (session.isScreenSharing) await session.stopScreenShare();
      else await session.startScreenShare(); // "cancelled" needs no message
    } catch (e) {
      if (this.session === session) {
        this.setMedia({ screenError: e instanceof CallError ? e.message : "Couldn't start screen sharing." });
      }
    } finally {
      if (this.session === session) this.syncVideo({ screenBusy: false });
    }
  };

  dismissScreenError = () => this.setMedia({ screenError: null });

  toggleMute = async () => {
    if (!this.session) return;
    const muted = !this.snapshot.media.muted;
    this.setMedia({ muted });
    try {
      await this.session.setMuted(muted);
    } catch {
      this.setMedia({ muted: !muted });
    }
  };

  setMicrophone = async (deviceId: string) => {
    if (!this.session) return;
    const previous = this.snapshot.media.microphoneId;
    this.setMedia({ microphoneId: deviceId });
    try {
      await this.session.setMicrophone(deviceId);
    } catch {
      this.setMedia({ microphoneId: previous });
    }
  };

  setSpeaker = async (deviceId: string) => {
    if (!this.session) return;
    const previous = this.snapshot.media.speakerId;
    this.setMedia({ speakerId: deviceId });
    try {
      await this.session.setSpeaker(deviceId);
    } catch {
      this.setMedia({ speakerId: previous });
    }
  };

  resumePlayback = () => {
    this.session?.resumePlayback();
    this.setMedia({ autoplayBlocked: false });
  };

  // --- Signaling --------------------------------------------------------------

  handleSignal = (signal: CallSignal) => {
    if (this.destroyed) return;
    const current = this.currentRow;
    const c = this.call;

    if (signal.type === "call:incoming") {
      // The server never rings a busy user; this guards against stale rows.
      if (this.inCall) return;
      void this.ring(signal.call);
      return;
    }
    if (signal.type === "call:outgoing") return; // our own start(), already handled
    if (!current || current.id !== signal.call.id) return;

    switch (signal.type) {
      case "call:accepted":
        if (c.phase === "outgoing") {
          this.stopRinging();
          this.clearTimer("ring");
          this.set({ phase: "connecting", call: signal.call, peer: c.peer });
          this.startConnectedTimers(this.generation);
          if (this.session?.remotePresent) this.markActive();
        } else if (c.phase === "incoming") {
          this.finish("answered-elsewhere"); // answered in another tab
        }
        // connecting/active: just a heartbeat
        break;
      case "call:declined":
        if (c.phase === "outgoing") this.finish("declined", { message: `${profileName(c.peer)} declined the call` });
        else if (c.phase === "incoming") this.finish("answered-elsewhere");
        break;
      case "call:ended":
        if (c.phase === "group") {
          this.finish("hangup", { message: "Call ended" });
        } else if (c.phase === "incoming") {
          this.finish("cancelled", { message: `Missed call from ${profileName(c.peer)}` });
        } else if (c.phase === "connecting" || c.phase === "active") {
          this.finish("hangup");
        } else if (c.phase === "outgoing") {
          this.finish(signal.call.status === "missed" ? "no-answer" : "cancelled");
        }
        break;
    }
  };

  /** After (re)subscribing: pick up anything we missed while disconnected. */
  resync = async () => {
    const current = this.currentRow;
    if (current) {
      const row = await fetchCall(this.supabase, current.id);
      if (!row) return;
      const signal = toSignal(this.meId, "UPDATE", row);
      if (signal && row.status !== "ringing") this.handleSignal(signal);
      return;
    }
    if (this.inCall) return;
    const [ringing] = await fetchRingingCalls(this.supabase, this.meId);
    if (ringing && !this.inCall) void this.ring(ringing);
  };

  /** The page is going away: tell the server now, since nothing can be awaited. */
  handleUnload = () => {
    const row = this.currentRow;
    // An incoming call is left ringing: another tab may still answer it.
    if (row && this.accessToken && this.call.phase !== "incoming") {
      endCallOnUnload(row.id, this.accessToken);
    }
    void this.session?.leave();
  };

  destroy() {
    if (this.destroyed) return;
    const row = this.currentRow;
    if (row && this.call.phase !== "incoming") void endCall(this.supabase, row.id);
    this.teardown();
    this.destroyed = true;
    this.listeners.clear();
  }

  // --- Internals --------------------------------------------------------------

  private async ring(row: CallRow) {
    const gen = this.generation;
    const { data: profile } = await this.supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url")
      .eq("id", row.caller_id)
      .maybeSingle();
    if (gen !== this.generation || this.inCall || this.destroyed) return;

    const peer: CallPeer = {
      id: row.caller_id,
      username: profile?.username ?? null,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      chatId: row.chat_id,
    };
    this.clearTimer("dismiss");
    this.set({ phase: "incoming", call: row, peer }, INITIAL_MEDIA);
    this.tone("ring");

    // The caller marks it missed; this covers a caller whose tab died.
    const age = Date.now() - new Date(row.created_at).getTime();
    this.setTimer("incoming", Math.max(5_000, RING_TIMEOUT_MS + 5_000 - age), () => {
      if (this.call.phase === "incoming") this.finish("cancelled", { message: `Missed call from ${profileName(peer)}` });
    });
  }

  /** Opens the mic (and camera). On mic failure finishes the call and returns null. */
  private async openSession(gen: number, video: boolean, onMicFailure?: () => void): Promise<CallSession | null> {
    try {
      const { session, cameraError } = await CallSession.create({
        onRemoteJoined: () => {
          if (gen === this.generation) this.markActive();
        },
        onRemoteLeft: (_uid, reason) => {
          if (gen !== this.generation) return;
          // In a group room people come and go; only 1-on-1 calls end here.
          if (this.call.phase !== "active" && this.call.phase !== "connecting") return;
          this.finish(reason === "Quit" ? "hangup" : "connection-lost", { notifyServer: true });
        },
        onReconnecting: (reconnecting) => {
          const c = this.call;
          if (gen !== this.generation) return;
          if (c.phase === "active" || c.phase === "group") this.set({ ...c, reconnecting });
        },
        onDisconnected: () => {
          if (gen === this.generation) this.finish("connection-lost", { notifyServer: true });
        },
        onDevicesChanged: (devices) => {
          if (gen === this.generation) this.setMedia({ devices, microphoneId: this.session?.microphoneId ?? null });
        },
        onAutoplayBlocked: () => {
          if (gen === this.generation) this.setMedia({ autoplayBlocked: true });
        },
        onRemoteChanged: () => {
          if (gen === this.generation) this.syncVideo();
        },
        onLocalVideoChanged: () => {
          if (gen === this.generation) this.syncVideo();
        },
        onCameraError: (message) => {
          if (gen === this.generation) this.syncVideo({ cameraError: message });
        },
        onScreenShareEnded: () => {
          if (gen === this.generation) this.syncVideo();
        },
      }, { video });
      if (gen !== this.generation) {
        void session.leave(); // releases mic + camera
        return null;
      }
      this.session = session;
      this.syncVideo({ cameraError, screenShareSupported: screenShareSupported() });
      const devices = await session.listDevices();
      if (gen === this.generation) this.setMedia({ devices, microphoneId: session.microphoneId || null });
      return session;
    } catch (e) {
      if (gen !== this.generation) return null;
      onMicFailure?.();
      const message = e instanceof CallError ? e.message : "Couldn't start your microphone.";
      this.finish("mic-error", { message });
      return null;
    }
  }

  /** Copies the session's video state into the snapshot. */
  private syncVideo(extra: Partial<MediaState> = {}) {
    const session = this.session;
    const screenSharing = !!session?.isScreenSharing;
    this.screenRoom?.setSharing(screenSharing);
    this.setMedia({
      cameraOn: !!session?.localVideoTrack,
      screenSharing,
      cameraResumesAfterShare: !!session?.cameraResumesAfterShare,
      cameraId: session?.currentCameraId ?? this.snapshot.media.cameraId,
      remoteVideoOn: !!session?.remoteVideoTrack,
      videoVersion: this.snapshot.media.videoVersion + 1,
      ...extra,
    });
  }

  /** Joins the Agora channel; on failure ends the call. Returns whether it worked. */
  private async joinChannel(gen: number, chatId: string): Promise<boolean> {
    const session = this.session;
    if (!session) return false;
    // Who's presenting travels over Realtime presence, not Agora.
    this.screenRoom?.leave();
    this.screenRoom = joinScreenShareRoom(this.supabase, chatId, this.meId, (uids) => {
      if (gen !== this.generation) return;
      const current = this.snapshot.media.remoteScreenUids;
      if (uids.length === current.length && uids.every((u) => current.includes(u))) return;
      this.syncVideo({ remoteScreenUids: uids });
    });
    this.screenRoom.setSharing(session.isScreenSharing);
    try {
      await session.join(callChannelName(chatId));
      return gen === this.generation;
    } catch (e) {
      if (gen !== this.generation) return false;
      const message = e instanceof CallError ? e.message : "Couldn't connect the call.";
      this.finish("error", { notifyServer: true, message });
      return false;
    }
  }

  /** Both sides are in the channel: the call is live. */
  private markActive() {
    const c = this.call;
    if (c.phase !== "connecting") return; // outgoing waits for call:accepted
    this.clearTimer("connect");
    this.set({ phase: "active", call: c.call, peer: c.peer, connectedAt: Date.now(), reconnecting: false });
  }

  private startConnectedTimers(gen: number) {
    this.setTimer("connect", CONNECT_TIMEOUT_MS, () => {
      if (gen === this.generation && this.call.phase === "connecting") {
        this.finish("connection-lost", { notifyServer: true, message: "Couldn't connect the call." });
      }
    });
    const beat = async () => {
      const row = this.currentRow;
      if (gen !== this.generation || !row) return;
      const alive = await heartbeatCall(this.supabase, row.id);
      if (alive === false && gen === this.generation) this.finish("hangup");
    };
    this.clearTimer("heartbeat");
    this.timers.set("heartbeat", window.setInterval(beat, HEARTBEAT_MS));
  }

  private finish(reason: CallEndReason, { notifyServer = false, timeout = false, message }: FinishOptions = {}) {
    const c = this.call;
    if (c.phase === "idle" || c.phase === "ended") return;
    const row = this.currentRow;
    if (notifyServer && row) void endCall(this.supabase, row.id, timeout);

    this.generation++;
    this.teardown();

    if (reason === "answered-elsewhere") {
      this.set({ phase: "idle" }, INITIAL_MEDIA);
      return;
    }
    const callType = c.phase === "starting" || c.phase === "group" ? c.callType : callTypeOf(c.call);
    const peer =
      c.phase === "group"
        ? { id: c.group.chatId, username: null, displayName: c.group.title, avatarUrl: null, chatId: c.group.chatId }
        : c.peer;
    this.set(
      {
        phase: "ended",
        peer,
        callType,
        group: c.phase === "group",
        reason,
        message: message ?? defaultMessage(reason),
      },
      {
        cameraOn: false,
        remoteVideoOn: false,
        screenSharing: false,
        screenBusy: false,
        remoteScreenUids: [],
        videoVersion: this.snapshot.media.videoVersion + 1,
      },
    );
    this.setTimer("dismiss", ENDED_BANNER_MS, () => this.set({ phase: "idle" }, INITIAL_MEDIA));
  }

  private teardown() {
    this.stopRinging();
    for (const key of ["ring", "connect", "incoming", "dismiss"] as const) this.clearTimer(key);
    this.clearTimer("heartbeat");
    this.screenRoom?.leave();
    this.screenRoom = null;
    const session = this.session;
    this.session = null;
    void session?.leave(); // also closes any screen track
  }

  private tone(kind: "ring" | "ringback") {
    this.stopRinging();
    this.stopTone = playTone(kind);
  }

  private stopRinging() {
    this.stopTone?.();
    this.stopTone = null;
  }

  private setTimer(key: "ring" | "connect" | "dismiss" | "incoming", ms: number, fn: () => void) {
    this.clearTimer(key);
    this.timers.set(key, window.setTimeout(fn, ms));
  }

  private clearTimer(key: "ring" | "connect" | "heartbeat" | "dismiss" | "incoming") {
    const id = this.timers.get(key);
    if (id === undefined) return;
    // clearTimeout and clearInterval share one id pool.
    window.clearTimeout(id);
    this.timers.delete(key);
  }
}

function defaultMessage(reason: CallEndReason): string {
  switch (reason) {
    case "hangup":
      return "Call ended";
    case "declined":
      return "Call declined";
    case "cancelled":
      return "Call cancelled";
    case "no-answer":
      return "No answer";
    case "busy":
      return "On another call";
    case "connection-lost":
      return "Connection lost";
    case "mic-error":
      return "Microphone unavailable";
    case "answered-elsewhere":
    case "error":
      return "Call failed";
  }
}

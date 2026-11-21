import { Alert, AppState, Linking, PermissionsAndroid, Platform } from "react-native";
import { create } from "zustand";
import { Ringer } from "../calls/ringer";
import { type AgoraToken, CallRepo, StartCallError } from "../data/calls";
import { ProfileRepo } from "../data/profiles";
import { AppError } from "../lib/errors";
import { storage } from "../lib/storage";
import { type CallRow, type Profile, profileName } from "../models/types";
import { Realtime } from "./realtime";
import type * as AgoraModule from "react-native-agora";

export type CallPhase = "idle" | "starting" | "outgoing" | "incoming" | "connecting" | "active" | "group" | "ended";

/** One Agora participant other than me. */
export type RemoteParticipant = { uid: number; userId: string | null; videoOff: boolean };

type CallState = {
  phase: CallPhase;
  call: CallRow | null;
  chatId: string | null;
  /** The other person (1-on-1), or null in a group. */
  peer: Profile | null;
  /** Group calls: the group's name and members (to name people in the room). */
  groupTitle: string | null;
  groupMembers: Record<string, Profile>;
  isVideo: boolean;
  connectedAt: number | null;
  reconnecting: boolean;
  micMuted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  endMessage: string | null;
  /** Our outgoing 1-on-1 call wasn't answered: offer a voicemail. */
  offerVoicemail: boolean;
  voicemailCallId: string | null;
  remotes: RemoteParticipant[];
  /** Set while joined, for video views. */
  channelName: string | null;
  engineGen: number;
};

const IDLE: CallState = {
  phase: "idle",
  call: null,
  chatId: null,
  peer: null,
  groupTitle: null,
  groupMembers: {},
  isVideo: false,
  connectedAt: null,
  reconnecting: false,
  micMuted: false,
  cameraOff: false,
  speakerOn: false,
  endMessage: null,
  offerVoicemail: false,
  voicemailCallId: null,
  remotes: [],
  channelName: null,
  engineGen: 0,
};

export const useCall = create<CallState>(() => ({ ...IDLE }));

const RING_TIMEOUT = 30_000;
const HEARTBEAT = 15_000;
/** A ringing row older than this is stale (the server treats > 45 s as gone). */
const STALE_RING = 45_000;
/** While ringing, re-read the row in case a Realtime event was missed. */
const RING_POLL = 3_000;
/** Set by the lock-screen "Accept" action so the call is picked up on launch. */
export const PENDING_ACCEPT_KEY = "calls.pendingAccept";

let meId: string | null = null;
let unsubscribe: (() => void) | null = null;
let gen = 0;
let engineGen = 0;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let incomingTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Agora gave no "joined" within this long: report it instead of spinning forever. */
const JOIN_TIMEOUT = 20_000;
let joinTimer: ReturnType<typeof setTimeout> | null = null;
/** Last error Agora reported for the current call (shown if the call fails). */
let agoraError: string | null = null;

/**
 * Incoming calls are normally pushed over Realtime, but a dropped or not-yet-
 * authorized socket must never mean a silent phone. While the app is open and
 * idle it also asks the server for a call ringing for me every few seconds
 * (one tiny indexed query: callee_id + status + created_at).
 */
const RING_WATCH = 4_000;
let ringWatch: ReturnType<typeof setInterval> | null = null;
/** Calls already shown (answered, declined or missed here): never ring twice. */
const handledCalls = new Set<string>();

/** The Agora module, loaded on first use (never at app startup). */
let agora: typeof AgoraModule | null = null;
export function loadAgora(): typeof AgoraModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  agora ??= require("react-native-agora") as typeof AgoraModule;
  return agora;
}
let engine: AgoraModule.IRtcEngine | null = null;
export const currentEngine = () => engine;

const get = useCall.getState;
const set = (patch: Partial<CallState>) => useCall.setState(patch);
const busy = () => {
  const p = get().phase;
  return p !== "idle" && p !== "ended";
};
const title = () => get().groupTitle ?? profileName(get().peer);

function clearTimers() {
  for (const t of [ringTimer, incomingTimer, dismissTimer, joinTimer]) if (t) clearTimeout(t);
  for (const t of [heartbeatTimer, pollTimer]) if (t) clearInterval(t);
  ringTimer = incomingTimer = dismissTimer = joinTimer = heartbeatTimer = pollTimer = null;
}

/**
 * Safety net while a 1-on-1 call rings: Realtime normally delivers
 * accepted / declined / cancelled instantly, but if an event is lost (socket
 * reconnecting, app just resumed) the row is re-read every few seconds.
 */
function pollWhileRinging(callId: string) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const { phase, call } = get();
    if ((phase !== "outgoing" && phase !== "incoming") || call?.id !== callId) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      return;
    }
    const row = await CallRepo.fetch(callId).catch(() => null);
    if (row && row.status !== "ringing" && get().call?.id === callId) onCallChange("UPDATE", row);
  }, RING_POLL);
}

// Ring / ringback / vibration follow the phase, so every way out of ringing
// (accept, decline, cancel, timeout, answered elsewhere, sign-out) stops them.
useCall.subscribe((st, prev) => {
  if (st.phase === prev.phase) return;
  if (st.phase === "incoming") Ringer.start("ring");
  else if (st.phase === "outgoing") Ringer.start("ringback");
  else Ringer.stop();
});

/** Explains a refused permission, with a shortcut to the app's settings. */
function permissionAlert(video: boolean) {
  Alert.alert(
    video ? "Camera and microphone needed" : "Microphone needed",
    video
      ? "Allow Chat App to use your microphone and camera to make and answer video calls."
      : "Allow Chat App to use your microphone to make and answer calls.",
    [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => void Linking.openSettings().catch(() => {}) },
    ],
  );
}

function releaseEngine() {
  const rtc = engine;
  engine = null;
  engineGen++;
  set({ remotes: [], channelName: null, engineGen });
  if (!rtc) return;
  try {
    rtc.leaveChannel();
  } catch {}
  try {
    rtc.release();
  } catch {}
}

function resetToIdle() {
  gen++;
  clearTimers();
  releaseEngine();
  useCall.setState({ ...IDLE, engineGen });
}

/** Tears down media and shows the ended screen. A non-null voicemailCallId offers a voicemail ('' = not linked). */
function finish(message: string, voicemailCallId?: string) {
  gen++;
  clearTimers();
  releaseEngine();
  const offer = voicemailCallId !== undefined && !get().groupTitle && !!get().peer;
  set({
    phase: "ended",
    endMessage: message,
    offerVoicemail: offer,
    voicemailCallId: voicemailCallId ? voicemailCallId : null,
    connectedAt: null,
    reconnecting: false,
  });
  if (!offer) dismissTimer = setTimeout(() => Calls.dismiss(), 2500);
}

function fresh(patch: Partial<CallState>) {
  clearTimers();
  useCall.setState({ ...IDLE, engineGen, ...patch });
}

async function permissions(video: boolean): Promise<boolean> {
  if (Platform.OS === "android") {
    const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
    const result = await PermissionsAndroid.requestMultiple(wanted);
    const mic = result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
    // A video call without a camera still works as audio.
    if (video && result[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED) set({ cameraOff: true });
    return mic;
  }
  const { requestRecordingPermissionsAsync } = await import("expo-audio");
  const mic = (await requestRecordingPermissionsAsync()).granted;
  if (video) {
    const { requestCameraPermissionsAsync } = await import("expo-image-picker");
    if (!(await requestCameraPermissionsAsync()).granted) set({ cameraOff: true });
  }
  return mic;
}

function onCallChange(event: "INSERT" | "UPDATE", row: CallRow) {
  if (row.isGroup) return; // group rooms never ring; the chat screen shows them
  const { call, phase, peer } = get();
  switch (row.status) {
    case "ringing":
      if (event === "INSERT" && row.calleeId === meId) void onIncoming(row);
      return;
    case "accepted":
      if (call?.id !== row.id) return;
      if (phase === "outgoing") {
        set({ call: row });
        if (ringTimer) clearTimeout(ringTimer);
        void connect();
      } else if (phase === "incoming") {
        resetToIdle(); // answered on another device
      }
      return;
    case "declined":
      if (call?.id !== row.id) return;
      if (phase === "outgoing") finish(`${profileName(peer)} declined the call.`, row.id);
      else resetToIdle();
      return;
    case "cancelled":
    case "missed":
    case "ended":
      if (call?.id !== row.id) return;
      if (phase === "incoming") finish(`Missed call from ${profileName(peer)}.`);
      else if (phase === "outgoing" && row.status === "missed") finish("No answer.", row.id);
      else finish("Call ended.");
      return;
  }
}

async function onIncoming(row: CallRow) {
  if (busy() || get().call?.id === row.id || handledCalls.has(row.id)) return;
  if (row.status !== "ringing" || row.calleeId !== meId) return;
  const age = Date.now() - Date.parse(row.createdAt);
  if (Number.isFinite(age) && age > STALE_RING) return; // rang out long ago
  const g = ++gen;
  const caller = await ProfileRepo.fetchPublic(row.callerId).catch(() => null);
  if (g !== gen || busy() || handledCalls.has(row.id)) return;
  // Shown once: the poll below must not re-ring a call I already declined or missed.
  handledCalls.add(row.id);
  fresh({
    call: row,
    chatId: row.chatId,
    peer: caller ?? { id: row.callerId, username: null, displayName: null, avatarUrl: null },
    isVideo: row.callType === "video",
    phase: "incoming",
  });
  const left = Math.max(5000, RING_TIMEOUT + 5000 - (Number.isFinite(age) ? age : 0));
  pollWhileRinging(row.id);
  incomingTimer = setTimeout(() => {
    if (get().phase === "incoming" && get().call?.id === row.id) finish(`Missed call from ${profileName(get().peer)}.`);
  }, left);
  // Accepted from the lock-screen notification before the app opened.
  if (storage.getString(PENDING_ACCEPT_KEY) === row.id) {
    storage.remove(PENDING_ACCEPT_KEY);
    void Calls.accept();
  }
}

function startHeartbeat(callId: string) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    const alive = await CallRepo.heartbeat(callId);
    if (alive === false && get().call?.id === callId && busy()) finish(get().groupTitle ? "The call ended." : "Call ended.");
  }, HEARTBEAT);
}

async function connect() {
  const { call: row, chatId: chat } = get();
  const me = meId;
  if (!row || !chat || !me) return;
  const g = gen;
  if (!get().groupTitle) set({ phase: "connecting" });

  let token: AgoraToken;
  try {
    token = await CallRepo.token(chat);
  } catch (e) {
    console.warn("Agora token failed", e);
    if (g !== gen) return;
    await CallRepo.end(row.id);
    finish(e instanceof AppError ? `Couldn't connect the call: ${e.message}` : "Couldn't connect the call (token).");
    return;
  }
  if (g !== gen) return;
  agoraError = null;

  const A = loadAgora();
  const rtc = A.createAgoraRtcEngine();
  engine = rtc;
  const myGen = ++engineGen;
  set({ channelName: token.channelName, engineGen: myGen });
  const mine = () => engine === rtc;
  const patchRemote = (uid: number, patch: Partial<RemoteParticipant>) =>
    set({ remotes: get().remotes.map((r) => (r.uid === uid ? { ...r, ...patch } : r)) });

  try {
    rtc.initialize({ appId: token.appId, channelProfile: A.ChannelProfileType.ChannelProfileCommunication });
    rtc.registerEventHandler({
      onError: (err, msg) => {
        if (!mine()) return;
        agoraError = `${err}${msg ? ` ${msg}` : ""}`;
        console.warn("Agora error", err, msg);
      },
      onJoinChannelSuccess: () => {
        if (!mine()) return;
        if (joinTimer) clearTimeout(joinTimer);
        joinTimer = null;
        set({ connectedAt: Date.now(), ...(get().groupTitle ? {} : { phase: "active" as const }) });
        // The audio route can only be switched once in the channel.
        try {
          rtc.setEnableSpeakerphone(get().speakerOn);
        } catch {}
        startHeartbeat(row.id);
      },
      onUserJoined: (_connection, uid) => {
        if (!mine() || get().remotes.some((r) => r.uid === uid)) return;
        set({ remotes: [...get().remotes, { uid, userId: null, videoOff: false }] });
        try {
          const info = rtc.getUserInfoByUid(uid);
          if (info?.userAccount) patchRemote(uid, { userId: info.userAccount });
        } catch {
          // onUserInfoUpdated fills it in.
        }
      },
      onUserOffline: (_connection, uid) => {
        if (mine()) set({ remotes: get().remotes.filter((r) => r.uid !== uid) });
      },
      onUserInfoUpdated: (uid, info) => {
        if (mine() && info.userAccount) patchRemote(uid, { userId: info.userAccount });
      },
      onUserMuteVideo: (_connection, uid, muted) => {
        if (mine()) patchRemote(uid, { videoOff: muted });
      },
      onTokenPrivilegeWillExpire: () => {
        void CallRepo.token(chat)
          .then((t) => {
            if (mine()) rtc.renewToken(t.token);
          })
          .catch(() => {});
      },
      onConnectionStateChanged: (_connection, state, reason) => {
        if (!mine()) return;
        set({ reconnecting: state === A.ConnectionStateType.ConnectionStateReconnecting });
        if (state === A.ConnectionStateType.ConnectionStateFailed) {
          void CallRepo.end(row.id);
          // e.g. reason 8 = invalid token, 9 = token expired, 4 = rejected by server.
          finish(`Connection lost (Agora reason ${reason}${agoraError ? `, error ${agoraError}` : ""}).`);
        }
      },
    });
    // Same setup as web (agora-client.ts: mode "rtc", publishes mic + camera):
    // a communication-profile broadcaster that publishes and subscribes.
    rtc.setChannelProfile(A.ChannelProfileType.ChannelProfileCommunication);
    rtc.setClientRole(A.ClientRoleType.ClientRoleBroadcaster);
    rtc.enableAudio();
    rtc.enableLocalAudio(true);
    const { isVideo, cameraOff, speakerOn, micMuted } = get();
    if (micMuted) rtc.muteLocalAudioStream(true);
    if (isVideo) {
      rtc.enableVideo();
      if (cameraOff) rtc.enableLocalVideo(false);
      else rtc.startPreview();
    }
    rtc.setDefaultAudioRouteToSpeakerphone(speakerOn);
    // /api/agora/token signs the Supabase user id as an Agora *user account*
    // (buildTokenWithUserAccount, and web joins with that same string uid), so
    // the native side joins with the account; a numeric uid would be rejected.
    const code = rtc.joinChannelWithUserAccount(token.token, token.channelName, me, {
      clientRoleType: A.ClientRoleType.ClientRoleBroadcaster,
      channelProfile: A.ChannelProfileType.ChannelProfileCommunication,
      publishMicrophoneTrack: true,
      publishCameraTrack: isVideo && !cameraOff,
      autoSubscribeAudio: true,
      autoSubscribeVideo: true,
    });
    if (typeof code === "number" && code < 0) throw new Error(`join returned ${code}`);
    // Never spin on "Connecting…" forever: say what Agora reported.
    joinTimer = setTimeout(() => {
      joinTimer = null;
      if (!mine() || get().connectedAt) return;
      void CallRepo.end(row.id);
      finish(`Couldn't connect the call (no answer from the call server${agoraError ? `, error ${agoraError}` : ""}).`);
    }, JOIN_TIMEOUT);
  } catch (e) {
    console.warn("Agora join failed", e);
    if (g !== gen) return;
    await CallRepo.end(row.id);
    finish(`Couldn't connect the call (${e instanceof Error ? e.message : String(e)}).`);
  }
}

function startRingWatch() {
  if (ringWatch) clearInterval(ringWatch);
  ringWatch = setInterval(() => {
    if (AppState.currentState === "active") void Calls.checkRinging();
  }, RING_WATCH);
}

export const Calls = {
  /** Starts listening for calls for the signed-in user. */
  async attach(userId: string) {
    if (meId === userId) return;
    await Calls.detach();
    meId = userId;
    const offCall = Realtime.onCall(onCallChange);
    // (Re)connected: anything that rang while the socket was down shows now.
    const offStatus = Realtime.onStatus((live) => {
      if (live) void Calls.checkRinging();
    });
    unsubscribe = () => {
      offCall();
      offStatus();
    };
    startRingWatch();
    const ringing = await CallRepo.ringingForMe(userId);
    if (ringing && meId === userId) void onIncoming(ringing);
  },

  /** Signing out: hang up and stop listening. */
  async detach() {
    if (busy()) await Calls.hangUp();
    resetToIdle();
    unsubscribe?.();
    unsubscribe = null;
    if (ringWatch) clearInterval(ringWatch);
    ringWatch = null;
    handledCalls.clear();
    meId = null;
  },

  /** Re-check for a call that rang while the app was in the background / closed. */
  async checkRinging() {
    if (!meId || busy()) return;
    const ringing = await CallRepo.ringingForMe(meId);
    if (ringing) void onIncoming(ringing);
  },

  get busy() {
    return busy();
  },
  title,

  async startDirect(chatId: string, peer: Profile, video: boolean) {
    if (busy()) return;
    const g = ++gen;
    fresh({ chatId, peer, isVideo: video, speakerOn: video, phase: "starting" });
    // Runtime permissions first: never ring someone we can't talk to.
    if (!(await permissions(video))) {
      if (g === gen) {
        finish(video ? "Camera and microphone access are needed for video calls." : "Microphone access is needed for calls.");
        permissionAlert(video);
      }
      return;
    }
    if (g !== gen) return;
    let row: CallRow;
    try {
      row = await CallRepo.start(chatId, video ? "video" : "voice");
    } catch (e) {
      if (g !== gen) return;
      const reason = e instanceof StartCallError ? e.reason : "error";
      if (reason === "callee-busy") finish(`${profileName(peer)} is on another call.`, "");
      else if (reason === "caller-busy") finish("You're already in another call.");
      else if (reason === "unavailable") finish("That account is no longer available.");
      else finish("Couldn't start the call. Please try again.");
      return;
    }
    if (g !== gen) {
      void CallRepo.end(row.id); // hung up while starting
      return;
    }
    set({ call: row, phase: "outgoing" });
    pollWhileRinging(row.id);
    ringTimer = setTimeout(async () => {
      if (get().phase !== "outgoing" || get().call?.id !== row.id) return;
      await CallRepo.end(row.id, true);
      if (get().phase === "outgoing" && get().call?.id === row.id) finish("No answer.", row.id);
    }, RING_TIMEOUT);
  },

  /** Joins (or opens) the group's call room. */
  async joinGroup(chatId: string, groupTitle: string, members: Record<string, Profile>, video: boolean) {
    if (busy()) return;
    const g = ++gen;
    fresh({ chatId, groupTitle, groupMembers: members, isVideo: video, speakerOn: true, phase: "group" });
    if (!(await permissions(video))) {
      if (g === gen) {
        finish("Microphone access is needed for calls.");
        permissionAlert(video);
      }
      return;
    }
    let row: CallRow;
    try {
      row = await CallRepo.start(chatId, video ? "video" : "voice");
    } catch (e) {
      if (g !== gen) return;
      const reason = e instanceof StartCallError ? e.reason : "error";
      finish(
        reason === "call-full"
          ? "This call is full."
          : reason === "caller-busy"
            ? "You're already in another call."
            : "Couldn't join the call. Please try again.",
      );
      return;
    }
    if (g !== gen) {
      void CallRepo.end(row.id);
      return;
    }
    // Joining a room that's already a video call turns my camera on too.
    set({ call: row, isVideo: row.callType === "video" });
    await connect();
  },

  async accept() {
    const { call: row, phase, isVideo } = get();
    if (phase !== "incoming" || !row) return;
    const g = ++gen;
    if (incomingTimer) clearTimeout(incomingTimer);
    set({ phase: "connecting", speakerOn: isVideo });
    if (!(await permissions(isVideo))) {
      await CallRepo.answer(row.id, false);
      if (g === gen) {
        finish("Microphone access is needed for calls.");
        permissionAlert(isVideo);
      }
      return;
    }
    const answered = await CallRepo.answer(row.id, true);
    if (g !== gen) return;
    if (!answered) {
      finish("This call is no longer available.");
      return;
    }
    set({ call: answered });
    await connect();
  },

  /** "Accept" on the incoming-call notification. */
  async acceptFromNotification(callId: string) {
    const { phase, call } = get();
    if (phase === "incoming" && call?.id === callId) return Calls.accept();
    // Not ringing in this process yet (app was killed): answer once it is.
    storage.set(PENDING_ACCEPT_KEY, callId);
    await Calls.checkRinging();
  },

  /** "Decline" on the incoming-call notification. */
  async declineFromNotification(callId: string) {
    const { phase, call } = get();
    if (phase === "incoming" && call?.id === callId) return Calls.decline();
    await CallRepo.answer(callId, false);
  },

  async decline() {
    const { call: row, phase } = get();
    if (phase !== "incoming" || !row) return;
    resetToIdle();
    await CallRepo.answer(row.id, false);
  },

  async hangUp() {
    const { call: row, phase, groupTitle } = get();
    switch (phase) {
      case "idle":
        return;
      case "incoming":
        return Calls.decline();
      case "ended":
        return Calls.dismiss();
      case "starting":
        resetToIdle();
        return;
      case "outgoing":
        resetToIdle();
        if (row) await CallRepo.end(row.id);
        return;
      default:
        finish(groupTitle ? "You left the call." : "Call ended.");
        if (row) await CallRepo.end(row.id);
    }
  },

  dismiss() {
    if (get().phase === "ended") resetToIdle();
  },

  toggleMic() {
    const micMuted = !get().micMuted;
    set({ micMuted });
    engine?.muteLocalAudioStream(micMuted);
  },

  toggleCamera() {
    const cameraOff = !get().cameraOff;
    set({ cameraOff });
    engine?.muteLocalVideoStream(cameraOff);
    engine?.enableLocalVideo(!cameraOff);
  },

  toggleSpeaker() {
    const speakerOn = !get().speakerOn;
    set({ speakerOn });
    try {
      engine?.setEnableSpeakerphone(speakerOn);
    } catch {}
  },

  switchCamera() {
    try {
      engine?.switchCamera();
    } catch {}
  },

  profileFor(r: RemoteParticipant): Profile | null {
    if (!r.userId) return null;
    const { groupMembers, peer } = get();
    return groupMembers[r.userId] ?? (peer?.id === r.userId ? peer : null);
  },
};

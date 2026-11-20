import { PermissionsAndroid, Platform } from "react-native";
import { create } from "zustand";
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
  for (const t of [ringTimer, incomingTimer, dismissTimer]) if (t) clearTimeout(t);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  ringTimer = incomingTimer = dismissTimer = heartbeatTimer = null;
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
  if (busy() || get().call?.id === row.id) return;
  const g = ++gen;
  const caller = await ProfileRepo.fetchPublic(row.callerId).catch(() => null);
  if (g !== gen || busy()) return;
  fresh({
    call: row,
    chatId: row.chatId,
    peer: caller ?? { id: row.callerId, username: null, displayName: null, avatarUrl: null },
    isVideo: row.callType === "video",
    phase: "incoming",
  });
  const age = Date.now() - Date.parse(row.createdAt);
  const left = Math.max(5000, RING_TIMEOUT + 5000 - age);
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
    if (g !== gen) return;
    await CallRepo.end(row.id);
    finish(e instanceof AppError ? e.message : "Couldn't connect the call.");
    return;
  }
  if (g !== gen) return;

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
      onJoinChannelSuccess: () => {
        if (!mine()) return;
        set({ connectedAt: Date.now(), ...(get().groupTitle ? {} : { phase: "active" as const }) });
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
      onConnectionStateChanged: (_connection, state) => {
        if (!mine()) return;
        set({ reconnecting: state === A.ConnectionStateType.ConnectionStateReconnecting });
        if (state === A.ConnectionStateType.ConnectionStateFailed) {
          void CallRepo.end(row.id);
          finish("Connection lost.");
        }
      },
    });
    rtc.enableAudio();
    const { isVideo, cameraOff, speakerOn } = get();
    if (isVideo) {
      rtc.enableVideo();
      if (cameraOff) rtc.enableLocalVideo(false);
      else rtc.startPreview();
    }
    rtc.setDefaultAudioRouteToSpeakerphone(speakerOn);
    rtc.joinChannelWithUserAccount(token.token, token.channelName, me, {
      clientRoleType: A.ClientRoleType.ClientRoleBroadcaster,
      channelProfile: A.ChannelProfileType.ChannelProfileCommunication,
      publishMicrophoneTrack: true,
      publishCameraTrack: isVideo && !cameraOff,
      autoSubscribeAudio: true,
      autoSubscribeVideo: true,
    });
  } catch (e) {
    console.warn("Agora join failed", e);
    if (g !== gen) return;
    await CallRepo.end(row.id);
    finish("Couldn't connect the call.");
  }
}

export const Calls = {
  /** Starts listening for calls for the signed-in user. */
  async attach(userId: string) {
    if (meId === userId) return;
    await Calls.detach();
    meId = userId;
    unsubscribe = Realtime.onCall(onCallChange);
    const ringing = await CallRepo.ringingForMe(userId);
    if (ringing && meId === userId) void onIncoming(ringing);
  },

  /** Signing out: hang up and stop listening. */
  async detach() {
    if (busy()) await Calls.hangUp();
    resetToIdle();
    unsubscribe?.();
    unsubscribe = null;
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
    if (!(await permissions(video))) {
      if (g === gen)
        finish(video ? "Camera and microphone access are needed for video calls." : "Microphone access is needed for calls.");
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
      if (g === gen) finish("Microphone access is needed for calls.");
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
      if (g === gen) finish("Microphone access is needed for calls.");
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

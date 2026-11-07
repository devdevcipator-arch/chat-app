import type {
  ConnectionDisconnectedReason,
  ConnectionState,
  IAgoraRTC,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
} from "agora-rtc-sdk-ng";
import type { AgoraTokenError, AgoraTokenResponse } from "@/lib/call/types";

// Browser-only wrapper around the Agora Web SDK for a 1-on-1 audio call.
// The SDK is imported lazily: it touches `window` at module load, and most
// page views never place a call.

let sdk: Promise<IAgoraRTC> | null = null;
function loadSdk() {
  sdk ??= import("agora-rtc-sdk-ng").then(({ default: AgoraRTC }) => {
    AgoraRTC.setLogLevel(3); // warnings + errors only
    AgoraRTC.disableLogUpload();
    return AgoraRTC;
  });
  return sdk;
}

export class CallError extends Error {
  constructor(
    message: string,
    readonly kind: "mic" | "network" | "server" = "server",
  ) {
    super(message);
    this.name = "CallError";
  }
}

/** Maps getUserMedia / Agora device errors to something a person can act on. */
function micErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const name = (error as { name?: string } | null)?.name;
  if (code === "PERMISSION_DENIED" || name === "NotAllowedError") {
    return "Microphone access is blocked. Allow it in your browser's site settings and try again.";
  }
  if (code === "DEVICE_NOT_FOUND" || name === "NotFoundError") {
    return "No microphone found. Connect one and try again.";
  }
  if (code === "NOT_READABLE" || name === "NotReadableError") {
    return "Your microphone is being used by another app. Close it and try again.";
  }
  if (code === "NOT_SUPPORTED" || code === "WEB_SECURITY_RESTRICT") {
    return "This browser can't make voice calls. Try a recent Chrome, Edge, Firefox or Safari.";
  }
  return "Couldn't start your microphone. Please try again.";
}

export async function fetchAgoraToken(channelName: string): Promise<AgoraTokenResponse> {
  let response: Response;
  try {
    response = await fetch("/api/agora/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelName }),
    });
  } catch {
    throw new CallError("Can't reach the server. Check your connection.", "network");
  }
  const json = (await response.json().catch(() => null)) as AgoraTokenResponse | AgoraTokenError | null;
  if (!response.ok || !json || "error" in json) {
    throw new CallError(json && "error" in json ? json.error : "Couldn't connect the call.");
  }
  return json;
}

export type AudioDevices = {
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

export type VoiceSessionEvents = {
  /** The other person joined and their audio is playing. */
  onRemoteJoined: () => void;
  /** The other person left the channel ("Quit") or dropped ("ServerTimeOut"). */
  onRemoteLeft: (reason: string) => void;
  /** Our own link to Agora is reconnecting (true) or back (false). */
  onReconnecting: (reconnecting: boolean) => void;
  /** Our link to Agora is gone for good. */
  onDisconnected: (reason: ConnectionDisconnectedReason | undefined) => void;
  /** Device list changed, or the active device was unplugged. */
  onDevicesChanged: (devices: AudioDevices) => void;
  /** The browser blocked audio playback until the user interacts. */
  onAutoplayBlocked: () => void;
};

/**
 * One call's media session. Usage:
 *   const s = await VoiceSession.create(events)   // asks for the mic
 *   await s.join(channelName)
 *   ...
 *   await s.leave()
 */
export class VoiceSession {
  private client: IAgoraRTCClient | null = null;
  private remoteTrack: IRemoteAudioTrack | null = null;
  private speakerId: string | null = null;
  private closed = false;

  private constructor(
    private readonly AgoraRTC: IAgoraRTC,
    private mic: IMicrophoneAudioTrack,
    private readonly events: VoiceSessionEvents,
  ) {}

  /** Loads the SDK and opens the microphone (triggers the permission prompt). */
  static async create(events: VoiceSessionEvents): Promise<VoiceSession> {
    const AgoraRTC = await loadSdk();
    if (!AgoraRTC.checkSystemRequirements()) {
      throw new CallError(micErrorMessage({ code: "NOT_SUPPORTED" }), "mic");
    }
    let mic: IMicrophoneAudioTrack;
    try {
      mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
    } catch (e) {
      throw new CallError(micErrorMessage(e), "mic");
    }
    const session = new VoiceSession(AgoraRTC, mic, events);
    session.watchDevices();
    return session;
  }

  get microphoneId(): string {
    return this.mic.getMediaStreamTrack().getSettings().deviceId ?? "";
  }

  /** Whether the other person is currently in the channel. */
  get remotePresent(): boolean {
    return (this.client?.remoteUsers.length ?? 0) > 0;
  }

  async join(channelName: string) {
    const { appId, token, uid } = await fetchAgoraToken(channelName);
    if (this.closed) return;

    const client = this.AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    this.client = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType) => {
      if (mediaType !== "audio") return;
      try {
        await client.subscribe(user, "audio");
        this.remoteTrack = user.audioTrack ?? null;
        if (this.remoteTrack) {
          if (this.speakerId) await this.remoteTrack.setPlaybackDevice(this.speakerId).catch(() => {});
          this.remoteTrack.play();
        }
      } catch {
        // A failed subscribe is retried by the next user-published event.
      }
    });
    client.on("user-joined", () => this.events.onRemoteJoined());
    client.on("user-left", (_user: IAgoraRTCRemoteUser, reason: string) => {
      this.remoteTrack = null;
      this.events.onRemoteLeft(reason);
    });
    client.on(
      "connection-state-change",
      (state: ConnectionState, prev: ConnectionState, reason?: ConnectionDisconnectedReason) => {
        if (state === "RECONNECTING") this.events.onReconnecting(true);
        else if (state === "CONNECTED" && prev === "RECONNECTING") this.events.onReconnecting(false);
        else if (state === "DISCONNECTED" && reason !== "LEAVE" && !this.closed) {
          this.events.onDisconnected(reason);
        }
      },
    );
    // Tokens last an hour; renew before long calls get cut off.
    client.on("token-privilege-will-expire", async () => {
      try {
        const fresh = await fetchAgoraToken(channelName);
        await client.renewToken(fresh.token);
      } catch {
        // The call ends with "connection lost" if renewal keeps failing.
      }
    });

    try {
      await client.join(appId, channelName, token, uid);
      if (this.closed) return;
      await client.publish(this.mic);
    } catch (e) {
      if (this.closed) return;
      throw new CallError(
        (e as { code?: string }).code === "NETWORK_ERROR"
          ? "Can't reach the call server. Check your connection."
          : "Couldn't connect the call.",
        "network",
      );
    }
    // The peer may already be in the channel (they joined first).
    if (client.remoteUsers.length > 0) this.events.onRemoteJoined();
  }

  async setMuted(muted: boolean) {
    await this.mic.setEnabled(!muted);
  }

  async setMicrophone(deviceId: string) {
    await this.mic.setDevice(deviceId);
  }

  /** Not every browser can route output (Safari/Firefox can't); throws then. */
  async setSpeaker(deviceId: string) {
    this.speakerId = deviceId;
    if (this.remoteTrack) await this.remoteTrack.setPlaybackDevice(deviceId);
  }

  async listDevices(): Promise<AudioDevices> {
    const [microphones, speakers] = await Promise.all([
      this.AgoraRTC.getMicrophones(true).catch(() => []),
      this.AgoraRTC.getPlaybackDevices(true).catch(() => []),
    ]);
    return { microphones, speakers };
  }

  /** Resume playback after an autoplay block (call from a click handler). */
  resumePlayback() {
    this.remoteTrack?.play();
  }

  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.AgoraRTC.onMicrophoneChanged = undefined;
    this.AgoraRTC.onPlaybackDeviceChanged = undefined;
    this.AgoraRTC.onAutoplayFailed = undefined;
    this.remoteTrack?.stop();
    this.mic.stop();
    this.mic.close();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.leave().catch(() => {});
    }
  }

  private watchDevices() {
    const refresh = async () => {
      if (!this.closed) this.events.onDevicesChanged(await this.listDevices());
    };
    this.AgoraRTC.onMicrophoneChanged = async (info) => {
      // If the active mic was unplugged, fall back to another one.
      const current = this.mic.getMediaStreamTrack().getSettings().deviceId;
      if (info.state === "INACTIVE" && info.device.deviceId === current) {
        const [next] = await this.AgoraRTC.getMicrophones(true).catch(() => []);
        if (next) await this.mic.setDevice(next.deviceId).catch(() => {});
      }
      await refresh();
    };
    this.AgoraRTC.onPlaybackDeviceChanged = async (info) => {
      if (info.state === "INACTIVE" && info.device.deviceId === this.speakerId) {
        this.speakerId = null;
        await this.remoteTrack?.setPlaybackDevice("default").catch(() => {});
      }
      await refresh();
    };
    this.AgoraRTC.onAutoplayFailed = () => this.events.onAutoplayBlocked();
  }
}

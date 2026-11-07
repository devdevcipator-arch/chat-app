import type {
  ConnectionDisconnectedReason,
  ConnectionState,
  IAgoraRTC,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import type { AgoraTokenError, AgoraTokenResponse } from "@/lib/call/types";

// Browser-only wrapper around the Agora Web SDK for a 1-on-1 call: always a
// microphone, plus an optional camera that can be switched on and off.
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
    readonly kind: "mic" | "camera" | "network" | "server" = "server",
  ) {
    super(message);
    this.name = "CallError";
  }
}

/** Maps getUserMedia / Agora device errors to something a person can act on. */
function deviceErrorMessage(error: unknown, device: "microphone" | "camera"): string {
  const code = (error as { code?: string } | null)?.code;
  const name = (error as { name?: string } | null)?.name;
  const label = device === "camera" ? "Camera" : "Microphone";
  if (code === "PERMISSION_DENIED" || name === "NotAllowedError") {
    return `${label} access is blocked. Allow it in your browser's site settings and try again.`;
  }
  if (code === "DEVICE_NOT_FOUND" || name === "NotFoundError" || name === "OverconstrainedError") {
    return `No ${device} found. Connect one and try again.`;
  }
  if (code === "NOT_READABLE" || name === "NotReadableError") {
    return `Your ${device} is being used by another app. Close it and try again.`;
  }
  if (code === "NOT_SUPPORTED" || code === "WEB_SECURITY_RESTRICT") {
    return "This browser can't make calls. Try a recent Chrome, Edge, Firefox or Safari.";
  }
  return `Couldn't start your ${device}. Please try again.`;
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

export type MediaDevices = {
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
};

export type CallSessionEvents = {
  /** The other person joined the channel. */
  onRemoteJoined: () => void;
  /** The other person left the channel ("Quit") or dropped ("ServerTimeOut"). */
  onRemoteLeft: (reason: string) => void;
  /** The other person's video started or stopped. */
  onRemoteVideoChanged: () => void;
  /** Our own camera track was created, closed or replaced. */
  onLocalVideoChanged: () => void;
  /** The camera failed or was unplugged; the call carries on without video. */
  onCameraError: (message: string) => void;
  /** Our own link to Agora is reconnecting (true) or back (false). */
  onReconnecting: (reconnecting: boolean) => void;
  /** Our link to Agora is gone for good. */
  onDisconnected: (reason: ConnectionDisconnectedReason | undefined) => void;
  /** Device list changed, or the active device was unplugged. */
  onDevicesChanged: (devices: MediaDevices) => void;
  /** The browser blocked audio playback until the user interacts. */
  onAutoplayBlocked: () => void;
};

const CAMERA_CONFIG = { encoderConfig: "720p_2", optimizationMode: "motion" } as const;

/**
 * One call's media session. Usage:
 *   const s = await CallSession.create(events, { video })   // asks for mic (+ camera)
 *   await s.join(channelName)
 *   await s.setCameraEnabled(false)                       // camera light goes off
 *   await s.leave()                                       // releases every device
 */
export class CallSession {
  private client: IAgoraRTCClient | null = null;
  private remoteAudio: IRemoteAudioTrack | null = null;
  private remoteVideo: IRemoteVideoTrack | null = null;
  private camera: ICameraVideoTrack | null = null;
  private cameraId: string | null = null;
  private speakerId: string | null = null;
  /** Serializes camera on/off/switch so rapid clicks can't leak a track. */
  private cameraQueue: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly AgoraRTC: IAgoraRTC,
    private readonly mic: IMicrophoneAudioTrack,
    private readonly events: CallSessionEvents,
  ) {}

  /**
   * Loads the SDK and opens the microphone, and the camera for video calls.
   * A missing mic fails the call; a missing camera only reports
   * `cameraError` and the call continues as audio.
   */
  static async create(
    events: CallSessionEvents,
    { video }: { video: boolean },
  ): Promise<{ session: CallSession; cameraError: string | null }> {
    const AgoraRTC = await loadSdk();
    if (!AgoraRTC.checkSystemRequirements()) {
      throw new CallError(deviceErrorMessage({ code: "NOT_SUPPORTED" }, "microphone"), "mic");
    }
    let mic: IMicrophoneAudioTrack;
    try {
      mic = await AgoraRTC.createMicrophoneAudioTrack({ AEC: true, ANS: true, AGC: true });
    } catch (e) {
      throw new CallError(deviceErrorMessage(e, "microphone"), "mic");
    }
    const session = new CallSession(AgoraRTC, mic, events);
    session.watchDevices();

    let cameraError: string | null = null;
    if (video) {
      try {
        await session.openCamera();
      } catch (e) {
        cameraError = e instanceof CallError ? e.message : deviceErrorMessage(e, "camera");
      }
    }
    return { session, cameraError };
  }

  // --- State ------------------------------------------------------------------

  get microphoneId(): string {
    return this.mic.getMediaStreamTrack().getSettings().deviceId ?? "";
  }

  get currentCameraId(): string | null {
    return this.camera ? (this.camera.getMediaStreamTrack().getSettings().deviceId ?? this.cameraId) : this.cameraId;
  }

  /** Whether the other person is currently in the channel. */
  get remotePresent(): boolean {
    return (this.client?.remoteUsers.length ?? 0) > 0;
  }

  /** Our camera track while the camera is on (for local preview). */
  get localVideoTrack(): ICameraVideoTrack | null {
    return this.camera;
  }

  /** The other person's video while they're sending it. */
  get remoteVideoTrack(): IRemoteVideoTrack | null {
    return this.remoteVideo;
  }

  // --- Channel ----------------------------------------------------------------

  async join(channelName: string) {
    const { appId, token, uid } = await fetchAgoraToken(channelName);
    if (this.closed) return;

    const client = this.AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    this.client = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video" | "datachannel") => {
      if (mediaType === "datachannel") return;
      try {
        await client.subscribe(user, mediaType);
        if (this.closed) return;
        if (mediaType === "audio") {
          this.remoteAudio = user.audioTrack ?? null;
          if (this.remoteAudio) {
            if (this.speakerId) await this.remoteAudio.setPlaybackDevice(this.speakerId).catch(() => {});
            this.remoteAudio.play();
          }
        } else {
          this.remoteVideo = user.videoTrack ?? null;
          this.events.onRemoteVideoChanged();
        }
      } catch {
        // A failed subscribe is retried by the next user-published event.
      }
    });
    client.on("user-unpublished", (_user: IAgoraRTCRemoteUser, mediaType: "audio" | "video" | "datachannel") => {
      if (mediaType === "video") {
        this.remoteVideo = null;
        this.events.onRemoteVideoChanged();
      } else if (mediaType === "audio") {
        this.remoteAudio = null;
      }
    });
    client.on("user-joined", () => this.events.onRemoteJoined());
    client.on("user-left", (_user: IAgoraRTCRemoteUser, reason: string) => {
      this.remoteAudio = null;
      if (this.remoteVideo) {
        this.remoteVideo = null;
        this.events.onRemoteVideoChanged();
      }
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
      await client.publish(this.camera ? [this.mic, this.camera] : [this.mic]);
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

  // --- Controls ---------------------------------------------------------------

  async setMuted(muted: boolean) {
    await this.mic.setEnabled(!muted);
  }

  async setMicrophone(deviceId: string) {
    await this.mic.setDevice(deviceId);
  }

  /** Not every browser can route output (Safari/Firefox can't); throws then. */
  async setSpeaker(deviceId: string) {
    this.speakerId = deviceId;
    if (this.remoteAudio) await this.remoteAudio.setPlaybackDevice(deviceId);
  }

  /**
   * Camera on: open the device and publish. Camera off: unpublish and close
   * the track, which releases the device (the camera light goes off).
   * Throws CallError(kind "camera") if the camera can't be opened.
   */
  setCameraEnabled(enabled: boolean): Promise<void> {
    return this.enqueueCamera(async () => {
      if (enabled) {
        if (this.camera) return;
        await this.openCamera();
        if (this.client && this.camera && this.client.connectionState === "CONNECTED") {
          await this.client.publish(this.camera);
        }
      } else {
        await this.closeCamera();
      }
    });
  }

  /** Switch webcam. If the camera is off, the choice applies next time it turns on. */
  setCamera(deviceId: string): Promise<void> {
    return this.enqueueCamera(async () => {
      this.cameraId = deviceId;
      if (this.camera) await this.camera.setDevice(deviceId);
    });
  }

  async listDevices(): Promise<MediaDevices> {
    const [microphones, speakers, cameras] = await Promise.all([
      this.AgoraRTC.getMicrophones(true).catch(() => []),
      this.AgoraRTC.getPlaybackDevices(true).catch(() => []),
      this.AgoraRTC.getCameras(true).catch(() => []),
    ]);
    return { microphones, speakers, cameras };
  }

  /** Resume playback after an autoplay block (call from a click handler). */
  resumePlayback() {
    this.remoteAudio?.play();
  }

  /** Leaves the channel and releases the microphone and camera. */
  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.AgoraRTC.onMicrophoneChanged = undefined;
    this.AgoraRTC.onPlaybackDeviceChanged = undefined;
    this.AgoraRTC.onCameraChanged = undefined;
    this.AgoraRTC.onAutoplayFailed = undefined;
    this.remoteAudio?.stop();
    this.remoteVideo?.stop();
    this.remoteAudio = null;
    this.remoteVideo = null;
    // Stop capture first so the devices are released even if leave() hangs.
    this.mic.stop();
    this.mic.close();
    const camera = this.camera;
    this.camera = null;
    camera?.stop();
    camera?.close();
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.leave().catch(() => {});
    }
  }

  // --- Internals --------------------------------------------------------------

  private enqueueCamera(task: () => Promise<void>): Promise<void> {
    const run = this.cameraQueue.then(() => (this.closed ? undefined : task()));
    this.cameraQueue = run.catch(() => {});
    return run;
  }

  private async openCamera() {
    let camera: ICameraVideoTrack;
    try {
      camera = await this.AgoraRTC.createCameraVideoTrack({
        ...CAMERA_CONFIG,
        ...(this.cameraId ? { cameraId: this.cameraId } : {}),
      });
    } catch (e) {
      throw new CallError(deviceErrorMessage(e, "camera"), "camera");
    }
    if (this.closed) {
      // The call ended while the camera was starting: release it at once.
      camera.close();
      return;
    }
    this.camera = camera;
    this.cameraId = camera.getMediaStreamTrack().getSettings().deviceId ?? this.cameraId;
    // The OS can revoke the camera (another app, privacy toggle, unplug).
    camera.on("track-ended", () => {
      if (this.camera !== camera) return;
      void this.enqueueCamera(() => this.closeCamera());
      this.events.onCameraError("Your camera stopped. Turn it back on to continue with video.");
    });
    this.events.onLocalVideoChanged();
  }

  private async closeCamera() {
    const camera = this.camera;
    if (!camera) return;
    this.camera = null;
    if (this.client && this.client.connectionState === "CONNECTED") {
      await this.client.unpublish(camera).catch(() => {});
    }
    camera.stop();
    camera.close();
    this.events.onLocalVideoChanged();
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
        await this.remoteAudio?.setPlaybackDevice("default").catch(() => {});
      }
      await refresh();
    };
    this.AgoraRTC.onCameraChanged = async (info) => {
      // Active webcam unplugged: switch to another, or turn video off.
      if (info.state === "INACTIVE" && this.camera && info.device.deviceId === this.currentCameraId) {
        const [next] = await this.AgoraRTC.getCameras(true).catch(() => []);
        if (next) {
          await this.setCamera(next.deviceId).catch(() => {});
        } else {
          await this.setCameraEnabled(false).catch(() => {});
          this.events.onCameraError("Your camera was disconnected.");
        }
      }
      await refresh();
    };
    this.AgoraRTC.onAutoplayFailed = () => this.events.onAutoplayBlocked();
  }
}

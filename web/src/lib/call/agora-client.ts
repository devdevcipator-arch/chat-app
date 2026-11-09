import type {
  ConnectionDisconnectedReason,
  ConnectionState,
  IAgoraRTC,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  ILocalAudioTrack,
  ILocalTrack,
  ILocalVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteVideoTrack,
} from "agora-rtc-sdk-ng";
import type { AgoraTokenError, AgoraTokenResponse } from "@/lib/call/types";

// Browser-only wrapper around the Agora Web SDK for one call (1-on-1 or a
// group room): always a microphone, plus an optional camera that can be
// switched on and off. Every remote participant's audio plays; their video is
// exposed per participant for the UI to render.
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
    readonly kind: "mic" | "camera" | "screen" | "network" | "server" = "server",
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

/**
 * Screen picker errors. Closing the picker and a real "blocked" both surface
 * as NotAllowedError; only the OS-level block says so in its message.
 * Returns null when the user simply cancelled.
 */
function screenErrorMessage(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  const name = (error as { name?: string } | null)?.name;
  const message = String((error as { message?: string } | null)?.message ?? "");
  if (code === "PERMISSION_DENIED" || name === "NotAllowedError" || name === "AbortError") {
    if (/system/i.test(message)) {
      return "Your system is blocking screen sharing. Allow screen recording for this browser in your OS privacy settings, then try again.";
    }
    return null; // the user closed the picker
  }
  if (code === "NOT_SUPPORTED" || name === "NotSupportedError" || name === "TypeError") {
    return "This browser can't share your screen. Try a recent desktop Chrome, Edge, Firefox or Safari.";
  }
  if (code === "NOT_READABLE" || name === "NotReadableError") {
    return "Couldn't capture your screen. Close other screen recorders and try again.";
  }
  return "Couldn't start screen sharing. Please try again.";
}

/** Whether this browser can capture the screen at all (no mobile browsers). */
export function screenShareSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** Stops capture and releases a local track (ends the browser's sharing indicator). */
function closeTrack(track: ILocalTrack | null) {
  if (!track) return;
  track.stop();
  track.close();
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

/** Someone else in the call, as the UI needs them. */
export type RemoteParticipant = {
  /** Agora string account = their Supabase user id. */
  uid: string;
  /** Sending audio (false = muted or no mic). */
  audioOn: boolean;
  /** Their video, once subscribed (null = camera off). */
  videoTrack: IRemoteVideoTrack | null;
};

export type CallSessionEvents = {
  /** Someone joined the channel. */
  onRemoteJoined: (uid: string) => void;
  /** Someone left the channel ("Quit") or dropped ("ServerTimeOut"). */
  onRemoteLeft: (uid: string, reason: string) => void;
  /** Anyone's tracks or mute state changed, or someone joined or left. */
  onRemoteChanged: () => void;
  /** Our own camera track was created, closed or replaced. */
  onLocalVideoChanged: () => void;
  /** The camera failed or was unplugged; the call carries on without video. */
  onCameraError: (message: string) => void;
  /**
   * Screen sharing stopped on its own: the browser's "Stop sharing" bar, or
   * the shared window closed. (Also fires onLocalVideoChanged.)
   */
  onScreenShareEnded: () => void;
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
// "detail" keeps text sharp (frame rate drops first under load).
const SCREEN_CONFIG = { encoderConfig: "1080p_2", optimizationMode: "detail" } as const;

export type ScreenShareResult = "started" | "cancelled";

/**
 * One call's media session. Usage:
 *   const s = await CallSession.create(events, { video })   // asks for mic (+ camera)
 *   await s.join(channelName)
 *   await s.setCameraEnabled(false)                       // camera light goes off
 *   await s.startScreenShare()                            // replaces the camera
 *   await s.leave()                                       // releases every device
 *
 * A client publishes one video track at a time, so the screen takes the
 * camera's place while sharing and the camera comes back afterwards (if it
 * was on). The microphone is never touched by either.
 */
export class CallSession {
  private client: IAgoraRTCClient | null = null;
  private camera: ICameraVideoTrack | null = null;
  private cameraId: string | null = null;
  private speakerId: string | null = null;
  private screen: ILocalVideoTrack | null = null;
  /** Tab/system audio captured with the screen (Chrome/Edge, when ticked). */
  private screenAudio: ILocalAudioTrack | null = null;
  /** The camera was on when sharing started: turn it back on afterwards. */
  private resumeCamera = false;
  /** Serializes camera on/off/switch and screen start/stop so rapid clicks can't leak a track. */
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

  /** Whether anyone else is currently in the channel. */
  get remotePresent(): boolean {
    return (this.client?.remoteUsers.length ?? 0) > 0;
  }

  /** Everyone else in the channel, in join order. */
  get remoteParticipants(): RemoteParticipant[] {
    return (this.client?.remoteUsers ?? []).map((user) => ({
      uid: String(user.uid),
      audioOn: user.hasAudio,
      videoTrack: user.hasVideo ? (user.videoTrack ?? null) : null,
    }));
  }

  /** Our camera track while the camera is on (for local preview). */
  get localVideoTrack(): ICameraVideoTrack | null {
    return this.camera;
  }

  /** We're publishing our screen instead of the camera. */
  get isScreenSharing(): boolean {
    return this.screen !== null;
  }

  /** Our screen track while sharing (for the local preview). */
  get screenTrack(): ILocalVideoTrack | null {
    return this.screen;
  }

  /** While sharing: whether the camera comes back when sharing stops. */
  get cameraResumesAfterShare(): boolean {
    return this.resumeCamera;
  }

  /** 1-on-1 calls: the other person's video while they're sending it. */
  get remoteVideoTrack(): IRemoteVideoTrack | null {
    return this.remoteParticipants.find((p) => p.videoTrack)?.videoTrack ?? null;
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
        // Everyone's audio plays at once; the browser mixes it.
        if (mediaType === "audio" && user.audioTrack) {
          if (this.speakerId) await user.audioTrack.setPlaybackDevice(this.speakerId).catch(() => {});
          user.audioTrack.play();
        }
        this.events.onRemoteChanged();
      } catch {
        // A failed subscribe is retried by the next user-published event.
      }
    });
    // Muting (setEnabled(false)) and camera-off both arrive as unpublish.
    client.on("user-unpublished", () => this.events.onRemoteChanged());
    client.on("user-joined", (user: IAgoraRTCRemoteUser) => {
      this.events.onRemoteJoined(String(user.uid));
      this.events.onRemoteChanged();
    });
    client.on("user-left", (user: IAgoraRTCRemoteUser, reason: string) => {
      this.events.onRemoteLeft(String(user.uid), reason);
      this.events.onRemoteChanged();
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
      // Sharing may have started while we were still joining.
      await client.publish(this.localTracks());
    } catch (e) {
      if (this.closed) return;
      throw new CallError(
        (e as { code?: string }).code === "NETWORK_ERROR"
          ? "Can't reach the call server. Check your connection."
          : "Couldn't connect the call.",
        "network",
      );
    }
    // Others may already be in the channel (they joined first).
    for (const user of client.remoteUsers) this.events.onRemoteJoined(String(user.uid));
    this.events.onRemoteChanged();
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
    await Promise.all(
      (this.client?.remoteUsers ?? []).map((u) => u.audioTrack?.setPlaybackDevice(deviceId)),
    );
  }

  /**
   * Camera on: open the device and publish. Camera off: unpublish and close
   * the track, which releases the device (the camera light goes off).
   * Throws CallError(kind "camera") if the camera can't be opened.
   */
  setCameraEnabled(enabled: boolean): Promise<void> {
    return this.enqueueCamera(async () => {
      if (this.screen) {
        // The screen holds the video slot: just decide whether the camera
        // comes back when sharing stops.
        this.resumeCamera = enabled;
        this.events.onLocalVideoChanged();
        return;
      }
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

  /**
   * Opens the browser's screen picker and publishes the chosen screen in
   * place of the camera. Resolves "cancelled" if the picker was closed
   * (nothing changes). Throws CallError(kind "screen") on a real failure;
   * the camera and mic are left exactly as they were.
   */
  async startScreenShare(): Promise<ScreenShareResult> {
    const result = await this.enqueueVideo(async (): Promise<ScreenShareResult> => {
      if (this.screen) return "started";
      if (!screenShareSupported()) throw new CallError(screenErrorMessage({ name: "NotSupportedError" })!, "screen");

      // 1. Pick first: cancelling must not cost the camera.
      let video: ILocalVideoTrack;
      let audio: ILocalAudioTrack | null = null;
      try {
        // "auto": include tab/system audio when the browser offers it and the user ticks it.
        const created = await this.AgoraRTC.createScreenVideoTrack(SCREEN_CONFIG, "auto");
        [video, audio] = Array.isArray(created) ? created : [created, null];
      } catch (e) {
        const message = screenErrorMessage(e);
        if (message === null) return "cancelled";
        throw new CallError(message, "screen");
      }
      if (this.closed) {
        closeTrack(video);
        closeTrack(audio);
        return "cancelled";
      }

      // 2. Free the video slot. Closing (not just unpublishing) turns the camera light off.
      const cameraWasOn = !!this.camera;
      await this.closeCamera();

      // 3. Publish the screen (if we're not connected yet, join() publishes it).
      this.screen = video;
      this.screenAudio = audio;
      this.resumeCamera = cameraWasOn;
      try {
        if (this.connected) await this.client!.publish(audio ? [video, audio] : video);
      } catch {
        this.screen = null;
        this.screenAudio = null;
        closeTrack(video);
        closeTrack(audio);
        await this.restoreCamera(cameraWasOn);
        throw new CallError("Couldn't share your screen with the call. Please try again.", "screen");
      }

      // 4. The browser's own "Stop sharing" bar (or the shared window closing).
      video.on("track-ended", () => {
        if (this.screen !== video) return;
        void this.enqueueVideo(() => this.closeScreen()).then(() => this.events.onScreenShareEnded());
      });
      this.events.onLocalVideoChanged();
      return "started";
    });
    return result ?? "cancelled"; // the call ended first
  }

  /** Stops sharing and brings the camera back if it was on before. */
  async stopScreenShare(): Promise<void> {
    await this.enqueueVideo(() => this.closeScreen());
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
    for (const user of this.client?.remoteUsers ?? []) user.audioTrack?.play();
  }

  /** Leaves the channel and releases the microphone and camera. */
  async leave() {
    if (this.closed) return;
    this.closed = true;
    this.AgoraRTC.onMicrophoneChanged = undefined;
    this.AgoraRTC.onPlaybackDeviceChanged = undefined;
    this.AgoraRTC.onCameraChanged = undefined;
    this.AgoraRTC.onAutoplayFailed = undefined;
    for (const user of this.client?.remoteUsers ?? []) {
      user.audioTrack?.stop();
      user.videoTrack?.stop();
    }
    // Stop capture first so the devices are released even if leave() hangs.
    this.mic.stop();
    this.mic.close();
    const camera = this.camera;
    this.camera = null;
    camera?.stop();
    camera?.close();
    // Ends the browser's "sharing this tab/screen" indicator too.
    closeTrack(this.screen);
    closeTrack(this.screenAudio);
    this.screen = null;
    this.screenAudio = null;
    this.resumeCamera = false;
    const client = this.client;
    this.client = null;
    if (client) {
      client.removeAllListeners();
      await client.leave().catch(() => {});
    }
  }

  // --- Internals --------------------------------------------------------------

  private enqueueCamera(task: () => Promise<void>): Promise<void> {
    return this.enqueueVideo(task).then(() => {});
  }

  /** Camera and screen share one video slot, so they share one queue. */
  private enqueueVideo<T>(task: () => Promise<T>): Promise<T | undefined> {
    const run = this.cameraQueue.then(() => (this.closed ? undefined : task()));
    this.cameraQueue = run.catch(() => {});
    return run;
  }

  private get connected() {
    return !!this.client && this.client.connectionState === "CONNECTED";
  }

  /** What we publish: the mic, plus the screen or else the camera. */
  private localTracks(): ILocalTrack[] {
    if (this.screen) return this.screenAudio ? [this.mic, this.screen, this.screenAudio] : [this.mic, this.screen];
    return this.camera ? [this.mic, this.camera] : [this.mic];
  }

  private async closeScreen() {
    const screen = this.screen;
    if (!screen) return;
    const audio = this.screenAudio;
    this.screen = null;
    this.screenAudio = null;
    if (this.connected) await this.client!.unpublish(audio ? [screen, audio] : screen).catch(() => {});
    closeTrack(screen);
    closeTrack(audio);
    const resume = this.resumeCamera;
    this.resumeCamera = false;
    this.events.onLocalVideoChanged();
    await this.restoreCamera(resume);
  }

  /** Re-opens and publishes the camera after sharing; failures only warn. */
  private async restoreCamera(enabled: boolean) {
    if (!enabled || this.closed || this.camera) return;
    try {
      await this.openCamera();
    } catch (e) {
      this.events.onCameraError(e instanceof CallError ? e.message : deviceErrorMessage(e, "camera"));
      return;
    }
    if (!this.camera || !this.connected) return;
    try {
      await this.client!.publish(this.camera);
    } catch {
      await this.closeCamera(); // don't leave a camera running that nobody sees
      this.events.onCameraError("Couldn't turn your camera back on. Try the camera button.");
    }
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
        await Promise.all(
          (this.client?.remoteUsers ?? []).map((u) => u.audioTrack?.setPlaybackDevice("default").catch(() => {})),
        );
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

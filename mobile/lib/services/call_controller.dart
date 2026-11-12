import 'dart:async';

import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/api.dart';
import '../core/supabase.dart';
import '../data/call_repository.dart';
import '../data/profile_repository.dart';
import '../models/profile.dart';

enum CallPhase { idle, starting, outgoing, incoming, connecting, active, group, ended }

/// One Agora participant other than me.
class RemoteParticipant {
  RemoteParticipant(this.uid);
  final int uid;
  String? userId;
  bool videoOff = false;
}

/// App-wide voice/video call state machine (mirrors web/src/lib/call/controller.ts).
///
/// Signaling: start_call / answer_call / end_call / heartbeat_call RPCs, with
/// row changes on `calls` delivered over Realtime. Media: Agora RTC, joined
/// with a token from /api/agora/token using my Supabase user id as the
/// string user account (same as the web client, so both interoperate).
class CallController extends ChangeNotifier {
  CallController._();
  static final instance = CallController._();

  static const ringTimeout = Duration(seconds: 30);
  static const heartbeatInterval = Duration(seconds: 15);

  String? _meId;
  RealtimeChannel? _channel;

  CallPhase phase = CallPhase.idle;
  CallRow? call;
  String? chatId;

  /// The other person (1-on-1), or null in a group.
  Profile? peer;

  /// Group calls: the group's name and members (to name people in the room).
  String? groupTitle;
  Map<String, Profile> groupMembers = const {};
  bool get isGroup => groupTitle != null;

  bool isVideo = false;
  DateTime? connectedAt;
  bool reconnecting = false;
  bool micMuted = false;
  bool cameraOff = false;
  bool speakerOn = false;

  /// Ended screen.
  String? endMessage;

  /// Our outgoing 1-on-1 call wasn't answered: offer a voicemail.
  bool offerVoicemail = false;
  String? voicemailCallId;

  final List<RemoteParticipant> remotes = [];
  RtcEngine? engine;
  String? channelName;

  Timer? _ringTimer;
  Timer? _incomingTimer;
  Timer? _heartbeatTimer;
  Timer? _dismissTimer;
  int _gen = 0;

  bool get busy => phase != CallPhase.idle && phase != CallPhase.ended;

  String get title => isGroup ? groupTitle! : profileName(peer);

  Profile? profileFor(RemoteParticipant r) => r.userId == null ? null : (groupMembers[r.userId] ?? (peer?.id == r.userId ? peer : null));

  // --- Lifecycle -------------------------------------------------------------

  /// Starts listening for calls for the signed-in user.
  Future<void> attach(String meId) async {
    if (_meId == meId) return;
    await detach();
    _meId = meId;
    _channel = CallRepository.subscribe(meId, _onCallChange);
    final ringing = await CallRepository.ringingForMe(meId);
    if (ringing != null && _meId == meId) _onIncoming(ringing);
  }

  /// Signing out: hang up and stop listening.
  Future<void> detach() async {
    if (busy) await hangUp();
    _resetToIdle();
    final channel = _channel;
    _channel = null;
    _meId = null;
    if (channel != null) await supabase.removeChannel(channel);
  }

  // --- Signaling -------------------------------------------------------------

  void _onCallChange(String event, CallRow row) {
    if (row.isGroup) return; // group rooms never ring; the chat screen shows them
    final current = call;
    switch (row.status) {
      case 'ringing':
        if (event == 'INSERT' && row.calleeId == _meId) _onIncoming(row);
      case 'accepted':
        if (current?.id != row.id) return;
        if (phase == CallPhase.outgoing) {
          call = row;
          _ringTimer?.cancel();
          unawaited(_connect());
        } else if (phase == CallPhase.incoming) {
          _resetToIdle(); // answered on another device
        }
      case 'declined':
        if (current?.id != row.id) return;
        if (phase == CallPhase.outgoing) {
          _finish('${profileName(peer)} declined the call.', voicemailCallId: row.id);
        } else {
          _resetToIdle();
        }
      case 'cancelled' || 'missed' || 'ended':
        if (current?.id != row.id) return;
        if (phase == CallPhase.incoming) {
          _finish('Missed call from ${profileName(peer)}.');
        } else if (phase == CallPhase.outgoing && row.status == 'missed') {
          _finish('No answer.', voicemailCallId: row.id);
        } else {
          _finish('Call ended.');
        }
    }
  }

  Future<void> _onIncoming(CallRow row) async {
    if (busy || call?.id == row.id) return;
    final gen = ++_gen;
    final caller = await ProfileRepository.fetchPublic(row.callerId).catchError((_) => null);
    if (gen != _gen || busy) return;
    _clearTimers();
    _resetFields();
    call = row;
    chatId = row.chatId;
    peer = caller ?? Profile(id: row.callerId);
    isVideo = row.isVideo;
    phase = CallPhase.incoming;
    final age = DateTime.now().toUtc().difference(row.createdAt.toUtc());
    final left = ringTimeout + const Duration(seconds: 5) - age;
    _incomingTimer = Timer(left < const Duration(seconds: 5) ? const Duration(seconds: 5) : left, () {
      if (phase == CallPhase.incoming && call?.id == row.id) _finish('Missed call from ${profileName(peer)}.');
    });
    notifyListeners();
  }

  // --- Actions ---------------------------------------------------------------

  Future<void> startDirect({required String chatId, required Profile peer, required bool video}) async {
    if (busy) return;
    final gen = ++_gen;
    _clearTimers();
    _resetFields();
    this.chatId = chatId;
    this.peer = peer;
    isVideo = video;
    speakerOn = video;
    phase = CallPhase.starting;
    notifyListeners();

    if (!await _permissions(video)) {
      if (gen == _gen) _finish(video ? 'Camera and microphone access are needed for video calls.' : 'Microphone access is needed for calls.');
      return;
    }
    if (gen != _gen) return;

    CallRow row;
    try {
      row = await CallRepository.start(chatId, video ? 'video' : 'voice');
    } on StartCallException catch (e) {
      if (gen != _gen) return;
      switch (e.reason) {
        case 'callee-busy':
          _finish('${peer.name} is on another call.', voicemailCallId: '');
        case 'caller-busy':
          _finish("You're already in another call.");
        case 'unavailable':
          _finish('That account is no longer available.');
        default:
          _finish("Couldn't start the call. Please try again.");
      }
      return;
    }
    if (gen != _gen) {
      unawaited(CallRepository.end(row.id)); // hung up while starting
      return;
    }
    call = row;
    phase = CallPhase.outgoing;
    _ringTimer = Timer(ringTimeout, () async {
      if (phase != CallPhase.outgoing || call?.id != row.id) return;
      await CallRepository.end(row.id, timeout: true);
      if (phase == CallPhase.outgoing && call?.id == row.id) _finish('No answer.', voicemailCallId: row.id);
    });
    notifyListeners();
  }

  /// Joins (or opens) the group's call room.
  Future<void> joinGroup({
    required String chatId,
    required String title,
    required Map<String, Profile> members,
    required bool video,
  }) async {
    if (busy) return;
    final gen = ++_gen;
    _clearTimers();
    _resetFields();
    this.chatId = chatId;
    groupTitle = title;
    groupMembers = members;
    isVideo = video;
    speakerOn = true;
    phase = CallPhase.group;
    notifyListeners();

    if (!await _permissions(video)) {
      if (gen == _gen) _finish('Microphone access is needed for calls.');
      return;
    }
    CallRow row;
    try {
      row = await CallRepository.start(chatId, video ? 'video' : 'voice');
    } on StartCallException catch (e) {
      if (gen != _gen) return;
      _finish(switch (e.reason) {
        'call-full' => 'This call is full.',
        'caller-busy' => "You're already in another call.",
        _ => "Couldn't join the call. Please try again.",
      });
      return;
    }
    if (gen != _gen) {
      unawaited(CallRepository.end(row.id));
      return;
    }
    call = row;
    // Joining a room that's already a video call turns my camera on too.
    isVideo = row.isVideo;
    await _connect();
  }

  Future<void> accept() async {
    final row = call;
    if (phase != CallPhase.incoming || row == null) return;
    final gen = ++_gen;
    _incomingTimer?.cancel();
    phase = CallPhase.connecting;
    speakerOn = isVideo;
    notifyListeners();
    if (!await _permissions(isVideo)) {
      await CallRepository.answer(row.id, accept: false);
      if (gen == _gen) _finish('Microphone access is needed for calls.');
      return;
    }
    final answered = await CallRepository.answer(row.id, accept: true);
    if (gen != _gen) return;
    if (answered == null) {
      _finish('This call is no longer available.');
      return;
    }
    call = answered;
    await _connect();
  }

  Future<void> decline() async {
    final row = call;
    if (phase != CallPhase.incoming || row == null) return;
    _resetToIdle();
    await CallRepository.answer(row.id, accept: false);
  }

  Future<void> hangUp() async {
    final row = call;
    switch (phase) {
      case CallPhase.idle:
        return;
      case CallPhase.incoming:
        return decline();
      case CallPhase.ended:
        return dismiss();
      case CallPhase.starting:
        _resetToIdle();
      case CallPhase.outgoing:
        _resetToIdle();
        if (row != null) await CallRepository.end(row.id);
      case CallPhase.connecting || CallPhase.active || CallPhase.group:
        final wasGroup = isGroup;
        _finish(wasGroup ? 'You left the call.' : 'Call ended.');
        if (row != null) await CallRepository.end(row.id);
    }
  }

  void dismiss() {
    if (phase == CallPhase.ended) _resetToIdle();
  }

  Future<void> toggleMic() async {
    micMuted = !micMuted;
    notifyListeners();
    await engine?.muteLocalAudioStream(micMuted);
  }

  Future<void> toggleCamera() async {
    cameraOff = !cameraOff;
    notifyListeners();
    await engine?.muteLocalVideoStream(cameraOff);
    await engine?.enableLocalVideo(!cameraOff);
  }

  Future<void> toggleSpeaker() async {
    speakerOn = !speakerOn;
    notifyListeners();
    try {
      await engine?.setEnableSpeakerphone(speakerOn);
    } catch (_) {}
  }

  Future<void> switchCamera() async {
    try {
      await engine?.switchCamera();
    } catch (_) {}
  }

  // --- Media -----------------------------------------------------------------

  Future<bool> _permissions(bool video) async {
    final statuses = await [Permission.microphone, if (video) Permission.camera].request();
    final mic = statuses[Permission.microphone]?.isGranted ?? false;
    // A video call without a camera still works as audio.
    if (video && !(statuses[Permission.camera]?.isGranted ?? false)) cameraOff = true;
    return mic;
  }

  Future<void> _connect() async {
    final row = call;
    final chat = chatId;
    final meId = _meId;
    if (row == null || chat == null || meId == null) return;
    final gen = _gen;
    if (!isGroup) phase = CallPhase.connecting;
    notifyListeners();

    AgoraToken token;
    try {
      token = await CallRepository.token(chat);
    } catch (e) {
      if (gen != _gen) return;
      await CallRepository.end(row.id);
      _finish(e is ApiException ? e.message : "Couldn't connect the call.");
      return;
    }
    if (gen != _gen) return;

    final rtc = createAgoraRtcEngine();
    engine = rtc;
    channelName = token.channelName;
    try {
      await rtc.initialize(RtcEngineContext(
        appId: token.appId,
        channelProfile: ChannelProfileType.channelProfileCommunication,
      ));
      rtc.registerEventHandler(RtcEngineEventHandler(
        onJoinChannelSuccess: (connection, elapsed) {
          if (engine != rtc) return;
          connectedAt = DateTime.now();
          if (!isGroup) phase = CallPhase.active;
          _startHeartbeat(row.id);
          notifyListeners();
        },
        onUserJoined: (connection, uid, elapsed) {
          if (engine != rtc || remotes.any((r) => r.uid == uid)) return;
          remotes.add(RemoteParticipant(uid));
          unawaited(_resolveUser(rtc, uid));
          notifyListeners();
        },
        onUserOffline: (connection, uid, reason) {
          if (engine != rtc) return;
          remotes.removeWhere((r) => r.uid == uid);
          notifyListeners();
        },
        onUserInfoUpdated: (uid, info) {
          if (engine != rtc) return;
          for (final r in remotes) {
            if (r.uid == uid) r.userId = info.userAccount;
          }
          notifyListeners();
        },
        onUserMuteVideo: (connection, uid, muted) {
          if (engine != rtc) return;
          for (final r in remotes) {
            if (r.uid == uid) r.videoOff = muted;
          }
          notifyListeners();
        },
        onTokenPrivilegeWillExpire: (connection, _) async {
          try {
            final fresh = await CallRepository.token(chat);
            if (engine == rtc) await rtc.renewToken(fresh.token);
          } catch (_) {}
        },
        onConnectionStateChanged: (connection, state, reason) {
          if (engine != rtc) return;
          reconnecting = state == ConnectionStateType.connectionStateReconnecting;
          notifyListeners();
          if (state == ConnectionStateType.connectionStateFailed) {
            unawaited(CallRepository.end(row.id));
            _finish('Connection lost.');
          }
        },
      ));
      await rtc.enableAudio();
      if (isVideo) {
        await rtc.enableVideo();
        if (cameraOff) {
          await rtc.enableLocalVideo(false);
        } else {
          await rtc.startPreview();
        }
      }
      await rtc.setDefaultAudioRouteToSpeakerphone(speakerOn);
      await rtc.joinChannelWithUserAccount(
        token: token.token,
        channelId: token.channelName,
        userAccount: meId,
        options: ChannelMediaOptions(
          clientRoleType: ClientRoleType.clientRoleBroadcaster,
          channelProfile: ChannelProfileType.channelProfileCommunication,
          publishMicrophoneTrack: true,
          publishCameraTrack: isVideo && !cameraOff,
          autoSubscribeAudio: true,
          autoSubscribeVideo: true,
        ),
      );
    } catch (e) {
      debugPrint('Agora join failed: $e');
      if (gen != _gen) return;
      await CallRepository.end(row.id);
      _finish("Couldn't connect the call.");
    }
  }

  Future<void> _resolveUser(RtcEngine rtc, int uid) async {
    try {
      final info = await rtc.getUserInfoByUid(uid);
      for (final r in remotes) {
        if (r.uid == uid && info.userAccount != null) r.userId = info.userAccount;
      }
      if (engine == rtc) notifyListeners();
    } catch (_) {
      // onUserInfoUpdated will fill it in.
    }
  }

  void _startHeartbeat(String callId) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(heartbeatInterval, (_) async {
      final alive = await CallRepository.heartbeat(callId);
      if (alive == false && call?.id == callId && busy) _finish(isGroup ? 'The call ended.' : 'Call ended.');
    });
  }

  // --- State helpers ---------------------------------------------------------

  /// Tears down media and shows the ended screen (or goes idle if [message] is null).
  /// A non-null [voicemailCallId] offers a voicemail ('' = not linked to a call).
  void _finish(String? message, {String? voicemailCallId}) {
    _gen++;
    _clearTimers();
    _releaseEngine();
    if (message == null) {
      _resetToIdle();
      return;
    }
    phase = CallPhase.ended;
    endMessage = message;
    offerVoicemail = voicemailCallId != null && !isGroup && peer != null;
    this.voicemailCallId = (voicemailCallId?.isEmpty ?? true) ? null : voicemailCallId;
    if (!offerVoicemail) _dismissTimer = Timer(const Duration(milliseconds: 2500), dismiss);
    notifyListeners();
  }

  void _resetToIdle() {
    _gen++;
    _clearTimers();
    _releaseEngine();
    _resetFields();
    phase = CallPhase.idle;
    notifyListeners();
  }

  void _resetFields() {
    call = null;
    chatId = null;
    peer = null;
    groupTitle = null;
    groupMembers = const {};
    isVideo = false;
    connectedAt = null;
    reconnecting = false;
    micMuted = false;
    cameraOff = false;
    speakerOn = false;
    endMessage = null;
    offerVoicemail = false;
    voicemailCallId = null;
    remotes.clear();
  }

  void _clearTimers() {
    _ringTimer?.cancel();
    _incomingTimer?.cancel();
    _heartbeatTimer?.cancel();
    _dismissTimer?.cancel();
  }

  void _releaseEngine() {
    final rtc = engine;
    engine = null;
    channelName = null;
    remotes.clear();
    if (rtc == null) return;
    unawaited(() async {
      try {
        await rtc.leaveChannel();
      } catch (_) {}
      try {
        await rtc.release();
      } catch (_) {}
    }());
  }
}

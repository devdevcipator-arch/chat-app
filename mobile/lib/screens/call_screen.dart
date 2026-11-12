import 'dart:async';

import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/ids.dart';
import '../core/media.dart';
import '../core/supabase.dart';
import '../data/chat_repository.dart';
import '../services/call_controller.dart';
import '../widgets/avatar.dart';
import '../widgets/voice_recorder.dart';

/// Full-screen call UI, shown above the app while a call is in progress.
class CallScreen extends StatefulWidget {
  const CallScreen({super.key});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  final _calls = CallController.instance;
  Timer? _ticker;
  bool _recordingVoicemail = false;
  bool _sendingVoicemail = false;
  String? _voicemailError;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _calls.connectedAt != null) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  String _status() {
    final c = _calls;
    switch (c.phase) {
      case CallPhase.starting:
        return 'Starting…';
      case CallPhase.outgoing:
        return 'Ringing…';
      case CallPhase.incoming:
        return 'Incoming ${c.isVideo ? 'video' : 'voice'} call';
      case CallPhase.connecting:
        return 'Connecting…';
      case CallPhase.active || CallPhase.group:
        if (c.reconnecting) return 'Reconnecting…';
        final at = c.connectedAt;
        if (at == null) return c.isGroup ? 'Joining…' : 'Connecting…';
        final elapsed = formatDuration(DateTime.now().difference(at).inSeconds);
        return c.isGroup ? '$elapsed · ${c.remotes.length + 1} in call' : elapsed;
      case CallPhase.ended:
        return c.endMessage ?? 'Call ended';
      case CallPhase.idle:
        return '';
    }
  }

  Future<void> _sendVoicemail(Recording rec) async {
    final chatId = _calls.chatId;
    final me = supabase.auth.currentUser?.id;
    if (chatId == null || me == null) return;
    setState(() {
      _recordingVoicemail = false;
      _sendingVoicemail = true;
      _voicemailError = null;
    });
    try {
      await ChatRepository.sendMedia(
        id: uuidV4(),
        chatId: chatId,
        senderId: me,
        file: rec.file,
        fileName: 'voicemail.m4a',
        type: mediaTypeFor('voicemail.m4a')!,
        messageType: 'voicemail',
        durationSeconds: rec.seconds.clamp(1, 120),
        callId: _calls.voicemailCallId,
      );
      if (mounted) setState(() => _sendingVoicemail = false);
      _calls.dismiss();
    } catch (e) {
      if (mounted) {
        setState(() {
          _sendingVoicemail = false;
          _voicemailError = e is ApiException ? e.message : 'Voicemail not sent. Please try again.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _calls.phase == CallPhase.ended) _calls.dismiss();
      },
      child: ListenableBuilder(
        listenable: _calls,
        builder: (context, _) => Scaffold(
          backgroundColor: const Color(0xFF0A0A0A),
          body: _calls.phase == CallPhase.idle ? const SizedBox.shrink() : _body(context),
        ),
      ),
    );
  }

  Widget _body(BuildContext context) {
    final c = _calls;
    final showVideo = c.isVideo && c.engine != null && (c.phase == CallPhase.active || c.phase == CallPhase.group || c.phase == CallPhase.connecting);
    return Stack(
      children: [
        if (showVideo) Positioned.fill(child: _videoStage()),
        SafeArea(
          child: Column(
            children: [
              const SizedBox(height: 32),
              if (!showVideo || c.remotes.isEmpty) ...[
                Avatar(
                  name: c.title,
                  imageUrl: c.isGroup ? null : c.peer?.avatarImageUrl,
                  group: c.isGroup,
                  size: 112,
                ),
                const SizedBox(height: 20),
              ],
              Text(
                c.title,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 6),
              Text(_status(), style: const TextStyle(color: Colors.white70, fontSize: 15)),
              if (c.isGroup && !c.isVideo && c.remotes.isNotEmpty) ...[
                const SizedBox(height: 24),
                Wrap(
                  spacing: 16,
                  runSpacing: 16,
                  alignment: WrapAlignment.center,
                  children: [
                    for (final r in c.remotes)
                      Column(children: [
                        Avatar(name: c.profileFor(r)?.name ?? '?', imageUrl: c.profileFor(r)?.avatarImageUrl, size: 56),
                        const SizedBox(height: 4),
                        Text(c.profileFor(r)?.name ?? 'Joining…', style: const TextStyle(color: Colors.white70, fontSize: 12)),
                      ]),
                  ],
                ),
              ],
              const Spacer(),
              _controls(context),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ],
    );
  }

  // Video views are native platform views: keep one controller per uid for
  // the engine's lifetime instead of recreating them on every rebuild.
  RtcEngine? _viewsEngine;
  VideoViewController? _localView;
  final _remoteViews = <int, VideoViewController>{};

  Widget _videoStage() {
    final c = _calls;
    final rtc = c.engine!;
    final channel = c.channelName;
    if (_viewsEngine != rtc) {
      _viewsEngine = rtc;
      _localView = null;
      _remoteViews.clear();
    }
    _remoteViews.removeWhere((uid, _) => !c.remotes.any((r) => r.uid == uid));

    final local = c.cameraOff
        ? const ColoredBox(color: Color(0xFF1F1F1F), child: Center(child: Icon(Icons.videocam_off, color: Colors.white54)))
        : AgoraVideoView(
            key: const ValueKey('local-video'),
            controller: _localView ??= VideoViewController(rtcEngine: rtc, canvas: const VideoCanvas(uid: 0)),
          );

    Widget remote(RemoteParticipant r) => r.videoOff || channel == null
        ? ColoredBox(
            color: const Color(0xFF141414),
            child: Center(child: Avatar(name: c.profileFor(r)?.name ?? '?', imageUrl: c.profileFor(r)?.avatarImageUrl, size: 64)),
          )
        : AgoraVideoView(
            key: ValueKey('remote-${r.uid}'),
            controller: _remoteViews.putIfAbsent(
              r.uid,
              () => VideoViewController.remote(
                rtcEngine: rtc,
                canvas: VideoCanvas(uid: r.uid),
                connection: RtcConnection(channelId: channel),
              ),
            ),
          );

    if (c.remotes.isEmpty) return local;
    if (c.remotes.length == 1) {
      return Stack(children: [
        Positioned.fill(child: remote(c.remotes.first)),
        Positioned(
          right: 16,
          bottom: 140,
          width: 110,
          height: 160,
          child: ClipRRect(borderRadius: BorderRadius.circular(12), child: local),
        ),
      ]);
    }
    final tiles = [local, for (final r in c.remotes) remote(r)];
    return GridView.count(
      crossAxisCount: 2,
      childAspectRatio: 3 / 4,
      padding: const EdgeInsets.only(top: 140, bottom: 140),
      children: [for (final t in tiles) Padding(padding: const EdgeInsets.all(2), child: ClipRRect(borderRadius: BorderRadius.circular(8), child: t))],
    );
  }

  Widget _controls(BuildContext context) {
    final c = _calls;
    switch (c.phase) {
      case CallPhase.incoming:
        return Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _RoundButton(icon: Icons.call_end, color: Colors.red, label: 'Decline', onTap: c.decline),
            _RoundButton(icon: c.isVideo ? Icons.videocam : Icons.call, color: Colors.green, label: 'Accept', onTap: c.accept),
          ],
        );
      case CallPhase.ended:
        if (_recordingVoicemail) {
          return Material(
            color: Theme.of(context).colorScheme.surface,
            child: VoiceRecorderBar(
              maxSeconds: 120,
              onCancel: () => setState(() => _recordingVoicemail = false),
              onDone: _sendVoicemail,
            ),
          );
        }
        return Column(
          children: [
            if (_voicemailError != null)
              Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(_voicemailError!, style: const TextStyle(color: Colors.redAccent))),
            if (_sendingVoicemail) const Padding(padding: EdgeInsets.only(bottom: 12), child: CircularProgressIndicator()),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                if (c.offerVoicemail && !_sendingVoicemail)
                  _RoundButton(
                    icon: Icons.voicemail,
                    color: Theme.of(context).colorScheme.primary,
                    label: 'Voicemail',
                    onTap: () => setState(() => _recordingVoicemail = true),
                  ),
                _RoundButton(icon: Icons.close, color: Colors.white24, label: 'Close', onTap: c.dismiss),
              ],
            ),
          ],
        );
      default:
        final live = c.phase == CallPhase.active || c.phase == CallPhase.group || c.phase == CallPhase.connecting;
        return Wrap(
          alignment: WrapAlignment.center,
          spacing: 20,
          runSpacing: 16,
          children: [
            if (live)
              _RoundButton(
                icon: c.micMuted ? Icons.mic_off : Icons.mic,
                color: c.micMuted ? Colors.white : Colors.white24,
                iconColor: c.micMuted ? Colors.black : Colors.white,
                label: c.micMuted ? 'Unmute' : 'Mute',
                onTap: c.toggleMic,
              ),
            if (live && c.isVideo)
              _RoundButton(
                icon: c.cameraOff ? Icons.videocam_off : Icons.videocam,
                color: c.cameraOff ? Colors.white : Colors.white24,
                iconColor: c.cameraOff ? Colors.black : Colors.white,
                label: 'Camera',
                onTap: c.toggleCamera,
              ),
            if (live && c.isVideo) _RoundButton(icon: Icons.cameraswitch, color: Colors.white24, label: 'Flip', onTap: c.switchCamera),
            if (live)
              _RoundButton(
                icon: c.speakerOn ? Icons.volume_up : Icons.hearing,
                color: c.speakerOn ? Colors.white : Colors.white24,
                iconColor: c.speakerOn ? Colors.black : Colors.white,
                label: 'Speaker',
                onTap: c.toggleSpeaker,
              ),
            _RoundButton(icon: Icons.call_end, color: Colors.red, label: c.isGroup ? 'Leave' : 'End', onTap: c.hangUp),
          ],
        );
    }
  }
}

class _RoundButton extends StatelessWidget {
  const _RoundButton({required this.icon, required this.color, required this.label, required this.onTap, this.iconColor = Colors.white});

  final IconData icon;
  final Color color;
  final Color iconColor;
  final String label;
  final FutureOr<void> Function() onTap;

  @override
  Widget build(BuildContext context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Material(
            color: color,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: () => onTap(),
              child: Padding(padding: const EdgeInsets.all(18), child: Icon(icon, color: iconColor, size: 28)),
            ),
          ),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      );
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';

import '../core/media.dart';

/// Only one clip plays at a time across the app.
class _NowPlaying {
  static AudioPlayer? current;

  static Future<void> claim(AudioPlayer player) async {
    final previous = current;
    current = player;
    if (previous != null && previous != player) await previous.pause();
  }
}

/// Compact play/pause + seek bar for voice notes, voicemails and audio files.
class AudioPlayerBar extends StatefulWidget {
  const AudioPlayerBar({
    super.key,
    this.url,
    this.localPath,
    this.durationSeconds,
    this.foreground,
    this.onFirstPlay,
  });

  final String? url;
  final String? localPath;

  /// Known length (from the message), shown before the file loads.
  final int? durationSeconds;
  final Color? foreground;

  /// Called the first time playback starts (e.g. to mark a voicemail played).
  final VoidCallback? onFirstPlay;

  @override
  State<AudioPlayerBar> createState() => _AudioPlayerBarState();
}

class _AudioPlayerBarState extends State<AudioPlayerBar> {
  final _player = AudioPlayer();
  final _subs = <StreamSubscription<Object?>>[];
  bool _loaded = false;
  bool _loading = false;
  bool _failed = false;
  bool _played = false;
  Duration _position = Duration.zero;
  Duration? _duration;
  PlayerState? _state;

  @override
  void initState() {
    super.initState();
    _subs
      ..add(_player.positionStream.listen((p) => mounted ? setState(() => _position = p) : null))
      ..add(_player.durationStream.listen((d) => mounted ? setState(() => _duration = d) : null))
      ..add(_player.playerStateStream.listen((s) {
        if (!mounted) return;
        setState(() => _state = s);
        if (s.processingState == ProcessingState.completed) {
          unawaited(_player.pause());
          unawaited(_player.seek(Duration.zero));
        }
      }));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    if (_NowPlaying.current == _player) _NowPlaying.current = null;
    unawaited(_player.dispose());
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_player.playing) {
      await _player.pause();
      return;
    }
    if (!_loaded) {
      setState(() {
        _loading = true;
        _failed = false;
      });
      try {
        if (widget.localPath != null) {
          await _player.setFilePath(widget.localPath!);
        } else if (widget.url != null) {
          await _player.setUrl(widget.url!);
        } else {
          throw StateError('no source');
        }
        _loaded = true;
      } catch (_) {
        if (mounted) setState(() => _failed = true);
        return;
      } finally {
        if (mounted) setState(() => _loading = false);
      }
    }
    await _NowPlaying.claim(_player);
    if (!_played) {
      _played = true;
      widget.onFirstPlay?.call();
    }
    unawaited(_player.play());
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.foreground ?? Theme.of(context).colorScheme.onSurface;
    final total = _duration ?? (widget.durationSeconds != null ? Duration(seconds: widget.durationSeconds!) : null);
    final playing = _state?.playing == true && _state?.processingState != ProcessingState.completed;
    final max = (total?.inMilliseconds ?? 0).toDouble();
    final value = max <= 0 ? 0.0 : _position.inMilliseconds.clamp(0, max).toDouble();

    return SizedBox(
      width: 230,
      child: Row(
        children: [
          SizedBox.square(
            dimension: 40,
            child: _loading
                ? Padding(
                    padding: const EdgeInsets.all(10),
                    child: CircularProgressIndicator(strokeWidth: 2, color: color),
                  )
                : IconButton(
                    padding: EdgeInsets.zero,
                    onPressed: _toggle,
                    icon: Icon(
                      _failed ? Icons.refresh : (playing ? Icons.pause_rounded : Icons.play_arrow_rounded),
                      color: color,
                      size: 30,
                    ),
                  ),
          ),
          Expanded(
            child: SliderTheme(
              data: SliderTheme.of(context).copyWith(
                trackHeight: 3,
                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
                activeTrackColor: color,
                inactiveTrackColor: color.withValues(alpha: 0.3),
                thumbColor: color,
              ),
              child: Slider(
                value: value,
                max: max <= 0 ? 1 : max,
                onChanged: max <= 0 || !_loaded ? null : (v) => _player.seek(Duration(milliseconds: v.round())),
              ),
            ),
          ),
          Text(
            _failed
                ? 'Error'
                : formatDuration(((playing || _position > Duration.zero) ? _position : (total ?? Duration.zero)).inSeconds),
            style: TextStyle(color: color, fontSize: 12, fontFeatures: const [FontFeature.tabularFigures()]),
          ),
          const SizedBox(width: 4),
        ],
      ),
    );
  }
}

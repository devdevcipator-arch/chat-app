import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import '../core/ids.dart';
import '../core/media.dart';

/// A finished recording: AAC in an .m4a container (uploads as audio/mp4).
class Recording {
  const Recording(this.file, this.seconds);
  final File file;
  final int seconds;
}

/// Inline recorder that replaces the composer while recording a voice note
/// (or a voicemail). Starts as soon as it's shown.
class VoiceRecorderBar extends StatefulWidget {
  const VoiceRecorderBar({
    super.key,
    required this.onDone,
    required this.onCancel,
    this.maxSeconds = 300,
    this.sendLabel = 'Send',
  });

  final ValueChanged<Recording> onDone;
  final VoidCallback onCancel;
  final int maxSeconds;
  final String sendLabel;

  @override
  State<VoiceRecorderBar> createState() => _VoiceRecorderBarState();
}

class _VoiceRecorderBarState extends State<VoiceRecorderBar> {
  final _recorder = AudioRecorder();
  final _watch = Stopwatch();
  Timer? _ticker;
  StreamSubscription<Amplitude>? _amp;
  double _level = 0;
  String? _path;
  String? _error;
  bool _finishing = false;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    unawaited(_amp?.cancel());
    unawaited(_recorder.dispose());
    super.dispose();
  }

  Future<void> _start() async {
    final granted = await Permission.microphone.request().isGranted;
    if (!granted) {
      if (mounted) setState(() => _error = 'Microphone access is needed to record.');
      return;
    }
    try {
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/voice-${uuidV4()}.m4a';
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 64000, sampleRate: 44100, numChannels: 1),
        path: path,
      );
      _path = path;
      _watch.start();
      _ticker = Timer.periodic(const Duration(milliseconds: 250), (_) {
        if (!mounted) return;
        setState(() {});
        if (_watch.elapsed.inSeconds >= widget.maxSeconds) unawaited(_finish());
      });
      _amp = _recorder.onAmplitudeChanged(const Duration(milliseconds: 120)).listen((a) {
        // dBFS (-160..0) to 0..1
        if (mounted) setState(() => _level = ((a.current + 50) / 50).clamp(0.0, 1.0));
      });
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't start recording.");
    }
  }

  Future<void> _finish() async {
    if (_finishing) return;
    _finishing = true;
    _ticker?.cancel();
    _watch.stop();
    final seconds = _watch.elapsed.inMilliseconds / 1000;
    final path = await _recorder.stop() ?? _path;
    if (!mounted) return;
    if (path == null || seconds < 1) {
      setState(() {
        _error = 'Hold on a little longer — recordings must be at least 1 second.';
        _finishing = false;
      });
      return;
    }
    widget.onDone(Recording(File(path), seconds.round().clamp(1, widget.maxSeconds)));
  }

  Future<void> _cancel() async {
    _ticker?.cancel();
    try {
      final path = await _recorder.stop();
      if (path != null) await File(path).delete();
    } catch (_) {}
    widget.onCancel();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: scheme.outlineVariant))),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Discard',
            onPressed: _cancel,
            icon: Icon(Icons.delete_outline, color: scheme.error),
          ),
          Expanded(
            child: _error != null
                ? Text(_error!, style: TextStyle(color: scheme.error))
                : Row(
                    children: [
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 120),
                        width: 10 + 10 * _level,
                        height: 10 + 10 * _level,
                        decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 12),
                      Text(
                        '${formatDuration(_watch.elapsed.inSeconds)} / ${formatDuration(widget.maxSeconds)}',
                        style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
                      ),
                    ],
                  ),
          ),
          if (_error == null)
            FilledButton.icon(
              onPressed: _finishing ? null : _finish,
              icon: const Icon(Icons.send_rounded, size: 18),
              label: Text(widget.sendLabel),
            ),
        ],
      ),
    );
  }
}

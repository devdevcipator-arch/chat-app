import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

/// Full-screen, zoomable image.
class ImageViewerScreen extends StatelessWidget {
  const ImageViewerScreen({super.key, this.url, this.localPath, this.title});

  final String? url;
  final String? localPath;
  final String? title;

  @override
  Widget build(BuildContext context) {
    final Widget image = localPath != null
        ? Image.file(File(localPath!), fit: BoxFit.contain)
        : Image.network(
            url!,
            fit: BoxFit.contain,
            loadingBuilder: (context, child, progress) =>
                progress == null ? child : const Center(child: CircularProgressIndicator()),
            errorBuilder: (_, _, _) => const Center(
              child: Text("Couldn't load the image.", style: TextStyle(color: Colors.white70)),
            ),
          );
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: title == null ? null : Text(title!, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          if (url != null)
            IconButton(
              tooltip: 'Open in browser',
              onPressed: () => openExternally(url!),
              icon: const Icon(Icons.open_in_new),
            ),
        ],
      ),
      body: InteractiveViewer(maxScale: 5, child: Center(child: image)),
    );
  }
}

/// Plays a video from a URL or local file, with simple controls.
class VideoPlayerView extends StatefulWidget {
  const VideoPlayerView({super.key, this.url, this.localPath, this.autoPlay = true});

  final String? url;
  final String? localPath;
  final bool autoPlay;

  @override
  State<VideoPlayerView> createState() => _VideoPlayerViewState();
}

class _VideoPlayerViewState extends State<VideoPlayerView> {
  late final VideoPlayerController _controller = widget.localPath != null
      ? VideoPlayerController.file(File(widget.localPath!))
      : VideoPlayerController.networkUrl(Uri.parse(widget.url!));
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTick);
    _controller.initialize().then((_) {
      if (!mounted) return;
      setState(() {});
      if (widget.autoPlay) _controller.play();
    }, onError: (Object _) {
      if (mounted) setState(() => _failed = true);
    });
  }

  void _onTick() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onTick);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) {
      return const Center(child: Text("Couldn't play this video.", style: TextStyle(color: Colors.white70)));
    }
    final value = _controller.value;
    if (!value.isInitialized) return const Center(child: CircularProgressIndicator());
    return GestureDetector(
      onTap: () => value.isPlaying ? _controller.pause() : _controller.play(),
      child: Stack(
        alignment: Alignment.center,
        children: [
          AspectRatio(aspectRatio: value.aspectRatio == 0 ? 16 / 9 : value.aspectRatio, child: VideoPlayer(_controller)),
          if (!value.isPlaying)
            const DecoratedBox(
              decoration: BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
              child: Padding(padding: EdgeInsets.all(12), child: Icon(Icons.play_arrow, color: Colors.white, size: 48)),
            ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: VideoProgressIndicator(_controller, allowScrubbing: true, padding: const EdgeInsets.all(12)),
          ),
        ],
      ),
    );
  }
}

class VideoScreen extends StatelessWidget {
  const VideoScreen({super.key, this.url, this.localPath, this.title});

  final String? url;
  final String? localPath;
  final String? title;

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          title: title == null ? null : Text(title!, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
        body: SafeArea(child: Center(child: VideoPlayerView(url: url, localPath: localPath))),
      );
}

/// Opens a document/media URL in the system browser or a viewer app.
Future<void> openExternally(String url) async {
  await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
}

IconData iconForFile(String name) {
  final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
  return switch (ext) {
    'pdf' => Icons.picture_as_pdf_outlined,
    'zip' => Icons.folder_zip_outlined,
    'xlsx' || 'csv' => Icons.table_chart_outlined,
    'pptx' => Icons.slideshow_outlined,
    'mp3' || 'm4a' || 'aac' || 'ogg' || 'wav' => Icons.audio_file_outlined,
    _ => Icons.description_outlined,
  };
}

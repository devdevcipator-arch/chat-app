import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../core/api.dart';
import '../core/media.dart';
import '../data/chat_repository.dart';
import '../data/gallery_repository.dart';
import '../models/chat_summary.dart';
import '../models/gallery_item.dart';
import '../widgets/audio_player.dart';
import '../widgets/avatar.dart';
import '../widgets/media_views.dart';
import 'chat_screen.dart' show GalleryThumb;

/// The personal vault: upload, preview, delete, and forward to chats.
class GalleryScreen extends StatefulWidget {
  const GalleryScreen({super.key});

  @override
  State<GalleryScreen> createState() => _GalleryScreenState();
}

class _GalleryScreenState extends State<GalleryScreen> {
  List<GalleryItem> _items = const [];
  bool _loading = true;
  String? _error;

  /// Uploads in flight: name → progress.
  final _uploads = <String, double>{};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await GalleryRepository.list();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = "Couldn't load your gallery.";
      });
    }
  }

  void _snack(String text) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  Future<void> _add() async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(leading: const Icon(Icons.perm_media_outlined), title: const Text('Photos & videos'), onTap: () => Navigator.pop(context, 'media')),
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take photo'), onTap: () => Navigator.pop(context, 'camera')),
            ListTile(leading: const Icon(Icons.attach_file), title: const Text('Files'), onTap: () => Navigator.pop(context, 'files')),
          ],
        ),
      ),
    );
    if (choice == null) return;
    try {
      switch (choice) {
        case 'media':
          final picked = await ImagePicker().pickMultipleMedia();
          for (final f in picked) {
            unawaited(_upload(File(f.path), f.name));
          }
        case 'camera':
          final photo = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 90);
          if (photo != null) unawaited(_upload(File(photo.path), photo.name));
        case 'files':
          final files = await FilePicker.pickFiles(
            type: FileType.custom,
            allowedExtensions: const ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'webm', ...pickableDocumentExtensions],
          );
          for (final f in files) {
            final path = f.path;
            if (path != null) unawaited(_upload(File(path), f.name));
          }
      }
    } on PlatformException {
      _snack("Couldn't open the picker.");
    }
  }

  Future<void> _upload(File file, String name) async {
    final key = '$name#${DateTime.now().microsecondsSinceEpoch}';
    setState(() => _uploads[key] = 0);
    try {
      final item = await GalleryRepository.upload(
        file,
        name,
        onProgress: (p) {
          if (mounted) setState(() => _uploads[key] = p);
        },
      );
      if (mounted) setState(() => _items = [item, ..._items]);
    } catch (e) {
      _snack('$name: ${e is ApiException ? e.message : 'upload failed.'}');
    } finally {
      if (mounted) setState(() => _uploads.remove(key));
    }
  }

  Future<void> _open(GalleryItem item) async {
    final action = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => _GalleryItemScreen(item: item)),
    );
    if (!mounted) return;
    if (action == 'delete') await _delete(item);
    if (action == 'forward') await _forward(item);
  }

  Future<void> _delete(GalleryItem item) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete from gallery?'),
        content: Text('${item.fileName} is permanently deleted. Copies already sent to chats stay.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await GalleryRepository.delete(item.id);
      if (mounted) setState(() => _items = _items.where((i) => i.id != item.id).toList());
      _snack('Deleted');
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't delete that item.");
    }
  }

  Future<void> _forward(GalleryItem item) async {
    final chat = await showModalBottomSheet<ChatSummary>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const _ChatPickerSheet(),
    );
    if (chat == null) return;
    try {
      await GalleryRepository.forward(item.id, chat.chatId);
      _snack('Sent to ${chat.name}');
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't send that file.");
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Gallery')),
      floatingActionButton: FloatingActionButton.extended(onPressed: _add, icon: const Icon(Icons.upload), label: const Text('Upload')),
      body: Column(
        children: [
          for (final e in _uploads.entries)
            ListTile(
              dense: true,
              leading: const Icon(Icons.cloud_upload_outlined),
              title: Text(e.key.split('#').first, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: LinearProgressIndicator(value: e.value),
            ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null && _items.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_error!),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ]),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: _items.isEmpty
          ? ListView(children: const [
              Padding(
                padding: EdgeInsets.fromLTRB(32, 96, 32, 0),
                child: Text(
                  'Your private gallery is empty.\nUpload photos, videos and documents to keep them here and send them to any chat.',
                  textAlign: TextAlign.center,
                ),
              ),
            ])
          : GridView.builder(
              padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: 140, mainAxisSpacing: 8, crossAxisSpacing: 8),
              itemCount: _items.length,
              itemBuilder: (context, i) => GalleryThumb(
                item: _items[i],
                onTap: () => _open(_items[i]),
                onLongPress: () => _delete(_items[i]),
              ),
            ),
    );
  }
}

/// Preview; pops with 'delete' or 'forward'.
class _GalleryItemScreen extends StatelessWidget {
  const _GalleryItemScreen({required this.item});

  final GalleryItem item;

  @override
  Widget build(BuildContext context) {
    final url = item.url;
    final Widget preview = url == null
        ? const Text('Preview unavailable', style: TextStyle(color: Colors.white70))
        : switch (item.kind) {
            'image' => InteractiveViewer(maxScale: 5, child: Image.network(url, fit: BoxFit.contain)),
            'video' => VideoPlayerView(url: url),
            'audio' => Card(child: Padding(padding: const EdgeInsets.all(12), child: AudioPlayerBar(url: url))),
            _ => Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(iconForFile(item.fileName), size: 72, color: Colors.white70),
                const SizedBox(height: 12),
                FilledButton.icon(onPressed: () => openExternally(url), icon: const Icon(Icons.open_in_new), label: const Text('Open')),
              ]),
          };
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(item.fileName, maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(formatBytes(item.size), style: const TextStyle(fontSize: 12, color: Colors.white70)),
          ],
        ),
        actions: [
          IconButton(tooltip: 'Send to chat', onPressed: () => Navigator.pop(context, 'forward'), icon: const Icon(Icons.send_outlined)),
          IconButton(tooltip: 'Delete', onPressed: () => Navigator.pop(context, 'delete'), icon: const Icon(Icons.delete_outline)),
        ],
      ),
      body: SafeArea(child: Center(child: preview)),
    );
  }
}

class _ChatPickerSheet extends StatefulWidget {
  const _ChatPickerSheet();

  @override
  State<_ChatPickerSheet> createState() => _ChatPickerSheetState();
}

class _ChatPickerSheetState extends State<_ChatPickerSheet> {
  late final Future<List<ChatSummary>> _chats = ChatRepository.listMyChats();

  @override
  Widget build(BuildContext context) => SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.6,
        child: FutureBuilder<List<ChatSummary>>(
          future: _chats,
          builder: (context, snapshot) {
            if (snapshot.hasError) return const Center(child: Text("Couldn't load your chats."));
            if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
            final chats = snapshot.data!;
            if (chats.isEmpty) return const Center(child: Text('No conversations yet.'));
            return ListView(
              children: [
                const Padding(padding: EdgeInsets.fromLTRB(16, 0, 16, 8), child: Text('Send to…')),
                for (final c in chats)
                  ListTile(
                    leading: Avatar(name: c.name, imageUrl: c.isGroup ? null : c.other?.avatarImageUrl, group: c.isGroup),
                    title: Text(c.name),
                    onTap: () => Navigator.pop(context, c),
                  ),
              ],
            );
          },
        ),
      );
}

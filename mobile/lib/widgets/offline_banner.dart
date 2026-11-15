import 'package:flutter/material.dart';

import '../services/network_status.dart';

/// A slim, non-blocking strip shown while [NetworkStatus] reports offline.
/// Collapses to nothing when online, so it costs no layout space.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: NetworkStatus.instance,
      builder: (context, online, _) {
        final scheme = Theme.of(context).colorScheme;
        return AnimatedSize(
          duration: const Duration(milliseconds: 200),
          alignment: Alignment.topCenter,
          child: online
              ? const SizedBox(width: double.infinity)
              : Semantics(
                  liveRegion: true,
                  child: Container(
                    width: double.infinity,
                    color: scheme.surfaceContainerHighest,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.cloud_off_outlined, size: 16, color: scheme.onSurfaceVariant),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            message,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 12.5, color: scheme.onSurfaceVariant),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
        );
      },
    );
  }
}

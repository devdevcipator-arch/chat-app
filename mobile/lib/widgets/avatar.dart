import 'package:flutter/material.dart';

/// Profile/group photo with an initials fallback.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.imageUrl, this.size = 40, this.group = false});

  final String name;
  final String? imageUrl;
  final double size;

  /// Shows a group icon instead of initials when there's no photo.
  final bool group;

  @override
  Widget build(BuildContext context) {
    final cleaned = name.replaceFirst(RegExp(r'^@'), '').trim();
    final initials = cleaned.isEmpty
        ? '?'
        : cleaned.substring(0, cleaned.length < 2 ? cleaned.length : 2).toUpperCase();

    final fallback = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFF6B35), Color(0xFFE64A19)],
        ),
      ),
      child: group
          ? Icon(Icons.group, color: Colors.white, size: size * 0.5)
          : Text(
              initials,
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: size * 0.36),
            ),
    );

    final url = imageUrl;
    return ExcludeSemantics(
      child: url == null
          ? fallback
          : ClipOval(
              child: Image.network(
                url,
                width: size,
                height: size,
                fit: BoxFit.cover,
                cacheWidth: (size * MediaQuery.devicePixelRatioOf(context)).round(),
                errorBuilder: (_, _, _) => fallback,
                loadingBuilder: (context, child, progress) => progress == null ? child : fallback,
              ),
            ),
    );
  }
}

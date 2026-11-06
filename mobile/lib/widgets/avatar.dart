import 'package:flutter/material.dart';

/// Initials placeholder until avatar uploads (R2) land.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.name, this.size = 40});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final cleaned = name.replaceFirst(RegExp(r'^@'), '');
    final initials = cleaned.isEmpty
        ? '?'
        : cleaned.substring(0, cleaned.length < 2 ? cleaned.length : 2).toUpperCase();

    return ExcludeSemantics(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: const BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFF6366F1), Color(0xFF7C3AED)],
          ),
        ),
        child: Text(
          initials,
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w600,
            fontSize: size * 0.36,
          ),
        ),
      ),
    );
  }
}

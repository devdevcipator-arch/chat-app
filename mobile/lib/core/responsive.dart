import 'package:flutter/material.dart';

/// Only extra-small phones (narrower than 360pt, e.g. the 320pt iPhone SE 1st
/// gen) get a tighter layout. Standard phones (360–430pt) keep full spacing,
/// so lists fill the screen comfortably instead of bunching up at the top.
const compactWidthBreakpoint = 360.0;

/// How much sizes shrink on compact phones.
const _compactFactor = 0.86;

extension Responsive on BuildContext {
  /// True on small phones (logical width < [compactWidthBreakpoint]).
  bool get isCompact => MediaQuery.sizeOf(this).width < compactWidthBreakpoint;

  /// [value] scaled down proportionally on compact phones, unchanged otherwise.
  double compact(double value) => isCompact ? (value * _compactFactor).roundToDouble() : value;
}

/// Wraps the whole app (MaterialApp.builder): on compact phones it trims the
/// theme (denser controls, shorter app bar) and scales text slightly down,
/// while still honouring the user's accessibility text size.
class CompactScope extends StatelessWidget {
  const CompactScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!context.isCompact) return child;
    final theme = Theme.of(context);
    final media = MediaQuery.of(context);
    return MediaQuery(
      // 94% of whatever text size the user chose, so accessibility settings still apply.
      data: media.copyWith(textScaler: TextScaler.linear(media.textScaler.scale(14) / 14 * 0.94)),
      child: Theme(
        data: theme.copyWith(
          visualDensity: VisualDensity.compact,
          appBarTheme: theme.appBarTheme.copyWith(
            toolbarHeight: 52,
            titleTextStyle: theme.textTheme.titleLarge?.copyWith(fontSize: 19, color: theme.colorScheme.onSurface),
          ),
          listTileTheme: theme.listTileTheme.copyWith(
            contentPadding: const EdgeInsets.symmetric(horizontal: 12),
            horizontalTitleGap: 12,
            minVerticalPadding: 6,
          ),
          navigationBarTheme: theme.navigationBarTheme.copyWith(height: 56),
        ),
        child: child,
      ),
    );
  }
}

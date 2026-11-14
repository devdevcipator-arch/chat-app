import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Answer to a `/math` command, shown inside the bubble in place of the
/// plain "🧮 … = …" text (mirrors web/src/app/chat/[chatId]/math-result-card.tsx).
class MathResultCard extends StatefulWidget {
  const MathResultCard({
    super.key,
    required this.expression,
    required this.result,
    required this.mine,
    required this.foreground,
  });

  final String expression;
  final String result;
  final bool mine;

  /// The bubble's text colour.
  final Color foreground;

  @override
  State<MathResultCard> createState() => _MathResultCardState();
}

class _MathResultCardState extends State<MathResultCard> {
  bool _copied = false;
  Timer? _reset;

  @override
  void dispose() {
    _reset?.cancel();
    super.dispose();
  }

  Future<void> _copy() async {
    // The bare number pastes better into other apps than "1,234.5".
    await Clipboard.setData(ClipboardData(text: widget.result.replaceAll(',', '')));
    if (!mounted) return;
    setState(() => _copied = true);
    _reset?.cancel();
    _reset = Timer(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final fg = widget.foreground;
    final mine = widget.mine;
    final badgeBg = mine ? Colors.white.withValues(alpha: 0.2) : scheme.primary.withValues(alpha: 0.14);
    final badgeFg = mine ? Colors.white : scheme.primary;

    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 170),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: badgeBg, borderRadius: BorderRadius.circular(999)),
            child: Text(
              '🧮 Math',
              style: TextStyle(color: badgeFg, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.3),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            widget.expression,
            style: TextStyle(color: fg.withValues(alpha: 0.75), fontFamily: 'monospace', fontSize: 13),
          ),
          const SizedBox(height: 2),
          Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Flexible(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '= ',
                        style: TextStyle(color: fg.withValues(alpha: 0.6)),
                      ),
                      TextSpan(text: widget.result),
                    ],
                  ),
                  style: TextStyle(
                    color: fg,
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Semantics(
                button: true,
                label: _copied ? 'Copied' : 'Copy result ${widget.result}',
                child: Material(
                  color: mine ? Colors.white.withValues(alpha: 0.15) : scheme.surface,
                  borderRadius: BorderRadius.circular(8),
                  child: InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: _copy,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            _copied ? Icons.check : Icons.copy,
                            size: 15,
                            color: mine ? Colors.white : scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            _copied ? 'Copied' : 'Copy',
                            style: TextStyle(
                              color: mine ? Colors.white : scheme.onSurfaceVariant,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

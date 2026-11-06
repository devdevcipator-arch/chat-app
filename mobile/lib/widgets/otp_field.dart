import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Segmented numeric code input. A single (invisible) TextField drives the
/// boxes, so typing, backspace, SMS/email autofill and paste all behave
/// natively. [onCompleted] fires once all digits are entered.
class OtpField extends StatefulWidget {
  const OtpField({
    super.key,
    required this.length,
    required this.controller,
    required this.onCompleted,
    this.focusNode,
    this.enabled = true,
    this.hasError = false,
  });

  final int length;
  final TextEditingController controller;
  final ValueChanged<String> onCompleted;
  final FocusNode? focusNode;
  final bool enabled;
  final bool hasError;

  @override
  State<OtpField> createState() => _OtpFieldState();
}

class _OtpFieldState extends State<OtpField> {
  late final FocusNode _focus = widget.focusNode ?? FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onChanged);
    _focus.addListener(_rebuild);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onChanged);
    _focus.removeListener(_rebuild);
    if (widget.focusNode == null) _focus.dispose();
    super.dispose();
  }

  void _rebuild() => setState(() {});

  String _lastText = '';

  void _onChanged() {
    final code = widget.controller.text;
    if (code == _lastText) return; // selection-only change
    _lastText = code;
    setState(() {});
    if (code.length == widget.length) widget.onCompleted(code);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final code = widget.controller.text;

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: widget.enabled ? _focus.requestFocus : null,
      child: Stack(
        children: [
          Row(
            children: List.generate(widget.length, (i) {
              final filled = i < code.length;
              final active = _focus.hasFocus &&
                  (i == code.length || (i == widget.length - 1 && code.length == widget.length));
              final borderColor = widget.hasError
                  ? scheme.error
                  : active
                      ? scheme.primary
                      : scheme.outlineVariant;
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: i == widget.length - 1 ? 0 : 8),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    height: 56,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: borderColor, width: active ? 2 : 1),
                    ),
                    child: Text(
                      filled ? code[i] : '',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontFeatures: const [FontFeature.tabularFigures()],
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                ),
              );
            }),
          ),
          // The real input: invisible, but focusable, tappable and pasteable.
          Positioned.fill(
            child: Opacity(
              opacity: 0,
              child: TextField(
                controller: widget.controller,
                focusNode: _focus,
                enabled: widget.enabled,
                autofocus: true,
                keyboardType: TextInputType.number,
                textInputAction: TextInputAction.done,
                autofillHints: const [AutofillHints.oneTimeCode],
                showCursor: false,
                enableSuggestions: false,
                autocorrect: false,
                maxLength: widget.length,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(widget.length),
                ],
                decoration: const InputDecoration(
                  counterText: '',
                  border: InputBorder.none,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

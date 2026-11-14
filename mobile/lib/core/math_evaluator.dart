/// Safe calculator for the `/math` slash command. A port of
/// web/src/lib/math-evaluator.ts. Both must format results identically,
/// because a result card is only shown when re-evaluating the expression
/// reproduces the posted text, so JS semantics are copied on purpose
/// (`%` keeps the dividend's sign, round() rounds halves up, en-US output).
///
/// ```text
/// expr    := term (("+" | "-") term)*
/// term    := unary (("*" | "/" | "%") unary | implicit-× unary)*
/// unary   := ("+" | "-") unary | power
/// power   := primary ("^" unary)?          right-associative, so -2^2 = -4
/// primary := number | constant | func "(" expr ")" | "(" expr ")"
/// ```
library;

import 'dart:math' as math;

sealed class MathResult {
  const MathResult();
}

class MathOk extends MathResult {
  const MathOk(this.value, this.formatted);
  final double value;
  final String formatted;
}

class MathError extends MathResult {
  const MathError(this.error);
  final String error;
}

/// Longest expression accepted, and deepest nesting (keeps the stack safe).
const mathMaxLength = 500;
const _maxDepth = 64;

class _Fail implements Exception {
  const _Fail(this.message);
  final String message;
}

enum _Kind { num, ident, op, lparen, rparen }

class _Token {
  const _Token(this.kind, {this.value = 0, this.text = ''});
  final _Kind kind;
  final double value;

  /// Identifier name or operator symbol.
  final String text;
}

const _constants = {'pi': math.pi, 'π': math.pi, 'e': math.e};

/// sin(pi) is 1.2e-16 in floating point; snap that noise to 0.
double _trig(double x) => x.abs() < 1e-15 ? 0 : x;

/// JavaScript's Math.round: halves round towards +∞ (-2.5 → -2).
double _jsRound(double x) {
  final down = x.floorToDouble();
  return x - down >= 0.5 ? down + 1 : down;
}

double _log(double x, double Function(double) fn) {
  if (x <= 0) throw const _Fail('Logarithm of zero or a negative number');
  return fn(x);
}

final Map<String, double Function(double)> _functions = {
  'sqrt': (x) {
    if (x < 0) throw const _Fail('Square root of a negative number');
    return math.sqrt(x);
  },
  'abs': (x) => x.abs(),
  'round': _jsRound,
  'floor': (x) => x.floorToDouble(),
  'ceil': (x) => x.ceilToDouble(),
  'sin': (x) => _trig(math.sin(x)),
  'cos': (x) => _trig(math.cos(x)),
  'tan': (x) => _trig(math.tan(x)),
  'log': (x) => _log(x, (v) => math.log(v) / math.ln10),
  'ln': (x) => _log(x, math.log),
};

/// Unicode operators people paste from elsewhere.
const _opAliases = {
  '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '·': '*', '/': '/', '÷': '/', '%': '%', '^': '^', //
};

final _space = RegExp(r'\s');
final _digitOrDot = RegExp(r'[0-9.]');
final _number = RegExp(r'^(?:\d+\.?\d*|\.\d+)');
final _letter = RegExp(r'[a-zπ]', caseSensitive: false);
final _word = RegExp(r'^(?:π|[a-z]+)', caseSensitive: false);

List<_Token> _tokenize(String input) {
  final tokens = <_Token>[];
  var i = 0;
  while (i < input.length) {
    final ch = input[i];
    if (_space.hasMatch(ch)) {
      i++;
    } else if (_digitOrDot.hasMatch(ch)) {
      final match = _number.firstMatch(input.substring(i));
      if (match == null) throw _Fail('Unexpected "$ch"');
      final text = match[0]!;
      if (i + text.length < input.length && input[i + text.length] == '.') {
        throw _Fail('Malformed number "$text."');
      }
      tokens.add(_Token(_Kind.num, value: double.parse(text.endsWith('.') ? '${text}0' : text)));
      i += text.length;
    } else if (_letter.hasMatch(ch)) {
      final name = _word.firstMatch(input.substring(i))![0]!;
      tokens.add(_Token(_Kind.ident, text: name.toLowerCase()));
      i += name.length;
    } else if (ch == '(' || ch == '[') {
      tokens.add(const _Token(_Kind.lparen));
      i++;
    } else if (ch == ')' || ch == ']') {
      tokens.add(const _Token(_Kind.rparen));
      i++;
    } else if (_opAliases.containsKey(ch)) {
      tokens.add(_Token(_Kind.op, text: _opAliases[ch]!));
      i++;
    } else {
      throw _Fail('Unexpected "$ch"');
    }
  }
  return tokens;
}

class _Parser {
  _Parser(this._tokens);
  final List<_Token> _tokens;
  int _pos = 0;
  int _depth = 0;

  double parse() {
    if (_tokens.isEmpty) throw const _Fail('Enter an expression');
    final value = _expr();
    final extra = _peek;
    if (extra != null) {
      throw _Fail(extra.kind == _Kind.rparen ? 'Unmatched ")"' : 'Unexpected input after the expression');
    }
    return value;
  }

  _Token? get _peek => _pos < _tokens.length ? _tokens[_pos] : null;

  bool _isOp(String op) {
    final t = _peek;
    return t != null && t.kind == _Kind.op && t.text == op;
  }

  T _nested<T>(T Function() fn) {
    if (++_depth > _maxDepth) throw const _Fail('Expression is nested too deeply');
    try {
      return fn();
    } finally {
      _depth--;
    }
  }

  double _expr() {
    var value = _term();
    while (_isOp('+') || _isOp('-')) {
      final op = _tokens[_pos++].text;
      final rhs = _term();
      value = op == '+' ? value + rhs : value - rhs;
    }
    return value;
  }

  /// Does the next token start an operand that multiplies implicitly?
  bool _implicitNext() {
    final next = _peek;
    if (next == null) return false;
    if (next.kind == _Kind.lparen || next.kind == _Kind.ident) return true;
    // `(2)3` is fine, but `2 3` is almost certainly a typo, not 6.
    return next.kind == _Kind.num && (_pos == 0 || _tokens[_pos - 1].kind != _Kind.num);
  }

  double _term() {
    var value = _unary();
    for (;;) {
      if (_isOp('*') || _isOp('/') || _isOp('%')) {
        final op = _tokens[_pos++].text;
        final rhs = _unary();
        if ((op == '/' || op == '%') && rhs == 0) throw const _Fail('Cannot divide by zero');
        // remainder() keeps the dividend's sign, like JS; Dart's % does not.
        value = op == '*'
            ? value * rhs
            : op == '/'
            ? value / rhs
            : value.remainder(rhs);
      } else if (_implicitNext()) {
        value *= _unary();
      } else {
        return value;
      }
    }
  }

  double _unary() {
    if (_isOp('-') || _isOp('+')) {
      final negate = _isOp('-');
      _pos++;
      final value = _nested(_unary);
      return negate ? -value : value;
    }
    return _power();
  }

  double _power() {
    final base = _primary();
    if (!_isOp('^')) return base;
    _pos++;
    final exponent = _nested(_unary);
    final value = math.pow(base, exponent).toDouble();
    if (value.isNaN) throw const _Fail('Result is not a real number');
    return value;
  }

  double _primary() {
    final t = _peek;
    _pos++;
    if (t == null) throw const _Fail('Expression ends too early');
    switch (t.kind) {
      case _Kind.num:
        return t.value;
      case _Kind.lparen:
        return _group();
      case _Kind.ident:
        final constant = _constants[t.text];
        if (constant != null) return constant;
        final fn = _functions[t.text];
        if (fn == null) throw _Fail('Unknown name "${t.text}"');
        if (_peek?.kind != _Kind.lparen) throw _Fail('${t.text} needs parentheses, e.g. ${t.text}(16)');
        _pos++;
        return fn(_group());
      case _Kind.rparen:
        throw const _Fail('Unexpected ")"');
      case _Kind.op:
        throw _Fail('Unexpected "${t.text}"');
    }
  }

  /// The inside of a group whose "(" was just consumed.
  double _group() {
    if (_peek?.kind == _Kind.rparen) throw const _Fail('Empty parentheses');
    final value = _nested(_expr);
    final close = _peek;
    _pos++;
    if (close?.kind != _Kind.rparen) throw const _Fail('Missing ")"');
    return value;
  }
}

/// "1,234,567.89", matching the web's Intl en-US output (max 10 decimals,
/// halves rounded away from zero). Rounds to 15 significant digits first,
/// which hides float noise (0.1 + 0.2 → 0.3). Very large or tiny values
/// use e-notation, like the web.
String formatMathNumber(double value) {
  final rounded = double.parse(value.toStringAsPrecision(15));
  if (rounded == 0) return '0'; // also turns -0 into 0
  final size = rounded.abs();
  if (size >= 1e21 || size < 1e-6) {
    return rounded.toStringAsExponential(14).replaceFirst(RegExp(r'\.?0+e'), 'e');
  }

  // Shortest decimal digits of the double (plain notation in this range).
  var digits = size.toString();
  if (digits.endsWith('.0')) digits = digits.substring(0, digits.length - 2);
  final dot = digits.indexOf('.');
  var whole = dot < 0 ? digits : digits.substring(0, dot);
  var fraction = dot < 0 ? '' : digits.substring(dot + 1);

  if (fraction.length > 10) {
    final roundUp = fraction.codeUnitAt(10) >= 0x35; // '5'
    var scaled = BigInt.parse('$whole${fraction.substring(0, 10)}');
    if (roundUp) scaled += BigInt.one;
    final text = scaled.toString().padLeft(11, '0');
    whole = text.substring(0, text.length - 10);
    fraction = text.substring(text.length - 10);
  }
  fraction = fraction.replaceFirst(RegExp(r'0+$'), '');
  final grouped = whole.replaceAllMapped(RegExp(r'\B(?=(\d{3})+$)'), (_) => ',');
  final sign = rounded < 0 ? '-' : '';
  return fraction.isEmpty ? '$sign$grouped' : '$sign$grouped.$fraction';
}

MathResult evaluateMath(String input) {
  final expression = input.trim();
  if (expression.isEmpty) return const MathError('Enter an expression');
  if (expression.length > mathMaxLength) return const MathError('Expression is too long');
  try {
    final value = _Parser(_tokenize(expression)).parse();
    if (value.isNaN) return const MathError('Result is not a real number');
    if (value.isInfinite) return const MathError('Result is too large');
    return MathOk(value, formatMathNumber(value));
  } on _Fail catch (e) {
    return MathError(e.message);
  } catch (_) {
    return const MathError('Invalid math expression');
  }
}

// --- Slash command & chat message format ---------------------------------------

/// What the composer's text means for `/math`: null when it isn't (on its way
/// to) a /math command, '' for just the hint ("/" … "/math"), otherwise the
/// expression with whitespace collapsed to single spaces.
String? parseMathCommand(String text) {
  final trimmed = text.trimLeft();
  if (RegExp(r'^/(?:m(?:a(?:t(?:h)?)?)?)?$', caseSensitive: false).hasMatch(trimmed.trimRight())) return '';
  final match = RegExp(r'^/math(?:\s+([\s\S]*))?$', caseSensitive: false).firstMatch(trimmed);
  if (match == null) return null;
  return (match[1] ?? '').replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// Does the text start a /math command (as opposed to "/ma" still being typed)?
bool isMathCommand(String text) => RegExp(r'^/math(\s|$)', caseSensitive: false).hasMatch(text.trim());

const _resultPrefix = '🧮 ';

/// The chat message posted with the answer: "🧮 (120 * 4) / 3 = 160".
String mathResultMessage(String expression, String formatted) => '$_resultPrefix$expression = $formatted';

/// Recognise an answer message for the result card. The expression is
/// re-evaluated, so a hand-typed "🧮 2 + 2 = 5" stays a plain text bubble.
({String expression, String result})? parseMathResultMessage(String? content) {
  if (content == null || !content.startsWith(_resultPrefix)) return null;
  final body = content.substring(_resultPrefix.length);
  final split = body.lastIndexOf(' = ');
  if (split <= 0) return null;
  final expression = body.substring(0, split);
  final result = body.substring(split + 3);
  final check = evaluateMath(expression);
  return check is MathOk && check.formatted == result ? (expression: expression, result: result) : null;
}

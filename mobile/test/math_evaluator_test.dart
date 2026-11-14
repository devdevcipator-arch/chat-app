import 'package:chat_app/core/math_evaluator.dart';
import 'package:flutter_test/flutter_test.dart';

/// The same expectations as the web evaluator: both platforms must produce
/// identical text, or result cards from one won't render on the other.
String v(String s) => switch (evaluateMath(s)) {
      MathOk(:final formatted) => formatted,
      MathError(:final error) => 'ERR: $error',
    };

void main() {
  test('order of operations', () {
    expect(v('2 + 3 * 4'), '14');
    expect(v('(2 + 3) * 4'), '20');
    expect(v('10 - 4 - 3'), '3');
    expect(v('100 / 10 / 2'), '5');
    expect(v('2 ^ 3 ^ 2'), '512');
    expect(v('-2 ^ 2'), '-4');
    expect(v('(-2) ^ 2'), '4');
    expect(v('2 ^ -1'), '0.5');
    expect(v('2 + 3 * 4 ^ 2 / 8'), '8');
    expect(v('17 % 5'), '2');
    expect(v('-7 % 3'), '-1'); // JS remainder semantics
    expect(v('(120 * 4) / 3'), '160');
    expect(v('((1+2)*(3+(4-1)))'), '18');
  });

  test('implicit multiplication', () {
    expect(v('2(3+4)'), '14');
    expect(v('(1+2)(3+4)'), '21');
    expect(v('2pi'), '6.2831853072');
    expect(v('3sqrt(16)'), '12');
    expect(v('(2)3'), '6');
    expect(v('2 3'), 'ERR: Unexpected input after the expression');
  });

  test('decimals and unary signs', () {
    expect(v('-12.5 + 4'), '-8.5');
    expect(v('.5 + .25'), '0.75');
    expect(v('5. + 1'), '6');
    expect(v('--3'), '3');
    expect(v('+5'), '5');
    expect(v('0.1 + 0.2'), '0.3');
    expect(v('1.1 * 1.1'), '1.21');
    expect(v('1.2.3'), 'ERR: Malformed number "1.2."');
  });

  test('functions and constants', () {
    expect(v('sqrt(144)'), '12');
    expect(v('abs(-7.5)'), '7.5');
    expect(v('round(2.5)'), '3');
    expect(v('round(-2.5)'), '-2'); // JS Math.round
    expect(v('floor(-2.5)'), '-3');
    expect(v('ceil(2.1)'), '3');
    expect(v('sin(pi)'), '0');
    expect(v('cos(0)'), '1');
    expect(v('tan(pi/4)'), '1');
    expect(v('log(1000)'), '3');
    expect(v('ln(e)'), '1');
    expect(v('PI'), '3.1415926536');
    expect(v('e'), '2.7182818285');
    expect(v('sqrt(-1)'), 'ERR: Square root of a negative number');
    expect(v('log(0)'), 'ERR: Logarithm of zero or a negative number');
    expect(v('sqrt 16'), 'ERR: sqrt needs parentheses, e.g. sqrt(16)');
    expect(v('foo(2)'), 'ERR: Unknown name "foo"');
  });

  test('division by zero', () {
    expect(v('5 / 0'), 'ERR: Cannot divide by zero');
    expect(v('5 % 0'), 'ERR: Cannot divide by zero');
    expect(v('1 / (2 - 2)'), 'ERR: Cannot divide by zero');
    expect(v('0 / 5'), '0');
  });

  test('malformed input', () {
    expect(v(''), 'ERR: Enter an expression');
    expect(v('2 +'), 'ERR: Expression ends too early');
    expect(v('(2 + 3'), 'ERR: Missing ")"');
    expect(v('2 + 3)'), 'ERR: Unmatched ")"');
    expect(v('()'), 'ERR: Empty parentheses');
    expect(v('* 3'), 'ERR: Unexpected "*"');
    expect(v(r'2 $ 3'), r'ERR: Unexpected "$"');
    expect(v('${'(' * 200}1${')' * 200}'), 'ERR: Expression is nested too deeply');
    expect(v('${'1+' * 300}1'), 'ERR: Expression is too long');
    expect(v('${'-' * 400}1'), startsWith('ERR'));
    expect(v('(-8)^(1/3)'), 'ERR: Result is not a real number');
    expect(v('10^400'), 'ERR: Result is too large');
  });

  test('formatting matches the web', () {
    expect(v('1234567 * 1000'), '1,234,567,000');
    expect(v('123456789012345'), '123,456,789,012,345');
    expect(v('1/3'), '0.3333333333');
    expect(v('2/3'), '0.6666666667');
    expect(v('-2/3'), '-0.6666666667');
    expect(v('999.99999999999'), '1,000');
    expect(v('2^100'), '1.26765060022823e+30');
    expect(v('1/10^9'), '1e-9');
    expect(v('10^20'), '100,000,000,000,000,000,000');
    expect(v('-0'), '0');
    expect(v('6 × 4 ÷ 3 − 1'), '7');
  });

  test('slash command parsing', () {
    expect(parseMathCommand('/'), '');
    expect(parseMathCommand('/ma'), '');
    expect(parseMathCommand('/MATH'), '');
    expect(parseMathCommand('/math   '), '');
    expect(parseMathCommand('/math 2+2'), '2+2');
    expect(parseMathCommand('/Math  (1 +\n 2)  * 3'), '(1 + 2) * 3');
    expect(parseMathCommand('/mathematics'), isNull);
    expect(parseMathCommand('/shrug'), isNull);
    expect(parseMathCommand('hello'), isNull);
    expect(isMathCommand('/math'), isTrue);
    expect(isMathCommand('/Math 2'), isTrue);
    expect(isMathCommand('/ma'), isFalse);
  });

  test('result messages', () {
    final msg = mathResultMessage('(120 * 4) / 3', '160');
    expect(msg, '🧮 (120 * 4) / 3 = 160');
    expect(parseMathResultMessage(msg), (expression: '(120 * 4) / 3', result: '160'));
    expect(parseMathResultMessage('🧮 1234567 * 1000 = 1,234,567,000'),
        (expression: '1234567 * 1000', result: '1,234,567,000'));
    expect(parseMathResultMessage('🧮 2 + 2 = 5'), isNull);
    expect(parseMathResultMessage('hello = 4'), isNull);
    expect(parseMathResultMessage(null), isNull);
  });
}

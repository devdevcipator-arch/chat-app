/**
 * Safe calculator for the `/math` slash command: a small recursive-descent
 * parser over a fixed grammar. No `eval`, no `Function`, no dependencies.
 *
 *   expr    := term (("+" | "-") term)*
 *   term    := unary (("*" | "/" | "%") unary | <implicit ×> unary)*
 *   unary   := ("+" | "-") unary | power
 *   power   := primary ("^" unary)?          right-associative, so -2^2 = -4
 *   primary := number | constant | func "(" expr ")" | "(" expr ")"
 *
 * Implicit multiplication: `2(3+4)`, `(1+2)(3+4)`, `2pi`, `3sqrt(4)`.
 */

export type MathResult =
  | { ok: true; value: number; formatted: string }
  | { ok: false; error: string };

/** Longest expression accepted, and deepest nesting (keeps the stack safe). */
export const MATH_MAX_LENGTH = 500;
const MAX_DEPTH = 64;

class MathError extends Error {}

type Token =
  | { kind: "num"; value: number; text: string }
  | { kind: "ident"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "^" }
  | { kind: "lparen" }
  | { kind: "rparen" };

const CONSTANTS: Record<string, number> = { pi: Math.PI, "π": Math.PI, e: Math.E };

/** sin(pi) is 1.2e-16 in floating point; snap that noise to 0. */
const trig = (x: number) => (Math.abs(x) < 1e-15 ? 0 : x);

const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: (x) => {
    if (x < 0) throw new MathError("Square root of a negative number");
    return Math.sqrt(x);
  },
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: (x) => trig(Math.sin(x)),
  cos: (x) => trig(Math.cos(x)),
  tan: (x) => trig(Math.tan(x)),
  log: (x) => {
    if (x <= 0) throw new MathError("Logarithm of zero or a negative number");
    return Math.log10(x);
  },
  ln: (x) => {
    if (x <= 0) throw new MathError("Logarithm of zero or a negative number");
    return Math.log(x);
  },
};

/** Unicode operators people paste from elsewhere. */
const OP_ALIASES: Record<string, Token & { kind: "op" }> = {
  "+": { kind: "op", op: "+" },
  "-": { kind: "op", op: "-" },
  "−": { kind: "op", op: "-" },
  "*": { kind: "op", op: "*" },
  "×": { kind: "op", op: "*" },
  "·": { kind: "op", op: "*" },
  "/": { kind: "op", op: "/" },
  "÷": { kind: "op", op: "/" },
  "%": { kind: "op", op: "%" },
  "^": { kind: "op", op: "^" },
};

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(?:\d+\.?\d*|\.\d+)/.exec(input.slice(i));
      if (!match) throw new MathError(`Unexpected "${ch}"`);
      const text = match[0];
      if (input[i + text.length] === ".") throw new MathError(`Malformed number "${text}."`);
      tokens.push({ kind: "num", value: Number(text), text });
      i += text.length;
    } else if (/[a-zπ]/i.test(ch)) {
      const name = /^(?:π|[a-z]+)/i.exec(input.slice(i))![0];
      tokens.push({ kind: "ident", name: name.toLowerCase() });
      i += name.length;
    } else if (ch === "(" || ch === "[") {
      tokens.push({ kind: "lparen" });
      i++;
    } else if (ch === ")" || ch === "]") {
      tokens.push({ kind: "rparen" });
      i++;
    } else if (OP_ALIASES[ch]) {
      tokens.push(OP_ALIASES[ch]);
      i++;
    } else {
      throw new MathError(`Unexpected "${ch}"`);
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private depth = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number {
    if (this.tokens.length === 0) throw new MathError("Enter an expression");
    const value = this.expr();
    const extra = this.peek();
    if (extra) throw new MathError(extra.kind === "rparen" ? 'Unmatched ")"' : "Unexpected input after the expression");
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(op: string) {
    const t = this.peek();
    return t?.kind === "op" && t.op === op;
  }

  private nested<T>(fn: () => T): T {
    if (++this.depth > MAX_DEPTH) throw new MathError("Expression is nested too deeply");
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }

  private expr(): number {
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.tokens[this.pos++] as Token & { kind: "op" }).op;
      const rhs = this.term();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  /** Does the next token start an operand that multiplies implicitly? */
  private implicitNext(): boolean {
    const next = this.peek();
    if (!next) return false;
    if (next.kind === "lparen" || next.kind === "ident") return true;
    // `(2)3` is fine, but `2 3` is almost certainly a typo, not 6.
    return next.kind === "num" && this.tokens[this.pos - 1]?.kind !== "num";
  }

  private term(): number {
    let value = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
        const op = (this.tokens[this.pos++] as Token & { kind: "op" }).op;
        const rhs = this.unary();
        if ((op === "/" || op === "%") && rhs === 0) throw new MathError("Cannot divide by zero");
        value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
      } else if (this.implicitNext()) {
        value *= this.unary();
      } else {
        return value;
      }
    }
  }

  private unary(): number {
    if (this.isOp("-") || this.isOp("+")) {
      const negate = this.isOp("-");
      this.pos++;
      const value = this.nested(() => this.unary());
      return negate ? -value : value;
    }
    return this.power();
  }

  private power(): number {
    const base = this.primary();
    if (!this.isOp("^")) return base;
    this.pos++;
    const exponent = this.nested(() => this.unary());
    const value = base ** exponent;
    if (Number.isNaN(value)) throw new MathError("Result is not a real number");
    return value;
  }

  private primary(): number {
    const t = this.tokens[this.pos++];
    if (!t) throw new MathError("Expression ends too early");
    switch (t.kind) {
      case "num":
        return t.value;
      case "lparen":
        return this.group();
      case "ident": {
        if (t.name in CONSTANTS) return CONSTANTS[t.name];
        const fn = FUNCTIONS[t.name];
        if (!fn) throw new MathError(`Unknown name "${t.name}"`);
        if (this.peek()?.kind !== "lparen") throw new MathError(`${t.name} needs parentheses, e.g. ${t.name}(16)`);
        this.pos++;
        return fn(this.group());
      }
      case "rparen":
        throw new MathError('Unexpected ")"');
      case "op":
        throw new MathError(`Unexpected "${t.op}"`);
    }
  }

  /** The inside of a group whose "(" was just consumed. */
  private group(): number {
    if (this.peek()?.kind === "rparen") throw new MathError("Empty parentheses");
    const value = this.nested(() => this.expr());
    if (this.tokens[this.pos++]?.kind !== "rparen") throw new MathError('Missing ")"');
    return value;
  }
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 10 });

/**
 * "1,234,567.89". Rounds to 15 significant digits first, which hides binary
 * float noise (0.1 + 0.2 → 0.3). Very large or tiny values use e-notation.
 * Always en-US so everyone in the chat sees the same text.
 */
export function formatMathNumber(value: number): string {
  const rounded = Number(value.toPrecision(15));
  if (rounded === 0) return "0"; // also turns -0 into 0
  const size = Math.abs(rounded);
  if (size >= 1e21 || size < 1e-6) {
    // "1.5e+25": trim trailing zeros from the mantissa.
    return rounded.toExponential(14).replace(/\.?0+e/, "e");
  }
  return grouped.format(rounded);
}

export function evaluateMath(input: string): MathResult {
  const expression = input.trim();
  if (!expression) return { ok: false, error: "Enter an expression" };
  if (expression.length > MATH_MAX_LENGTH) return { ok: false, error: "Expression is too long" };
  try {
    const value = new Parser(tokenize(expression)).parse();
    if (Number.isNaN(value)) return { ok: false, error: "Result is not a real number" };
    if (!Number.isFinite(value)) return { ok: false, error: "Result is too large" };
    return { ok: true, value, formatted: formatMathNumber(value) };
  } catch (e) {
    if (e instanceof MathError) return { ok: false, error: e.message };
    return { ok: false, error: "Invalid math expression" };
  }
}

// --- Slash command & chat message format -------------------------------------

/** What the composer's text means for `/math`. */
export type MathCommand =
  /** "/", "/m" … "/math", or "/math " with nothing after it. */
  | { kind: "hint" }
  | { kind: "expression"; expression: string };

/** Classify composer text; null when it isn't (on its way to) a /math command. */
export function parseMathCommand(text: string): MathCommand | null {
  const trimmed = text.trimStart();
  if (/^\/(?:m(?:a(?:t(?:h)?)?)?)?$/i.test(trimmed.trimEnd())) return { kind: "hint" };
  const match = /^\/math(?:\s+([\s\S]*))?$/i.exec(trimmed);
  if (!match) return null;
  // Collapse newlines and runs of spaces: the answer is a one-line message.
  const expression = (match[1] ?? "").replace(/\s+/g, " ").trim();
  return expression ? { kind: "expression", expression } : { kind: "hint" };
}

const RESULT_PREFIX = "🧮 ";

/** The chat message posted with the answer: "🧮 (120 * 4) / 3 = 160". */
export function mathResultMessage(expression: string, formatted: string) {
  return `${RESULT_PREFIX}${expression} = ${formatted}`;
}

/**
 * Recognise an answer message for the result card. The expression is
 * re-evaluated, so a hand-typed "🧮 2 + 2 = 5" stays a plain text bubble.
 */
export function parseMathResultMessage(content: string | null): { expression: string; result: string } | null {
  if (!content?.startsWith(RESULT_PREFIX)) return null;
  const body = content.slice(RESULT_PREFIX.length);
  const split = body.lastIndexOf(" = ");
  if (split <= 0) return null;
  const expression = body.slice(0, split);
  const result = body.slice(split + 3);
  const check = evaluateMath(expression);
  return check.ok && check.formatted === result ? { expression, result } : null;
}

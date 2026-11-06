"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

type Props = {
  length: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
};

// Segmented numeric code input: auto-advance, backspace-to-previous,
// arrow-key navigation, and pasting a full code into any box.
export function OtpInput({ length, value, onChange, disabled, invalid }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");

  const focus = (index: number) => {
    const el = refs.current[Math.max(0, Math.min(length - 1, index))];
    el?.focus();
    el?.select();
  };

  const setDigit = (index: number, digit: string) => {
    const next = digits.slice();
    next[index] = digit;
    onChange(next.join("").slice(0, length));
  };

  const fill = (from: number, text: string) => {
    const incoming = text.replace(/\D/g, "");
    if (!incoming) return;
    const next = digits.slice();
    for (let i = 0; i < incoming.length && from + i < length; i++) {
      next[from + i] = incoming[i];
    }
    onChange(next.join(""));
    focus(Math.min(from + incoming.length, length - 1));
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[index]) setDigit(index, "");
      else if (index > 0) {
        setDigit(index - 1, "");
        focus(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focus(index - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focus(index + 1);
    }
  };

  const handlePaste = (index: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(index, e.clipboardData.getData("text"));
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Verification code">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          // A full code may arrive via iOS/Android autofill into the first box.
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            if (v.length > 1) fill(i, v);
            else {
              setDigit(i, v);
              if (v) focus(i + 1);
            }
          }}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          autoFocus={i === 0}
          autoComplete={i === 0 ? "one-time-code" : "off"}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={length}
          disabled={disabled}
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
          className={`h-12 w-full min-w-0 rounded-lg border bg-white text-center font-mono text-xl outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 dark:bg-zinc-900 ${
            invalid ? "border-red-400 dark:border-red-700" : "border-zinc-300 dark:border-zinc-700"
          }`}
        />
      ))}
    </div>
  );
}

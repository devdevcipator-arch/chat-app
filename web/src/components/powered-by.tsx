export function PoweredBy({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-xs text-zinc-500 ${className}`}>
      Powered by{" "}
      <a
        href="https://www.devcipator.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-zinc-600 underline-offset-2 transition hover:text-indigo-600 hover:underline dark:text-zinc-400 dark:hover:text-indigo-400"
      >
        Devcipator
      </a>
    </p>
  );
}

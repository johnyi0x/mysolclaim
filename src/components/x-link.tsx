import { X_URL } from "@/lib/constants";

/** Simple X (Twitter) mark — pixel-friendly, no external icon pack. */
export function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

export function XLinkButton({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const box =
    size === "sm"
      ? "h-9 w-9"
      : "h-10 w-10";
  const icon = size === "sm" ? "h-4 w-4" : "h-[18px] w-[18px]";

  return (
    <a
      href={X_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="MySolClaim on X"
      title="Follow @mysolclaim on X"
      className={`pixel-btn pixel-btn-secondary inline-flex ${box} items-center justify-center text-[var(--fg)] hover:text-[var(--accent)] ${className}`}
    >
      <XIcon className={icon} />
    </a>
  );
}

import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

/**
 * Small presentational pieces shared across the console. No data, no state.
 */

/** The Zapp bolt, same geometry as the mobile app's BrandMarkIcon. */
export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <polygon
          points="57,8 26,54 45,54 43,92 74,44 55,44"
          fill="#fff"
          stroke="#fff"
          strokeWidth="4"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const TONES = 7;

function initialsOf(name?: string) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0])[0] ?? "";
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/** Stable colour per person, so the same customer looks the same everywhere. */
function toneOf(seed?: string) {
  let h = 0;
  for (const ch of seed ?? "") h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % TONES;
}

/** Initials in a coloured disc. Decorative: the name is always shown beside it. */
export function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  const initials = initialsOf(name);
  return (
    <span
      className="avatar"
      data-tone={toneOf(name)}
      style={{ "--size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      {initials || <Icon name="user" size={Math.round(size * 0.52)} />}
    </span>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function EmptyState({
  icon = "inbox",
  title,
  children,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={26} />
      </span>
      <div className="empty-title">{title}</div>
      {children ? <p className="empty-hint">{children}</p> : null}
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * Line icons in the spirit of SF Symbols: 24px grid, 1.8 stroke, round caps.
 *
 * Drawn for this console rather than copied — SF Symbols are licensed for
 * native Apple apps only, so they cannot ship in a web bundle.
 */
export type IconName =
  | "user"
  | "briefcase"
  | "idcard"
  | "banknote"
  | "send"
  | "search"
  | "refresh"
  | "signout"
  | "chevron"
  | "inbox"
  | "image"
  | "lock"
  | "alert"
  | "ledger"
  | "check"
  | "close";

const PATHS: Record<IconName, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M4.8 19.6c.8-3.4 3.6-5.3 7.2-5.3s6.4 1.9 7.2 5.3" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="2.6" />
      <path d="M9 7.5V6.3a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6.3v1.2" />
      <path d="M3.5 12.6h17" />
    </>
  ),
  idcard: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.6" />
      <circle cx="8.6" cy="10.9" r="1.9" />
      <path d="M5.8 15.8c.5-1.5 1.6-2.2 2.8-2.2s2.3.7 2.8 2.2" />
      <path d="M14 10.2h4M14 13.6h3" />
    </>
  ),
  banknote: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2.6" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6.6 10v4M17.4 10v4" />
    </>
  ),
  send: (
    <>
      <path d="M4 14.2v3.3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3.3" />
      <path d="M12 15V4.2M7.9 8.3 12 4.2l4.1 4.1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.4 12.3A7.4 7.4 0 1 1 17 6.9" />
      <path d="M19.6 4.4v4.5h-4.5" />
    </>
  ),
  signout: (
    <>
      <path d="M9.5 20H6.5A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4h3" />
      <path d="M15 16.6 19.6 12 15 7.4M19.6 12H9.6" />
    </>
  ),
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  inbox: (
    <>
      <path d="M3.8 13.4 6.3 6.2A2.2 2.2 0 0 1 8.4 4.7h7.2a2.2 2.2 0 0 1 2.1 1.5l2.5 7.2" />
      <path d="M3.8 13.4V17A2.5 2.5 0 0 0 6.3 19.5h11.4a2.5 2.5 0 0 0 2.5-2.5v-3.6h-4.1a1.6 1.6 0 0 0-1.5 1.1 1.9 1.9 0 0 1-1.8 1.2h-1.6a1.9 1.9 0 0 1-1.8-1.2 1.6 1.6 0 0 0-1.5-1.1H3.8Z" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.6" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4.4 17.2 4.6-4.6 3.2 3.2 2.6-2.6 4.8 4.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.6" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.4 4.9 3.5 17A1.9 1.9 0 0 0 5.2 19.8h13.6A1.9 1.9 0 0 0 20.5 17L13.6 4.9a1.9 1.9 0 0 0-3.2 0Z" />
      <path d="M12 9.6v4M12 16.6v.1" />
    </>
  ),
  ledger: (
    <>
      <path d="M5.5 5.5A2 2 0 0 1 7.5 3.5h11v14h-11a2 2 0 0 0-2 2Z" />
      <path d="M5.5 19.5a2 2 0 0 0 2 2h11v-4" />
      <path d="M9 8h6M9 11.5h4" />
    </>
  ),
  check: <path d="m5.5 12.5 4.2 4.2L18.5 7.8" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** Small line icons. Severity always shows an icon and a word, never colour alone. */
const base = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const AlertIcon = () => (
  <svg {...base} stroke="var(--critical)">
    <path d="M12 3 2 21h20L12 3z" />
    <path d="M12 10v5M12 18h.01" />
  </svg>
);
export const BulbIcon = () => (
  <svg {...base} stroke="var(--serious)">
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
  </svg>
);
export const InfoIcon = () => (
  <svg {...base} stroke="var(--series-1)">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5h.01" />
  </svg>
);
export const CheckIcon = () => (
  <svg {...base} width={18} height={18} stroke="var(--good)">
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);
export const PhoneIcon = () => (
  <svg {...base} stroke="currentColor">
    <rect x="7" y="2" width="10" height="20" rx="2" />
    <path d="M11 18h2" />
  </svg>
);
export const LockIcon = () => (
  <svg {...base} width={18} height={18} stroke="currentColor">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

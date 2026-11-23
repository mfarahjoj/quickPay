import { createContext, useContext, type ReactNode } from "react";

/**
 * Opens an account's page from anywhere in the console, so a desk never has
 * to be the end of the road: click a name, land on everything about them.
 */
export const OpenAccountContext = createContext<((uid: string) => void) | null>(null);

export function useOpenAccount() {
  return useContext(OpenAccountContext);
}

/** A name that opens the account. Plain text when there is no uid or no handler. */
export function AccountLink({ uid, children }: { uid?: string | null; children: ReactNode }) {
  const open = useOpenAccount();
  if (!uid || !open) return <>{children}</>;
  return (
    <button
      type="button"
      className="link-btn"
      title="Open this account"
      onClick={(e) => {
        e.stopPropagation();
        open(uid);
      }}
    >
      {children}
    </button>
  );
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, ErrorBoundary } from "./App";
import { saveLastError } from "./storage";
import "./styles.css";

window.addEventListener("error", (e) => saveLastError(String(e.message)));
window.addEventListener("unhandledrejection", (e) => saveLastError(String((e.reason as Error)?.message ?? e.reason)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);

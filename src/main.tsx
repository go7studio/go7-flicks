import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

async function start(): Promise<void> {
  if (!window.flicks) {
    const { boot } = await import("./mobile/boot");
    await boot();
  }
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();

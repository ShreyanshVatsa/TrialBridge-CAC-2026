"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useMessages } from "@/components/i18n";
import { Button } from "@/components/ui/button";

/**
 * Registers the app-shell service worker (production builds only) and offers a reload when a new
 * version is waiting. The worker never caches AI responses or user answers (see public/sw.js).
 */
export function ServiceWorkerRegister() {
  const m = useMessages();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let refreshing = false;
    // Only reload for an UPDATE (a worker already controlled the page). On the very first install,
    // clients.claim() also fires controllerchange; reloading then would wipe in-progress intake.
    const hadController = Boolean(navigator.serviceWorker.controller);
    const onControllerChange = () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
          });
        });
      })
      .catch(() => {
        // Registration failure only disables offline support.
      });
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      className="no-print animate-fade-up fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-popover p-4 shadow-lg"
    >
      <p className="flex-1 text-sm">{m.pwa.updateAvailable}</p>
      <Button size="sm" onClick={() => waiting.postMessage("SKIP_WAITING")}>
        <RefreshCw aria-hidden />
        {m.pwa.reload}
      </Button>
    </div>
  );
}

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        if (reg.active?.scriptURL?.endsWith("/sw.js")) {
          await reg.unregister();
          console.log("[PWA] Unregistered old sw.js");
        }
      }

      const cacheKeys = await caches.keys();
      for (const key of cacheKeys) {
        if (key.includes("ulysse-") && !key.includes("v3")) {
          await caches.delete(key);
          console.log("[PWA] Deleted old cache:", key);
        }
      }

      const registration = await navigator.serviceWorker.register("/sw-v3.js");
      console.log("[PWA] Service Worker v3 registered:", registration.scope);

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              console.log("[PWA] New version available, activating...");
              newWorker.postMessage("skipWaiting");
            }
          });
        }
      });

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        console.log("[PWA] New SW active, reloading...");
        window.location.reload();
      });
    } catch (error) {
      console.log("[PWA] Service Worker setup failed:", error);
    }
  });
}

createRoot(document.getElementById("root")!).render(<App />);

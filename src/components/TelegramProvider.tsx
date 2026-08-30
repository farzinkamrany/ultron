"use client";

import { useEffect, useState } from "react";

export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    // Check if running inside Telegram Web App
    if (typeof window !== "undefined" && (window as any).Telegram?.WebApp) {
      const tg = (window as any).Telegram.WebApp;
      tg.ready();
      tg.expand();

      // Set CSS variables for Telegram theme
      if (tg.themeParams && Object.keys(tg.themeParams).length > 0) {
        setIsTelegram(true);
        const root = document.documentElement;
        if (tg.themeParams.bg_color) {
          root.style.setProperty("--background", tg.themeParams.bg_color);
        }
        if (tg.themeParams.text_color) {
          root.style.setProperty("--foreground", tg.themeParams.text_color);
        }
        if (tg.themeParams.button_color) {
          root.style.setProperty("--primary", tg.themeParams.button_color);
        }
        if (tg.themeParams.button_text_color) {
          root.style.setProperty("--primary-foreground", tg.themeParams.button_text_color);
        }
      }
    }
  }, []);

  return (
    <>
      {children}
    </>
  );
}

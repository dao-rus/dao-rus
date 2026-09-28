"use client";

import { useEffect, useState, type ReactNode } from "react";

type TelegramWindow = Window & {
  Telegram?: { WebApp?: { initData?: string; ready?: () => void } };
};

export function telegramEntryMode(initData: string | undefined): "mini_app" | "browser" {
  return initData ? "mini_app" : "browser";
}

export function NeedAuthGate({
  children,
}: {
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"checking" | "browser" | "error">("checking");

  useEffect(() => {
    let active = true;
    const telegramWindow = window as TelegramWindow;
    const useTelegramData = async () => {
      if (!active) return;
      const initData = telegramWindow.Telegram?.WebApp?.initData;
      if (telegramEntryMode(initData) === "browser") {
        setMode("browser");
        return;
      }
      telegramWindow.Telegram?.WebApp?.ready?.();
      try {
        const response = await fetch("/api/auth/telegram/mini-app", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Mini App login failed");
        if (active) window.location.replace("/need");
      } catch {
        if (active) setMode("error");
      }
    };

    if (telegramWindow.Telegram?.WebApp) {
      void useTelegramData();
    } else {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-web-app.js";
      script.async = true;
      script.onload = () => { void useTelegramData(); };
      script.onerror = () => {
        if (active) {
          const launchParams = window.location.search + window.location.hash;
          setMode(launchParams.includes("tgWebApp") ? "error" : "browser");
        }
      };
      document.head.appendChild(script);
      return () => {
        active = false;
        script.remove();
      };
    }
    return () => { active = false; };
  }, []);

  if (mode === "checking") {
    return <p className="muted" role="status">Проверяем вход через Telegram…</p>;
  }
  if (mode === "error") {
    return <p className="formError" role="alert">Не удалось подтвердить вход через Telegram. Закройте окно и откройте «Мне нужно» снова.</p>;
  }
  return <>{children}</>;
}

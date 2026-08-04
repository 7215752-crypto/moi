"use client";

import { useEffect, useState } from "react";

type Mode = "dark" | "light" | "auto";

const LABELS: Record<Mode, string> = {
  dark: "тёмная",
  light: "светлая",
  auto: "как в системе",
};

// Тёмная — тема по умолчанию.
const ORDER: Mode[] = ["dark", "light", "auto"];

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("dark");

  useEffect(() => {
    const saved = localStorage.getItem("moi-theme");
    if (saved === "light" || saved === "auto") setMode(saved);
  }, []);

  const apply = (next: Mode) => {
    setMode(next);
    localStorage.setItem("moi-theme", next);
    if (next === "auto") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = next;
    }
  };

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    apply(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      title="Переключить тему оформления: тёмная → светлая → как в системе"
    >
      Тема: {LABELS[mode]}
    </button>
  );
}

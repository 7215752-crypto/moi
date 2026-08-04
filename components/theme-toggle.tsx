"use client";

import { useEffect, useState } from "react";

type Mode = "auto" | "light" | "dark";

const LABELS: Record<Mode, string> = {
  auto: "как в системе",
  light: "светлая",
  dark: "тёмная",
};

const ORDER: Mode[] = ["auto", "light", "dark"];

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");

  useEffect(() => {
    const saved = localStorage.getItem("moi-theme");
    if (saved === "light" || saved === "dark") setMode(saved);
  }, []);

  const apply = (next: Mode) => {
    setMode(next);
    if (next === "auto") {
      localStorage.removeItem("moi-theme");
      delete document.documentElement.dataset.theme;
    } else {
      localStorage.setItem("moi-theme", next);
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
      title="Переключить тему оформления: как в системе → светлая → тёмная"
    >
      Тема: {LABELS[mode]}
    </button>
  );
}

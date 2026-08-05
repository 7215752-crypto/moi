"use client";

import { useEffect } from "react";

// Ссылка из письма-приглашения Supabase ведёт на корень сайта с токенами
// в #hash; middleware отправляет неавторизованных на /login, hash при этом
// сохраняется. Здесь перехватываем его и ведём человека на страницу пароля.
export function InviteHashCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    if (
      hash.includes("access_token=") &&
      (hash.includes("type=invite") || hash.includes("type=recovery"))
    ) {
      window.location.replace(`/auth/set-password${hash}`);
    }
  }, []);

  return null;
}

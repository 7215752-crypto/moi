import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOI Group",
  description: "Портал MOI Group: расчёт зарплаты, планирование и аналитика ресторанов",
};

// Применяем сохранённую тему до отрисовки, чтобы страница не мигала.
// По умолчанию (нет сохранённого выбора) — тёмная; «auto» = как в системе.
const themeInitScript = `try{var t=localStorage.getItem("moi-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}else if(t!=="auto"){document.documentElement.dataset.theme="dark"}}catch(e){document.documentElement.dataset.theme="dark"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

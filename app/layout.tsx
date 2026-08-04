import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOI Group",
  description: "Портал MOI Group: расчёт зарплаты, планирование и аналитика ресторанов",
};

// Применяем сохранённую тему до отрисовки, чтобы страница не мигала.
const themeInitScript = `try{var t=localStorage.getItem("moi-theme");if(t==="light"||t==="dark"){document.documentElement.dataset.theme=t}}catch(e){}`;

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

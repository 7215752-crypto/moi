import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOI Group",
  description: "РџСЂРѕР·СЂР°С‡РЅР°СЏ СЃРёСЃС‚РµРјР° СЂР°СЃС‡С‘С‚Р° Р·Р°СЂРїР»Р°С‚С‹ СЃРѕС‚СЂСѓРґРЅРёРєРѕРІ MOI Group",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}


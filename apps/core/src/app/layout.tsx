import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ДАО Русь: Ядро",
  description: "Прототип цифрового ядра ДАО Русь",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

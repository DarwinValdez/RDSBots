import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Betting Analyst", template: "%s · AI Betting Analyst" },
  description: "Inteligencia deportiva cuantitativa: modelos estadísticos calibrados, cuotas y análisis explicado por IA.",
  robots: { index: false },
};

export const viewport: Viewport = { themeColor: "#0a0b0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LinkAffi Pro", template: "%s · LinkAffi Pro" },
  description: "Plateforme interne de statistiques d'affiliation et de bots Telegram",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}

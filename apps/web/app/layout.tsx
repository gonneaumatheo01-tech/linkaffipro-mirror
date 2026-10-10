import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * Police Inter auto-hébergée (téléchargée au build par next/font : aucune requête vers Google depuis le navigateur).
 * La variable --font-inter est lue par le thème (--font-sans dans globals.css).
 */
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

/** Icônes : app/favicon.ico, app/icon.png et app/apple-icon.png (générées depuis public/brand/logo.png). */
export const metadata: Metadata = {
  title: { default: "LinkAffi Pro", template: "%s · LinkAffi Pro" },
  applicationName: "LinkAffi Pro",
  appleWebApp: { title: "LinkAffi Pro" },
  description: "Plateforme interne de statistiques d'affiliation et de bots Telegram",
  robots: { index: false, follow: false },
};

/**
 * Barre du navigateur sur téléphone : blanche comme l'en-tête (les écrans de connexion et d'invitation la passent
 * en nuit) ; `cover` donne accès à la zone sûre iOS (env(safe-area-inset-*)) utilisée par la barre du bas.
 */
export const viewport: Viewport = {
  themeColor: "#ffffff",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}

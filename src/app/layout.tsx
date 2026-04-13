import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Focus Club Vallecas | Entrenamiento Personal y Bienestar en Madrid",
  description: "Centro premium de entrenamiento personal en Vallecas, Madrid. Sandra Andújar — 15+ años de experiencia en hipertrofia, tonificación, recomposición corporal, pilates y nutrición deportiva. ¡Reserva tu valoración gratuita!",
  keywords: [
    "Entrenamiento personal Vallecas",
    "Focus Club",
    "Gimnasio Madrid",
    "Sandra Andújar",
    "Hipertrofia Vallecas",
    "Entrenador personal Madrid",
    "Pilates Vallecas",
    "Nutrición deportiva Madrid",
    "Tonificación",
    "Recomposición corporal",
    "Fisioterapia deportiva Vallecas",
    "Gimnasio premium Madrid",
  ],
  authors: [{ name: "Focus Club Vallecas" }],
  icons: {
    icon: "/imagenes/logo.jpeg",
  },
  openGraph: {
    title: "Focus Club Vallecas | Entrenamiento Personal Premium en Madrid",
    description: "Transforma tu cuerpo con Sandra Andújar en Focus Club Vallecas. Entrenamiento personalizado, hipertrofia, pilates y nutrición. ¡Reserva tu valoración gratuita!",
    type: "website",
    locale: "es_ES",
    siteName: "Focus Club Vallecas",
  },
  twitter: {
    card: "summary_large_image",
    title: "Focus Club Vallecas | Entrenamiento Personal Premium",
    description: "Entrenamiento personal, hipertrofia, pilates y nutrición en Vallecas, Madrid. Sandra Andújar, 15+ años de experiencia.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

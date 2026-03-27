import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "./ConvexClientProvider";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aurum",
  description: "AGIMA - сервис согласования затрат и инвестиций",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" className={inter.variable}>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <ConvexClientProvider>
            <div className="min-h-screen bg-background text-foreground">
              {children}
              <footer className="border-t border-zinc-200 bg-[linear-gradient(180deg,rgba(255,255,255,0)_0%,rgba(244,244,245,0.9)_100%)]">
                <div className="mx-auto flex w-full max-w-5xl justify-center px-6 py-5 text-sm text-muted-foreground">
                  <span>
                    Если есть проблемы, пишите{" "}
                    <a
                      href="https://t.me/Natarom"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-950"
                    >
                      @Natarom
                    </a>
                  </span>
                </div>
              </footer>
            </div>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}

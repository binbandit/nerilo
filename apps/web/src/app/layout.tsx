import type { ReactNode } from "react";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import "./workspace.css";
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-nerilo-sans" });
const serif = DM_Serif_Display({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-nerilo-serif",
});
export const metadata = {
  title: "Nerilo · Room to make",
  description: "A calm place to direct agents and bring work to completion.",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            data-options={JSON.stringify({ freezeReactUpdates: false })}
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className={`${sans.variable} ${serif.variable}`}>{children}</body>
    </html>
  );
}

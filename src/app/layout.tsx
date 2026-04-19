import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "linkdm",
  description: "LinkedIn Auto-DM Tool",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}

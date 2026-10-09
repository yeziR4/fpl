import type { Metadata } from "next";
import { Big_Shoulders, Space_Grotesk } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import "./globals.css";

const bigShoulders = Big_Shoulders({
  variable: "--font-big-shoulders",
  subsets: ["latin"],
  weight: ["700", "800", "900"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Overline — a study of humans and AI pricing football",
  description:
    "Five frontier models and public forecasters, pricing the same Fantasy Premier League markets, every position settled on Solana.",
};

/**
 * Applies the saved theme BEFORE first paint.
 *
 * Without this the page renders in the default theme, then the toggle's effect
 * runs and repaints -- a visible flash on every navigation, and on a dark page
 * a white one. Inline and synchronous in <head>, so it cannot be deferred.
 *
 * Kept in step with ThemeToggle's STORAGE_KEY by hand: one of them has to run
 * before React exists and cannot import from the other.
 */
const THEME_SCRIPT = `try{var m=localStorage.getItem("overline-theme");if(m==="light"||m==="dark"){document.documentElement.classList.add(m)}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bigShoulders.variable} ${spaceGrotesk.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}

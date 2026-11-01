import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";
import "./register.css";

export const metadata: Metadata = {
  title: {
    default: "RAMSport03 — reliability analysis that can prove itself",
    template: "%s — RAMSport03",
  },
  description:
    "Reliability, availability, maintainability and safety analysis with per-value provenance and Excel-first reporting.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

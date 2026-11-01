import { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Scratch — RAMSport03", template: "%s — Scratch | RAMSport03" },
  description: "Scratch page for testing",
};

export default function ScratchPage() {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
        <div className="p-8 text-center">
          <h1 className="text-4xl font-bold">Scratch Page</h1>
          <p className="mt-4 text-lg">This is a placeholder scratch page.</p>
        </div>
      </body>
    </html>
  );
}

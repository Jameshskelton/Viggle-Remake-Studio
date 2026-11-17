import type { Metadata } from "next";
import { RunReminder } from "../components/run-reminder.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viggle Remake Studio",
  description: "Select a character in a video, mask them, and remake the shot with Viggle Remake on your own GPU.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
      {children}
      <RunReminder />
    </body>
    </html>
  );
}

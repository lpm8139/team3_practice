import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Link Pocket — URLを、短く。",
  description: "登録不要で使えるシンプルなURL短縮サービス",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

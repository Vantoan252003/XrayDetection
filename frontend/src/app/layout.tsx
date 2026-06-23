import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin", "vietnamese"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "XRay Data Engineering Platform",
  description: "Nền tảng phân tích X-quang quy mô lớn với Apache Kafka, Spark, MinIO và trực quan hoá dữ liệu realtime",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex" style={{ WebkitFontSmoothing: "antialiased" }}>
        <Sidebar />
        <main className="main-content flex-1">{children}</main>
      </body>
    </html>
  );
}

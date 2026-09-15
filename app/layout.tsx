import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const euclidCircularA = localFont({
  variable: "--font-euclid-circular-a",
  src: [
    { path: "./fonts/EuclidCircularA-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/EuclidCircularA-LightItalic.ttf", weight: "300", style: "italic" },
    { path: "./fonts/EuclidCircularA-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/EuclidCircularA-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/EuclidCircularA-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/EuclidCircularA-MediumItalic.ttf", weight: "500", style: "italic" },
    { path: "./fonts/EuclidCircularA-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/EuclidCircularA-SemiBoldItalic.ttf", weight: "600", style: "italic" },
    { path: "./fonts/EuclidCircularA-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/EuclidCircularA-BoldItalic.ttf", weight: "700", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: "SEO Console",
  description: "Google Search Console + Bing performance, with better readability",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${euclidCircularA.variable} h-full antialiased`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('seo-theme');if(t&&t!=='system')document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

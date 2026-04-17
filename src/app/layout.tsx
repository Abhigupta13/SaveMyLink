import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { getCategories } from "@/actions/category";
import { PreviewProvider } from "@/components/PreviewContext";
import { ViewProvider } from "@/components/ViewContext";
import { UserProvider } from "@/components/UserContext";
import AuthProvider from "@/components/AuthProvider";
import { cookies } from "next/headers";

export const dynamic = 'force-dynamic';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SaveMyLink",
  description: "Save your important links",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const privateSafe = cookieStore.get('privateSafe')?.value === 'true';
  const columns = Number(cookieStore.get('columns')?.value) || 2;

  let categories = [];
  try {
    categories = await getCategories(privateSafe);
  } catch (error) {
    console.warn("Failed to fetch categories. Database might not be connected yet.");
  }
  
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>
          <UserProvider>
            <PreviewProvider>
              <ViewProvider initialColumns={columns}>
                <TopNav initialCategories={categories} />
                {children}
              </ViewProvider>
            </PreviewProvider>
          </UserProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

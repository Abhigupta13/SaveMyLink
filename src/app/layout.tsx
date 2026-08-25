import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { getCategories } from "@/actions/category";
import { PreviewProvider } from "@/components/PreviewContext";
import { ViewProvider } from "@/components/ViewContext";
import { UserProvider } from "@/components/UserContext";
import AuthProvider from "@/components/AuthProvider";
import SendIntentListener from "@/components/SendIntentListener";
import JarvisWidget from "@/components/JarvisWidget";
import { FeedbackProvider } from "@/components/ui/Feedback";
import { cookies } from "next/headers";

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: "ALL you need",
  description: "Your personal digital companion",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const privateSafe = cookieStore.get('privateSafe')?.value === 'true';
  const columns = Number(cookieStore.get('columns')?.value) || 2;
  // Rendered on the server so there is no flash of the wrong theme.
  // No attribute ("system") means the CSS follows the OS.
  const theme = cookieStore.get('theme')?.value;

  let categories = [];
  try {
    categories = await getCategories(privateSafe);
  } catch (error) {
    console.warn("Failed to fetch categories. Database might not be connected yet.");
  }
  
  return (
    <html
      lang="en"
      data-theme={theme === 'light' || theme === 'dark' ? theme : undefined}
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>
          <UserProvider>
            <FeedbackProvider>
            <PreviewProvider>
              <ViewProvider initialColumns={columns}>
                <SendIntentListener />
                <TopNav initialCategories={categories} />
                <main className="flex-1">
                  {children}
                </main>
                <JarvisWidget />
              </ViewProvider>
            </PreviewProvider>
            </FeedbackProvider>
          </UserProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

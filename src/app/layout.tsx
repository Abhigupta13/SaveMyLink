import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { getCategories } from "@/actions/category";
import { PreviewProvider } from "@/components/PreviewContext";
import { ViewProvider } from "@/components/ViewContext";
import { UserProvider } from "@/components/UserContext";
import AuthProvider from "@/components/AuthProvider";
import SendIntentListener from "@/components/SendIntentListener";
import BackButtonListener from "@/components/BackButtonListener";
import JarvisWidget from "@/components/JarvisWidget";
import { FeedbackProvider } from "@/components/ui/Feedback";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

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

  // Handed to SessionProvider so client pages start with the session already in hand.
  const session = await getServerSession(authOptions);

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
        <AuthProvider session={session}>
          <UserProvider>
            <FeedbackProvider>
            <PreviewProvider>
              <ViewProvider initialColumns={columns}>
                <SendIntentListener />
                <BackButtonListener />
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

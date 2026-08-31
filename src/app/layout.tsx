import type { Metadata } from "next";
import "./globals.css";
import TopNav from "@/components/TopNav";
import { getCategories } from "@/actions/category";
import { PreviewProvider } from "@/components/PreviewContext";
import { ViewProvider } from "@/components/ViewContext";
import { UserProvider } from "@/components/UserContext";
import AuthProvider from "@/components/AuthProvider";
import { Suspense } from "react";
import SendIntentListener from "@/components/SendIntentListener";
import NativeAuthListener from "@/components/NativeAuthListener";
import ReminderBootstrap from "@/components/ReminderBootstrap";
import TimeZoneCookie from "@/components/TimeZoneCookie";
import DriveOutcome from "@/components/DriveOutcome";
import BackButtonListener from "@/components/BackButtonListener";
import JarvisWidget from "@/components/JarvisWidget";
import Tour from "@/components/Tour";
import { FeedbackProvider } from "@/components/ui/Feedback";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { Inter, Plus_Jakarta_Sans, Fraunces } from "next/font/google";

/* The three faces the design actually uses. They were loaded with an @import at the top of
   globals.css, which the production build drops — the deployed site has been rendering in
   system sans and Georgia this whole time. next/font self-hosts them instead, so they are
   served from our own origin, preloaded, and cannot silently go missing again. */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
// opsz and SOFT are non-default axes; the display rules set them through font-variation-settings,
// and italic is used by the sign-in side panel. Ask for all of it or those rules do nothing.
const fraunces = Fraunces({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["SOFT", "opsz"],
  variable: "--font-fraunces",
  display: "swap",
});

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
      className={`h-full antialiased ${inter.variable} ${jakarta.variable} ${fraunces.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider session={session}>
          <UserProvider>
            <FeedbackProvider>
            <PreviewProvider>
              <ViewProvider initialColumns={columns}>
                <SendIntentListener />
                <NativeAuthListener />
                <ReminderBootstrap />
                {/* Publishes the browser's zone so SERVER renders can use the viewer's clock
                    rather than the runtime's. Without it the digest printed UTC. */}
                <TimeZoneCookie />
                <Suspense fallback={null}><DriveOutcome /></Suspense>
                <BackButtonListener />
                <TopNav initialCategories={categories} />
                <main className="flex-1">
                  {children}
                </main>
                <JarvisWidget />
                <Tour />
              </ViewProvider>
            </PreviewProvider>
            </FeedbackProvider>
          </UserProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

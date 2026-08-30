import Loading from '@/components/ui/Loading';

/**
 * What the app shows between pressing a destination and it arriving. Next wraps every page below
 * this segment in a Suspense boundary with this as the fallback, so one file covers every route.
 *
 * It does NOT cover the root layout's own render — that reads cookies and the session, and an
 * uncached layout blocks rather than falling back. So this is the navigation case: the rail and the
 * bottom bar stay put and interactive, and only the page area shows the mark. Which is the right
 * shape anyway — the chrome did not go anywhere, so it should not blink.
 */
export default function RouteLoading() {
  return (
    <div className="page">
      <Loading label="Loading this page" />
    </div>
  );
}

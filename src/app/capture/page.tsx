import { getCategories } from '@/actions/category';
import CaptureSheet from '@/components/CaptureSheet';

// Quick-save sheet opened by the Android share sheet (via SendIntentListener)
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; title?: string }>;
}) {
  const { url, title } = await searchParams;
  const categories = await getCategories(false);
  return <CaptureSheet url={url} title={title} categories={categories} />;
}

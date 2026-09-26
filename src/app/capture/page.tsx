import { redirect } from 'next/navigation';
import { getCategories } from '@/actions/category';
import CaptureSheet from '@/components/CaptureSheet';
import { linksAddParams } from '@/lib/shareIntent';

/** Share target: URLs go to Links tab; plain text still uses the quick note sheet. */
export default async function CapturePage({
  searchParams,
}: {
  searchParams: Promise<{ url?: string; title?: string }>;
}) {
  const { url, title } = await searchParams;
  if (url) redirect(`/links?${linksAddParams(url, title || '')}`);

  const categories = await getCategories(false);
  return <CaptureSheet url={url} title={title} categories={categories} />;
}

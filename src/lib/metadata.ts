import ogs from 'open-graph-scraper';
import { youtubeId } from '@/lib/url';

export async function scrapeMetadata(url: string) {
  // YouTube: keyless thumbnail URL + oEmbed title — faster and more reliable than scraping
  const ytId = youtubeId(url);
  if (ytId) {
    let title = '';
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) title = (await res.json()).title || '';
    } catch {
      // keep empty title; thumbnail still works
    }
    return {
      title,
      image: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      duration: '',
      quality: ''
    };
  }

  try {
    const options = { url, timeout: 5000 };
    const { result, error } = await ogs(options);
    
    if (error) {
      console.warn('Scraping returned an error for', url);
    }
    
    // Quick heuristic logic for YouTube URLs duration. Actually fetching real duration requires YouTube API which isn't available without a key.
    
    let image = '';
    if (result.ogImage && result.ogImage.length > 0) {
      image = result.ogImage[0].url;
    } else if (result.twitterImage && result.twitterImage.length > 0) {
      image = result.twitterImage[0].url;
    }

    return {
      title: result.ogTitle || result.twitterTitle || '',
      image: image,
      duration: '', // Optional/Difficult without API
      quality: ''
    };
  } catch (error) {
    console.error('Exception while scraping metadata:', error);
    return { title: '', image: '', duration: '', quality: '' };
  }
}

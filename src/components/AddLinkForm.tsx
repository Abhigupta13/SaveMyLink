'use client';

import { useState, useEffect, useRef } from 'react';
import { createCategory, addCategoryDomain } from '@/actions/category';
import { createLink, getLinkMetadata } from '@/actions/link';
import { useUser } from '@/components/UserContext';
import { hostnameOf } from '@/lib/url';
import { useFeedback } from '@/components/ui/Feedback';

interface AddLinkFormProps {
  initialUrl?: string;
  initialTitle?: string;
  categories: any[];
  onSaved: (opts: { isPrivate: boolean }) => void;
}

// Shared add-link form: used by the TopNav modal (web) and /capture (share sheet)
export default function AddLinkForm({ initialUrl, initialTitle, categories: initialCategories, onSaved }: AddLinkFormProps) {
  const { toast, confirm } = useFeedback();
  const [categories, setCategories] = useState(initialCategories);
  useEffect(() => { setCategories(initialCategories); }, [initialCategories]);

  const [url, setUrl] = useState(initialUrl || '');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [previewMetadata, setPreviewMetadata] = useState<{ title: string, image: string } | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [fileDomain, setFileDomain] = useState(false);
  const userPickedCategory = useRef(false);

  const { privateSafe } = useUser();
  const [isPrivate, setIsPrivate] = useState(privateSafe);
  useEffect(() => { setIsPrivate(privateSafe); }, [privateSafe]);

  const hostname = hostnameOf(url);
  const selectedCat = categories.find((c: any) => c._id === selectedCategory);
  const domainAlreadyFiled = !!selectedCat?.domains?.some((d: string) => hostname === d || hostname.endsWith('.' + d));

  // Rule-based preselect: match hostname against category domain rules until the user picks one
  useEffect(() => {
    if (!hostname || userPickedCategory.current || showCreateCategory) return;
    const match = categories.find((c: any) =>
      c.domains?.some((d: string) => hostname === d || hostname.endsWith('.' + d))
    );
    if (match) setSelectedCategory(match._id);
  }, [hostname, categories, showCreateCategory]);

  // Debounced live metadata preview
  useEffect(() => {
    if (!url || !url.startsWith('http')) {
      setPreviewMetadata(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsFetchingMetadata(true);
      try {
        const res = await getLinkMetadata(url);
        if (res.success && res.metadata && (res.metadata.title || res.metadata.image)) {
          setPreviewMetadata({
            title: res.metadata.title || initialTitle || '',
            image: res.metadata.image || ''
          });
        } else {
          // Scrape blocked (e.g. Instagram) — fall back to the share-provided title
          setPreviewMetadata({ title: initialTitle || 'No preview found', image: '' });
        }
      } catch {
        setPreviewMetadata({ title: initialTitle || 'Failed to fetch preview', image: '' });
      } finally {
        setIsFetchingMetadata(false);
      }
    }, initialUrl === url ? 0 : 800);
    return () => clearTimeout(timer);
  }, [url, initialUrl, initialTitle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setIsLoading(true);
    let categoryId = selectedCategory;

    if (showCreateCategory && newCategoryName) {
      const res = await createCategory(newCategoryName, isPrivate);
      if (res.success && res.category) {
        categoryId = res.category._id;
        setCategories([res.category, ...categories]);
      } else {
        toast(res.error || 'Failed to create category', 'error');
        setIsLoading(false);
        return;
      }
    }

    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const prefetched = previewMetadata && (previewMetadata.image || (previewMetadata.title && previewMetadata.title !== 'No preview found' && previewMetadata.title !== 'Failed to fetch preview'))
      ? { title: previewMetadata.title, image: previewMetadata.image }
      : initialTitle ? { title: initialTitle, image: '' } : undefined;

    const res = await createLink(url, categoryId || '', tags, isPrivate, prefetched);
    if (res.success) {
      if (fileDomain && categoryId && hostname) {
        await addCategoryDomain(categoryId, hostname);
      }
      onSaved({ isPrivate });
    } else {
      toast(res.error || 'Failed to save link', 'error');
    }
    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="modal-form">
      <div className="input-group">
        <input
          type="url" placeholder="Paste URL (https://...)"
          value={url} onChange={(e) => setUrl(e.target.value)}
          style={{ borderRadius: '16px', padding: '14px 18px', background: 'var(--bg-tertiary)' }} required
        />
      </div>

      {(url && (isFetchingMetadata || previewMetadata)) && (
        <div className="modal-preview-container">
          {isFetchingMetadata ? (
            <div style={{ padding: '20px', display: 'flex', justifyContent: 'center' }}>
              <div className="loading-spinner"></div>
            </div>
          ) : previewMetadata ? (
            <div className="preview-content-box" style={{
              position: 'relative', width: '100%', height: '180px', background: 'var(--bg-tertiary)', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)'
            }}>
              {previewMetadata.image ? (
                <img src={previewMetadata.image} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontWeight: 600 }}>NO PREVIEW</div>
              )}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, transparent 100%)', padding: '20px 16px'
              }}>
                <p style={{ fontSize: '0.85rem', color: 'white', margin: 0, fontWeight: 700, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{previewMetadata.title}</p>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="category-selector">
        <p style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Store in</p>
        <div className="popular-categories" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {categories.slice(0, 5).map((c: any) => (
            <button
              type="button" key={c._id}
              className={`cat-pill ${selectedCategory === c._id && !showCreateCategory ? 'active' : ''}`}
              onClick={() => { userPickedCategory.current = true; setSelectedCategory(c._id); setShowCreateCategory(false); }}
              style={{ padding: '10px 16px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 700 }}
            >
              {c.name}
            </button>
          ))}
          <button
            type="button" className={`cat-pill ${showCreateCategory ? 'active' : ''}`}
            onClick={() => { userPickedCategory.current = true; setShowCreateCategory(true); setSelectedCategory(''); }}
            style={{ padding: '10px 16px', borderRadius: '12px', fontSize: '0.8rem', borderStyle: 'dashed' }}
          >
            + New
          </button>
        </div>

        {showCreateCategory && (
          <div className="input-group" style={{ marginTop: '12px' }}>
            <input
              type="text" placeholder="Category Name" value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              style={{ borderRadius: '14px' }} required
            />
          </div>
        )}

        {hostname && (selectedCategory || showCreateCategory) && !domainAlreadyFiled && (
          <label className="switch-container" style={{ marginTop: '12px', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={fileDomain} onChange={(e) => setFileDomain(e.target.checked)} />
            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Remember this: file future <strong style={{ color: 'var(--text-primary)' }}>{hostname}</strong> links here automatically
            </span>
          </label>
        )}
      </div>

      <div className="input-group">
        <input
          type="text" placeholder="Tags (comma separated)"
          value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
          style={{ borderRadius: '14px', padding: '14px 18px', background: 'var(--bg-tertiary)' }}
        />
      </div>

      <div className="input-group" style={{ marginBottom: '24px' }}>
        <label className="switch-container">
          <div className="switch"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /><span className="slider round"></span></div>
          <span className="switch-label" style={{ fontWeight: 600 }}>Internal Safe 🔒</span>
        </label>
      </div>

      <button type="submit" className="btn-primary" disabled={isLoading} style={{ width: '100%', height: '56px', borderRadius: '18px', fontWeight: 800 }}>
        {isLoading ? 'Saving...' : 'Secure to Vault'}
      </button>
    </form>
  );
}

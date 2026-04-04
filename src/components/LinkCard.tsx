'use client';

import { useState } from 'react';
import { usePreview } from '@/components/PreviewContext';
import { updateLink, deleteLink, toggleFavorite, refreshMetadata, toggleLinkPrivacy } from '@/actions/link';

export default function LinkCard({ link, categories }: { link: any, categories: any[] }) {
  const { showPreview } = usePreview();
  const categoryName = link.category?.name || 'Uncategorized';
  const categoryColor = link.category?.color || '#3b82f6';

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(link.category?._id || '');
  const [tagsInput, setTagsInput] = useState(link.tags ? link.tags.join(', ') : '');
  const [title, setTitle] = useState(link.title || '');
  const [url, setUrl] = useState(link.url || '');
  const [isFavorite, setIsFavorite] = useState(link.isFavorite || false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const res = await updateLink(link._id, {
      categoryId: selectedCategory,
      tagsInput,
      title,
      url,
      isFavorite
    });
    if (res.success) {
      setIsEditing(false);
    } else {
      alert(res.error || 'Failed to update link');
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this link?')) return;
    setIsDeleting(true);
    const res = await deleteLink(link._id);
    if (!res.success) {
      alert(res.error || 'Failed to delete link');
      setIsDeleting(false);
    }
  };

  const handleToggleFavorite = async () => {
    const nextFavorite = !isFavorite;
    setIsFavorite(nextFavorite); // Optimistic update
    const res = await toggleFavorite(link._id, nextFavorite);
    if (!res.success) {
      setIsFavorite(!nextFavorite); // Revert on failure
      alert(res.error || 'Failed to update favorite status');
    }
  };

  const handleTogglePrivacy = async () => {
    setIsRefreshing(true);
    const res = await toggleLinkPrivacy(link._id, !link.isPrivate);
    if (!res.success) {
      alert('Failed to update privacy: ' + res.error);
    }
    setIsRefreshing(false);
  };

  const handleRefreshMetadata = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    setIsRefreshing(true);
    setStatus(null);
    const res = await refreshMetadata(link._id);
    if (!res.success) {
      setStatus({ type: 'error', message: res.error || 'Failed to refresh preview' });
    } else {
      setStatus({ type: 'success', message: 'Preview updated successfully!' });
      // Clear success message after 3 seconds
      setTimeout(() => setStatus(null), 3000);
    }
    setIsRefreshing(false);
  };

  return (
    <div className="link-card-container">
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="link-card">
        {showPreview && (
          <div className="card-image-wrap">
            {link.previewImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={link.previewImageUrl} alt={link.title || 'Preview'} className="card-image" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No Preview Available</div>
                <button 
                  onClick={handleRefreshMetadata}
                  disabled={isRefreshing}
                  className="refresh-preview-btn"
                >
                  {isRefreshing ? 'Refreshing...' : 'Refresh Preview'}
                </button>
              </div>
            )}
            {link.quality && <span className="card-badge card-quality">{link.quality}</span>}
            {link.duration && <span className="card-badge card-duration">{link.duration}</span>}
          </div>
        )}
        <div className="card-content">
          <div className="card-actions-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {isFavorite && <span className="card-favorite" title="Favorite">★</span>}
              <span className="card-category" style={{ backgroundColor: categoryColor, marginBottom: 0 }}>
                {categoryName}
              </span>
              {link.isPrivate && <span className="card-private-badge" title="Private Link">🔒</span>}
              {!link.isPrivate && (
                <button 
                  className="quick-privacy-btn" 
                  onClick={(e) => { e.preventDefault(); handleTogglePrivacy(); }}
                  title="Move to Private Safe"
                  style={{ fontSize: '0.9rem', opacity: 0.7, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                >
                  🔓
                </button>
              )}
            </div>
            <div className="card-tags">
              {link.tags && link.tags.map((tag: string, i: number) => (
                <span key={i} className="card-tag">#{tag}</span>
              ))}
            </div>
          </div>
          <div className="card-url" title={link.url}>{link.url}</div>
          <h3 className="card-title">{link.title || link.url}</h3>
          <button 
            className="card-menu-btn" 
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsEditing(true); }}
            title="Edit Link"
          >
            &#8942;
          </button>
        </div>
      </a>

      {/* Edit Modal */}
      {isEditing && (
        <div className="modal-overlay" onClick={() => setIsEditing(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                <input 
                  type="text" 
                  className="modal-title-input" 
                  value={title} 
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter Title"
                />
                {status && (
                  <div style={{ fontSize: '0.75rem', color: status.type === 'error' ? '#f87171' : '#34d399', marginLeft: '8px' }}>
                    {status.message}
                  </div>
                )}
              </div>
              <button className="modal-close" onClick={() => { setIsEditing(false); setStatus(null); }}>&times;</button>
            </div>

            <form onSubmit={handleUpdate} className="modal-form">
              {link.previewImageUrl && (
                <div className="modal-preview-container">
                  <img src={link.previewImageUrl} alt="Preview" className="modal-preview-image" />
                </div>
              )}

              <div className="modal-url-row">
                <span className="modal-url-label">link</span>
                <input 
                  type="text" 
                  className="modal-url-input" 
                  value={url} 
                  onChange={(e) => setUrl(e.target.value)}
                />
                <button type="button" className="modal-url-edit-btn">Edit</button>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Category</label>
                <select 
                  className="category-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  required
                >
                  <option value="" disabled>Choose Category</option>
                  {categories.map((c: any) => (
                    <option key={c._id} value={c._id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="input-group">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Tags</label>
                <input 
                  type="text" 
                  placeholder="Tags (comma separated)" 
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>

              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn-danger" 
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
                <div className="modal-footer-actions">
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {!link.previewImageUrl && (
                      <button 
                        type="button"
                        className="modal-refresh-btn"
                        onClick={handleRefreshMetadata}
                        disabled={isRefreshing}
                        title="Refresh Metadata"
                        style={{ background: 'var(--bg-tertiary)', width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {isRefreshing ? '⌛' : '↻'}
                      </button>
                    )}
                    <button 
                      type="button"
                      className={`favorite-btn ${isFavorite ? 'active' : ''}`}
                      onClick={handleToggleFavorite}
                      title={isFavorite ? 'Unfavorite' : 'Favorite'}
                      style={{ background: 'var(--bg-tertiary)', width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--border-color)' }}
                    >
                      {isFavorite ? '★' : '☆'}
                    </button>
                  </div>
                  <button type="submit" className="btn-primary" disabled={isSaving}>
                    {isSaving ? <div className="loading-spinner"></div> : 'Save Changes'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

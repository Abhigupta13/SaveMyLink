'use client';

import { useState } from 'react';
import { usePreview } from '@/components/PreviewContext';
import { updateLink } from '@/actions/link';

export default function LinkCard({ link, categories }: { link: any, categories: any[] }) {
  const { showPreview } = usePreview();
  const categoryName = link.category?.name || 'Uncategorized';
  const categoryColor = link.category?.color || '#3b82f6';

  const [isEditing, setIsEditing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(link.category?._id || '');
  const [tagsInput, setTagsInput] = useState(link.tags ? link.tags.join(', ') : '');
  const [isSaving, setIsSaving] = useState(false);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const res = await updateLink(link._id, selectedCategory, tagsInput);
    if (res.success) {
      setIsEditing(false);
    } else {
      alert(res.error || 'Failed to update link');
    }
    setIsSaving(false);
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
              <div style={{ color: 'var(--text-secondary)' }}>No Preview Available</div>
            )}
            {link.quality && <span className="card-badge card-quality">{link.quality}</span>}
            {link.duration && <span className="card-badge card-duration">{link.duration}</span>}
          </div>
        )}
        <div className="card-content">
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <span className="card-category" style={{ backgroundColor: categoryColor, marginBottom: 0 }}>
              {categoryName}
            </span>
            {link.tags && link.tags.map((tag: string, i: number) => (
              <span key={i} className="card-tag">#{tag}</span>
            ))}
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
              <h2 className="modal-title">Update Link details</h2>
              <button className="modal-close" onClick={() => setIsEditing(false)}>&times;</button>
            </div>
            <form onSubmit={handleUpdate} className="modal-form">
              <div className="input-group">
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
                <input 
                  type="text" 
                  placeholder="Tags (comma separated)" 
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={isSaving}>
                {isSaving ? <div className="loading-spinner"></div> : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useRef } from 'react';
import { bulkCreateLinks } from '@/actions/link';
import { useUser } from './UserContext';

export default function BulkImportModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const { privateSafe } = useUser();
  const [activeTab, setActiveTab] = useState<'text' | 'csv'>('text');
  const [urlList, setUrlList] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number, failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handlePasteSubmit = async () => {
    const urls = urlList
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.startsWith('http'));

    if (urls.length === 0) return;

    setLoading(true);
    const res: any = await bulkCreateLinks(urls.map(url => ({ url, isPrivate: privateSafe })));
    setLoading(false);
    
    if (res.success) {
      setResult({ success: res.successCount || 0, failed: res.failed || 0 });
      setUrlList('');
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n');
      if (lines.length < 1) {
        setLoading(false);
        return;
      }

      // Simple CSV parsing: find URL-like columns or look for "url", "link" in header
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      let urlIndex = headers.findIndex(h => h.includes('url') || h.includes('link') || h.includes('href'));
      
      if (urlIndex === -1) urlIndex = 0; // Default to first column if no header match

      const urls = lines.slice(1)
        .map(line => {
          const cols = line.split(',');
          return cols[urlIndex]?.trim().replace(/^["']|["']$/g, ''); // Remove quotes
        })
        .filter(url => url && url.startsWith('http'));

      if (urls.length > 0) {
        const res: any = await bulkCreateLinks(urls.map(url => ({ url, isPrivate: privateSafe })));
        if (res.success) {
          setResult({ success: res.successCount || 0, failed: res.failed || 0 });
        }
      }
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const handleClose = () => {
    setResult(null);
    setUrlList('');
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Bulk Import Links</h2>
          <button className="modal-close" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-tabs" style={{ display: 'flex', gap: '20px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
          <button 
            className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTab('text')}
            style={{ paddingBottom: '10px', borderBottom: activeTab === 'text' ? '2px solid var(--accent-color)' : 'none', background: 'none', color: activeTab === 'text' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Paste URLs
          </button>
          <button 
            className={`tab-btn ${activeTab === 'csv' ? 'active' : ''}`}
            onClick={() => setActiveTab('csv')}
            style={{ paddingBottom: '10px', borderBottom: activeTab === 'csv' ? '2px solid var(--accent-color)' : 'none', background: 'none', color: activeTab === 'csv' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Upload CSV
          </button>
        </div>

        {result ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
            <h3>Import Complete</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
              Successfully imported {result.success} links.
              {result.failed > 0 && ` (${result.failed} failed)`}
            </p>
            <button className="btn-primary" onClick={handleClose} style={{ marginTop: '20px', width: '100%' }}>Done</button>
          </div>
        ) : (
          <div className="modal-body">
            {activeTab === 'text' ? (
              <div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  Paste multiple links below, one per line. They will be added to your current {privateSafe ? 'Private Safe' : 'Collection'}.
                </p>
                <textarea
                  className="bulk-textarea"
                  placeholder="https://example.com/item1&#10;https://example.com/item2"
                  value={urlList}
                  onChange={(e) => setUrlList(e.target.value)}
                  style={{ width: '100%', height: '200px', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', resize: 'none', fontFamily: 'monospace', fontSize: '0.9rem' }}
                  disabled={loading}
                />
                <button 
                  className="btn-primary" 
                  style={{ width: '100%', marginTop: '20px' }}
                  onClick={handlePasteSubmit}
                  disabled={loading || !urlList.trim()}
                >
                  {loading ? 'Importing...' : 'Import Links'}
                </button>
              </div>
            ) : (
              <div 
                style={{ border: '2px dashed var(--border-color)', borderRadius: '12px', padding: '40px 20px', textAlign: 'center', cursor: 'pointer' }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  accept=".csv" 
                  ref={fileInputRef} 
                  style={{ display: 'none' }} 
                  onChange={handleCsvUpload} 
                />
                <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>📁</div>
                <p style={{ color: 'var(--text-primary)', fontWeight: '500' }}>Click to upload CSV file</p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '8px' }}>
                  We will look for columns named "url" or "link".
                </p>
                {loading && <p style={{ marginTop: '15px', color: 'var(--accent-color)' }}>Parsing and importing links...</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

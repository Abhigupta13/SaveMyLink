'use client';
import { useState, useRef } from 'react';
import { useDialog, dialogProps } from '@/components/ui/useDialog';
import { bulkCreateLinks } from '@/actions/link';
import { useUser } from './UserContext';

type BulkImportEntry = {
  url: string;
  isPrivate?: boolean;
  category?: string;
  tags?: string[];
};

export default function BulkImportModal({ isOpen, onClose, inline = false }: { isOpen: boolean, onClose: () => void, inline?: boolean }) {
  const { privateSafe } = useUser();
  const [activeTab, setActiveTab] = useState<'text' | 'csv'>('text');
  const [urlList, setUrlList] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: number, failed: number } | null>(null);
  const [progress, setProgress] = useState<{ processed: number; total: number; success: number; failed: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Declared up here, above the early return, because useDialog below has to be too — hooks cannot
     sit after a conditional return, and a hook referencing a `const` declared further down is a
     temporal-dead-zone hazard the React compiler rules reject even when the call is deferred. */
  const handleClose = () => {
    setResult(null);
    setProgress(null);
    setUrlList('');
    onClose();
  };

  // `inline` renders this same component as a plain card on /import with no overlay, so there is
  // nothing to dismiss in that mode.
  useDialog(isOpen && !inline, handleClose);

  if (!isOpen) return null;

  const parseCsvLine = (line: string) => {
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    cols.push(current.trim());
    return cols.map((col) => col.replace(/^["']|["']$/g, ''));
  };

  const handlePasteSubmit = async () => {
    const urls = urlList
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.startsWith('http'));

    if (urls.length === 0) return;

    const entries: BulkImportEntry[] = urls.map((url) => ({ url, isPrivate: privateSafe }));
    await importWithProgress(entries);
    if (entries.length > 0) {
      setUrlList('');
    }
  };

  const importWithProgress = async (entries: BulkImportEntry[]) => {
    if (entries.length === 0) return;

    const batchSize = 5;
    let successCount = 0;
    let failedCount = 0;
    setLoading(true);
    setProgress({ processed: 0, total: entries.length, success: 0, failed: 0 });

    try {
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        const res: any = await bulkCreateLinks(batch);
        const batchSuccess = res?.successCount || 0;
        const batchFailed = res?.failed || 0;

        successCount += batchSuccess;
        failedCount += batchFailed;

        setProgress({
          processed: Math.min(i + batch.length, entries.length),
          total: entries.length,
          success: successCount,
          failed: failedCount
        });
      }

      setResult({ success: successCount, failed: failedCount });
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 1) {
        return;
      }

      const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
      let urlIndex = headers.findIndex(h => h.includes('url') || h.includes('link') || h.includes('href'));
      const categoryIndex = headers.findIndex(h => h === 'category' || h.includes('category'));
      const privateIndex = headers.findIndex(h => h === 'isprivate' || h.includes('private'));
      const tagsIndex = headers.findIndex(h => h === 'tags' || h.includes('tag'));
      
      if (urlIndex === -1) urlIndex = 0; // Default to first column if no header match

      const entries: BulkImportEntry[] = lines.slice(1)
        .map(line => {
          const cols = parseCsvLine(line);
          const url = cols[urlIndex]?.trim();
          const category = categoryIndex >= 0 ? cols[categoryIndex]?.trim() : '';
          const rawPrivate = privateIndex >= 0 ? cols[privateIndex]?.trim().toLowerCase() : '';
          const rowIsPrivate = ['true', '1', 'yes', 'y'].includes(rawPrivate)
            ? true
            : ['false', '0', 'no', 'n'].includes(rawPrivate)
              ? false
              : privateSafe;
          const rawTags = tagsIndex >= 0 ? cols[tagsIndex] : '';
          const tags = rawTags
            ? rawTags.split(/[;,]/).map(tag => tag.trim()).filter(Boolean)
            : [];

          return {
            url,
            category: category || undefined,
            isPrivate: rowIsPrivate,
            tags
          };
        })
        .filter(item => item.url && item.url.startsWith('http'));

      await importWithProgress(entries);
    };
    reader.readAsText(file);
  };

  return (
    <div className={inline ? '' : 'modal-overlay'} onClick={inline ? undefined : handleClose}>
      <div className={inline ? 'card' : 'modal-content'} onClick={e => e.stopPropagation()} style={inline ? undefined : { maxWidth: '500px' }}
        {...(inline ? {} : { ...dialogProps, 'aria-label': 'Import links' })}>
        {!inline && (<div className="modal-header">
          <h2 className="modal-title">Bulk Import Links</h2>
          <button className="modal-close" onClick={handleClose} aria-label="Close">&times;</button>
        </div>)}

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
                {progress && (
                  <p style={{ marginTop: '10px', color: 'var(--accent-color)', fontSize: '0.85rem' }}>
                    {progress.processed} out of {progress.total} links uploaded ({progress.success} success, {progress.failed} failed)
                  </p>
                )}
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
                  Supported columns: URL, Category, IsPrivate, Tags.
                </p>
                {loading && (
                  <p style={{ marginTop: '15px', color: 'var(--accent-color)' }}>
                    {progress
                      ? `${progress.processed} out of ${progress.total} links uploaded (${progress.success} success, ${progress.failed} failed)`
                      : 'Parsing and importing links...'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

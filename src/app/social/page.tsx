'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Plus, X, Check, Pencil } from 'lucide-react';
import { getSocialApps, addSocialApp, deleteSocialApp } from '@/actions/social';

// Real brand icons for any URL, no asset management
const iconFor = (url: string) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`; } catch { return ''; }
};
const normalize = (u: string) => /^https?:\/\//i.test(u) ? u : `https://${u}`;

export default function AppsPage() {
  const { status } = useSession();
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');

  const load = useCallback(async () => {
    const res = await getSocialApps();
    setApps(res.apps || []);
    setLoading(false);
  }, []);
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = normalize(url.trim());
    const n = name.trim() || new URL(u).hostname.replace(/^www\./, '').split('.')[0];
    const res = await addSocialApp({ name: n.charAt(0).toUpperCase() + n.slice(1), url: u, icon: '•', color: '#6366f1' });
    if (res.success) { setName(''); setUrl(''); setAdding(false); load(); } else alert(res.error);
  };

  const handleDelete = async (id: string) => {
    setApps(a => a.filter(x => x._id !== id));
    const res = await deleteSocialApp(id);
    if (!res.success) load();
  };

  return (
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '20px', gap: '12px' }}>
        <div>
          <h1 className="page-title">Apps</h1>
          <p className="page-subtitle">Tap to open — in the app if installed, else your browser</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {apps.length > 0 && (
            <button className="icon-btn" onClick={() => setEditing(e => !e)} title={editing ? 'Done' : 'Edit'}>
              {editing ? <Check size={16} /> : <Pencil size={15} />}
            </button>
          )}
          <button className="btn-primary" onClick={() => setAdding(a => !a)} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}>
            <Plus size={18} /> Add
          </button>
        </div>
      </header>

      {adding && (
        <form onSubmit={handleAdd} className="card" style={{ display: 'grid', gap: '10px', marginBottom: '20px' }}>
          <input className="field" placeholder="App URL (e.g. instagram.com)" value={url} onChange={e => setUrl(e.target.value)} required autoFocus />
          <input className="field" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button type="button" className="icon-btn" onClick={() => setAdding(false)}><X size={16} /></button>
            <button type="submit" className="btn-primary" style={{ padding: '10px 22px', borderRadius: '12px', fontWeight: 800 }}>Add</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : (
        <div className="apps-grid">
          {apps.map(app => (
            <div key={app._id} className={`app-tile ${editing ? 'editing' : ''}`}>
              {/* target=_blank: new tab on web; in the Android app the system opens the native app (App Links) or the browser */}
              <a href={app.url} target="_blank" rel="noopener noreferrer" className="app-tile-link" onClick={e => editing && e.preventDefault()}>
                <span className="app-icon">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={iconFor(app.url)} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  <span className="app-icon-fallback">{app.name[0].toUpperCase()}</span>
                </span>
                <span className="app-name">{app.name}</span>
              </a>
              {editing && <button className="app-remove" onClick={() => handleDelete(app._id)} aria-label="Remove"><X size={12} /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

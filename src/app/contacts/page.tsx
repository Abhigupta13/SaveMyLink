'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Phone, Mail, MessageCircle, Plus, Pencil, Trash2, X } from 'lucide-react';
import { getContacts, createContact, updateContact, deleteContact, ContactInput } from '@/actions/contact';

const EMPTY: ContactInput = { name: '', phone: '', email: '', company: '', note: '' };
const digits = (s?: string) => (s || '').replace(/\D/g, '');

export default function ContactsPage() {
  const { status } = useSession();
  const [contacts, setContacts] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ContactInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const res = await getContacts();
    if (res.success) { setContacts(res.contacts || []); setTeam(res.team || []); }
    setLoading(false);
  }, []);
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  const startAdd = (prefill: Partial<ContactInput> = {}) => { setEditingId(null); setForm({ ...EMPTY, ...prefill }); };
  const startEdit = (c: any) => { setEditingId(c._id); setForm({ name: c.name, phone: c.phone || '', email: c.email || '', company: c.company || '', note: c.note || '' }); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const res = editingId ? await updateContact(editingId, form) : await createContact(form);
    if (res.success) { setForm(null); setEditingId(null); load(); } else alert(res.error);
  };

  const remove = async () => {
    if (!editingId || !window.confirm('Delete this contact?')) return;
    const res = await deleteContact(editingId);
    if (res.success) { setForm(null); setEditingId(null); load(); } else alert(res.error);
  };

  const filtered = contacts.filter(c => !q || [c.name, c.company, c.email, c.phone].join(' ').toLowerCase().includes(q.toLowerCase()));

  const actions = (c: { phone?: string; email?: string }) => (
    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
      {c.phone && <a className="icon-btn" href={`tel:${c.phone}`} title="Call"><Phone size={16} /></a>}
      {c.phone && <a className="icon-btn" href={`https://wa.me/${digits(c.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={16} /></a>}
      {c.email && <a className="icon-btn" href={`mailto:${c.email}`} title="Email"><Mail size={16} /></a>}
    </div>
  );

  return (
    <div className="container" style={{ maxWidth: '640px', padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '20px', gap: '12px' }}>
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">{contacts.length} saved{team.length ? ` · ${team.length} from projects` : ''}</p>
        </div>
        {!form && (
          <button className="btn-primary" onClick={() => startAdd()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', borderRadius: '12px', fontWeight: 800 }}>
            <Plus size={18} /> Add
          </button>
        )}
      </header>

      {form && (
        <form onSubmit={save} className="card" style={{ marginBottom: '20px', display: 'grid', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800 }}>{editingId ? 'Edit contact' : 'New contact'}</span>
            <button type="button" className="icon-btn" onClick={() => { setForm(null); setEditingId(null); }}><X size={16} /></button>
          </div>
          <input className="field" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <input className="field" placeholder="Phone" type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            <input className="field" placeholder="Email" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <input className="field" placeholder="Company / role" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
          <input className="field" placeholder="Note" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {editingId && <button type="button" className="icon-btn danger" onClick={remove} title="Delete"><Trash2 size={16} /></button>}
            <button type="submit" className="btn-primary" style={{ padding: '10px 22px', borderRadius: '12px', fontWeight: 800 }}>Save</button>
          </div>
        </form>
      )}

      {contacts.length > 5 && (
        <input className="field" placeholder="Search contacts…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: '16px' }} />
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="loading-spinner"></div></div>
      ) : (
        <>
          {filtered.length === 0 && !form && (
            <div className="empty-state">
              <p style={{ fontWeight: 700 }}>No contacts yet.</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Add people you call, message, or work with.</p>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filtered.map(c => (
              <div key={c._id} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px' }}>
                <div className="avatar-xs" style={{ width: '38px', height: '38px', fontSize: '0.95rem', flexShrink: 0 }}>{c.name[0].toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => startEdit(c)}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[c.company, c.phone, c.email].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {actions(c)}
                <button className="icon-btn contact-edit" onClick={() => startEdit(c)} title="Edit"><Pencil size={15} /></button>
              </div>
            ))}
          </div>

          {team.length > 0 && (
            <div style={{ marginTop: '28px' }}>
              <p className="task-group-label">From your projects</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {team.map(t => (
                  <div key={t.email} className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px' }}>
                    <div className="avatar-xs" style={{ width: '38px', height: '38px', fontSize: '0.95rem', flexShrink: 0 }}>{(t.name || t.email)[0].toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t.name || t.email}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t.projects.join(', ')}</div>
                    </div>
                    {actions({ email: t.email })}
                    <button className="subtle-link" onClick={() => startAdd({ name: t.name || '', email: t.email })}>Save</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

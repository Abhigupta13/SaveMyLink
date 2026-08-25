'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Phone, Mail, MessageCircle, Plus, Pencil, Trash2, X, UserPlus } from 'lucide-react';
import { getContacts, createContact, updateContact, deleteContact, inviteContact, ContactInput } from '@/actions/contact';
import { useFeedback } from '@/components/ui/Feedback';

const EMPTY: ContactInput = { name: '', phone: '', email: '', company: '', note: '' };
const digits = (s?: string) => (s || '').replace(/\D/g, '');

export default function ContactsPage() {
  const { toast, confirm } = useFeedback();
  const { status } = useSession();
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ContactInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  // Set only when the person we just saved has no account. Offered, never sent on its own —
  // the message goes out under the user's name, so it stays the user's decision.
  const [invitee, setInvitee] = useState<{ email: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const res = await getContacts();
    if (res.success) setContacts(res.contacts || []);
    setLoading(false);
  }, []);
  useEffect(() => { if (status === 'authenticated') load(); }, [status, load]);

  const startAdd = (prefill: Partial<ContactInput> = {}) => { setEditingId(null); setForm({ ...EMPTY, ...prefill }); };
  const startEdit = (c: any) => { setEditingId(c._id); setForm({ name: c.name, phone: c.phone || '', email: c.email || '', company: c.company || '', note: c.note || '' }); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const name = form.name;
    const res = editingId ? await updateContact(editingId, form) : await createContact(form);
    if (!res.success) return toast(res.error || 'Something went wrong', 'error');
    setForm(null); setEditingId(null);
    if (res.inviteAvailable) setInvitee({ email: res.inviteAvailable, name });
    load();
  };

  const sendInvite = async () => {
    if (!invitee) return;
    const res = await inviteContact(invitee.email);
    toast(res.success ? `Invite sent to ${invitee.email}` : (res.error || 'Could not send the invite'), res.success ? 'success' : 'error');
    setInvitee(null);
  };

  const remove = async () => {
    if (!editingId) return;
    if (!(await confirm({ title: 'Delete this contact?', danger: true, confirmLabel: 'Delete' }))) return;
    const res = await deleteContact(editingId);
    if (res.success) { setForm(null); setEditingId(null); load(); } else toast(res.error || 'Something went wrong', 'error');
  };

  const filtered = contacts.filter(c =>
    !q || [c.name, c.company, c.email, c.phone, ...(c.projects || [])].join(' ').toLowerCase().includes(q.toLowerCase()));
  const shared = contacts.filter(c => (c.projects || []).length).length;
  // Somebody who arrived from a project and has had nothing filled in yet
  const bare = (c: { phone?: string; company?: string; note?: string }) => !c.phone && !c.company && !c.note;

  const actions = (c: { phone?: string; email?: string }) => (
    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
      {c.phone && <a className="icon-btn" href={`tel:${c.phone}`} title="Call"><Phone size={16} /></a>}
      {c.phone && <a className="icon-btn" href={`https://wa.me/${digits(c.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp"><MessageCircle size={16} /></a>}
      {c.email && <a className="icon-btn" href={`mailto:${c.email}`} title="Email"><Mail size={16} /></a>}
    </div>
  );

  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '20px', gap: '12px' }}>
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-subtitle">
            {contacts.length} {contacts.length === 1 ? 'person' : 'people'}
            {shared ? ` · ${shared} on your projects` : ''}
          </p>
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

      {invitee && (
        <div className="card" style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px' }}>
          <span className="row-icon"><UserPlus size={18} strokeWidth={2.2} /></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 700, color: 'var(--text-primary)' }}>
              {invitee.name || invitee.email} isn’t on the app yet
            </span>
            <span style={{ display: 'block', fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
              Send them an invite so you can share projects and assign them tasks.
            </span>
          </span>
          <button className="subtle-link" onClick={() => setInvitee(null)}>Not now</button>
          <button className="btn-primary" onClick={sendInvite} style={{ padding: '9px 16px', borderRadius: '12px', fontWeight: 800, flexShrink: 0 }}>
            Invite
          </button>
        </div>
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
              <div key={c._id} className="card contact-row">
                <div className="avatar-xs contact-avatar">{(c.name || c.email || '?')[0].toUpperCase()}</div>

                <div className="contact-main" onClick={() => startEdit(c)}>
                  <div className="contact-name">{c.name || c.email}</div>
                  <div className="contact-sub">
                    {[c.company, c.phone, c.email].filter(Boolean).join(' · ')}
                  </div>
                  {(!!(c.projects || []).length || bare(c)) && (
                    <div className="contact-chips">
                      {(c.projects || []).map((name: string) => (
                        <span key={name} className="chip" title={`Shares ${name} with you`}>{name}</span>
                      ))}
                      {bare(c) && <button className="subtle-link" onClick={e => { e.stopPropagation(); startEdit(c); }}>Add details</button>}
                    </div>
                  )}
                </div>

                {actions(c)}
                <button className="icon-btn contact-edit" onClick={() => startEdit(c)} title="Edit"><Pencil size={15} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

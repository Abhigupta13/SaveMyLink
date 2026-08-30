'use client'

import { useState, useEffect, useCallback, useRef } from 'react';
import { hintFor } from '@/lib/nav';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { getDocuments, addDocument, deleteDocument, moveDocument, fileDocumentUnderProject } from '@/actions/document';
import { goConnectDrive, DRIVE_OUTCOME_MESSAGE, type DriveOutcome } from '@/lib/driveConnect';
import { useDriveGate } from '@/components/useDriveGate';
import { getProjects } from '@/actions/project';
import { ExternalLink, Download, X } from 'lucide-react';
import { useFeedback } from '@/components/ui/Feedback';
import { useShareNotice } from '@/components/ShareNotice';
import { useUser } from '@/components/UserContext';
import { SafeBanner, SafeEmpty, PrivateToggle, droppedPrivacy } from '@/components/PrivateSafe';

interface DocType {
  _id: string;
  name: string;
  folder?: string;
  projectId?: { _id: string; name: string } | null;   // populated when shared with a project
  type: 'file' | 'link';
  url: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
}

const ALL = 'All';
const DEFAULT_FOLDER = 'Personal';

export default function DLockerPage() {
  const { toast, confirm } = useFeedback();
  const { confirmShare, shareDialog } = useShareNotice();
  const { privateSafe } = useUser();
  // Asks before the picker rather than after the upload: documents go to the user own Drive, so
  // with none connected the file dialog can only ever end in a failure.
  const ensureDrive = useDriveGate();
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [docs, setDocs] = useState<DocType[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>(ALL);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<any | null>(null);

  // Form state
  const [docType, setDocType] = useState<'file' | 'link'>('file');
  const [docName, setDocName] = useState('');
  const [docFolder, setDocFolder] = useState(DEFAULT_FOLDER);
  const [docProject, setDocProject] = useState('');   // '' = my locker only
  // Uploading with the safe open files into the safe. Anything else drops the document into the
  // half of the locker the user cannot currently see.
  const [docPrivate, setDocPrivate] = useState(false);
  useEffect(() => { setDocPrivate(privateSafe); }, [privateSafe]);
  const [externalLink, setExternalLink] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  /* The name the picker last filled in. Choosing a file names the document for you — nobody wants
     to retype "Electricity bill March.pdf" — but only while the box still holds what we put there.
     The moment somebody types their own name it is theirs, and re-picking a file will not eat it. */
  const autoNamed = useRef('');
  const docFileRef = useRef<HTMLInputElement>(null);

  const pickFile = (file: File | null) => {
    setSelectedFile(file);
    if (!file) return;
    const untouched = !docName.trim() || docName === autoNamed.current;
    if (untouched) { autoNamed.current = file.name; setDocName(file.name); }
  };

  const fetchDocs = useCallback(async () => {
    setIsLoading(true);
    const res = await getDocuments();
    if (res.docs) setDocs(res.docs);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated') {
      fetchDocs();
      getProjects().then(r => { if (r.success) setProjects(r.projects || []); }).catch(() => {});
    }
  }, [status, router, fetchDocs]);

  // Folders in use, straight off the documents — anything saved before folders existed has no
  // folder field at all, so it reads as Personal here and in the filter below, consistently.
  const folders = [...new Set(docs.map(d => d.folder || DEFAULT_FOLDER))].sort((a, b) => a.localeCompare(b));
  // Folders are personal filing. Sharing with a project is a separate, real thing now —
  // it used to be faked by naming a folder after a project, which shared nothing.
  const folderOptions = [...new Set([DEFAULT_FOLDER, ...folders])];
  const visibleDocs = activeFolder === ALL ? docs : docs.filter(d => (d.folder || DEFAULT_FOLDER) === activeFolder);

  const handleMove = async (id: string, folder: string) => {
    const target = folder.trim();
    if (!target) return;
    const res = await moveDocument(id, target);
    if (res.success) { setPreview((p: any) => p && { ...p, folder: target }); fetchDocs(); }
    else toast(res.error || 'Could not move it', 'error');
  };

  const handleShareWithProject = async (id: string, projectId: string) => {
    if (!(await confirmShare(projects.find(p => p._id === projectId)))) return;
    const res = await fileDocumentUnderProject(id, projectId);
    if (res.success) {
      // Sharing a document out of the safe is exactly the move that would leave a padlock on
      // something the whole group can open.
      if (res.privacyDropped) toast(droppedPrivacy(projects.find(p => p._id === projectId)?.name), 'info');
      const project = projects.find(p => p._id === projectId) || null;
      setPreview((p: any) => p && { ...p, projectId: project && { _id: project._id, name: project.name } });
      fetchDocs();
    } else toast(res.error || 'Could not share it', 'error');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName) { toast('Please enter a name', 'error'); return; }
    if (!(await confirmShare(projects.find(p => p._id === docProject)))) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('name', docName);
    formData.append('type', docType);
    formData.append('folder', docFolder);
    formData.append('projectId', docProject);
    // Sent as asked for, not as decided: privacyOnWrite has the final word server-side, and
    // privacyDropped comes back when a group overruled it.
    formData.set('isPrivate', String(docPrivate));

    if (docType === 'file' && selectedFile) {
      formData.append('file', selectedFile);
    } else if (docType === 'link') {
      formData.append('externalLink', externalLink);
    } else {
      setIsUploading(false);
      toast('Please select a file or enter a link', 'error');
      return;
    }

    const res = await addDocument(formData);
    setIsUploading(false);
    
    if (res.success) {
      if (res.privacyDropped) toast(droppedPrivacy(projects.find(p => p._id === docProject)?.name), 'info');
      setIsAddingDoc(false);
      setDocName('');
      setExternalLink('');
      setSelectedFile(null);
      autoNamed.current = '';
      setActiveFolder(docFolder);   // land on the folder you just filed into
      fetchDocs();
    } else if (res.needsDrive) {
      // Not an error, a missing step — so perform it rather than naming it. They land back here.
      toast('Taking you to Google to connect your Drive…', 'info');
      goConnectDrive();
    } else {
      toast(res.error || 'Failed to add document', 'error');
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (await confirm({ title: 'Delete this document?', message: 'This removes the file permanently.', danger: true, confirmLabel: 'Delete' })) {
      deleteDocument(id).then(res => {
        if (res.success) fetchDocs();
      });
    }
  };

  const getDocIcon = (doc: DocType) => {
    if (doc.type === 'link') return '🔗';
    const mime = doc.mimeType || '';
    if (mime.includes('image')) return '🖼️';
    if (mime.includes('pdf')) return '📄';
    if (mime.includes('video')) return '🎥';
    if (mime.includes('audio')) return '🎵';
    return '📁';
  };

  // What we can actually preview in-browser without extra libraries
  const kindOf = (doc: any): 'image' | 'video' | 'pdf' | 'audio' | 'link' | 'file' => {
    if (doc.type === 'link') return 'link';
    const m = (doc.mimeType || '').toLowerCase();
    const ext = (doc.url || '').split('.').pop()?.toLowerCase() || '';
    if (m.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','avif','bmp'].includes(ext)) return 'image';
    if (m.startsWith('video/') || ['mp4','webm','mov','mkv'].includes(ext)) return 'video';
    if (m.startsWith('audio/') || ['mp3','wav','m4a','ogg'].includes(ext)) return 'audio';
    if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
    return 'file';
  };
  const extOf = (doc: any) => ((doc.name?.includes('.') ? doc.name : doc.url) || '').split('.').pop()?.slice(0, 4).toUpperCase() || 'FILE';
  const favicon = (url: string) => { try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=128`; } catch { return ''; } };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  if (status === 'loading' || isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '80px 16px' }}>
        <div className="loading-spinner"></div>
        <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Opening your Digi Locker…</p>
      </div>
    );
  }

  return (
    <main className="container d-locker-container">
      {shareDialog}
      {/* Shared by the add form and the move-to-folder box in the preview, so it lives out here */}
      <datalist id="folder-options">
        {folderOptions.map(f => <option key={f} value={f} />)}
      </datalist>

      <header className="d-locker-header">
        <div className="header-info">
          <h1 className="page-title">Digi Locker</h1>
          <p className="page-subtitle">Your documents, PDFs & important files</p>
        </div>
        <button className="add-doc-btn" onClick={() => setIsAddingDoc(true)}>
          <span className="plus-icon">+</span>
          Add document
        </button>
      </header>

      {/* The locker has no scope switch — personal and group documents share one grid — so the
          banner has to admit that only half of it swapped. */}
      <SafeBanner noun="files" also="Anything shared with a group is here in both." />

      {folders.length > 1 && (
        <div className="folder-bar">
          {[ALL, ...folders].map(f => (
            <button key={f} className={`folder-chip ${activeFolder === f ? 'on' : ''}`} onClick={() => setActiveFolder(f)}>
              {f}
              <span className="folder-count">{f === ALL ? docs.length : docs.filter(d => (d.folder || DEFAULT_FOLDER) === f).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="doc-grid">
        {visibleDocs.length > 0 ? (
          visibleDocs.map((doc) => (
            <div key={doc._id} className="doc-card" onClick={() => setPreview(doc)}>
              <button className="doc-delete-btn" onClick={(e) => handleDelete(e, doc._id)} title="Delete">&times;</button>

              <div className="doc-thumb">
                {(() => {
                  const kind = kindOf(doc);
                  if (kind === 'image') return <img src={doc.url} alt="" loading="lazy" />;
                  if (kind === 'video') return <video src={doc.url} preload="metadata" muted playsInline />;
                  if (kind === 'link') return <img className="doc-favicon" src={favicon(doc.url)} alt="" loading="lazy" />;
                  return <div className={`doc-glyph ${kind}`}><span>{kind === 'pdf' ? 'PDF' : kind === 'audio' ? '\u266a' : extOf(doc)}</span></div>;
                })()}
              </div>

              <div className="doc-card-info">
                <h3>{doc.name}</h3>
                <div className="doc-card-meta">
                  <span className={`doc-tag ${doc.type}`}>{doc.type === 'link' ? 'link' : extOf(doc)}</span>
                  {doc.projectId?.name && <span className="doc-tag">{doc.projectId.name}</span>}
                  {activeFolder === ALL && <span className="doc-size-text">{doc.folder || DEFAULT_FOLDER}</span>}
                  {doc.type === 'file' && <span className="doc-size-text">{formatSize(doc.size)}</span>}
                </div>
              </div>
            </div>
          ))
        ) : privateSafe && !docs.length ? (
          /* "Your Digi Locker is empty" about a locker that is not empty, only swapped. Keyed on
             docs rather than the folder: with the safe open the folder bar has nothing to draw, so
             "Nothing in Taxes yet" would be a dead end with no way back to All. */
          <SafeEmpty noun="files" />
        ) : (
          <div className="empty-locker-state">
            <div className="empty- locker-icon">🗄️</div>
            <h2>{docs.length ? `Nothing in ${activeFolder} yet` : 'Your Digi Locker is empty'}</h2>
            {!docs.length && <p className="empty-hint">{hintFor('/d-locker')}</p>}
            <p>{docs.length
              ? 'Add a document here, or pick another folder above.'
              : 'Store PDFs, images, or important links and access them from any device.'}</p>
            <button className="btn-explore" onClick={() => { setDocFolder(activeFolder === ALL ? DEFAULT_FOLDER : activeFolder); setIsAddingDoc(true); }}>
              {docs.length ? 'Add a document' : 'Upload your first document'}
            </button>
          </div>
        )}
      </div>

      {preview && (() => {
        const kind = kindOf(preview);
        return (
          <div className="modal-overlay" onClick={() => setPreview(null)}>
            <div className="preview-shell" onClick={e => e.stopPropagation()}>
              <div className="preview-bar">
                <span className="preview-name">{preview.name}</span>
                <input className="preview-folder" type="text" list="folder-options" title="Move to folder"
                  defaultValue={preview.folder || DEFAULT_FOLDER}
                  onBlur={e => { if (e.target.value.trim() !== (preview.folder || DEFAULT_FOLDER)) handleMove(preview._id, e.target.value); }} />
                {projects.length > 0 && (
                  <select className="preview-folder" title="Share with a project"
                    value={preview.projectId?._id || ''} onChange={e => handleShareWithProject(preview._id, e.target.value)}>
                    <option value="">Just me</option>
                    {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                )}
                <a className="icon-btn" href={preview.url} target="_blank" rel="noreferrer" title="Open in new tab"><ExternalLink size={16} /></a>
                {preview.type === 'file' && (
                  <a className="icon-btn" href={preview.url} download={preview.name} title="Download"><Download size={16} /></a>
                )}
                <button className="icon-btn" onClick={() => setPreview(null)} title="Close"><X size={16} /></button>
              </div>

              <div className="preview-body">
                {kind === 'image' && <img src={preview.url} alt={preview.name} />}
                {kind === 'video' && <video src={preview.url} controls autoPlay />}
                {kind === 'audio' && <audio src={preview.url} controls style={{ width: '100%' }} />}
                {kind === 'pdf' && <iframe src={preview.url} title={preview.name} />}
                {(kind === 'file' || kind === 'link') && (
                  <div className="preview-fallback">
                    <div className={`doc-glyph ${kind}`} style={{ width: '72px', height: '72px', fontSize: '0.9rem' }}>
                      <span>{kind === 'link' ? '\u2197' : extOf(preview)}</span>
                    </div>
                    <p>{kind === 'link' ? 'External link \u2014 open it in a new tab.' : 'No in-app preview for this file type.'}</p>
                    <a className="btn-primary" href={preview.url} target="_blank" rel="noreferrer"
                      style={{ padding: '11px 24px', borderRadius: '12px', fontWeight: 800, textDecoration: 'none' }}>
                      {kind === 'link' ? 'Open link' : 'Open file'}
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {isAddingDoc && (
        <div className="modal-overlay" onClick={() => setIsAddingDoc(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h2 className="modal-title">Add to Digi Locker</h2>
              <button className="modal-close" onClick={() => setIsAddingDoc(false)}>&times;</button>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '14px' }}>
              <div>
                <label className="field-label">Document name</label>
                <input className="field" type="text" placeholder="e.g. My Resume, Passport Copy"
                  value={docName} onChange={(e) => setDocName(e.target.value)} required autoFocus />
                {docName && docName === autoNamed.current && (
                  <span className="field-hint">Taken from the file — edit it if you like.</span>
                )}
              </div>

              <div>
                <label className="field-label">Folder</label>
                {/* Native datalist: pick an existing folder or type a new one — that is how a folder gets created */}
                <input className="field" type="text" list="folder-options" placeholder="Personal, Taxes, Passport…"
                  value={docFolder} onChange={(e) => setDocFolder(e.target.value)} />
              </div>

              {projects.length > 0 && (
                <div>
                  <label className="field-label">Share with a project</label>
                  <select className="field" value={docProject} onChange={(e) => setDocProject(e.target.value)}>
                    <option value="">Just me</option>
                    {projects.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {/* Under the project select, which is the control that takes it away. */}
              <PrivateToggle value={docPrivate} onChange={setDocPrivate}
                groupName={projects.find(p => p._id === docProject)?.name} />

              <div className="seg-group">
                {(['file', 'link'] as const).map(t => (
                  <button key={t} type="button" className={`seg-btn ${docType === t ? 'active' : ''}`} onClick={() => setDocType(t)}>
                    {t === 'file' ? 'File upload' : 'External link'}
                  </button>
                ))}
              </div>

              {docType === 'file' ? (
                <div>
                  <label className="field-label">Select file</label>
                  <input ref={docFileRef} type="file" id="doc-file" style={{ display: 'none' }}
                    onChange={(e) => pickFile(e.target.files?.[0] || null)} />
                  {/* A button rather than a <label htmlFor>: a label opens the system file dialog
                      natively, and there is no holding that back while the Drive check runs. */}
                  <button type="button" className={`file-drop ${selectedFile ? 'has-file' : ''}`}
                    onClick={async () => { if (await ensureDrive('/d-locker')) docFileRef.current?.click(); }}>
                    {selectedFile ? selectedFile.name : 'Click to choose a file…'}
                  </button>
                </div>
              ) : (
                <div>
                  <label className="field-label">URL</label>
                  <input className="field" type="url" placeholder="https://example.com/file.pdf"
                    value={externalLink} onChange={(e) => setExternalLink(e.target.value)} required />
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={isUploading}
                style={{ height: '46px', borderRadius: '14px', fontWeight: 800, marginTop: '4px' }}>
                {isUploading ? 'Uploading…' : 'Save to locker'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

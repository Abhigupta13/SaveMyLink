'use client'

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { getDocuments, addDocument, deleteDocument } from '@/actions/document';

interface DocType {
  _id: string;
  name: string;
  type: 'file' | 'link';
  url: string;
  mimeType?: string;
  size?: number;
  createdAt: string;
}

export default function DLockerPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  
  const [docs, setDocs] = useState<DocType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingDoc, setIsAddingDoc] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Form state
  const [docType, setDocType] = useState<'file' | 'link'>('file');
  const [docName, setDocName] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const fetchDocs = useCallback(async () => {
    setIsLoading(true);
    const res = await getDocuments();
    if (res.docs) {
      setDocs(res.docs);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin');
    } else if (status === 'authenticated') {
      fetchDocs();
    }
  }, [status, router, fetchDocs]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName) return alert('Please enter a name');
    
    setIsUploading(true);
    const formData = new FormData();
    formData.append('name', docName);
    formData.append('type', docType);
    
    if (docType === 'file' && selectedFile) {
      formData.append('file', selectedFile);
    } else if (docType === 'link') {
      formData.append('externalLink', externalLink);
    } else {
      setIsUploading(false);
      return alert('Please select a file or enter a link');
    }

    const res = await addDocument(formData);
    setIsUploading(false);
    
    if (res.success) {
      setIsAddingDoc(false);
      setDocName('');
      setExternalLink('');
      setSelectedFile(null);
      fetchDocs();
    } else {
      alert(res.error || 'Failed to add document');
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this document?')) {
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

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="social-loading">
        <div className="loading-spinner"></div>
        <p>Opening your D-locker...</p>
      </div>
    );
  }

  return (
    <main className="container d-locker-container">
      <header className="d-locker-header">
        <div className="header-info">
          <h1 className="page-title">D-locker</h1>
          <p className="page-subtitle">Documents, PDFs & important files</p>
        </div>
        <button className="add-doc-btn" onClick={() => setIsAddingDoc(true)}>
          <span className="plus-icon">+</span>
          Add document
        </button>
      </header>

      <div className="doc-grid">
        {docs.length > 0 ? (
          docs.map((doc) => (
            <div key={doc._id} className="doc-card" onClick={() => window.open(doc.url, '_blank')}>
              <button 
                className="doc-delete-btn" 
                onClick={(e) => handleDelete(e, doc._id)}
                title="Delete"
              >
                ×
              </button>
              <div className="doc-icon-wrap">
                <span className="doc-emoji">{getDocIcon(doc)}</span>
              </div>
              <div className="doc-card-info">
                <h3>{doc.name}</h3>
                <div className="doc-card-meta">
                  <span className={`doc-tag ${doc.type}`}>{doc.type}</span>
                  {doc.type === 'file' && <span className="doc-size-text">{formatSize(doc.size)}</span>}
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="empty-locker-state">
            <div className="empty- locker-icon">🗄️</div>
            <h2>Your locker is empty</h2>
            <p>Store PDFs, images, or important links and access them from any device.</p>
            <button className="btn-explore" onClick={() => setIsAddingDoc(true)}>Upload your first document</button>
          </div>
        )}
      </div>

      {isAddingDoc && (
        <div className="modal-overlay" onClick={() => setIsAddingDoc(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add to D-locker</h2>
              <button className="close-btn" onClick={() => setIsAddingDoc(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit} className="add-app-form">
              <div className="form-group">
                <label>Document Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. My Resume, Passport Copy" 
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  required 
                />
              </div>

              <div className="type-toggle-group">
                <button 
                  type="button" 
                  className={`toggle-btn ${docType === 'file' ? 'active' : ''}`}
                  onClick={() => setDocType('file')}
                >
                  File Upload
                </button>
                <button 
                  type="button" 
                  className={`toggle-btn ${docType === 'link' ? 'active' : ''}`}
                  onClick={() => setDocType('link')}
                >
                  External Link
                </button>
              </div>

              {docType === 'file' ? (
                <div className="form-group">
                  <label>Select File</label>
                  <div className="file-input-wrapper">
                    <input 
                      type="file" 
                      onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                      className="hidden-file-input"
                      id="doc-file"
                    />
                    <label htmlFor="doc-file" className="file-input-label">
                      {selectedFile ? `Selected: ${selectedFile.name}` : 'Click to choose file...'}
                    </label>
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label>URL</label>
                  <input 
                    type="url" 
                    placeholder="https://example.com/file.pdf" 
                    value={externalLink}
                    onChange={(e) => setExternalLink(e.target.value)}
                    required 
                  />
                </div>
              )}

              <button type="submit" className="submit-btn" disabled={isUploading}>
                {isUploading ? 'Uploading...' : 'Save to Locker'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

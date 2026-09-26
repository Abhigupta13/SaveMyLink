'use client';

import { ExternalLink, Download, X } from 'lucide-react';
import DocFilePreview from '@/components/DocFilePreview';
import { useOfflineFileUrl } from '@/hooks/useOfflineFileUrl';

type PreviewDoc = {
  _id: string;
  name: string;
  url: string;
  mimeType?: string;
  type?: 'file' | 'link';
  folder?: string;
  projectId?: { _id: string; name: string } | null;
};

export default function DocPreviewModal({
  doc,
  defaultFolder,
  projects,
  onClose,
  onMove,
  onShareWithProject,
}: {
  doc: PreviewDoc;
  defaultFolder: string;
  projects: { _id: string; name: string }[];
  onClose: () => void;
  onMove: (id: string, folder: string) => void;
  onShareWithProject: (id: string, projectId: string) => void;
}) {
  const { displayUrl, fromCache } = useOfflineFileUrl(doc.url, { name: doc.name, mimeType: doc.mimeType });
  const fileHref = displayUrl || doc.url;
  const readOnly = doc._id.startsWith('offline:');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="preview-shell" onClick={(e) => e.stopPropagation()}>
        <div className="preview-bar">
          <span className="preview-name">{doc.name}</span>
          {!readOnly && (
            <>
              <input
                className="preview-folder"
                type="text"
                list="folder-options"
                title="Move to folder"
                defaultValue={doc.folder || defaultFolder}
                onBlur={(e) => {
                  if (e.target.value.trim() !== (doc.folder || defaultFolder)) {
                    onMove(doc._id, e.target.value);
                  }
                }}
              />
              {projects.length > 0 && (
                <select
                  className="preview-folder"
                  title="Share with a project"
                  value={doc.projectId?._id || ''}
                  onChange={(e) => onShareWithProject(doc._id, e.target.value)}
                >
                  <option value="">Just me</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
              )}
            </>
          )}
          <a className="icon-btn" href={fileHref} target="_blank" rel="noreferrer" title="Open in new tab">
            <ExternalLink size={16} />
          </a>
          {doc.type === 'file' && (
            <a className="icon-btn" href={fileHref} download={doc.name} title="Download">
              <Download size={16} />
            </a>
          )}
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="preview-body">
          <DocFilePreview doc={doc} displayUrl={fileHref} fromCache={fromCache} />
        </div>
      </div>
    </div>
  );
}

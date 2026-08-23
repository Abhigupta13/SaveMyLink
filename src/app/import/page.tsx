'use client';

import { useRouter } from 'next/navigation';
import BulkImportModal from '@/components/BulkImportModal';

// Bulk import as its own tab; the modal body is reused as the page content
export default function ImportPage() {
  const router = useRouter();
  return (
    <div className="container" style={{ padding: '24px 16px 120px' }}>
      <header style={{ marginBottom: '18px' }}>
        <h1 className="page-title">Import links</h1>
        <p className="page-subtitle">Paste a list of URLs or upload a CSV</p>
      </header>
      <BulkImportModal isOpen onClose={() => router.push('/links')} inline />
    </div>
  );
}

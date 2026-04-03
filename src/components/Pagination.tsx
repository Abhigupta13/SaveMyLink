'use client';

import { useRouter, useSearchParams } from 'next/navigation';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
}

export default function Pagination({ currentPage, totalPages }: PaginationProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const createPageURL = (pageNumber: number | string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', pageNumber.toString());
    return `?${params.toString()}`;
  };

  const handlePageChange = (page: number) => {
    router.push(createPageURL(page));
  };

  if (totalPages <= 1) return null;

  return (
    <div className="pagination-container">
      <div className="pagination-controls">
        <button 
          className="pagination-btn" 
          disabled={currentPage <= 1}
          onClick={() => handlePageChange(1)}
          title="First Page"
        >
          &laquo; First
        </button>
        
        <button 
          className="pagination-btn" 
          disabled={currentPage <= 1}
          onClick={() => handlePageChange(currentPage - 1)}
          title="Previous Page"
        >
          &lsaquo; Prev
        </button>

        <div className="pagination-info">
          Page <span>{currentPage}</span> of {totalPages}
        </div>

        <button 
          className="pagination-btn" 
          disabled={currentPage >= totalPages}
          onClick={() => handlePageChange(currentPage + 1)}
          title="Next Page"
        >
          Next &rsaquo;
        </button>
        
        <button 
          className="pagination-btn" 
          disabled={currentPage >= totalPages}
          onClick={() => handlePageChange(totalPages)}
          title="Last Page"
        >
          Last &raquo;
        </button>
      </div>
    </div>
  );
}

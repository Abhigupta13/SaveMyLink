'use client';

import LinkCard from '@/components/LinkCard';
import { useView } from '@/components/ViewContext';

export default function LinksDisplay({ links, categories, privateSafe = false }: { links: any[], categories: any[], privateSafe?: boolean }) {
  const { columns } = useView();

  return (
    <div 
      className="links-grid" 
      style={{ 
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        '--cols': columns // Also set CSS variable for media queries if needed
      } as any}
    >
      {links.map((link: any) => (
        <LinkCard key={link._id} link={link} categories={categories} privateSafe={privateSafe} />
      ))}
    </div>
  );
}

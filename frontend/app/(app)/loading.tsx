'use client';

import { Skeleton } from '../../components/ui';

export default function Loading() {
  return (
    <div className="space-y-4 pt-6" aria-label="Loading page">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

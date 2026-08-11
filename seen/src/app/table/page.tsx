import { counts, rows } from '@/lib/db';
import { BUCKETS } from '@/lib/types';
import type { Bucket } from '@/lib/types';
import { Footer, Header } from '../components/Chrome';
import TableClient from './TableClient';

export const dynamic = 'force-dynamic';

export default function TablePage({
  searchParams,
}: {
  searchParams: { bucket?: string };
}) {
  const active = (
    BUCKETS.includes(searchParams.bucket as Bucket) ? searchParams.bucket : 'people'
  ) as Bucket;

  const c = counts();

  return (
    <main className="min-h-screen flex flex-col">
      <Header
        right={
          <span className="text-[12px] text-muted tabular-nums">
            {c.total} saved &middot; {c.acted} acted on
          </span>
        }
      />
      <div className="flex-1 mx-auto w-full max-w-page px-6 py-16">
        <TableClient
          active={active}
          rows={rows(active)}
          countsByBucket={c.byBucket}
          undrafted={c.undrafted}
        />
      </div>
      <Footer />
    </main>
  );
}

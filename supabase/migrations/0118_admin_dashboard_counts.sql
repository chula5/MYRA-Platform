-- The admin dashboard's standing counts in ONE round trip.
--
-- /admin used to ask PostgREST for twenty-two separate exact counts (items by
-- status and stock, outfits, projects, the waitlist, the review queue…) on
-- every load. On the nano instance, with an hourly cron reading the library at
-- the same time, each of those could wait seconds behind the others and the
-- page hit the 8s statement timeout or Vercel's function limit. One function,
-- one scan per table, one answer.
--
-- service_role only: nothing here is for a member or the public.

create or replace function public.admin_dashboard_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'items', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where status = 'draft'),
        'ready', count(*) filter (where status = 'ready'),
        'live', count(*) filter (where status = 'live'),
        'out_of_stock', count(*) filter (where stock_status = 'out_of_stock'),
        'low_stock', count(*) filter (where stock_status = 'low_stock')
      ) from item
    ),
    'outfits', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where status = 'draft'),
        'live', count(*) filter (where status = 'live'),
        'needs_desktop', count(*) filter (where status::text = 'needs_desktop'),
        'published_today', count(*) filter (where published_at >= date_trunc('day', now()))
      ) from outfit
    ),
    'projects', (
      select jsonb_build_object(
        'total', count(*),
        'draft', count(*) filter (where status = 'draft'),
        'live', count(*) filter (where status = 'live')
      ) from admin_project
    ),
    'waitlist', (select count(*) from waitlist),
    'composed_pending', (select count(*) from composed_outfit where status::text = 'pending'),
    'ways_queued', (select count(*) from styled_way_job where status::text = 'queued')
  );
$$;

revoke all on function public.admin_dashboard_counts() from public;
revoke all on function public.admin_dashboard_counts() from anon;
revoke all on function public.admin_dashboard_counts() from authenticated;
grant execute on function public.admin_dashboard_counts() to service_role;

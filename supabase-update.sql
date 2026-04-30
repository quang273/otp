alter table domain_configs add column if not exists quick_text text default '';

create table if not exists saved_2fa_accounts (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  combo text not null,
  created_at timestamptz default now()
);

alter table saved_2fa_accounts enable row level security;

drop policy if exists "allow anon read saved_2fa" on saved_2fa_accounts;
drop policy if exists "allow anon insert saved_2fa" on saved_2fa_accounts;
drop policy if exists "allow anon delete saved_2fa" on saved_2fa_accounts;

create policy "allow anon read saved_2fa" on saved_2fa_accounts for select to anon using (true);
create policy "allow anon insert saved_2fa" on saved_2fa_accounts for insert to anon with check (true);
create policy "allow anon delete saved_2fa" on saved_2fa_accounts for delete to anon using (true);
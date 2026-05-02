alter table domain_configs add column if not exists quick_text text default '';
alter table domain_configs add column if not exists withdraw_email text default '';

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

alter table domain_configs add column if not exists withdraw_email text default '';

create table if not exists withdraw_mails (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  base_email text not null,
  generated_email text not null unique,
  created_at timestamptz default now()
);

alter table withdraw_mails enable row level security;

drop policy if exists "allow anon read withdraw_mails" on withdraw_mails;
drop policy if exists "allow anon insert withdraw_mails" on withdraw_mails;
drop policy if exists "allow anon delete withdraw_mails" on withdraw_mails;

create policy "allow anon read withdraw_mails"
on withdraw_mails for select
to anon
using (true);

create policy "allow anon insert withdraw_mails"
on withdraw_mails for insert
to anon
with check (true);

create policy "allow anon delete withdraw_mails"
on withdraw_mails for delete
to anon
using (true);

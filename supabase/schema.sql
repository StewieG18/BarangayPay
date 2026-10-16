-- BarangayPay - Supabase (PostgreSQL) reference schema.
--
-- This is the schema the front end and Edge Functions expect. It is NOT
-- applied automatically. Review it against your live project, then run the
-- parts you are missing in the Supabase SQL editor. Every statement is
-- written to be safe to re-run.
--
-- The security section at the bottom matters even if your tables already
-- exist: without it a resident could change their own role, or submit a
-- request with amount = 0 and skip payment.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    email         text,
    full_name     text,
    phone         text,
    birthdate     date,
    sex           text check (sex in ('male', 'female')),
    house_street  text,
    barangay      text,
    city          text,
    province      text,
    address       text,
    role          text not null default 'resident'
                  check (role in ('resident', 'staff', 'admin')),
    status        text not null default 'active'
                  check (status in ('active', 'inactive', 'pending')),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create table if not exists public.services (
    id               integer primary key,
    name             text not null unique,
    fee              numeric(10, 2) not null default 0 check (fee >= 0),
    processing_time  text,
    is_active        boolean not null default true
);

insert into public.services (id, name, fee, processing_time) values
    (1, 'Barangay Clearance',       50,  '1–2 Days'),
    (2, 'Certificate of Residency', 50,  '1–2 Days'),
    (3, 'Certificate of Indigency', 0,   '1 Day'),
    (4, 'Business Clearance',       350, '2–3 Days')
on conflict (id) do nothing;

create sequence if not exists public.service_request_code_seq;

create table if not exists public.service_requests (
    id                   uuid primary key default gen_random_uuid(),
    request_code         text unique,
    resident_id          uuid not null references public.profiles (id) on delete cascade,
    service_id           integer references public.services (id),
    service              text,
    first_name           text not null,
    middle_name          text,
    last_name            text not null,
    contact_number       text not null,
    address              text not null,
    purpose              text not null,
    preferred_date       date,
    notes                text,
    remarks              text,
    document_paths       jsonb not null default '[]'::jsonb,
    amount               numeric(10, 2) not null default 0,
    status               text not null default 'pending'
                         check (status in ('pending', 'processing', 'ready',
                                           'completed', 'rejected', 'cancelled')),
    payment_status       text not null default 'unpaid'
                         check (payment_status in ('unpaid', 'paid', 'failed', 'not_required')),
    payment_method       text,
    payment_reference    text,
    paymongo_session_id  text,
    paid_at              timestamptz,
    submitted_at         timestamptz not null default now(),
    updated_at           timestamptz not null default now()
);

create index if not exists service_requests_resident_idx on public.service_requests (resident_id);
create index if not exists service_requests_status_idx   on public.service_requests (status);
create index if not exists service_requests_submitted_idx on public.service_requests (submitted_at desc);

create table if not exists public.documents (
    id             bigint generated always as identity primary key,
    document_code  text unique,
    request_id     uuid not null references public.service_requests (id) on delete cascade,
    document_type  text,
    status         text not null default 'pending_generation'
                   check (status in ('pending_generation', 'ready_for_release',
                                     'released', 'archived')),
    file_path      text,
    generated_at   timestamptz,
    released_at    timestamptz,
    created_at     timestamptz not null default now()
);

create index if not exists documents_request_idx on public.documents (request_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Role of the signed-in user (security definer, so it can be used in policies
-- on profiles without recursion).
create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
    select role from public.profiles
    where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_staff_or_admin()
returns boolean
language sql
stable
as $$
    select coalesce(public.current_role_name() in ('staff', 'admin'), false)
$$;

-- New sign-ups get a resident profile built from the sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (
        id, email, full_name, phone, birthdate, sex,
        house_street, barangay, city, province, address
    ) values (
        new.id,
        new.email,
        new.raw_user_meta_data ->> 'full_name',
        new.raw_user_meta_data ->> 'phone',
        nullif(new.raw_user_meta_data ->> 'birthdate', '')::date,
        nullif(lower(new.raw_user_meta_data ->> 'sex'), ''),
        new.raw_user_meta_data ->> 'house_street',
        new.raw_user_meta_data ->> 'barangay',
        new.raw_user_meta_data ->> 'city',
        new.raw_user_meta_data ->> 'province',
        new.raw_user_meta_data ->> 'address'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Security triggers
-- ---------------------------------------------------------------------------

-- Only admins (or the service role used by Edge Functions) may change
-- role, status or email on a profile.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') = 'service_role'
       or public.current_role_name() = 'admin' then
        new.updated_at := now();
        return new;
    end if;

    if new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.email is distinct from old.email
       or new.id is distinct from old.id then
        raise exception 'You are not allowed to change these profile fields.';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists protect_profile_fields on public.profiles;
create trigger protect_profile_fields
    before update on public.profiles
    for each row execute function public.protect_profile_fields();

-- Server-side values for a new request: owner, price, payment state, code.
-- The browser cannot choose its own amount or mark itself as paid.
create or replace function public.prepare_service_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    service_row public.services%rowtype;
begin
    select * into service_row
    from public.services
    where id = new.service_id and is_active;

    if not found then
        raise exception 'Unknown or inactive service.';
    end if;

    if coalesce(auth.role(), '') <> 'service_role' then
        new.resident_id := auth.uid();
    end if;

    new.service            := service_row.name;
    new.amount             := service_row.fee;
    new.payment_status     := case when service_row.fee > 0 then 'unpaid' else 'not_required' end;
    new.status             := 'pending';
    new.payment_method     := null;
    new.payment_reference  := null;
    new.paymongo_session_id := null;
    new.paid_at            := null;
    new.remarks            := null;
    new.submitted_at       := now();
    new.updated_at         := now();
    new.request_code       := 'BP-' || to_char(now(), 'YYYY') || '-' ||
                              lpad(nextval('public.service_request_code_seq')::text, 5, '0');
    return new;
end;
$$;

drop trigger if exists prepare_service_request on public.service_requests;
create trigger prepare_service_request
    before insert on public.service_requests
    for each row execute function public.prepare_service_request();

-- Staff may change workflow fields; payment fields are written only by the
-- paymongo-webhook / create-checkout functions (service role).
create or replace function public.protect_payment_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' and (
        new.amount             is distinct from old.amount or
        new.payment_status     is distinct from old.payment_status or
        new.payment_method     is distinct from old.payment_method or
        new.payment_reference  is distinct from old.payment_reference or
        new.paymongo_session_id is distinct from old.paymongo_session_id or
        new.paid_at            is distinct from old.paid_at or
        new.resident_id        is distinct from old.resident_id
    ) then
        raise exception 'Payment details can only be changed by the payment service.';
    end if;

    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists protect_payment_fields on public.service_requests;
create trigger protect_payment_fields
    before update on public.service_requests
    for each row execute function public.protect_payment_fields();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles         enable row level security;
alter table public.services         enable row level security;
alter table public.service_requests enable row level security;
alter table public.documents        enable row level security;

-- profiles
drop policy if exists "profiles: read own or staff" on public.profiles;
create policy "profiles: read own or staff" on public.profiles
    for select to authenticated
    using (id = auth.uid() or public.is_staff_or_admin());

drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin" on public.profiles
    for update to authenticated
    using (id = auth.uid() or public.current_role_name() = 'admin')
    with check (id = auth.uid() or public.current_role_name() = 'admin');

-- services
drop policy if exists "services: read" on public.services;
create policy "services: read" on public.services
    for select to authenticated
    using (true);

drop policy if exists "services: admin update" on public.services;
create policy "services: admin update" on public.services
    for update to authenticated
    using (public.current_role_name() = 'admin')
    with check (public.current_role_name() = 'admin');

-- service_requests
drop policy if exists "requests: read own or staff" on public.service_requests;
create policy "requests: read own or staff" on public.service_requests
    for select to authenticated
    using (resident_id = auth.uid() or public.is_staff_or_admin());

drop policy if exists "requests: resident insert" on public.service_requests;
create policy "requests: resident insert" on public.service_requests
    for insert to authenticated
    with check (resident_id = auth.uid() and public.current_role_name() = 'resident');

drop policy if exists "requests: staff update" on public.service_requests;
create policy "requests: staff update" on public.service_requests
    for update to authenticated
    using (public.is_staff_or_admin())
    with check (public.is_staff_or_admin());

-- documents
drop policy if exists "documents: staff all" on public.documents;
create policy "documents: staff all" on public.documents
    for all to authenticated
    using (public.is_staff_or_admin())
    with check (public.is_staff_or_admin());

-- ---------------------------------------------------------------------------
-- Storage: private bucket for uploaded requirements, one folder per resident
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('request-documents', 'request-documents', false)
on conflict (id) do nothing;

drop policy if exists "request-documents: owner upload" on storage.objects;
create policy "request-documents: owner upload" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'request-documents'
                and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "request-documents: owner or staff read" on storage.objects;
create policy "request-documents: owner or staff read" on storage.objects
    for select to authenticated
    using (bucket_id = 'request-documents'
           and ((storage.foldername(name))[1] = auth.uid()::text
                or public.is_staff_or_admin()));

drop policy if exists "request-documents: owner delete" on storage.objects;
create policy "request-documents: owner delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'request-documents'
           and (storage.foldername(name))[1] = auth.uid()::text);

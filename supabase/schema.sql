-- Panpan Comics: comments & reviews table.
--
-- Run this once in Supabase: your project -> SQL Editor -> New query ->
-- paste this whole file -> Run.

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  manga_id text not null,
  chapter_id text,        -- null = a review on the comic's detail page; set = a comment on that specific chapter
  name text not null check (char_length(name) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists comments_lookup_idx on comments (manga_id, chapter_id, created_at desc);

alter table comments enable row level security;

-- There's no real login yet (see README), so every visitor uses the same
-- public anon key. These policies intentionally allow anyone to read and
-- post comments, but not edit or delete anyone's — including their own.
-- Once real accounts exist, insert should be scoped to auth.uid() and an
-- update/delete-your-own policy can be added.
create policy "Anyone can read comments" on comments
  for select using (true);

create policy "Anyone can post a comment" on comments
  for insert with check (true);

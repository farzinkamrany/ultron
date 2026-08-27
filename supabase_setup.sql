-- 1. Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- 2. Create a table to store the memories
create table if not exists memory_embeddings (
  id uuid primary key default gen_random_uuid(),
  content text not null,          -- The memory / summary text
  metadata jsonb,                 -- Additional info (source, topic, etc.)
  embedding vector(768),          -- Google's text-embedding-004 uses 768 dimensions
  created_at timestamptz default now()
);

-- 3. Create a function to search for matching memories (Cosine Similarity)
create or replace function match_memories (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
returns table (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    memory_embeddings.id,
    memory_embeddings.content,
    memory_embeddings.metadata,
    1 - (memory_embeddings.embedding <=> query_embedding) as similarity
  from memory_embeddings
  where 1 - (memory_embeddings.embedding <=> query_embedding) > match_threshold
  order by memory_embeddings.embedding <=> query_embedding
  limit match_count;
$$;

-- Run this in the Supabase SQL Editor

-- 1. Create the Users table
CREATE TABLE public.users (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen',
  points INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

-- 2. Turn on Row Level Security (RLS) for the users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- 3. Create policies so users can read/write their own data
CREATE POLICY "Users can insert their own row"
  ON public.users
  FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view their own data"
  ON public.users
  FOR SELECT
  USING (auth.uid() = id);

-- 4. Create policy so users can update their own data (needed for points)
CREATE POLICY "Users can update their own data"
  ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 5. Create policies for collectors to view user data if needed (optional for now)
-- CREATE POLICY "Collectors can view all users" ON public.users FOR SELECT USING (role = 'collector');


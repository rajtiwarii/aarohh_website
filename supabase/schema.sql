-- AAROHH Platform Database Schema Migration SQL
-- Execute this script in your Supabase SQL Editor to configure tables, triggers, and Row Level Security.

-- 1. Users Table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    username TEXT UNIQUE,
    photo_url TEXT,
    is_premium BOOLEAN DEFAULT FALSE,
    premium_until TIMESTAMPTZ,
    language TEXT DEFAULT 'en',
    appearance TEXT DEFAULT 'light',
    notifications_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable RLS for users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Safely recreate policies
DROP POLICY IF EXISTS "Allow users to read their own profile" ON public.users;
CREATE POLICY "Allow users to read their own profile"
    ON public.users FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Allow users to update their own profile" ON public.users;
CREATE POLICY "Allow users to update their own profile"
    ON public.users FOR UPDATE
    USING (auth.uid() = id);

-- Trigger to automatically create user row on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, username, is_premium)
    VALUES (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Aarohh User'),
        lower(regexp_replace(split_part(new.email, '@', 1), '[^a-zA-Z0-9]', '', 'g')) || '_' || floor(random() * 1000)::text,
        FALSE
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate trigger statement safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 2. Daily Wellness Metrics Table
CREATE TABLE IF NOT EXISTS public.daily_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    calories_target INTEGER DEFAULT 2000,
    calories_consumed INTEGER DEFAULT 0,
    protein_target INTEGER DEFAULT 150,
    protein_consumed INTEGER DEFAULT 0,
    water_target INTEGER DEFAULT 3000, -- in ml
    water_consumed INTEGER DEFAULT 0, -- in ml
    steps_target INTEGER DEFAULT 10000,
    steps_count INTEGER DEFAULT 0,
    recovery_score INTEGER DEFAULT 80, -- scale of 0-100
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT unique_user_date UNIQUE (user_id, date)
);

-- Enable RLS for daily_metrics table
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to select their own metrics" ON public.daily_metrics;
CREATE POLICY "Allow users to select their own metrics"
    ON public.daily_metrics FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to insert their own metrics" ON public.daily_metrics;
CREATE POLICY "Allow users to insert their own metrics"
    ON public.daily_metrics FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to update their own metrics" ON public.daily_metrics;
CREATE POLICY "Allow users to update their own metrics"
    ON public.daily_metrics FOR UPDATE
    USING (auth.uid() = user_id);


-- 3. Workouts Table
CREATE TABLE IF NOT EXISTS public.workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    exercises JSONB DEFAULT '[]'::jsonb, -- list of exercise dicts (name, sets, reps, weight)
    scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable RLS for workouts table
ALTER TABLE public.workouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to select their own workouts" ON public.workouts;
CREATE POLICY "Allow users to select their own workouts"
    ON public.workouts FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to insert their own workouts" ON public.workouts;
CREATE POLICY "Allow users to insert their own workouts"
    ON public.workouts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to update their own workouts" ON public.workouts;
CREATE POLICY "Allow users to update their own workouts"
    ON public.workouts FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to delete their own workouts" ON public.workouts;
CREATE POLICY "Allow users to delete their own workouts"
    ON public.workouts FOR DELETE
    USING (auth.uid() = user_id);


-- 4. User Devices Table
CREATE TABLE IF NOT EXISTS public.user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    is_connected BOOLEAN DEFAULT TRUE,
    last_sync TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()),
    CONSTRAINT unique_user_device UNIQUE (user_id, device_name)
);

-- Enable RLS for user_devices table
ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to select their own devices" ON public.user_devices;
CREATE POLICY "Allow users to select their own devices"
    ON public.user_devices FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to insert/update their own devices" ON public.user_devices;
CREATE POLICY "Allow users to insert/update their own devices"
    ON public.user_devices FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to update their own devices" ON public.user_devices;
CREATE POLICY "Allow users to update their own devices"
    ON public.user_devices FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow users to delete their own devices" ON public.user_devices;
CREATE POLICY "Allow users to delete their own devices"
    ON public.user_devices FOR DELETE
    USING (auth.uid() = user_id);


-- 5. Subscriptions & Billing Table
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    plan_id TEXT NOT NULL, -- e.g., 'monthly', 'yearly'
    status TEXT NOT NULL, -- 'active', 'cancelled', 'expired'
    amount INTEGER NOT NULL, -- in paise/cents
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable RLS for subscriptions table
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow users to view their own billing history" ON public.subscriptions;
CREATE POLICY "Allow users to view their own billing history"
    ON public.subscriptions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Allow service role or edge functions to insert/update subscriptions" ON public.subscriptions;
CREATE POLICY "Allow service role or edge functions to insert/update subscriptions"
    ON public.subscriptions FOR ALL
    USING (TRUE)
    WITH CHECK (TRUE);


-- 6. Webhook Events Table (Idempotency and log)
CREATE TABLE IF NOT EXISTS public.webhook_events (
    id TEXT PRIMARY KEY, -- Razorpay Event ID (e.g. 'evt_XXXXXX')
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable RLS for webhook_events table (Service role only access)
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;


-- 7. Community Posts Table
CREATE TABLE IF NOT EXISTS public.posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    author_name TEXT,
    author_username TEXT,
    text TEXT NOT NULL,
    likes JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW())
);

-- Enable RLS for posts table
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow anyone to read posts" ON public.posts;
CREATE POLICY "Allow anyone to read posts"
    ON public.posts FOR SELECT
    USING (TRUE);

DROP POLICY IF EXISTS "Allow authenticated users to insert posts" ON public.posts;
CREATE POLICY "Allow authenticated users to insert posts"
    ON public.posts FOR INSERT
    WITH CHECK (auth.uid() = author_id);

DROP POLICY IF EXISTS "Allow users to delete their own posts" ON public.posts;
CREATE POLICY "Allow users to delete their own posts"
    ON public.posts FOR DELETE
    USING (auth.uid() = author_id);

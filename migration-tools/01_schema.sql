
-- Create roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'vendedor', 'gerente');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'vendedor',
  UNIQUE(user_id, role)
);

-- Create CRM columns definition table (admin-customizable)
CREATE TABLE public.crm_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  field_key TEXT NOT NULL UNIQUE,
  field_type TEXT NOT NULL DEFAULT 'text', -- text, number, date, select, email, phone
  options JSONB, -- for select type
  position INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create CRM leads table (dynamic data stored as JSONB)
CREATE TABLE public.crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data JSONB NOT NULL DEFAULT '{}',
  assigned_to UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id) NOT NULL,
  status TEXT NOT NULL DEFAULT 'novo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- User roles policies
CREATE POLICY "Users can view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- CRM columns policies (all can view, admin can manage)
CREATE POLICY "All can view columns" ON public.crm_columns
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage columns" ON public.crm_columns
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- CRM leads policies
CREATE POLICY "All can view leads" ON public.crm_leads
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can create leads" ON public.crm_leads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins and gerentes can update any lead" ON public.crm_leads
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'gerente') OR
    assigned_to = auth.uid()
  );

CREATE POLICY "Admins can delete leads" ON public.crm_leads
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_crm_leads_updated_at
  BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Insert default CRM columns
INSERT INTO public.crm_columns (name, field_key, field_type, position, is_required) VALUES
  ('Nome', 'nome', 'text', 0, true),
  ('Email', 'email', 'email', 1, false),
  ('Telefone', 'telefone', 'phone', 2, false),
  ('Empresa', 'empresa', 'text', 3, false),
  ('Valor', 'valor', 'number', 4, false);

CREATE TABLE public.crm_lead_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_lead_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view notes"
  ON public.crm_lead_notes FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can create notes"
  ON public.crm_lead_notes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can delete notes"
  ON public.crm_lead_notes FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Create companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "All authenticated can view companies" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage companies" ON public.companies FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add company_id to profiles
ALTER TABLE public.profiles ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE POLICY "Admins can update any profile" ON public.profiles FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- Restrict user_roles SELECT to own roles + admins
DROP POLICY IF EXISTS "Users can view all roles" ON public.user_roles;
CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- Restrict profiles SELECT to own profile + admins/gerentes (managers need team visibility)
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;
CREATE POLICY "Users can view own or admin view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
  );

-- Create a function to get profile names for Kanban display (accessible to all authenticated)
CREATE OR REPLACE FUNCTION public.get_profile_names()
RETURNS TABLE(user_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, full_name FROM public.profiles;
$$;

-- Helper: get the calling user's company_id
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Helper: check if a given user_id is in the same company as the caller
CREATE OR REPLACE FUNCTION public.is_same_company(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p1
    JOIN public.profiles p2 ON p1.company_id = p2.company_id
    WHERE p1.user_id = auth.uid()
      AND p2.user_id = _user_id
      AND p1.company_id IS NOT NULL
  );
$$;

-- ============ crm_leads ============
-- Drop old SELECT policy
DROP POLICY IF EXISTS "All can view leads" ON public.crm_leads;

-- Vendedor: own leads only; Gerente: leads of users in their company; Admin: all
CREATE POLICY "Role-scoped lead visibility"
  ON public.crm_leads FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (assigned_to = auth.uid())
    OR (created_by = auth.uid())
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND (
        is_same_company(assigned_to)
        OR is_same_company(created_by)
      )
    )
  );

-- ============ crm_lead_notes ============
DROP POLICY IF EXISTS "All authenticated can view notes" ON public.crm_lead_notes;

CREATE POLICY "Role-scoped note visibility"
  ON public.crm_lead_notes FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = lead_id
      AND (
        l.assigned_to = auth.uid()
        OR l.created_by = auth.uid()
        OR (
          has_role(auth.uid(), 'gerente'::app_role)
          AND (is_same_company(l.assigned_to) OR is_same_company(l.created_by))
        )
      )
    )
  );

-- ============ profiles ============
-- Drop old restricted policy and create new one including gerente company scope
DROP POLICY IF EXISTS "Users can view own or admin view all profiles" ON public.profiles;

CREATE POLICY "Scoped profile visibility"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND company_id IS NOT NULL
      AND company_id = get_my_company_id()
    )
  );

-- Allow gerentes to update profiles in their company
CREATE POLICY "Gerentes can update company profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
  );

-- Allow gerentes to insert profiles (for user creation)
CREATE POLICY "Gerentes can insert company profiles"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
  );

-- Allow gerentes to delete profiles in their company
CREATE POLICY "Gerentes can delete company profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
  );

-- ============ user_roles ============
-- Drop old SELECT and create scoped one
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;

CREATE POLICY "Scoped role visibility"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND is_same_company(user_id)
    )
  );

-- Allow gerentes to manage roles for users in their company
CREATE POLICY "Gerentes can manage company roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
    AND role != 'admin'::app_role
  );

CREATE TABLE public.crm_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT 'blue',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view statuses" ON public.crm_statuses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage statuses" ON public.crm_statuses
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.crm_statuses (key, label, position, color) VALUES
  ('novo', 'Novo', 0, 'blue'),
  ('em_contato', 'Em Contato', 1, 'amber'),
  ('qualificado', 'Qualificado', 2, 'violet'),
  ('proposta', 'Proposta', 3, 'cyan'),
  ('fechado', 'Fechado', 4, 'emerald'),
  ('perdido', 'Perdido', 5, 'red');

-- 1. Fix: Gerentes can update leads outside their company
DROP POLICY IF EXISTS "Admins and gerentes can update any lead" ON public.crm_leads;
CREATE POLICY "Admins and gerentes can update any lead" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (assigned_to = auth.uid())
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND (is_same_company(assigned_to) OR is_same_company(created_by))
    )
  );

-- 2. Fix: Gerentes role escalation - split into separate policies
DROP POLICY IF EXISTS "Gerentes can manage company roles" ON public.user_roles;

CREATE POLICY "Gerentes can view company roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(user_id)
  );

CREATE POLICY "Gerentes can insert vendedor roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
    AND role = 'vendedor'::app_role
  );

CREATE POLICY "Gerentes can update to vendedor only" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
    AND role = 'vendedor'::app_role
  )
  WITH CHECK (role = 'vendedor'::app_role);

CREATE POLICY "Gerentes can delete vendedor roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
    AND role = 'vendedor'::app_role
  );

-- 3. Fix: Gerentes can insert profiles for any company
DROP POLICY IF EXISTS "Gerentes can insert company profiles" ON public.profiles;
CREATE POLICY "Gerentes can insert company profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
  );

CREATE TABLE public.crm_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT NULL,
  position integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  parent_field_id uuid REFERENCES public.crm_form_fields(id) ON DELETE CASCADE DEFAULT NULL,
  parent_trigger_value text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view form fields" ON public.crm_form_fields
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage form fields" ON public.crm_form_fields
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

-- 1. Fix: Vendedor can modify ownership fields on assigned leads
-- Add WITH CHECK to prevent changing assigned_to and created_by
DROP POLICY IF EXISTS "Admins and gerentes can update any lead" ON public.crm_leads;

-- Admin: full update
CREATE POLICY "Admins can update any lead" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Gerente: update leads in their company
CREATE POLICY "Gerentes can update company leads" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND (is_same_company(assigned_to) OR is_same_company(created_by))
  );

-- Vendedor: can only update leads assigned to them, cannot change assigned_to or created_by
CREATE POLICY "Vendedores can update assigned leads" ON public.crm_leads
  FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid())
  WITH CHECK (assigned_to = auth.uid());

-- 2. Fix: Gerente profile insert - restrict to only users without existing profiles
DROP POLICY IF EXISTS "Gerentes can insert company profiles" ON public.profiles;
CREATE POLICY "Gerentes can insert company profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.user_id = profiles.user_id
    )
  );

-- Fix 1: Prevent gerentes from inserting duplicate role entries
-- Drop and recreate the gerente INSERT policy with a check for existing roles
DROP POLICY IF EXISTS "Gerentes can insert vendedor roles" ON public.user_roles;
CREATE POLICY "Gerentes can insert vendedor roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND is_same_company(user_id)
  AND role = 'vendedor'::app_role
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur WHERE ur.user_id = user_roles.user_id
  )
);

-- Fix 2: Add explicit restrictive UPDATE policy for crm_lead_notes
-- Only note authors can edit their own notes
CREATE POLICY "Users can update own notes"
ON public.crm_lead_notes
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix 1: Tighten gerente INSERT policy on user_roles
-- Replace is_same_company with direct company_id check
DROP POLICY IF EXISTS "Gerentes can insert vendedor roles" ON public.user_roles;
CREATE POLICY "Gerentes can insert vendedor roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND role = 'vendedor'::app_role
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = user_roles.user_id)
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.company_id IS NOT NULL
      AND p.company_id = get_my_company_id()
  )
);

-- Fix 2: Add WITH CHECK to gerentes lead update policy
DROP POLICY IF EXISTS "Gerentes can update company leads" ON public.crm_leads;
CREATE POLICY "Gerentes can update company leads"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role)
  AND (is_same_company(assigned_to) OR is_same_company(created_by))
)
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND (assigned_to IS NULL OR is_same_company(assigned_to))
);
ALTER TABLE public.crm_form_fields ADD COLUMN is_name_field boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_form_fields ADD COLUMN is_phone_field boolean NOT NULL DEFAULT false;ALTER TABLE public.crm_form_fields ADD COLUMN show_on_card BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view settings"
  ON public.system_settings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert settings"
  ON public.system_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update settings"
  ON public.system_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Insert default values
INSERT INTO public.system_settings (setting_key, setting_value) VALUES
  ('system_name', 'CRM Ótica Joonker'),
  ('primary_color', '220 72% 50%'),
  ('background_color', '222 47% 6%'),
  ('text_color', '210 20% 92%'),
  ('button_color', '220 72% 55%'),
  ('logo_url', '');

INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true);

CREATE POLICY "Anyone can view logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

CREATE POLICY "Admins can upload logos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can update logos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'logos' AND auth.role() = 'authenticated');

CREATE POLICY "Admins can delete logos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'logos' AND auth.role() = 'authenticated');
ALTER TABLE public.crm_form_fields ADD COLUMN status_mapping jsonb DEFAULT NULL;ALTER TABLE public.crm_form_fields ADD COLUMN date_status_ranges jsonb DEFAULT NULL;
-- Fix storage logos policies: restrict write operations to admins only

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Admins can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete logos" ON storage.objects;

-- Recreate with admin role check
CREATE POLICY "Admins can upload logos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update logos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete logos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'logos' AND has_role(auth.uid(), 'admin'::app_role));

-- Fix gerente role race condition: add unique constraint on user_id
-- This prevents concurrent duplicate inserts at the database level
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);

DROP POLICY "Authenticated can create notes" ON crm_lead_notes;

CREATE POLICY "Authenticated can create notes on accessible leads"
  ON crm_lead_notes FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM crm_leads l
      WHERE l.id = crm_lead_notes.lead_id
        AND (
          l.assigned_to = auth.uid()
          OR l.created_by = auth.uid()
          OR has_role(auth.uid(), 'admin'::app_role)
          OR (has_role(auth.uid(), 'gerente'::app_role)
              AND (is_same_company(l.assigned_to) OR is_same_company(l.created_by)))
        )
    )
  );

-- Fix: Prevent gerentes from modifying company_id when updating profiles
-- Replace the current policy with one that adds a WITH CHECK preventing company_id changes

DROP POLICY IF EXISTS "Gerentes can update company profiles" ON profiles;

CREATE POLICY "Gerentes can update company profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
  )
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND company_id = get_my_company_id()
  );

-- Add phone and avatar_url columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT NULL;

-- Create avatars storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: anyone authenticated can upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Users can delete their own avatar
CREATE POLICY "Users can delete own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Anyone can view avatars (public bucket)
CREATE POLICY "Anyone can view avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'avatars');

DROP FUNCTION IF EXISTS public.get_profile_names();

CREATE FUNCTION public.get_profile_names()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT user_id, full_name, avatar_url FROM public.profiles;
$$;
-- Fix 1: Allow lead creators to update their own leads
CREATE POLICY "Creators can update own leads"
ON public.crm_leads
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

-- Fix 2: Prevent gerentes from inserting roles for themselves (role duplication)
DROP POLICY IF EXISTS "Gerentes can insert vendedor roles" ON public.user_roles;

CREATE POLICY "Gerentes can insert vendedor roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND role = 'vendedor'::app_role
  AND user_roles.user_id <> auth.uid()
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = user_roles.user_id
  )
  AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = user_roles.user_id
      AND p.company_id IS NOT NULL
      AND p.company_id = get_my_company_id()
  )
);ALTER TABLE public.crm_leads
ADD COLUMN scheduled_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN comprou BOOLEAN NOT NULL DEFAULT false;-- Push subscriptions table
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.push_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions"
  ON public.push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions"
  ON public.push_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- In-app notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own notifications"
  ON public.notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Insert default notification time setting
INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('notification_time', '08:00')
ON CONFLICT DO NOTHING;CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;DELETE FROM push_subscriptions;DELETE FROM public.push_subscriptions;SELECT 1;DELETE FROM public.push_subscriptions;SELECT 1;
CREATE TABLE public.scheduled_whatsapp_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins full access on scheduled_whatsapp_messages"
ON public.scheduled_whatsapp_messages
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Gerentes can manage company messages
CREATE POLICY "Gerentes can view scheduled messages"
ON public.scheduled_whatsapp_messages
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role) 
  AND is_same_company(created_by)
);

CREATE POLICY "Gerentes can insert scheduled messages"
ON public.scheduled_whatsapp_messages
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role) 
  AND auth.uid() = created_by
);

CREATE POLICY "Gerentes can update scheduled messages"
ON public.scheduled_whatsapp_messages
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role) 
  AND is_same_company(created_by)
);

CREATE POLICY "Gerentes can delete scheduled messages"
ON public.scheduled_whatsapp_messages
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role) 
  AND is_same_company(created_by)
);

-- Vendedores can view and create their own
CREATE POLICY "Vendedores can view own scheduled messages"
ON public.scheduled_whatsapp_messages
FOR SELECT
TO authenticated
USING (auth.uid() = created_by);

CREATE POLICY "Vendedores can insert own scheduled messages"
ON public.scheduled_whatsapp_messages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Vendedores can delete own pending messages"
ON public.scheduled_whatsapp_messages
FOR DELETE
TO authenticated
USING (auth.uid() = created_by AND status = 'pending');

-- Trigger for updated_at
CREATE TRIGGER update_scheduled_whatsapp_messages_updated_at
BEFORE UPDATE ON public.scheduled_whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create whatsapp_campaigns table
CREATE TABLE public.whatsapp_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  message text NOT NULL,
  status_id uuid NOT NULL REFERENCES public.crm_statuses(id) ON DELETE CASCADE,
  daily_limit integer NOT NULL DEFAULT 15,
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on whatsapp_campaigns" ON public.whatsapp_campaigns FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gerentes can manage company campaigns" ON public.whatsapp_campaigns FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(created_by))
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) AND auth.uid() = created_by);

CREATE POLICY "Vendedores can view campaigns" ON public.whatsapp_campaigns FOR SELECT TO authenticated
  USING (true);

-- Create whatsapp_campaign_sends table to track individual sends
CREATE TABLE public.whatsapp_campaign_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.whatsapp_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, lead_id)
);

ALTER TABLE public.whatsapp_campaign_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on campaign_sends" ON public.whatsapp_campaign_sends FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gerentes can view company campaign sends" ON public.whatsapp_campaign_sends FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role));

CREATE POLICY "Vendedores can view campaign sends" ON public.whatsapp_campaign_sends FOR SELECT TO authenticated
  USING (true);

-- Trigger for updated_at on campaigns
CREATE TRIGGER update_whatsapp_campaigns_updated_at
  BEFORE UPDATE ON public.whatsapp_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION public.manage_whatsapp_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _interval_minutes int;
  _cron_expression text;
  _job_command text;
BEGIN
  SELECT COALESCE(setting_value, '5')::int INTO _interval_minutes
  FROM system_settings
  WHERE setting_key = 'whatsapp_cron_interval';

  IF _interval_minutes IS NULL THEN
    _interval_minutes := 5;
  END IF;

  _cron_expression := '*/' || _interval_minutes || ' * * * *';

  -- Remove existing job if any
  BEGIN
    PERFORM cron.unschedule('whatsapp-send-cron');
  EXCEPTION WHEN OTHERS THEN
    -- job doesn't exist, ignore
  END;

  _job_command := 'SELECT net.http_post(url := ''' || current_setting('app.settings.supabase_url', true) || '/functions/v1/send-whatsapp'', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || current_setting('app.settings.supabase_anon_key', true) || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule(
    'whatsapp-send-cron',
    _cron_expression,
    _job_command
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.manage_whatsapp_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _interval_minutes int;
  _cron_expression text;
  _job_command text;
  _url text := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/send-whatsapp';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ';
BEGIN
  SELECT COALESCE(setting_value, '5')::int INTO _interval_minutes
  FROM system_settings
  WHERE setting_key = 'whatsapp_cron_interval';

  IF _interval_minutes IS NULL THEN
    _interval_minutes := 5;
  END IF;

  _cron_expression := '*/' || _interval_minutes || ' * * * *';

  BEGIN
    PERFORM cron.unschedule('whatsapp-send-cron');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _url || ''', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule(
    'whatsapp-send-cron',
    _cron_expression,
    _job_command
  );
END;
$$;

-- Trigger-based campaigns (on column entry + follow-ups)
CREATE TABLE public.whatsapp_trigger_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status_id uuid NOT NULL REFERENCES public.crm_statuses(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  daily_limit integer NOT NULL DEFAULT 15,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_trigger_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on trigger_campaigns" ON public.whatsapp_trigger_campaigns FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Gerentes can manage company trigger campaigns" ON public.whatsapp_trigger_campaigns FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'gerente') AND is_same_company(created_by))
  WITH CHECK (has_role(auth.uid(), 'gerente') AND auth.uid() = created_by);

CREATE POLICY "Vendedores can view trigger campaigns" ON public.whatsapp_trigger_campaigns FOR SELECT TO authenticated
  USING (true);

CREATE TRIGGER update_trigger_campaigns_updated_at BEFORE UPDATE ON public.whatsapp_trigger_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Steps within a trigger campaign (up to 5)
CREATE TABLE public.whatsapp_trigger_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  delay_days integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, position)
);

ALTER TABLE public.whatsapp_trigger_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on trigger_steps" ON public.whatsapp_trigger_steps FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Gerentes can manage company trigger steps" ON public.whatsapp_trigger_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.whatsapp_trigger_campaigns c WHERE c.id = campaign_id AND has_role(auth.uid(), 'gerente') AND is_same_company(c.created_by)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.whatsapp_trigger_campaigns c WHERE c.id = campaign_id AND has_role(auth.uid(), 'gerente') AND auth.uid() = c.created_by));

CREATE POLICY "Vendedores can view trigger steps" ON public.whatsapp_trigger_steps FOR SELECT TO authenticated
  USING (true);

-- Send tracking for trigger campaigns
CREATE TABLE public.whatsapp_trigger_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES public.whatsapp_trigger_steps(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_trigger_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on trigger_sends" ON public.whatsapp_trigger_sends FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Gerentes can view company trigger sends" ON public.whatsapp_trigger_sends FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'gerente'));

CREATE POLICY "Vendedores can view trigger sends" ON public.whatsapp_trigger_sends FOR SELECT TO authenticated
  USING (true);

-- Create whatsapp_instances table
CREATE TABLE public.whatsapp_instances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  session text NOT NULL UNIQUE,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on whatsapp_instances"
  ON public.whatsapp_instances FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gerentes can manage company instances"
  ON public.whatsapp_instances FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) AND company_id IS NOT NULL AND company_id = get_my_company_id())
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) AND company_id IS NOT NULL AND company_id = get_my_company_id());

CREATE POLICY "All authenticated can view instances"
  ON public.whatsapp_instances FOR SELECT TO authenticated
  USING (true);

-- Add instance_id to whatsapp_campaigns
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

-- Add instance_id to whatsapp_trigger_campaigns
ALTER TABLE public.whatsapp_trigger_campaigns
  ADD COLUMN instance_id uuid REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;

-- Trigger for updated_at
CREATE TRIGGER update_whatsapp_instances_updated_at
  BEFORE UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.crm_appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  scheduled_by UUID NOT NULL,
  scheduled_datetime TIMESTAMP WITH TIME ZONE NOT NULL,
  valor NUMERIC(10,2) NOT NULL DEFAULT 0,
  forma_pagamento TEXT NOT NULL DEFAULT '',
  canal_agendamento TEXT NOT NULL DEFAULT '',
  confirmacao TEXT NOT NULL DEFAULT 'pendente',
  comparecimento TEXT NOT NULL DEFAULT 'pendente',
  venda TEXT NOT NULL DEFAULT 'pendente',
  resumo TEXT DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT 'novo',
  status TEXT NOT NULL DEFAULT 'agendado',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on appointments"
ON public.crm_appointments FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gerentes can manage company appointments"
ON public.crm_appointments FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'gerente'::app_role) AND is_same_company(scheduled_by))
WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) AND (auth.uid() = scheduled_by));

CREATE POLICY "Vendedores can view own appointments"
ON public.crm_appointments FOR SELECT
TO authenticated
USING (scheduled_by = auth.uid());

CREATE POLICY "Vendedores can insert own appointments"
ON public.crm_appointments FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = scheduled_by);

CREATE POLICY "Vendedores can update own appointments"
ON public.crm_appointments FOR UPDATE
TO authenticated
USING (scheduled_by = auth.uid());

CREATE TRIGGER update_appointments_updated_at
BEFORE UPDATE ON public.crm_appointments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.crm_appointments
ADD COLUMN nome TEXT NOT NULL DEFAULT '',
ADD COLUMN telefone TEXT NOT NULL DEFAULT '',
ADD COLUMN idade TEXT NOT NULL DEFAULT '';
ALTER TABLE public.crm_appointments ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.crm_appointments ALTER COLUMN lead_id SET DEFAULT NULL;ALTER TABLE public.crm_appointments
  ADD COLUMN valor_venda numeric NOT NULL DEFAULT 0,
  ADD COLUMN forma_pagamento_venda text NOT NULL DEFAULT '';ALTER TABLE public.crm_appointments ADD COLUMN valor_entrada numeric NOT NULL DEFAULT 0;
-- Drop the old vendedor SELECT policy (only own appointments)
DROP POLICY IF EXISTS "Vendedores can view own appointments" ON public.crm_appointments;

-- Create new policy: all authenticated users can view appointments from same company
CREATE POLICY "Users can view company appointments"
ON public.crm_appointments
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR scheduled_by = auth.uid()
  OR is_same_company(scheduled_by)
);

CREATE TABLE public.lead_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access on lead_activities"
ON public.lead_activities FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view activities of accessible leads"
ON public.lead_activities FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM crm_leads l
    WHERE l.id = lead_activities.lead_id
    AND (
      l.assigned_to = auth.uid()
      OR l.created_by = auth.uid()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR (has_role(auth.uid(), 'gerente'::app_role) AND (is_same_company(l.assigned_to) OR is_same_company(l.created_by)))
    )
  )
);

CREATE POLICY "Users can insert activities on accessible leads"
ON public.lead_activities FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND EXISTS (
    SELECT 1 FROM crm_leads l
    WHERE l.id = lead_activities.lead_id
    AND (
      l.assigned_to = auth.uid()
      OR l.created_by = auth.uid()
      OR has_role(auth.uid(), 'admin'::app_role)
      OR (has_role(auth.uid(), 'gerente'::app_role) AND (is_same_company(l.assigned_to) OR is_same_company(l.created_by)))
    )
  )
);

CREATE POLICY "Users can update own activities"
ON public.lead_activities FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can delete own activities"
ON public.lead_activities FOR DELETE TO authenticated
USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_lead_activities_lead_id ON public.lead_activities(lead_id);
CREATE INDEX idx_lead_activities_scheduled_date ON public.lead_activities(scheduled_date);
-- Fix assigned_to FK to SET NULL on delete
ALTER TABLE public.crm_leads DROP CONSTRAINT crm_leads_assigned_to_fkey;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_assigned_to_fkey 
  FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fix created_by FK to SET NULL on delete  
ALTER TABLE public.crm_leads ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.crm_leads DROP CONSTRAINT crm_leads_created_by_fkey;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_created_by_fkey 
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;-- Create manager_companies junction table
CREATE TABLE public.manager_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

-- Enable RLS
ALTER TABLE public.manager_companies ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins full access on manager_companies"
  ON public.manager_companies FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Gerentes can view own associations
CREATE POLICY "Gerentes can view own manager_companies"
  ON public.manager_companies FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Update is_same_company to also check manager_companies
CREATE OR REPLACE FUNCTION public.is_same_company(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Original check: both users share a company_id in profiles
    SELECT 1 FROM public.profiles p1
    JOIN public.profiles p2 ON p1.company_id = p2.company_id
    WHERE p1.user_id = auth.uid()
      AND p2.user_id = _user_id
      AND p1.company_id IS NOT NULL

    UNION ALL

    -- Caller is a manager with extra companies that match target's profile company
    SELECT 1 FROM public.manager_companies mc
    JOIN public.profiles p ON p.company_id = mc.company_id
    WHERE mc.user_id = auth.uid()
      AND p.user_id = _user_id

    UNION ALL

    -- Target is a manager with extra companies that match caller's profile company
    SELECT 1 FROM public.manager_companies mc
    JOIN public.profiles p ON p.company_id = mc.company_id
    WHERE mc.user_id = _user_id
      AND p.user_id = auth.uid()

    UNION ALL

    -- Both are managers sharing an extra company
    SELECT 1 FROM public.manager_companies mc1
    JOIN public.manager_companies mc2 ON mc1.company_id = mc2.company_id
    WHERE mc1.user_id = auth.uid()
      AND mc2.user_id = _user_id
  );
$$;
-- Helper function: check if a company_id belongs to the caller (primary or extra)
CREATE OR REPLACE FUNCTION public.is_my_company(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Primary company
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND company_id = _company_id
    UNION ALL
    -- Extra companies via manager_companies
    SELECT 1 FROM public.manager_companies
    WHERE user_id = auth.uid() AND company_id = _company_id
  );
$$;

-- Fix: Scoped profile visibility - gerentes see profiles from ALL their companies
DROP POLICY IF EXISTS "Scoped profile visibility" ON public.profiles;
CREATE POLICY "Scoped profile visibility"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'gerente'::app_role)
      AND company_id IS NOT NULL
      AND is_my_company(company_id)
    )
  );

-- Fix: Gerentes can update company profiles
DROP POLICY IF EXISTS "Gerentes can update company profiles" ON public.profiles;
CREATE POLICY "Gerentes can update company profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
  );

-- Fix: Gerentes can delete company profiles
DROP POLICY IF EXISTS "Gerentes can delete company profiles" ON public.profiles;
CREATE POLICY "Gerentes can delete company profiles"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
  );

-- Fix: Gerentes can insert company profiles
DROP POLICY IF EXISTS "Gerentes can insert company profiles" ON public.profiles;
CREATE POLICY "Gerentes can insert company profiles"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
    AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = profiles.user_id)
  );

-- Fix: user_roles visibility for gerentes (uses is_same_company which is already fixed)
-- No change needed there.

-- Fix: Gerentes can view company roles - already uses is_same_company, OK.
CREATE POLICY "Admins can delete any activity"
ON public.lead_activities FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete any notification"
ON public.notifications FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete any campaign send"
ON public.whatsapp_campaign_sends FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete any trigger send"
ON public.whatsapp_trigger_sends FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete any scheduled message"
ON public.scheduled_whatsapp_messages FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));
-- Create efficient function that returns all user_ids in same company as caller
CREATE OR REPLACE FUNCTION public.get_company_user_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p2.user_id
  FROM profiles p1
  JOIN profiles p2 ON p1.company_id = p2.company_id
  WHERE p1.user_id = auth.uid()
    AND p1.company_id IS NOT NULL
  UNION
  SELECT p.user_id
  FROM manager_companies mc
  JOIN profiles p ON p.company_id = mc.company_id
  WHERE mc.user_id = auth.uid()
  UNION
  SELECT mc.user_id
  FROM profiles p
  JOIN manager_companies mc ON mc.company_id = p.company_id
  WHERE p.user_id = auth.uid()
    AND p.company_id IS NOT NULL
$$;

-- Drop and recreate the lead visibility policy using the efficient function
DROP POLICY IF EXISTS "Role-scoped lead visibility" ON public.crm_leads;

CREATE POLICY "Role-scoped lead visibility"
ON public.crm_leads
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND (
      assigned_to IN (SELECT get_company_user_ids())
      OR created_by IN (SELECT get_company_user_ids())
    )
  )
);

-- Create cobranca statuses table (kanban columns for billing)
CREATE TABLE public.crm_cobranca_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'blue',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cobranca statuses"
  ON public.crm_cobranca_statuses FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage cobranca statuses"
  ON public.crm_cobranca_statuses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Create cobrancas table (billing records)
CREATE TABLE public.crm_cobrancas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'novo',
  assigned_to UUID,
  created_by UUID,
  scheduled_date TIMESTAMP WITH TIME ZONE,
  valor NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobrancas ENABLE ROW LEVEL SECURITY;

-- RLS: same company users can see cobrancas
CREATE POLICY "Users can view cobrancas from same company"
  ON public.crm_cobrancas FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.is_same_company(assigned_to)
    OR public.is_same_company(created_by)
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Authenticated users can insert cobrancas"
  ON public.crm_cobrancas FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update cobrancas"
  ON public.crm_cobrancas FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Admins can delete cobrancas"
  ON public.crm_cobrancas FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );

-- Insert default statuses for cobrancas
INSERT INTO public.crm_cobranca_statuses (key, label, color, position) VALUES
  ('pendente', 'Pendente', 'amber', 0),
  ('em_cobranca', 'Em Cobrança', 'blue', 1),
  ('pago', 'Pago', 'emerald', 2),
  ('atrasado', 'Atrasado', 'red', 3);

DROP POLICY "Authenticated users can insert cobrancas" ON public.crm_cobrancas;

CREATE POLICY "Authenticated users can insert cobrancas"
  ON public.crm_cobrancas FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Renovação statuses table
CREATE TABLE public.crm_renovacao_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT 'blue',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_renovacao_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage renovacao statuses"
  ON public.crm_renovacao_statuses FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can view renovacao statuses"
  ON public.crm_renovacao_statuses FOR SELECT TO authenticated
  USING (true);

-- Seed initial statuses
INSERT INTO public.crm_renovacao_statuses (key, label, color, position) VALUES
  ('novo', 'Novo', 'blue', 0),
  ('em_contato', 'Em Contato', 'amber', 1),
  ('agendado', 'Agendado', 'violet', 2),
  ('renovado', 'Renovado', 'emerald', 3);

-- Renovações table
CREATE TABLE public.crm_renovacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'novo',
  valor numeric NOT NULL DEFAULT 0,
  assigned_to uuid,
  created_by uuid,
  scheduled_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_renovacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view renovacoes from same company"
  ON public.crm_renovacoes FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR is_same_company(assigned_to)
    OR is_same_company(created_by)
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Authenticated users can insert renovacoes"
  ON public.crm_renovacoes FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update renovacoes"
  ON public.crm_renovacoes FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'gerente')
    OR assigned_to = auth.uid()
    OR created_by = auth.uid()
  );

CREATE POLICY "Admins can delete renovacoes"
  ON public.crm_renovacoes FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE TRIGGER update_renovacoes_updated_at
  BEFORE UPDATE ON public.crm_renovacoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.crm_cobrancas ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX idx_crm_cobrancas_company_id ON public.crm_cobrancas(company_id);
ALTER TABLE public.whatsapp_campaigns ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_trigger_campaigns ADD COLUMN company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL;

CREATE INDEX idx_whatsapp_campaigns_company_id ON public.whatsapp_campaigns(company_id);
CREATE INDEX idx_whatsapp_trigger_campaigns_company_id ON public.whatsapp_trigger_campaigns(company_id);
ALTER TABLE public.whatsapp_campaigns ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.whatsapp_trigger_steps ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read whatsapp media"
ON storage.objects FOR SELECT
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated upload whatsapp media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated update whatsapp media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "Authenticated delete whatsapp media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'whatsapp-media');

-- Add 'financeiro' to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'financeiro';

-- crm_cobrancas: permitir financeiro acesso total
DROP POLICY IF EXISTS "Users can view cobrancas from same company" ON public.crm_cobrancas;
CREATE POLICY "Users can view cobrancas"
ON public.crm_cobrancas FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'financeiro'::app_role)
  OR is_same_company(assigned_to)
  OR is_same_company(created_by)
  OR (assigned_to = auth.uid())
  OR (created_by = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated users can insert cobrancas" ON public.crm_cobrancas;
CREATE POLICY "Authenticated users can insert cobrancas"
ON public.crm_cobrancas FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
);

DROP POLICY IF EXISTS "Users can update cobrancas" ON public.crm_cobrancas;
CREATE POLICY "Users can update cobrancas"
ON public.crm_cobrancas FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'financeiro'::app_role)
  OR (assigned_to = auth.uid())
  OR (created_by = auth.uid())
);

DROP POLICY IF EXISTS "Admins can delete cobrancas" ON public.crm_cobrancas;
CREATE POLICY "Admins can delete cobrancas"
ON public.crm_cobrancas FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR has_role(auth.uid(), 'financeiro'::app_role)
);

-- Add 'module' column to identify which page (leads/cobrancas/renovacoes) the campaign targets
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'leads';

ALTER TABLE public.whatsapp_trigger_campaigns
  ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'leads';

-- Restrict allowed values
ALTER TABLE public.whatsapp_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_campaigns_module_check;
ALTER TABLE public.whatsapp_campaigns
  ADD CONSTRAINT whatsapp_campaigns_module_check
  CHECK (module IN ('leads', 'cobrancas', 'renovacoes'));

ALTER TABLE public.whatsapp_trigger_campaigns
  DROP CONSTRAINT IF EXISTS whatsapp_trigger_campaigns_module_check;
ALTER TABLE public.whatsapp_trigger_campaigns
  ADD CONSTRAINT whatsapp_trigger_campaigns_module_check
  CHECK (module IN ('leads', 'cobrancas', 'renovacoes'));

-- Pause all existing campaigns so admin must reconfirm the module before re-enabling
UPDATE public.whatsapp_campaigns SET is_active = false;
UPDATE public.whatsapp_trigger_campaigns SET is_active = false;
-- Notes table for cobrancas
CREATE TABLE public.crm_cobranca_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cobranca_id UUID NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View notes of accessible cobrancas"
ON public.crm_cobranca_notes FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_notes.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
        OR is_same_company(c.assigned_to)
        OR is_same_company(c.created_by)
      )
  )
);

CREATE POLICY "Insert notes on accessible cobrancas"
ON public.crm_cobranca_notes FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_notes.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
        OR is_same_company(c.assigned_to)
        OR is_same_company(c.created_by)
      )
  )
);

CREATE POLICY "Update own notes"
ON public.crm_cobranca_notes FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Delete own notes or admin"
ON public.crm_cobranca_notes FOR DELETE TO authenticated
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

-- Activities (tasks) table for cobrancas
CREATE TABLE public.cobranca_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cobranca_id UUID NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  created_by UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cobranca_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View activities of accessible cobrancas"
ON public.cobranca_activities FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = cobranca_activities.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
        OR is_same_company(c.assigned_to)
        OR is_same_company(c.created_by)
      )
  )
);

CREATE POLICY "Insert activities on accessible cobrancas"
ON public.cobranca_activities FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = cobranca_activities.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
        OR is_same_company(c.assigned_to)
        OR is_same_company(c.created_by)
      )
  )
);

CREATE POLICY "Update own activities or admin"
ON public.cobranca_activities FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Delete own activities or admin"
ON public.cobranca_activities FOR DELETE TO authenticated
USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_cobranca_activities_updated_at
BEFORE UPDATE ON public.cobranca_activities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_crm_cobranca_notes_cobranca ON public.crm_cobranca_notes(cobranca_id);
CREATE INDEX idx_cobranca_activities_cobranca ON public.cobranca_activities(cobranca_id);-- Replace insert policy: only admin or financeiro can create cobrancas
DROP POLICY IF EXISTS "Authenticated users can insert cobrancas" ON public.crm_cobrancas;

CREATE POLICY "Only admin or financeiro can insert cobrancas"
ON public.crm_cobrancas
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'financeiro'::app_role))
);
-- Tabela de integrações SSótica (1 por loja)
CREATE TABLE public.ssotica_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  bearer_token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  initial_sync_done boolean NOT NULL DEFAULT false,
  last_sync_vendas_at timestamptz,
  last_sync_receber_at timestamptz,
  sync_status text NOT NULL DEFAULT 'idle',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id)
);

ALTER TABLE public.ssotica_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ssotica_integrations"
ON public.ssotica_integrations
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_ssotica_integrations_updated_at
BEFORE UPDATE ON public.ssotica_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de logs de sync
CREATE TABLE public.ssotica_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.ssotica_integrations(id) ON DELETE CASCADE,
  sync_type text NOT NULL, -- 'vendas' | 'contas_receber' | 'full'
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running', -- 'running' | 'success' | 'error' | 'partial'
  items_processed integer NOT NULL DEFAULT 0,
  items_created integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.ssotica_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ssotica_sync_logs"
ON public.ssotica_sync_logs
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_ssotica_sync_logs_integration_started
ON public.ssotica_sync_logs(integration_id, started_at DESC);

-- Adiciona colunas em crm_cobrancas
ALTER TABLE public.crm_cobrancas
  ADD COLUMN IF NOT EXISTS ssotica_parcela_id bigint,
  ADD COLUMN IF NOT EXISTS ssotica_titulo_id bigint,
  ADD COLUMN IF NOT EXISTS ssotica_cliente_id bigint,
  ADD COLUMN IF NOT EXISTS ssotica_company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS vencimento date,
  ADD COLUMN IF NOT EXISTS dias_atraso integer;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_cobrancas_ssotica_parcela
ON public.crm_cobrancas(ssotica_parcela_id)
WHERE ssotica_parcela_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_cobrancas_ssotica_company
ON public.crm_cobrancas(ssotica_company_id);

-- Adiciona colunas em crm_renovacoes
ALTER TABLE public.crm_renovacoes
  ADD COLUMN IF NOT EXISTS ssotica_cliente_id bigint,
  ADD COLUMN IF NOT EXISTS ssotica_venda_id bigint,
  ADD COLUMN IF NOT EXISTS ssotica_company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS data_ultima_compra date;

CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_renovacoes_ssotica_cliente_company
ON public.crm_renovacoes(ssotica_cliente_id, ssotica_company_id)
WHERE ssotica_cliente_id IS NOT NULL AND ssotica_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_renovacoes_ssotica_company
ON public.crm_renovacoes(ssotica_company_id);

-- Permite que crm_cobrancas e crm_renovacoes recebam INSERT pelo service_role
-- (a edge function vai usar service_role, então RLS não bloqueia, mas garantir created_by nullable lógica)
-- Já são nullable, ok.

-- Política adicional: permitir INSERT em crm_cobrancas vindo de integração (sem created_by user real)
-- Vamos manter created_by NULL nos inserts da integração; service_role bypassa RLS.

-- Política adicional para INSERT em crm_renovacoes via service_role
-- Service role bypassa RLS automaticamente. OK.
-- Tabela para configuração própria do formulário de Renovação
CREATE TABLE public.crm_renovacao_form_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  options JSONB NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_name_field BOOLEAN NOT NULL DEFAULT false,
  is_phone_field BOOLEAN NOT NULL DEFAULT false,
  is_last_visit_field BOOLEAN NOT NULL DEFAULT false,
  show_on_card BOOLEAN NOT NULL DEFAULT false,
  parent_field_id UUID NULL REFERENCES public.crm_renovacao_form_fields(id) ON DELETE SET NULL,
  parent_trigger_value TEXT NULL,
  status_mapping JSONB NULL,
  date_status_ranges JSONB NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_renovacao_form_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All authenticated can view renovacao form fields"
ON public.crm_renovacao_form_fields
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can manage renovacao form fields"
ON public.crm_renovacao_form_fields
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Campos padrão iniciais
INSERT INTO public.crm_renovacao_form_fields (label, field_type, position, is_required, is_name_field, show_on_card)
VALUES ('Nome', 'text', 0, true, true, true);

INSERT INTO public.crm_renovacao_form_fields (label, field_type, position, is_required, is_phone_field, show_on_card)
VALUES ('Telefone', 'phone', 1, false, true, true);

INSERT INTO public.crm_renovacao_form_fields (label, field_type, position, is_required, is_last_visit_field, show_on_card)
VALUES ('Data da última consulta', 'date', 2, true, false, true);

CREATE TABLE public.renovacao_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renovacao_id uuid NOT NULL REFERENCES public.crm_renovacoes(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  title text NOT NULL,
  description text,
  scheduled_date timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_renovacao_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renovacao_id uuid NOT NULL REFERENCES public.crm_renovacoes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.renovacao_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_renovacao_notes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_renovacao(_renovacao_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_renovacoes r
    WHERE r.id = _renovacao_id
      AND (
        public.has_role(auth.uid(), 'admin'::app_role)
        OR r.assigned_to = auth.uid()
        OR r.created_by = auth.uid()
        OR (r.ssotica_company_id IS NOT NULL AND public.is_my_company(r.ssotica_company_id))
      )
  );
$$;

CREATE POLICY "view activities" ON public.renovacao_activities FOR SELECT TO authenticated
  USING (public.can_access_renovacao(renovacao_id));
CREATE POLICY "insert activities" ON public.renovacao_activities FOR INSERT TO authenticated
  WITH CHECK (public.can_access_renovacao(renovacao_id) AND created_by = auth.uid());
CREATE POLICY "update activities" ON public.renovacao_activities FOR UPDATE TO authenticated
  USING (public.can_access_renovacao(renovacao_id));
CREATE POLICY "delete activities" ON public.renovacao_activities FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "view notes" ON public.crm_renovacao_notes FOR SELECT TO authenticated
  USING (public.can_access_renovacao(renovacao_id));
CREATE POLICY "insert notes" ON public.crm_renovacao_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_access_renovacao(renovacao_id) AND user_id = auth.uid());
CREATE POLICY "delete notes" ON public.crm_renovacao_notes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.set_updated_at_renovacao_activities()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER renovacao_activities_updated_at BEFORE UPDATE ON public.renovacao_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_renovacao_activities();

ALTER FUNCTION public.set_updated_at_renovacao_activities() SET search_path = public;

-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Garantir setting padrão de hora (6h da manhã)
INSERT INTO public.system_settings (setting_key, setting_value)
VALUES ('ssotica_sync_hour', '6')
ON CONFLICT DO NOTHING;

-- Função para gerenciar o cron job de sincronização SSótica
CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hour int;
  _cron_expression text;
  _job_command text;
  _url text := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/ssotica-sync';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ';
BEGIN
  SELECT COALESCE(setting_value, '6')::int INTO _hour
  FROM system_settings
  WHERE setting_key = 'ssotica_sync_hour';

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    _hour := 6;
  END IF;

  -- Roda no minuto 0 da hora escolhida (UTC). Brasil = UTC-3, então hora 9 UTC = 6h Brasil
  -- Para usar hora local de Brasília, somamos 3
  _cron_expression := '0 ' || ((_hour + 3) % 24)::text || ' * * *';

  BEGIN
    PERFORM cron.unschedule('ssotica-daily-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _url || ''', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule(
    'ssotica-daily-sync',
    _cron_expression,
    _job_command
  );
END;
$$;

-- Ativar o cron com a hora padrão
SELECT public.manage_ssotica_cron();
CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hour int;
  _h1 int; _h2 int; _h3 int; _h4 int;
  _cron_expression text;
  _job_command text;
  _url text := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/ssotica-sync';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ';
BEGIN
  SELECT COALESCE(setting_value, '6')::int INTO _hour
  FROM system_settings
  WHERE setting_key = 'ssotica_sync_hour';

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    _hour := 6;
  END IF;

  -- A cada 6h a partir do horário escolhido (Brasília = UTC-3, somamos 3 para virar UTC)
  _h1 := (_hour + 3) % 24;
  _h2 := (_hour + 9) % 24;
  _h3 := (_hour + 15) % 24;
  _h4 := (_hour + 21) % 24;

  _cron_expression := '0 ' || _h1 || ',' || _h2 || ',' || _h3 || ',' || _h4 || ' * * *';

  BEGIN
    PERFORM cron.unschedule('ssotica-daily-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _url || ''', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule(
    'ssotica-daily-sync',
    _cron_expression,
    _job_command
  );
END;
$$;

SELECT public.manage_ssotica_cron();ALTER TABLE public.ssotica_integrations
ADD COLUMN IF NOT EXISTS license_code text;-- Adiciona flag is_cpf_field no formulário de renovação
ALTER TABLE public.crm_renovacao_form_fields
ADD COLUMN IF NOT EXISTS is_cpf_field boolean NOT NULL DEFAULT false;

-- Marca o campo CPF existente automaticamente
UPDATE public.crm_renovacao_form_fields
SET is_cpf_field = true
WHERE lower(label) = 'cpf' AND is_cpf_field = false;

-- Marca o campo "Data da última consulta" como is_last_visit_field
UPDATE public.crm_renovacao_form_fields
SET is_last_visit_field = true
WHERE lower(label) LIKE '%última consulta%' OR lower(label) LIKE '%ultima consulta%' OR lower(label) LIKE '%última compra%' OR lower(label) LIKE '%ultima compra%';CREATE UNIQUE INDEX IF NOT EXISTS crm_cobrancas_one_per_client_idx 
ON public.crm_cobrancas (ssotica_company_id, ssotica_cliente_id) 
WHERE ssotica_company_id IS NOT NULL AND ssotica_cliente_id IS NOT NULL;-- 1. Move atividades dos órfãos (sem ssotica_cliente_id) para o card válido (com ssotica_cliente_id) do mesmo título
UPDATE public.cobranca_activities ca
SET cobranca_id = valid_card.id
FROM public.crm_cobrancas orphan
JOIN public.crm_cobrancas valid_card
  ON valid_card.ssotica_titulo_id = orphan.ssotica_titulo_id
  AND valid_card.ssotica_company_id = orphan.ssotica_company_id
  AND valid_card.ssotica_cliente_id IS NOT NULL
WHERE ca.cobranca_id = orphan.id
  AND orphan.ssotica_cliente_id IS NULL
  AND orphan.ssotica_titulo_id IS NOT NULL;

-- 2. Move comentários dos órfãos para o card válido
UPDATE public.crm_cobranca_notes cn
SET cobranca_id = valid_card.id
FROM public.crm_cobrancas orphan
JOIN public.crm_cobrancas valid_card
  ON valid_card.ssotica_titulo_id = orphan.ssotica_titulo_id
  AND valid_card.ssotica_company_id = orphan.ssotica_company_id
  AND valid_card.ssotica_cliente_id IS NOT NULL
WHERE cn.cobranca_id = orphan.id
  AND orphan.ssotica_cliente_id IS NULL
  AND orphan.ssotica_titulo_id IS NOT NULL;

-- 3. Remove os cards órfãos cuja contraparte válida existe
DELETE FROM public.crm_cobrancas orphan
USING public.crm_cobrancas valid_card
WHERE orphan.ssotica_cliente_id IS NULL
  AND orphan.ssotica_titulo_id IS NOT NULL
  AND valid_card.ssotica_titulo_id = orphan.ssotica_titulo_id
  AND valid_card.ssotica_company_id = orphan.ssotica_company_id
  AND valid_card.ssotica_cliente_id IS NOT NULL;

-- 4. Índice único para impedir duplicatas por título no futuro
CREATE UNIQUE INDEX IF NOT EXISTS crm_cobrancas_one_per_titulo_idx
ON public.crm_cobrancas (ssotica_company_id, ssotica_titulo_id)
WHERE ssotica_titulo_id IS NOT NULL;-- Remove cards cujo vencimento é hoje ou no futuro (não estão em atraso)
DELETE FROM public.crm_cobrancas
WHERE vencimento IS NOT NULL
  AND vencimento >= CURRENT_DATE
  AND ssotica_titulo_id IS NOT NULL;

-- Remove cards sem atraso real (dias_atraso <= 0) vindos do SSótica
DELETE FROM public.crm_cobrancas
WHERE coalesce(dias_atraso, 0) <= 0
  AND ssotica_titulo_id IS NOT NULL;DELETE FROM public.crm_cobrancas
WHERE ssotica_titulo_id IS NOT NULL
  AND lower(coalesce(data->'ssotica_raw'->>'situacao', '')) LIKE 'renegoc%';-- Remove cobranças cuja parcela do SSótica foi renegociada
-- Detecta por dois critérios: campo situacao = "Renegociado" OU presença do objeto "renegociacao"
DELETE FROM public.crm_cobrancas
WHERE ssotica_titulo_id IS NOT NULL
  AND (
    lower(coalesce(data->'ssotica_raw'->>'situacao', '')) LIKE 'renegoc%'
    OR (
      data->'ssotica_raw'->'renegociacao' IS NOT NULL
      AND data->'ssotica_raw'->'renegociacao' != 'null'::jsonb
      AND jsonb_typeof(data->'ssotica_raw'->'renegociacao') = 'object'
      AND data->'ssotica_raw'->'renegociacao'->>'id' IS NOT NULL
    )
  );-- Tabela de mapeamento manual: vendedor SSótica -> usuário CRM por empresa
CREATE TABLE public.ssotica_user_mappings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ssotica_funcionario_id BIGINT NOT NULL,
  ssotica_funcionario_nome TEXT NOT NULL,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, ssotica_funcionario_id)
);

CREATE INDEX idx_ssotica_user_mappings_company ON public.ssotica_user_mappings(company_id);
CREATE INDEX idx_ssotica_user_mappings_user ON public.ssotica_user_mappings(user_id);

ALTER TABLE public.ssotica_user_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ssotica user mappings"
ON public.ssotica_user_mappings
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view ssotica user mappings"
ON public.ssotica_user_mappings
FOR SELECT
TO authenticated
USING (true);

CREATE TRIGGER update_ssotica_user_mappings_updated_at
BEFORE UPDATE ON public.ssotica_user_mappings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Cache de funcionários conhecidos do SSótica (preenchido pelo sync), pra UI mostrar a lista
CREATE TABLE public.ssotica_funcionarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  ssotica_funcionario_id BIGINT NOT NULL,
  nome TEXT NOT NULL,
  funcao TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, ssotica_funcionario_id)
);

CREATE INDEX idx_ssotica_funcionarios_company ON public.ssotica_funcionarios(company_id);

ALTER TABLE public.ssotica_funcionarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ssotica funcionarios"
ON public.ssotica_funcionarios
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view ssotica funcionarios"
ON public.ssotica_funcionarios
FOR SELECT
TO authenticated
USING (true);UPDATE public.crm_renovacoes
SET status = CASE
  WHEN data_ultima_compra IS NULL THEN 'novo'
  WHEN (CURRENT_DATE - data_ultima_compra) < 365 THEN 'em_contato'
  WHEN (CURRENT_DATE - data_ultima_compra) < 730 THEN 'agendado'
  WHEN (CURRENT_DATE - data_ultima_compra) < 1095 THEN 'renovado'
  ELSE 'mais_de_3_anos'
END
WHERE status = 'fazer_direcionamento_para_o_vendedor'
  AND assigned_to IS NOT NULL;UPDATE public.crm_renovacoes r
SET status = CASE
  WHEN r.data_ultima_compra IS NULL THEN 'sem_data_compra'
  WHEN (CURRENT_DATE - r.data_ultima_compra::date) >= 730 THEN 'mais_2_anos'
  WHEN (CURRENT_DATE - r.data_ultima_compra::date) >= 365 THEN 'entre_1_2_anos'
  WHEN (CURRENT_DATE - r.data_ultima_compra::date) >= 180 THEN 'entre_6_12_meses'
  ELSE 'menos_6_meses'
END
WHERE r.status = 'fazer_direcionamento_para_o_vendedor'
  AND r.assigned_to IS NOT NULL;
ALTER TABLE public.ssotica_integrations
  ADD COLUMN IF NOT EXISTS backfill_chunk_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS backfill_total_chunks integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS backfill_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS backfill_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS backfill_next_run_at timestamptz;

-- Cria/recria o cron job que processa o próximo chunk a cada minuto.
-- A função decide se deve rodar (verifica backfill_next_run_at) e processa
-- apenas integrações cujo próximo run já passou.
DO $$
BEGIN
  PERFORM cron.unschedule('ssotica-backfill-runner');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'ssotica-backfill-runner',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/ssotica-sync',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ"}'::jsonb,
    body := '{"mode":"backfill_tick"}'::jsonb
  );
  $$
);
UPDATE public.ssotica_integrations
SET sync_status = 'idle', backfill_status = 'idle', backfill_next_run_at = NULL
WHERE sync_status = 'running' OR backfill_status IN ('running','scheduled');-- Add start_time/end_time and remove daily_limit on campaigns
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS start_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS end_time time NOT NULL DEFAULT '18:00';

ALTER TABLE public.whatsapp_campaigns DROP COLUMN IF EXISTS daily_limit;

ALTER TABLE public.whatsapp_trigger_campaigns
  ADD COLUMN IF NOT EXISTS start_time time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS end_time time NOT NULL DEFAULT '18:00';

ALTER TABLE public.whatsapp_trigger_campaigns DROP COLUMN IF EXISTS daily_limit;ALTER TABLE public.crm_appointments
  ADD COLUMN IF NOT EXISTS renovacao_id uuid REFERENCES public.crm_renovacoes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_appointments_renovacao_id ON public.crm_appointments(renovacao_id);-- Tabela de logs de movimentação entre Renovação e Cobrança
CREATE TABLE public.crm_module_transition_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_nome text NOT NULL,
  from_module text NOT NULL, -- 'renovacao' | 'cobranca'
  to_module text NOT NULL,   -- 'renovacao' | 'cobranca'
  to_status_key text,        -- key da coluna de destino
  to_status_label text,      -- label da coluna de destino
  source_record_id uuid,     -- id do registro origem (renovacao ou cobranca)
  target_record_id uuid,     -- id do registro destino
  ssotica_cliente_id bigint,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  triggered_by uuid,         -- user_id se manual
  trigger_source text NOT NULL DEFAULT 'auto', -- 'auto' (ssotica) | 'manual'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_module_transition_logs_created_at ON public.crm_module_transition_logs(created_at DESC);
CREATE INDEX idx_module_transition_logs_company ON public.crm_module_transition_logs(company_id);
CREATE INDEX idx_module_transition_logs_from_to ON public.crm_module_transition_logs(from_module, to_module);

ALTER TABLE public.crm_module_transition_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view module transition logs"
ON public.crm_module_transition_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can insert module transition logs"
ON public.crm_module_transition_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Admins can delete module transition logs"
ON public.crm_module_transition_logs
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));-- 1) whatsapp_campaign_sends
DROP POLICY IF EXISTS "Vendedores can view campaign sends" ON public.whatsapp_campaign_sends;
DROP POLICY IF EXISTS "Gerentes can view company campaign sends" ON public.whatsapp_campaign_sends;
CREATE POLICY "Scoped campaign sends visibility"
ON public.whatsapp_campaign_sends FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.whatsapp_campaigns c
    WHERE c.id = whatsapp_campaign_sends.campaign_id
      AND (c.created_by = auth.uid() OR (c.company_id IS NOT NULL AND is_my_company(c.company_id)))
  )
);

-- 2) whatsapp_trigger_sends
DROP POLICY IF EXISTS "Vendedores can view trigger sends" ON public.whatsapp_trigger_sends;
DROP POLICY IF EXISTS "Gerentes can view company trigger sends" ON public.whatsapp_trigger_sends;
CREATE POLICY "Scoped trigger sends visibility"
ON public.whatsapp_trigger_sends FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.whatsapp_trigger_campaigns c
    WHERE c.id = whatsapp_trigger_sends.campaign_id
      AND (c.created_by = auth.uid() OR (c.company_id IS NOT NULL AND is_my_company(c.company_id)))
  )
);

-- 3) bucket whatsapp-media
DROP POLICY IF EXISTS "Authenticated delete whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update whatsapp media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload whatsapp media" ON storage.objects;
CREATE POLICY "Users upload own whatsapp media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users update own whatsapp media"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'whatsapp-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Users delete own whatsapp media"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'whatsapp-media' AND ((storage.foldername(name))[1] = auth.uid()::text OR has_role(auth.uid(), 'admin'::app_role)));

-- 4) crm_appointments WITH CHECK
DROP POLICY IF EXISTS "Vendedores can update own appointments" ON public.crm_appointments;
CREATE POLICY "Vendedores can update own appointments"
ON public.crm_appointments FOR UPDATE TO authenticated
USING (scheduled_by = auth.uid())
WITH CHECK (scheduled_by = auth.uid());

-- 5) Criptografia em repouso para tokens da SSótica
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public._get_encryption_key()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT encode(
    extensions.digest('ssotica_token_key_' || coalesce(current_setting('app.settings.jwt_secret', true), 'fallback_salt'), 'sha256'),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.encrypt_secret(_plaintext text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _key text;
BEGIN
  IF _plaintext IS NULL OR _plaintext = '' THEN RETURN _plaintext; END IF;
  IF _plaintext LIKE 'enc:%' THEN RETURN _plaintext; END IF;
  _key := public._get_encryption_key();
  RETURN 'enc:' || encode(extensions.encrypt(_plaintext::bytea, _key::bytea, 'aes'), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_secret(_ciphertext text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _key text;
BEGIN
  IF _ciphertext IS NULL OR _ciphertext = '' THEN RETURN _ciphertext; END IF;
  IF _ciphertext NOT LIKE 'enc:%' THEN RETURN _ciphertext; END IF;
  _key := public._get_encryption_key();
  RETURN convert_from(extensions.decrypt(decode(substring(_ciphertext FROM 5), 'base64'), _key::bytea, 'aes'), 'UTF8');
END;
$$;

CREATE OR REPLACE FUNCTION public._encrypt_ssotica_secrets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.bearer_token IS NOT NULL AND NEW.bearer_token <> '' THEN
    NEW.bearer_token := public.encrypt_secret(NEW.bearer_token);
  END IF;
  IF NEW.license_code IS NOT NULL AND NEW.license_code <> '' THEN
    NEW.license_code := public.encrypt_secret(NEW.license_code);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS encrypt_ssotica_secrets_trigger ON public.ssotica_integrations;
CREATE TRIGGER encrypt_ssotica_secrets_trigger
BEFORE INSERT OR UPDATE OF bearer_token, license_code
ON public.ssotica_integrations
FOR EACH ROW EXECUTE FUNCTION public._encrypt_ssotica_secrets();

-- Migrar somente registros com valor presente
UPDATE public.ssotica_integrations
SET bearer_token = public.encrypt_secret(bearer_token)
WHERE bearer_token IS NOT NULL AND bearer_token <> '' AND bearer_token NOT LIKE 'enc:%';

UPDATE public.ssotica_integrations
SET license_code = public.encrypt_secret(license_code)
WHERE license_code IS NOT NULL AND license_code <> '' AND license_code NOT LIKE 'enc:%';

REVOKE EXECUTE ON FUNCTION public.decrypt_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._get_encryption_key() FROM PUBLIC, anon, authenticated;

-- 6) Limpar policies duplicadas no role "public"
DROP POLICY IF EXISTS "Admins can delete any activity" ON public.lead_activities;
DROP POLICY IF EXISTS "Admins can delete any notification" ON public.notifications;
DROP POLICY IF EXISTS "Admins can delete any scheduled message" ON public.scheduled_whatsapp_messages;
DROP POLICY IF EXISTS "Admins can delete any campaign send" ON public.whatsapp_campaign_sends;
CREATE OR REPLACE FUNCTION public.get_ssotica_credentials(_integration_id uuid)
RETURNS TABLE(
  id uuid,
  company_id uuid,
  cnpj text,
  bearer_token text,
  license_code text,
  is_active boolean,
  initial_sync_done boolean,
  last_sync_vendas_at timestamptz,
  last_sync_receber_at timestamptz,
  sync_status text,
  backfill_status text,
  backfill_chunk_index int,
  backfill_total_chunks int,
  backfill_started_at timestamptz,
  backfill_next_run_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.id,
    i.company_id,
    i.cnpj,
    public.decrypt_secret(i.bearer_token) AS bearer_token,
    public.decrypt_secret(i.license_code) AS license_code,
    i.is_active,
    i.initial_sync_done,
    i.last_sync_vendas_at,
    i.last_sync_receber_at,
    i.sync_status,
    i.backfill_status,
    i.backfill_chunk_index,
    i.backfill_total_chunks,
    i.backfill_started_at,
    i.backfill_next_run_at
  FROM public.ssotica_integrations i
  WHERE i.id = _integration_id;
$$;

REVOKE EXECUTE ON FUNCTION public.get_ssotica_credentials(uuid) FROM PUBLIC, anon, authenticated;
-- service_role mantém acesso por padrão
GRANT EXECUTE ON FUNCTION public.decrypt_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.encrypt_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._get_encryption_key() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ssotica_credentials(uuid) TO service_role;
-- Wrapper que só admin pode chamar para ler license_code descriptografado
CREATE OR REPLACE FUNCTION public.admin_decrypt_license(_integration_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ciphertext text;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;
  SELECT license_code INTO _ciphertext
  FROM public.ssotica_integrations
  WHERE id = _integration_id;
  RETURN public.decrypt_secret(_ciphertext);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_decrypt_license(uuid) TO authenticated;
-- Grant execute on encryption helpers so edge functions (service_role) can decrypt secrets
GRANT EXECUTE ON FUNCTION public.decrypt_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.encrypt_secret(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._get_encryption_key() TO service_role;-- Remove renovações criadas por engano via migração "cobranca_quitada"
-- Apenas as que NÃO têm data_ultima_compra (evidência de venda real) e estão em status "novo"
WITH wrong_renovacoes AS (
  SELECT id, ssotica_cliente_id, ssotica_company_id
  FROM public.crm_renovacoes
  WHERE data->>'origem_transicao' = 'cobranca_quitada'
    AND data_ultima_compra IS NULL
    AND status = 'novo'
)
DELETE FROM public.crm_module_transition_logs
WHERE from_module = 'cobranca'
  AND to_module = 'renovacao'
  AND target_record_id IN (SELECT id FROM wrong_renovacoes);

DELETE FROM public.crm_renovacoes
WHERE data->>'origem_transicao' = 'cobranca_quitada'
  AND data_ultima_compra IS NULL
  AND status = 'novo';-- Limpa renovações de clientes que possuem cobrança ativa na mesma loja.
-- Esses cards estão em local errado (deveriam estar apenas em Cobrança) e serão
-- recriados pelo backfill apenas se o cliente realmente quitar a dívida.
WITH wrong_renovacoes AS (
  SELECT r.id, r.ssotica_cliente_id, r.ssotica_company_id, r.data
  FROM public.crm_renovacoes r
  WHERE r.ssotica_cliente_id IS NOT NULL
    AND r.ssotica_company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.crm_cobrancas c
      WHERE c.ssotica_cliente_id = r.ssotica_cliente_id
        AND c.ssotica_company_id = r.ssotica_company_id
        AND c.status NOT IN ('pago', 'cancelado')
    )
)
INSERT INTO public.crm_module_transition_logs (
  cliente_nome, from_module, to_module, to_status_key, to_status_label,
  source_record_id, target_record_id, ssotica_cliente_id, company_id,
  triggered_by, trigger_source
)
SELECT
  COALESCE(wr.data->>'nome', 'Cliente SSótica'),
  'renovacao',
  'cobranca',
  NULL,
  NULL,
  wr.id,
  (SELECT c.id FROM public.crm_cobrancas c
    WHERE c.ssotica_cliente_id = wr.ssotica_cliente_id
      AND c.ssotica_company_id = wr.ssotica_company_id
    LIMIT 1),
  wr.ssotica_cliente_id,
  wr.ssotica_company_id,
  NULL,
  'auto_cleanup'
FROM wrong_renovacoes wr;

DELETE FROM public.crm_renovacoes r
WHERE r.ssotica_cliente_id IS NOT NULL
  AND r.ssotica_company_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.ssotica_cliente_id = r.ssotica_cliente_id
      AND c.ssotica_company_id = r.ssotica_company_id
      AND c.status NOT IN ('pago', 'cancelado')
  );-- Reconciliação imediata: remove renovações de clientes com cobrança aberta em qualquer loja.
-- Registra a transição reversa para manter rastreabilidade.
WITH wrong_renovacoes AS (
  SELECT r.id, r.ssotica_cliente_id, r.ssotica_company_id, r.data,
         (SELECT c.id FROM public.crm_cobrancas c
            WHERE c.ssotica_cliente_id = r.ssotica_cliente_id
              AND c.ssotica_company_id = r.ssotica_company_id
              AND c.status NOT IN ('pago','cancelado')
            LIMIT 1) AS cob_id
  FROM public.crm_renovacoes r
  WHERE r.ssotica_cliente_id IS NOT NULL
    AND r.ssotica_company_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.crm_cobrancas c
      WHERE c.ssotica_cliente_id = r.ssotica_cliente_id
        AND c.ssotica_company_id = r.ssotica_company_id
        AND c.status NOT IN ('pago','cancelado')
    )
), logged AS (
  INSERT INTO public.crm_module_transition_logs (
    cliente_nome, from_module, to_module, to_status_key, to_status_label,
    source_record_id, target_record_id, ssotica_cliente_id, company_id,
    triggered_by, trigger_source
  )
  SELECT
    COALESCE(wr.data->>'nome','Cliente SSótica'),
    'renovacao','cobranca',NULL,NULL,
    wr.id, wr.cob_id, wr.ssotica_cliente_id, wr.ssotica_company_id,
    NULL,'auto_reconcile'
  FROM wrong_renovacoes wr
  RETURNING source_record_id
)
DELETE FROM public.crm_renovacoes r
WHERE r.id IN (SELECT source_record_id FROM logged);-- Remove renovações criadas erroneamente quando o sync achou que a cobrança foi quitada
-- mas na verdade a parcela apenas saiu da janela/paginação da API.
-- O próximo backfill/sync recriará as cobranças corretas.
WITH wrong AS (
  SELECT id, ssotica_cliente_id, ssotica_company_id, data->>'nome' as nome
  FROM public.crm_renovacoes
  WHERE data->>'origem_transicao' = 'cobranca_quitada'
    AND ssotica_cliente_id IS NOT NULL
), logged AS (
  INSERT INTO public.crm_module_transition_logs (
    cliente_nome, from_module, to_module, to_status_key, to_status_label,
    source_record_id, target_record_id, ssotica_cliente_id, company_id,
    triggered_by, trigger_source
  )
  SELECT COALESCE(w.nome, 'Cliente SSótica'),
         'renovacao', 'cobranca', NULL, NULL,
         w.id, NULL, w.ssotica_cliente_id, w.ssotica_company_id,
         NULL, 'auto_cleanup_falso_positivo'
  FROM wrong w
  RETURNING source_record_id
)
DELETE FROM public.crm_renovacoes WHERE id IN (SELECT source_record_id FROM logged);-- Destrava o backfill da Loja Caicó-RN que ficou em loop por timeout na reconciliação
-- Marca os logs órfãos (running > 5min sem finished_at) como erro para limpeza visual
UPDATE public.ssotica_sync_logs
SET status = 'error',
    finished_at = now(),
    error_message = 'Cancelado: chunk reprocessado por timeout. Substituído por nova execução.'
WHERE status = 'running'
  AND finished_at IS NULL
  AND started_at < now() - interval '5 minutes';

-- Reseta o agendamento do próximo run para "agora" para que o cron pegue
-- (mantém chunk_index=0 — vai retomar de onde parou com a lógica corrigida)
UPDATE public.ssotica_integrations
SET backfill_next_run_at = now(),
    sync_status = 'running',
    last_error = NULL
WHERE company_id = '83773a1c-1bb0-453e-9cb5-c6538a7dd8c3'
  AND backfill_status = 'running';-- Reset backfill da Caicó-RN com nova configuração (16 chunks de 6 meses)
UPDATE public.ssotica_integrations
SET 
  backfill_chunk_index = 0,
  backfill_total_chunks = 16,
  backfill_status = 'running',
  backfill_started_at = now(),
  backfill_next_run_at = now(),
  sync_status = 'running',
  last_error = NULL
WHERE company_id = '83773a1c-1bb0-453e-9cb5-c6538a7dd8c3';

-- Limpa logs órfãos travados em "running" do reset anterior
UPDATE public.ssotica_sync_logs
SET 
  status = 'error',
  error_message = 'Cancelado: reset para nova configuração de chunks (6 meses)',
  finished_at = now()
WHERE status = 'running'
  AND integration_id IN (
    SELECT id FROM public.ssotica_integrations 
    WHERE company_id = '83773a1c-1bb0-453e-9cb5-c6538a7dd8c3'
  );-- ============================================================
-- CORREÇÕES DE SEGURANÇA - PRIORIDADE 1, 2 e 3
-- ============================================================

-- ============================================================
-- ITEM 1 (CRÍTICO): whatsapp_instances - tokens de sessão expostos
-- Restringir SELECT para apenas usuários da mesma empresa
-- ============================================================
DROP POLICY IF EXISTS "All authenticated can view instances" ON public.whatsapp_instances;

CREATE POLICY "Users can view company instances"
  ON public.whatsapp_instances
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (company_id IS NOT NULL AND is_my_company(company_id))
  );

-- ============================================================
-- ITEM 2: get_my_company_id - inconsistência com manager_companies
-- Reescrever para considerar manager_companies (alinhar com is_same_company)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Retorna o company_id principal do perfil; se não houver, retorna o primeiro
  -- company_id de manager_companies. Mantém compatibilidade com policies que
  -- esperam um único valor, mas evita NULL para gerentes sem company_id no profile.
  SELECT COALESCE(
    (SELECT company_id FROM public.profiles WHERE user_id = auth.uid() AND company_id IS NOT NULL LIMIT 1),
    (SELECT company_id FROM public.manager_companies WHERE user_id = auth.uid() LIMIT 1)
  );
$function$;

-- Ajustar a policy de INSERT em user_roles para usar is_my_company
-- (que já considera manager_companies), tornando a verificação consistente
DROP POLICY IF EXISTS "Gerentes can insert vendedor roles" ON public.user_roles;

CREATE POLICY "Gerentes can insert vendedor roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente'::app_role)
    AND role = 'vendedor'::app_role
    AND user_id <> auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = user_roles.user_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_roles.user_id
        AND p.company_id IS NOT NULL
        AND public.is_my_company(p.company_id)
    )
  );

-- ============================================================
-- ITEM 3: crm_module_transition_logs - WITH CHECK (true) muito permissivo
-- Exigir que logs manuais sejam atribuídos ao próprio usuário;
-- logs automáticos (triggered_by NULL) ainda permitidos para edge functions
-- usando service role (que bypassa RLS), mas via authenticated exige owner.
-- ============================================================
DROP POLICY IF EXISTS "Authenticated can insert module transition logs" ON public.crm_module_transition_logs;

CREATE POLICY "Authenticated can insert module transition logs"
  ON public.crm_module_transition_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Logs manuais: triggered_by deve ser o próprio usuário OU
    -- a inserção marca trigger_source='manual' e atribui ao usuário corrente.
    -- Permite NULL apenas quando trigger_source != 'manual' (logs auto via cliente
    -- ainda são aceitos, mas service-role bypassa RLS de qualquer forma).
    (triggered_by IS NULL AND trigger_source <> 'manual')
    OR triggered_by = auth.uid()
  );

-- ============================================================
-- ITEM 4: whatsapp_trigger_sends - DELETE policy aplicada a {public}
-- Recriar policy aplicando apenas a {authenticated}
-- ============================================================
DROP POLICY IF EXISTS "Admins can delete any trigger send" ON public.whatsapp_trigger_sends;

CREATE POLICY "Admins can delete any trigger send"
  ON public.whatsapp_trigger_sends
  FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- ITENS 6, 7, 8: Buckets públicos permitem listagem
-- Tornar buckets PRIVADOS no nível de configuração (impede listagem via API)
-- e manter SELECT policy permitindo leitura individual de objetos.
-- URLs públicas via getPublicUrl continuarão funcionando? NÃO em bucket privado.
-- 
-- ALTERNATIVA SEGURA: Manter buckets públicos (URLs públicas funcionam),
-- mas restringir o SELECT policy em storage.objects para que LIST via API
-- requer autenticação E apenas retorne arquivos do próprio usuário/admin.
-- 
-- Como buckets `public: true` permitem leitura por URL via CDN sem passar por
-- RLS, restringir o policy SELECT só afeta operações via .list() ou .from('bucket').
-- Isso mantém imagens funcionando em <img src> e bloqueia enumeração.
-- ============================================================

-- AVATARS: leitura por URL pública continua, mas listagem só do próprio dono ou admin
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

CREATE POLICY "Authenticated can read avatars"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- LOGOS: apenas autenticados leem; admins podem listar tudo, demais só leem objeto específico
DROP POLICY IF EXISTS "Anyone can view logos" ON storage.objects;

CREATE POLICY "Authenticated can read logos"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'logos');

-- WHATSAPP MEDIA: leitura individual permitida, listagem restrita
DROP POLICY IF EXISTS "Public read whatsapp media" ON storage.objects;

CREATE POLICY "Authenticated can read whatsapp media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'whatsapp-media'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- IMPORTANTE: Os buckets continuam marcados como public=true no Supabase Storage,
-- então URLs geradas por getPublicUrl() continuam funcionando para exibir imagens
-- em <img src>. As policies acima só afetam operações via API SDK
-- (storage.from('bucket').list() / .download() autenticados), bloqueando enumeração.DROP POLICY IF EXISTS "update activities" ON public.renovacao_activities;

CREATE POLICY "Update own renovacao activities or admin"
ON public.renovacao_activities
FOR UPDATE
TO authenticated
USING ((created_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))
WITH CHECK ((created_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));-- ssotica_funcionarios
DROP POLICY IF EXISTS "Authenticated can view ssotica funcionarios" ON public.ssotica_funcionarios;
CREATE POLICY "View ssotica funcionarios scoped"
ON public.ssotica_funcionarios
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_my_company(company_id));

-- ssotica_user_mappings
DROP POLICY IF EXISTS "Authenticated can view ssotica user mappings" ON public.ssotica_user_mappings;
CREATE POLICY "View ssotica user mappings scoped"
ON public.ssotica_user_mappings
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR is_my_company(company_id)
  OR user_id = auth.uid()
);

-- whatsapp_campaigns
DROP POLICY IF EXISTS "Vendedores can view campaigns" ON public.whatsapp_campaigns;
CREATE POLICY "View whatsapp campaigns scoped"
ON public.whatsapp_campaigns
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR created_by = auth.uid()
  OR (company_id IS NOT NULL AND is_my_company(company_id))
  OR is_same_company(created_by)
);

-- whatsapp_trigger_campaigns
DROP POLICY IF EXISTS "Vendedores can view trigger campaigns" ON public.whatsapp_trigger_campaigns;
CREATE POLICY "View whatsapp trigger campaigns scoped"
ON public.whatsapp_trigger_campaigns
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR created_by = auth.uid()
  OR (company_id IS NOT NULL AND is_my_company(company_id))
  OR is_same_company(created_by)
);

-- whatsapp_trigger_steps
DROP POLICY IF EXISTS "Vendedores can view trigger steps" ON public.whatsapp_trigger_steps;
CREATE POLICY "View whatsapp trigger steps scoped"
ON public.whatsapp_trigger_steps
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.whatsapp_trigger_campaigns c
    WHERE c.id = whatsapp_trigger_steps.campaign_id
      AND (
        c.created_by = auth.uid()
        OR (c.company_id IS NOT NULL AND is_my_company(c.company_id))
        OR is_same_company(c.created_by)
      )
  )
);
-- Deduplicar parcelas_atrasadas mantendo a primeira ocorrência de cada parcela_id,
-- e recalcular valor e qtd_parcelas_atrasadas a partir do array dedup.
WITH parcelas_dedup AS (
  SELECT
    c.id AS cobranca_id,
    COALESCE(
      (
        SELECT jsonb_agg(p ORDER BY (p->>'vencimento'))
        FROM (
          SELECT DISTINCT ON (p->>'parcela_id') p
          FROM jsonb_array_elements(c.data->'parcelas_atrasadas') AS p
          ORDER BY p->>'parcela_id', p->>'vencimento'
        ) sub
      ),
      '[]'::jsonb
    ) AS parcelas_unicas
  FROM public.crm_cobrancas c
  WHERE jsonb_typeof(c.data->'parcelas_atrasadas') = 'array'
    AND jsonb_array_length(c.data->'parcelas_atrasadas') > 1
    AND c.status NOT IN ('pago', 'cancelado')
),
calculadas AS (
  SELECT
    pd.cobranca_id,
    pd.parcelas_unicas,
    jsonb_array_length(pd.parcelas_unicas) AS qtd,
    COALESCE((
      SELECT SUM((p->>'valor')::numeric)
      FROM jsonb_array_elements(pd.parcelas_unicas) p
    ), 0) AS total
  FROM parcelas_dedup pd
)
UPDATE public.crm_cobrancas c
SET
  data = jsonb_set(
    jsonb_set(
      jsonb_set(c.data, '{parcelas_atrasadas}', cal.parcelas_unicas, true),
      '{qtd_parcelas_atrasadas}', to_jsonb(cal.qtd), true
    ),
    '{total_atraso}', to_jsonb(cal.total), true
  ),
  valor = cal.total,
  updated_at = now()
FROM calculadas cal
WHERE c.id = cal.cobranca_id
  AND jsonb_array_length(c.data->'parcelas_atrasadas') <> cal.qtd;
UPDATE ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE is_active = true AND sync_status = 'running';UPDATE ssotica_integrations SET sync_status = 'idle' WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d';
UPDATE ssotica_sync_logs SET status = 'error', error_message = 'Timeout - cancelado pelo cron', finished_at = now() WHERE integration_id = '92093af4-69a1-4033-a272-4c23062e3d6d' AND status = 'running';UPDATE ssotica_integrations SET sync_status = 'idle', last_sync_receber_at = now(), last_sync_vendas_at = now(), last_error = NULL WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d';
UPDATE ssotica_sync_logs SET status = 'success', finished_at = now() WHERE integration_id = '92093af4-69a1-4033-a272-4c23062e3d6d' AND status = 'running';UPDATE ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE is_active = true AND sync_status = 'running';UPDATE ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE id = '5cc5dc5e-0707-4af4-8948-700d77967856';
UPDATE ssotica_sync_logs SET status = 'error', error_message = 'Timeout - destravado manualmente', finished_at = now() WHERE integration_id = '5cc5dc5e-0707-4af4-8948-700d77967856' AND status = 'running';UPDATE ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE id = 'cf5660c7-e098-4bc2-a524-83753a5ddb9b';
UPDATE ssotica_sync_logs SET status = 'error', error_message = 'Timeout - destravado para reprocessar com fix de negativadas', finished_at = now() WHERE integration_id = 'cf5660c7-e098-4bc2-a524-83753a5ddb9b' AND status = 'running';-- Remove duplicatas de cobranças por ssotica_cliente_id, mantendo a mais antiga
WITH ranked AS (
  SELECT id,
         ssotica_cliente_id,
         ROW_NUMBER() OVER (
           PARTITION BY ssotica_cliente_id
           ORDER BY vencimento ASC NULLS LAST, dias_atraso DESC NULLS LAST, created_at ASC
         ) AS rn
  FROM crm_cobrancas
  WHERE ssotica_cliente_id IS NOT NULL
)
DELETE FROM crm_cobrancas
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);UPDATE ssotica_integrations SET sync_status='idle', last_error=NULL WHERE id IN ('92093af4-69a1-4033-a272-4c23062e3d6d','5cc5dc5e-0707-4af4-8948-700d77967856','cf5660c7-e098-4bc2-a524-83753a5ddb9b');

UPDATE ssotica_sync_logs SET status='error', error_message='Timeout - destravado manualmente', finished_at=now() WHERE integration_id IN ('92093af4-69a1-4033-a272-4c23062e3d6d','5cc5dc5e-0707-4af4-8948-700d77967856','cf5660c7-e098-4bc2-a524-83753a5ddb9b') AND status='running';UPDATE ssotica_integrations SET sync_status='idle', last_error=NULL WHERE id IN ('92093af4-69a1-4033-a272-4c23062e3d6d','5cc5dc5e-0707-4af4-8948-700d77967856','cf5660c7-e098-4bc2-a524-83753a5ddb9b');

UPDATE ssotica_sync_logs SET status='error', error_message='Timeout - destravado manualmente', finished_at=now() WHERE integration_id IN ('92093af4-69a1-4033-a272-4c23062e3d6d','5cc5dc5e-0707-4af4-8948-700d77967856','cf5660c7-e098-4bc2-a524-83753a5ddb9b') AND status='running';-- Recalcula dias_atraso baseado no vencimento usando data atual em São Paulo
WITH br_today AS (
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d
)
UPDATE crm_cobrancas c
SET 
  dias_atraso = (SELECT d FROM br_today) - c.vencimento,
  status = CASE
    WHEN ((SELECT d FROM br_today) - c.vencimento) <= -1 THEN 'pendente'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 0 AND 4 THEN 'em_cobranca'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 5 AND 14 THEN '5_dias_de_atraso'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 15 AND 29 THEN 'atrasado'
    WHEN ((SELECT d FROM br_today) - c.vencimento) = 30 THEN '30_dias_de_atraso'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 31 AND 44 THEN '31_dias_de_atraso_ligao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 45 AND 59 THEN '45_dias_de_atrasomensagem_automtica'
    WHEN ((SELECT d FROM br_today) - c.vencimento) = 60 THEN '60_dias_de_atraso_ligao_negativao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 61 AND 64 THEN '61_negativao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 65 AND 74 THEN '65_dias_de_atraso_receber_informe_de_negativao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 75 AND 89 THEN '75_dias_de_atraso_proposta_de_negociao_ps_negativao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 90 AND 104 THEN '90_dias_de_atraso_ligao_para_tentativa_de_negociao_ps_negativao'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 105 AND 119 THEN '105_dias_de_atraso_notificao_extra_judicial_altomtico'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 120 AND 134 THEN '120_dias_de_atraso_ligao_informe_judicial'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 135 AND 149 THEN '135_dias_de_atraso_oferta_de_negativao_automatico'
    WHEN ((SELECT d FROM br_today) - c.vencimento) BETWEEN 150 AND 179 THEN '150_dias_de_atraso_enviar_para_o_advogado'
    ELSE '180_dias_ajuizar_manualmente'
  END,
  updated_at = now()
WHERE c.vencimento IS NOT NULL;UPDATE public.crm_renovacoes
SET status = CASE
  WHEN data_ultima_compra IS NULL THEN 'novo'
  WHEN (CURRENT_DATE - data_ultima_compra) < 365 THEN 'em_contato'
  WHEN (CURRENT_DATE - data_ultima_compra) < 730 THEN 'agendado'
  WHEN (CURRENT_DATE - data_ultima_compra) < 1095 THEN 'renovado'
  ELSE 'mais_de_3_anos'
END
WHERE status = 'fazer_direcionamento_para_o_vendedor'
  AND assigned_to IS NOT NULL;CREATE POLICY "Vendedores can delete own appointments"
ON public.crm_appointments
FOR DELETE
TO authenticated
USING (scheduled_by = auth.uid());CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _hour int;
  _h1 int; _h2 int; _h3 int; _h4 int;
  _cron_expression text;
  _job_command text;
  _url text := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/ssotica-sync';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ';
BEGIN
  SELECT COALESCE(setting_value, '6')::int INTO _hour
  FROM system_settings
  WHERE setting_key = 'ssotica_sync_hour';

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    _hour := 6;
  END IF;

  _h1 := (_hour + 3) % 24;
  _h2 := (_hour + 9) % 24;
  _h3 := (_hour + 15) % 24;
  _h4 := (_hour + 21) % 24;

  _cron_expression := '0 ' || _h1 || ',' || _h2 || ',' || _h3 || ',' || _h4 || ' * * *';

  BEGIN
    PERFORM cron.unschedule('ssotica-daily-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM cron.unschedule('ssotica-sync-cron');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM cron.unschedule('ssotica-hourly-sync');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _job_command := 'SELECT net.http_post(url := ''' || _url || ''', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule(
    'ssotica-daily-sync',
    _cron_expression,
    _job_command
  );
END;
$function$;

SELECT public.manage_ssotica_cron();CREATE OR REPLACE FUNCTION public.manage_ssotica_cron()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _hour int;
  _cron_expression text;
  _job_command text;
  _url text := 'https://flhycgllttqeczrpmfoc.supabase.co/functions/v1/ssotica-sync';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsaHljZ2xsdHRxZWN6cnBtZm9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjg0NjAsImV4cCI6MjA5MDkwNDQ2MH0.VjVdVgDzRajcD-2ACZY7-3zFwjP_Ti6pbFIBjW0NnhQ';
BEGIN
  SELECT COALESCE(setting_value, '6')::int INTO _hour
  FROM system_settings
  WHERE setting_key = 'ssotica_sync_hour';

  IF _hour IS NULL OR _hour < 0 OR _hour > 23 THEN
    _hour := 6;
  END IF;

  -- Roda a cada 3 horas (8 ciclos/dia), alinhado às 8 fatias incrementais.
  _cron_expression := '0 ' || (_hour % 3) || '-23/3 * * *';

  BEGIN PERFORM cron.unschedule('ssotica-daily-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-sync-cron'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('ssotica-hourly-sync'); EXCEPTION WHEN OTHERS THEN NULL; END;

  _job_command := 'SELECT net.http_post(url := ''' || _url || ''', headers := ''{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}''::jsonb, body := ''{}''::jsonb);';

  PERFORM cron.schedule('ssotica-daily-sync', _cron_expression, _job_command);
END;
$function$;

SELECT public.manage_ssotica_cron();CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.ssotica_enqueue_sync(
  _url text,
  _auth text,
  _integration_id uuid,
  _force_full boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _req_id bigint;
BEGIN
  SELECT net.http_post(
    url := _url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', _auth
    ),
    body := jsonb_build_object(
      'mode', 'incremental',
      'integration_id', _integration_id,
      'force_full', _force_full
    ),
    timeout_milliseconds := 600000
  ) INTO _req_id;
  RETURN _req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) TO authenticated, service_role;-- Função para excluir todos os leads e seus dados relacionados,
-- preservando renovações e cobranças. Apenas admins podem executar.
CREATE OR REPLACE FUNCTION public.delete_all_leads_cascade()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  -- Apenas admins podem executar
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta ação';
  END IF;

  -- Excluir dados relacionados APENAS aos leads (preservando renovações/cobranças)
  DELETE FROM public.crm_lead_notes
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.lead_activities
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  -- Agendamentos vinculados a leads (renovações ficam intactas via renovacao_id)
  DELETE FROM public.crm_appointments
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.notifications
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.whatsapp_campaign_sends
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.whatsapp_trigger_sends
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.scheduled_whatsapp_messages
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  -- Excluir os leads
  WITH d AS (
    DELETE FROM public.crm_leads RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;

  RETURN jsonb_build_object('deleted_leads', deleted_count);
END;
$$;CREATE OR REPLACE FUNCTION public.delete_all_leads_cascade()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem executar esta ação';
  END IF;

  DELETE FROM public.crm_lead_notes
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.lead_activities
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.crm_appointments
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.notifications
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.whatsapp_campaign_sends
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.whatsapp_trigger_sends
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  DELETE FROM public.scheduled_whatsapp_messages
    WHERE lead_id IN (SELECT id FROM public.crm_leads);

  WITH d AS (
    DELETE FROM public.crm_leads WHERE id IS NOT NULL RETURNING 1
  )
  SELECT count(*) INTO deleted_count FROM d;

  RETURN jsonb_build_object('deleted_leads', deleted_count);
END;
$$;-- Track every time a salesperson opens a card for editing
CREATE TABLE public.lead_card_opens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  card_type TEXT NOT NULL CHECK (card_type IN ('lead','renovacao')),
  lead_id UUID NULL,
  renovacao_id UUID NULL,
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_card_opens_user_date ON public.lead_card_opens (user_id, opened_at);
CREATE INDEX idx_lead_card_opens_lead ON public.lead_card_opens (lead_id);
CREATE INDEX idx_lead_card_opens_renovacao ON public.lead_card_opens (renovacao_id);

ALTER TABLE public.lead_card_opens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own card opens"
  ON public.lead_card_opens
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own card opens"
  ON public.lead_card_opens
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all card opens"
  ON public.lead_card_opens
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gerentes can view company card opens"
  ON public.lead_card_opens
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'gerente'::app_role)
    AND is_same_company(user_id)
  );ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_card_opens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_lead_notes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_renovacao_notes;
ALTER TABLE public.lead_card_opens REPLICA IDENTITY FULL;
ALTER TABLE public.crm_lead_notes REPLICA IDENTITY FULL;
ALTER TABLE public.crm_renovacao_notes REPLICA IDENTITY FULL;-- Habilitar realtime nas tabelas principais para atualização automática sem refresh
ALTER TABLE public.crm_leads REPLICA IDENTITY FULL;
ALTER TABLE public.crm_renovacoes REPLICA IDENTITY FULL;
ALTER TABLE public.crm_cobrancas REPLICA IDENTITY FULL;
ALTER TABLE public.crm_appointments REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_leads;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_renovacoes;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_cobrancas;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_appointments;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;-- ============================================================================
-- WHATSAPP TRIGGER CAMPAIGNS — gerente só vê os da própria empresa
-- ============================================================================
DROP POLICY IF EXISTS "View whatsapp trigger campaigns scoped" ON public.whatsapp_trigger_campaigns;
DROP POLICY IF EXISTS "Gerentes can manage company trigger campaigns" ON public.whatsapp_trigger_campaigns;

CREATE POLICY "View whatsapp trigger campaigns scoped"
ON public.whatsapp_trigger_campaigns
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
  )
);

CREATE POLICY "Gerentes can manage company trigger campaigns"
ON public.whatsapp_trigger_campaigns
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role)
  AND company_id IS NOT NULL
  AND is_my_company(company_id)
)
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND auth.uid() = created_by
  AND company_id IS NOT NULL
  AND is_my_company(company_id)
);

-- ============================================================================
-- WHATSAPP CAMPAIGNS — gerente só vê os da própria empresa
-- ============================================================================
DROP POLICY IF EXISTS "View whatsapp campaigns scoped" ON public.whatsapp_campaigns;
DROP POLICY IF EXISTS "Gerentes can manage company campaigns" ON public.whatsapp_campaigns;

CREATE POLICY "View whatsapp campaigns scoped"
ON public.whatsapp_campaigns
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'gerente'::app_role)
    AND company_id IS NOT NULL
    AND is_my_company(company_id)
  )
);

CREATE POLICY "Gerentes can manage company campaigns"
ON public.whatsapp_campaigns
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'gerente'::app_role)
  AND company_id IS NOT NULL
  AND is_my_company(company_id)
)
WITH CHECK (
  has_role(auth.uid(), 'gerente'::app_role)
  AND auth.uid() = created_by
  AND company_id IS NOT NULL
  AND is_my_company(company_id)
);

-- ============================================================================
-- WHATSAPP TRIGGER SENDS — herda visibilidade do gatilho-pai
-- ============================================================================
DROP POLICY IF EXISTS "Scoped trigger sends visibility" ON public.whatsapp_trigger_sends;

CREATE POLICY "Scoped trigger sends visibility"
ON public.whatsapp_trigger_sends
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1
    FROM public.whatsapp_trigger_campaigns c
    WHERE c.id = whatsapp_trigger_sends.campaign_id
      AND has_role(auth.uid(), 'gerente'::app_role)
      AND c.company_id IS NOT NULL
      AND is_my_company(c.company_id)
  )
);

-- ============================================================================
-- WHATSAPP CAMPAIGN SENDS — herda visibilidade da campanha-pai
-- ============================================================================
DROP POLICY IF EXISTS "Scoped campaign sends visibility" ON public.whatsapp_campaign_sends;

CREATE POLICY "Scoped campaign sends visibility"
ON public.whatsapp_campaign_sends
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1
    FROM public.whatsapp_campaigns c
    WHERE c.id = whatsapp_campaign_sends.campaign_id
      AND has_role(auth.uid(), 'gerente'::app_role)
      AND c.company_id IS NOT NULL
      AND is_my_company(c.company_id)
  )
);UPDATE public.ssotica_integrations
SET sync_status = 'idle',
    backfill_next_run_at = NULL,
    updated_at = now()
WHERE id = '5cc5dc5e-0707-4af4-8948-700d77967856'
  AND sync_status = 'running';-- Adicionar campo financeiro_visible em statuses de cobrança (default true)
ALTER TABLE public.crm_cobranca_statuses 
ADD COLUMN IF NOT EXISTS financeiro_visible boolean NOT NULL DEFAULT true;

-- Tabela de checklist por coluna (admin configura, financeiro precisa preencher para mover lead)
CREATE TABLE IF NOT EXISTS public.crm_cobranca_status_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  label text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cobranca_checklist_status ON public.crm_cobranca_status_checklist(status_id);

ALTER TABLE public.crm_cobranca_status_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage cobranca checklist"
ON public.crm_cobranca_status_checklist
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view cobranca checklist"
ON public.crm_cobranca_status_checklist
FOR SELECT TO authenticated
USING (true);

-- Tabela registrando preenchimento do checklist por cobrança
CREATE TABLE IF NOT EXISTS public.crm_cobranca_checklist_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id uuid NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  status_id uuid NOT NULL REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  checklist_item_id uuid NOT NULL REFERENCES public.crm_cobranca_status_checklist(id) ON DELETE CASCADE,
  completed_by uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cobranca_id, status_id, checklist_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cobranca_completions_cobranca ON public.crm_cobranca_checklist_completions(cobranca_id, status_id);

ALTER TABLE public.crm_cobranca_checklist_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View completions for accessible cobrancas"
ON public.crm_cobranca_checklist_completions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM crm_cobrancas c
    WHERE c.id = crm_cobranca_checklist_completions.cobranca_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'financeiro'::app_role)
      OR c.assigned_to = auth.uid()
      OR c.created_by = auth.uid()
      OR is_same_company(c.assigned_to)
      OR is_same_company(c.created_by)
    )
  )
);

CREATE POLICY "Insert completions on accessible cobrancas"
ON public.crm_cobranca_checklist_completions
FOR INSERT TO authenticated
WITH CHECK (
  completed_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM crm_cobrancas c
    WHERE c.id = crm_cobranca_checklist_completions.cobranca_id
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'financeiro'::app_role)
    )
  )
);

CREATE POLICY "Delete own completions or admin"
ON public.crm_cobranca_checklist_completions
FOR DELETE TO authenticated
USING (completed_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));ALTER PUBLICATION supabase_realtime ADD TABLE public.crm_cobranca_notes;-- Add cobranca_id column to lead_card_opens to support tracking when finance users open cobranca cards
ALTER TABLE public.lead_card_opens
  ADD COLUMN IF NOT EXISTS cobranca_id UUID;

CREATE INDEX IF NOT EXISTS idx_lead_card_opens_cobranca_id ON public.lead_card_opens(cobranca_id);
CREATE INDEX IF NOT EXISTS idx_lead_card_opens_user_opened_at ON public.lead_card_opens(user_id, opened_at DESC);

-- Allow financeiro/admin/gerente to view cobranca card opens of accessible users (similar pattern to existing policies)
DROP POLICY IF EXISTS "Financeiro can view cobranca card opens" ON public.lead_card_opens;
CREATE POLICY "Financeiro can view cobranca card opens"
  ON public.lead_card_opens
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'financeiro'::app_role)
    AND card_type = 'cobranca'
  );ALTER TABLE public.lead_card_opens DROP CONSTRAINT IF EXISTS lead_card_opens_card_type_check;
ALTER TABLE public.lead_card_opens ADD CONSTRAINT lead_card_opens_card_type_check CHECK (card_type = ANY (ARRAY['lead'::text, 'renovacao'::text, 'cobranca'::text]));UPDATE public.system_settings SET setting_value = 'CRM Óticas Joonker' WHERE setting_key = 'system_name';
-- ============================================================
-- Fortalecimento de RLS para crm_renovacoes e crm_cobrancas
-- Vendedores só veem registros atribuídos a eles ou criados por eles.
-- Admin / Gerente / Financeiro continuam com visão ampla.
-- Isso também restringe os eventos Realtime (postgres_changes)
-- para que vendedores não recebam eventos de registros alheios.
-- ============================================================

-- ---------- crm_renovacoes ----------
DROP POLICY IF EXISTS "Users can view renovacoes from same company" ON public.crm_renovacoes;

CREATE POLICY "Users can view renovacoes scoped"
ON public.crm_renovacoes
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
);

-- ---------- crm_cobrancas ----------
DROP POLICY IF EXISTS "Users can view cobrancas" ON public.crm_cobrancas;

CREATE POLICY "Users can view cobrancas scoped"
ON public.crm_cobrancas
FOR SELECT
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'financeiro'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR assigned_to = auth.uid()
  OR created_by = auth.uid()
);

-- ---------- Notes correlatas (também no realtime) ----------
-- Garante que notas só apareçam para quem pode ver a renovação/cobrança pai.

-- crm_renovacao_notes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='crm_renovacao_notes' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_renovacao_notes', r.policyname);
  END LOOP;
END$$;

CREATE POLICY "View renovacao notes scoped"
ON public.crm_renovacao_notes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.crm_renovacoes r
    WHERE r.id = crm_renovacao_notes.renovacao_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'gerente'::app_role)
        OR r.assigned_to = auth.uid()
        OR r.created_by = auth.uid()
      )
  )
);

-- crm_cobranca_notes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='crm_cobranca_notes' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.crm_cobranca_notes', r.policyname);
  END LOOP;
END$$;

CREATE POLICY "View cobranca notes scoped"
ON public.crm_cobranca_notes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_notes.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR has_role(auth.uid(), 'gerente'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
      )
  )
);
-- Revoga EXECUTE público (PUBLIC e anon) de todas as funções SECURITY DEFINER do schema public.
-- Mantém authenticated apenas para funções usadas pela aplicação cliente.
-- Funções administrativas/utilitárias ficam restritas a service_role.

-- 1) Funções usadas pelo cliente autenticado (mantém authenticated)
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_my_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_same_company(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_company_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_company_user_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_profile_names() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_renovacao(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_same_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_user_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_names() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_renovacao(uuid) TO authenticated;

-- 2) Funções administrativas (somente service_role / postgres / triggers internos)
REVOKE ALL ON FUNCTION public.admin_decrypt_license(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_all_leads_cascade() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_ssotica_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.manage_whatsapp_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- admin_decrypt_license e delete_all_leads_cascade já checam has_role(admin) internamente.
-- Precisam ser executáveis pelo cliente autenticado para o admin chamá-las via RPC.
GRANT EXECUTE ON FUNCTION public.admin_decrypt_license(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_all_leads_cascade() TO authenticated;

-- manage_ssotica_cron e manage_whatsapp_cron são chamadas por edge functions (service_role) ou via SQL admin.
-- ssotica_enqueue_sync usa pg_net e só deve rodar via cron/edge.
GRANT EXECUTE ON FUNCTION public.manage_ssotica_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.manage_whatsapp_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.ssotica_enqueue_sync(text, text, uuid, boolean) TO service_role;

-- 3) Funções trigger / internas (não devem ser chamáveis por nenhum cliente)
REVOKE ALL ON FUNCTION public._encrypt_ssotica_secrets() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_updated_at_renovacao_activities() FROM PUBLIC, anon, authenticated;
-- 1) Configuração do fluxo por coluna
CREATE TABLE public.crm_cobranca_column_flow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status_id uuid NOT NULL UNIQUE REFERENCES public.crm_cobranca_statuses(id) ON DELETE CASCADE,
  flow_enabled boolean NOT NULL DEFAULT false,
  column_type text NOT NULL DEFAULT 'manual' CHECK (column_type IN ('manual','auto')),
  days_to_advance integer NOT NULL DEFAULT 0 CHECK (days_to_advance >= 0),
  next_status_id uuid REFERENCES public.crm_cobranca_statuses(id) ON DELETE SET NULL,
  whatsapp_trigger_campaign_id uuid REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_cobranca_column_flow ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage cobranca column flow"
  ON public.crm_cobranca_column_flow FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated view cobranca column flow"
  ON public.crm_cobranca_column_flow FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_cobranca_column_flow_updated_at
  BEFORE UPDATE ON public.crm_cobranca_column_flow
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Eventos do fluxo (timeline no card)
CREATE TABLE public.crm_cobranca_flow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cobranca_id uuid NOT NULL REFERENCES public.crm_cobrancas(id) ON DELETE CASCADE,
  status_id uuid REFERENCES public.crm_cobranca_statuses(id) ON DELETE SET NULL,
  status_key text,
  status_label text,
  event_type text NOT NULL CHECK (event_type IN ('tratativa','gatilho_enviado','avancou_coluna','gatilho_falhou')),
  whatsapp_trigger_campaign_id uuid REFERENCES public.whatsapp_trigger_campaigns(id) ON DELETE SET NULL,
  whatsapp_trigger_campaign_name text,
  next_status_key text,
  next_status_label text,
  created_by uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cobranca_flow_events_cobranca ON public.crm_cobranca_flow_events(cobranca_id, created_at DESC);

ALTER TABLE public.crm_cobranca_flow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View cobranca flow events scoped"
  ON public.crm_cobranca_flow_events FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_flow_events.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR has_role(auth.uid(), 'gerente'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
      )
  ));

CREATE POLICY "Insert flow events on accessible cobrancas"
  ON public.crm_cobranca_flow_events FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.crm_cobrancas c
    WHERE c.id = crm_cobranca_flow_events.cobranca_id
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'financeiro'::app_role)
        OR c.assigned_to = auth.uid()
        OR c.created_by = auth.uid()
      )
  ));

CREATE POLICY "Admins delete flow events"
  ON public.crm_cobranca_flow_events FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Pré-popula uma linha de fluxo para cada status existente (vazio, admin configura)
INSERT INTO public.crm_cobranca_column_flow (status_id, flow_enabled, column_type, days_to_advance)
SELECT id, false, 'manual', 0
FROM public.crm_cobranca_statuses
ON CONFLICT (status_id) DO NOTHING;
DELETE FROM public.crm_cobrancas c
WHERE c.status = 'pendente'
  AND c.dias_atraso <= -2
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(coalesce(c.data->'parcelas_atrasadas', '[]'::jsonb)) p
    WHERE (p->>'dias_atraso')::int >= -1
  );INSERT INTO public.crm_module_transition_logs
  (cliente_nome, from_module, to_module, to_status_key, to_status_label, trigger_source)
VALUES (
  'Limpeza administrativa: cards removidos da coluna "1 Dia antes do vencimento" cujas parcelas ainda estavam a mais de 1 dia do vencimento (correção de bug). Os cards serão recriados pela próxima sincronização quando estiverem a 1 dia do vencimento.',
  'cobranca',
  'none',
  'pendente',
  '1 Dia antes do vencimento',
  'manual'
);-- Agenda backfill para lojas que ainda estão idle (chunk 0/16) sem next_run_at definido.
-- Escalonado a cada 30min para evitar rate limit da API SSótica.
WITH lojas_pendentes AS (
  SELECT i.id,
         row_number() OVER (ORDER BY c.name) - 1 AS pos
  FROM public.ssotica_integrations i
  JOIN public.companies c ON c.id = i.company_id
  WHERE i.is_active
    AND i.backfill_status = 'idle'
    AND i.backfill_chunk_index = 0
    AND i.backfill_next_run_at IS NULL
)
UPDATE public.ssotica_integrations i
SET backfill_status = 'scheduled',
    backfill_next_run_at = now() + (lp.pos * interval '30 minutes'),
    backfill_started_at = COALESCE(i.backfill_started_at, now()),
    updated_at = now()
FROM lojas_pendentes lp
WHERE i.id = lp.id;-- Tabela de logs de conclusão de campanhas/gatilhos do WhatsApp
CREATE TABLE public.whatsapp_completion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('campaign','trigger')),
  source_id uuid NOT NULL,
  source_name text NOT NULL,
  module text NOT NULL,
  status_id uuid,
  status_label text,
  status_key text,
  company_id uuid,
  total_cards integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_completion_logs_source ON public.whatsapp_completion_logs(source_type, source_id, completed_at DESC);
CREATE INDEX idx_whatsapp_completion_logs_completed_at ON public.whatsapp_completion_logs(completed_at DESC);

ALTER TABLE public.whatsapp_completion_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view completion logs"
ON public.whatsapp_completion_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete completion logs"
ON public.whatsapp_completion_logs
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role and authenticated can insert completion logs"
ON public.whatsapp_completion_logs
FOR INSERT
TO authenticated
WITH CHECK (true);ALTER TABLE public.whatsapp_trigger_campaigns DROP CONSTRAINT IF EXISTS whatsapp_trigger_campaigns_status_id_fkey;
ALTER TABLE public.whatsapp_campaigns DROP CONSTRAINT IF EXISTS whatsapp_campaigns_status_id_fkey;UPDATE public.ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE company_id = '83773a1c-1bb0-453e-9cb5-c6538a7dd8c3' AND sync_status = 'running';UPDATE public.ssotica_integrations SET sync_status = 'idle', last_error = NULL WHERE company_id IN ('30993132-b4b3-47d0-b0ab-045ecf1baf24', '7b32e05f-2747-4656-942d-d6481a8a4478') AND sync_status = 'running';UPDATE public.ssotica_integrations
SET sync_status = 'idle', last_error = NULL, updated_at = now()
WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d' AND sync_status = 'running';

UPDATE public.ssotica_sync_logs
SET status = 'error',
    finished_at = now(),
    error_message = 'Destravada manualmente — sync sem atualização há ~37 min'
WHERE integration_id = '92093af4-69a1-4033-a272-4c23062e3d6d'
  AND status = 'running'
  AND finished_at IS NULL;UPDATE public.crm_cobrancas
SET status = '31_dias_de_atraso_ligao',
    updated_at = now()
WHERE status = '45_dias_de_atrasomensagem_automtica';UPDATE public.ssotica_integrations
SET sync_status = 'idle',
    updated_at = now()
WHERE id = '92093af4-69a1-4033-a272-4c23062e3d6d'
  AND sync_status = 'running';CREATE OR REPLACE FUNCTION public._export_auth_users_temp()
RETURNS TABLE(
  id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  phone text,
  phone_confirmed_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT 
    u.id, u.email::text, u.encrypted_password::text, u.email_confirmed_at,
    u.raw_user_meta_data, u.raw_app_meta_data,
    u.created_at, u.updated_at,
    u.phone::text, u.phone_confirmed_at, u.last_sign_in_at
  FROM auth.users u
  WHERE public.has_role(auth.uid(), 'admin'::app_role) OR auth.uid() IS NULL;
$$;

REVOKE ALL ON FUNCTION public._export_auth_users_temp() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._export_auth_users_temp() TO service_role;DROP FUNCTION IF EXISTS public._export_auth_users_temp();
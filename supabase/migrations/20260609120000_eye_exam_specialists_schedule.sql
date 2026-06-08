-- Especialistas de exame de vista, cores por loja e escala por dia

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS exam_schedule_color text;

COMMENT ON COLUMN public.companies.exam_schedule_color IS
  'Cor no calendário de escala de especialistas (hex, ex: #3B82F6)';

CREATE TABLE public.eye_exam_specialists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_eye_exam_specialists_active ON public.eye_exam_specialists (active);

ALTER TABLE public.eye_exam_specialists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read eye exam specialists"
  ON public.eye_exam_specialists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage eye exam specialists"
  ON public.eye_exam_specialists FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.company_eye_exam_day_specialists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  eye_exam_day_id uuid NOT NULL REFERENCES public.company_eye_exam_days(id) ON DELETE CASCADE,
  specialist_id uuid NOT NULL REFERENCES public.eye_exam_specialists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (eye_exam_day_id, specialist_id)
);

CREATE INDEX idx_company_eye_exam_day_specialists_day
  ON public.company_eye_exam_day_specialists (eye_exam_day_id);

CREATE INDEX idx_company_eye_exam_day_specialists_specialist
  ON public.company_eye_exam_day_specialists (specialist_id);

ALTER TABLE public.company_eye_exam_day_specialists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read eye exam day specialists"
  ON public.company_eye_exam_day_specialists FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage eye exam day specialists"
  ON public.company_eye_exam_day_specialists FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

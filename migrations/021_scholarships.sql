-- ─── 021 Scholarships ────────────────────────────────────────────────────────
-- Unified scholarship table fed by internal seeds, optional RapidAPI, and
-- org-posted scholarships. Also adds saved_scholarships for student bookmarks.

CREATE TABLE IF NOT EXISTS public.scholarships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  provider      text        NOT NULL,
  amount_label  text,
  amount_min    integer,
  amount_max    integer,
  deadline      date,
  is_rolling    boolean     NOT NULL DEFAULT false,
  url           text        NOT NULL,
  description   text,
  requirements  text,
  eligibility   text,
  categories    text[]      NOT NULL DEFAULT '{}',
  location      text        NOT NULL DEFAULT 'Canada',
  renewable     boolean     NOT NULL DEFAULT false,
  featured      boolean     NOT NULL DEFAULT false,
  source        text        NOT NULL DEFAULT 'internal',
  -- 'internal' = seeded | 'rapidapi' = external | 'org' = org-posted
  org_id        uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  external_id   text,       -- dedup key for external sources
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_scholarships_categories
  ON public.scholarships USING GIN (categories);
CREATE INDEX IF NOT EXISTS idx_scholarships_deadline
  ON public.scholarships (deadline) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_scholarships_source
  ON public.scholarships (source);
CREATE INDEX IF NOT EXISTS idx_scholarships_org
  ON public.scholarships (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scholarships_featured
  ON public.scholarships (featured, created_at DESC) WHERE active = true;

-- Student bookmarks
CREATE TABLE IF NOT EXISTS public.saved_scholarships (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scholarship_id uuid        NOT NULL REFERENCES public.scholarships(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scholarship_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_scholarships_user
  ON public.saved_scholarships (user_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.scholarships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scholarships_public_read"
  ON public.scholarships FOR SELECT
  USING (active = true);

CREATE POLICY "scholarships_service_all"
  ON public.scholarships FOR ALL
  USING (auth.role() = 'service_role');

ALTER TABLE public.saved_scholarships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_scholarships_own"
  ON public.saved_scholarships FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "saved_scholarships_service"
  ON public.saved_scholarships FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Seed: top Canadian scholarships ─────────────────────────────────────────

INSERT INTO public.scholarships
  (title, provider, amount_label, amount_min, amount_max,
   deadline, url, description, requirements,
   eligibility, categories, location, renewable,
   featured, source, external_id)
VALUES
('Loran Award',
 'Loran Scholars Foundation',
 '$100,000', 100000, 100000,
 '2025-11-01',
 'https://loranscholar.ca/becoming-a-scholar/',
 'Canada''s most significant undergraduate scholarship for students of exceptional character committed to service and leadership.',
 'Community service record, leadership, independent thinking, character',
 'Canadian citizens or permanent residents entering first-year university',
 ARRAY['community','leadership','volunteering','social-impact'],
 'Canada', true, true, 'internal', 'loran-award'),

('TD Scholarship for Community Leadership',
 'TD Bank Group',
 '$70,000', 70000, 70000,
 '2026-03-01',
 'https://www.td.com/ca/en/personal-banking/solutions/student-banking/scholarships',
 'For students who have made extraordinary contributions to their communities.',
 'Demonstrated community leadership, volunteerism, financial need',
 'Canadian students entering post-secondary education',
 ARRAY['community','leadership','volunteering'],
 'Canada', false, true, 'internal', 'td-community'),

('Terry Fox Humanitarian Award',
 'Terry Fox Humanitarian Award Program',
 '$28,000', 28000, 28000,
 '2026-02-01',
 'https://terryfox.org/humanitarian-award/',
 'Recognizes students who reflect Terry Fox''s spirit through volunteerism, leadership, and athletic endeavour.',
 'Volunteerism, humanitarian efforts, athletic participation, character',
 'Canadian students at any level of post-secondary',
 ARRAY['community','volunteering','health','athletics','leadership'],
 'Canada', true, true, 'internal', 'terry-fox'),

('Schulich Leader Scholarship',
 'Schulich Foundation',
 'Up to $120,000', 80000, 120000,
 '2026-02-15',
 'https://schulichleaders.com',
 'Canada''s most distinguished STEM undergraduate scholarship.',
 'STEM focus, entrepreneurial spirit, community involvement, leadership',
 'Canadian students entering first year of a STEM program',
 ARRAY['stem','education','leadership','community','innovation'],
 'Canada', true, true, 'internal', 'schulich-leader'),

('Vancouver Foundation Youth Scholarship',
 'Vancouver Foundation',
 '$5,000', 5000, 5000,
 '2026-04-30',
 'https://vancouverfoundation.ca/grants-and-scholarships/',
 'Supporting young people committed to their communities in BC.',
 'Community involvement, leadership, BC resident',
 'BC residents aged 17–25',
 ARRAY['community','volunteering','leadership'],
 'BC', false, false, 'internal', 'van-foundation-youth'),

('BC Excellence Scholarship',
 'Province of British Columbia',
 '$2,500', 2500, 2500,
 '2026-06-30',
 'https://studentaidbc.ca/scholarships',
 'Recognizing BC students who demonstrate excellence in academics and community.',
 'Academic achievement, community service',
 'BC Grade 12 students',
 ARRAY['community','education','leadership'],
 'BC', false, true, 'internal', 'bc-excellence'),

('David Suzuki Foundation Youth Award',
 'David Suzuki Foundation',
 '$3,000', 3000, 3000,
 '2026-06-01',
 'https://davidsuzuki.org',
 'For young environmental advocates making a real difference.',
 'Environmental volunteer work, advocacy, creativity',
 'Canadian youth under 25',
 ARRAY['environment','nature','conservation','community'],
 'Canada', false, false, 'internal', 'david-suzuki-youth'),

('BC Parks Foundation Scholarship',
 'BC Parks Foundation',
 '$2,500', 2500, 2500,
 '2026-05-15',
 'https://bcparksfoundation.ca',
 'For young people passionate about protecting BC''s natural spaces.',
 'Conservation volunteer work, love of nature, BC resident',
 'BC residents aged 15–25',
 ARRAY['environment','nature','conservation','parks'],
 'BC', false, false, 'internal', 'bc-parks'),

('Canada Millennium Excellence Award',
 'Millennium Scholarship Foundation',
 '$10,000', 10000, 10000,
 '2026-01-15',
 'https://bursaries-bourses.gc.ca',
 'For students demonstrating leadership, innovation and community service.',
 'Leadership, community involvement, innovation',
 'Canadian students in post-secondary',
 ARRAY['leadership','community','innovation','education'],
 'Canada', false, true, 'internal', 'millennium-excellence'),

('Indspire Education Awards',
 'Indspire',
 'Varies', NULL, NULL,
 NULL,
 'https://indspire.ca/for-students/bursaries-scholarships/',
 'Building Brighter Futures bursaries and scholarships for First Nations, Inuit, and Métis students.',
 'Indigenous identity, community involvement, academic standing',
 'First Nations, Inuit, or Métis students in Canada',
 ARRAY['community','education','indigenous','leadership'],
 'Canada', true, true, 'internal', 'indspire'),

('Rotary Foundation Scholarship',
 'Rotary International',
 'Varies', NULL, NULL,
 NULL,
 'https://www.rotary.org/en/our-programs/scholarships',
 'For students committed to peace, cultural understanding, and community service.',
 'Community service, leadership, academic excellence',
 'Students worldwide pursuing post-secondary',
 ARRAY['community','leadership','volunteering','peace','international'],
 'Canada', false, false, 'internal', 'rotary-foundation'),

('RBC Future Launch Scholarship',
 'RBC Foundation',
 '$5,000', 5000, 5000,
 '2026-05-01',
 'https://www.rbc.com/en/future-launch',
 'Supporting youth facing barriers to employment and education through community work.',
 'Community involvement, financial need, future ambitions',
 'Canadian youth 15–29',
 ARRAY['community','leadership','social-impact'],
 'Canada', false, false, 'internal', 'rbc-future-launch'),

('Duke of Edinburgh Gold Award Scholarship',
 'Duke of Edinburgh''s International Award Canada',
 '$3,000', 3000, 3000,
 '2026-09-01',
 'https://dukeofed.org',
 'Recognizing young people who complete the Duke of Edinburgh Gold Award.',
 'Completion of Duke of Ed Gold (volunteering, skill, physical, expedition)',
 'Canadian youth who have completed the Gold Award',
 ARRAY['volunteering','community','athletics','leadership'],
 'Canada', false, false, 'internal', 'duke-of-ed'),

('United Way Youth Volunteer Award',
 'United Way',
 '$2,000', 2000, 2000,
 '2026-04-01',
 'https://unitedway.ca',
 'Celebrating young volunteers who go above and beyond in their communities.',
 'Sustained volunteer commitment, impact, leadership',
 'Canadian youth under 25',
 ARRAY['volunteering','community','social-impact'],
 'Canada', false, false, 'internal', 'united-way-youth'),

('Google Generation Scholarship',
 'Google',
 '$10,000', 10000, 10000,
 '2026-01-10',
 'https://buildyourfuture.withgoogle.com/scholarships',
 'For students who are active in their communities and exemplify leadership.',
 'STEM studies, community involvement, leadership',
 'Students studying CS or tech in Canada/US',
 ARRAY['stem','technology','leadership','community'],
 'Canada', false, false, 'internal', 'google-generation'),

('Healthy Communities Initiative Grant',
 'Public Health Agency of Canada',
 '$10,000', 5000, 10000,
 '2026-07-15',
 'https://www.canada.ca/en/public-health',
 'For youth-led projects that improve health and wellbeing in Canadian communities.',
 'Community health project, youth-led initiative, measurable impact',
 'Canadian youth organizations and individuals 15–25',
 ARRAY['health','community','social-impact','volunteering'],
 'Canada', false, false, 'internal', 'phac-healthy-communities'),

('Mastercard Foundation Scholars Program',
 'Mastercard Foundation',
 'Full scholarship', NULL, NULL,
 '2026-03-01',
 'https://mastercardfdn.org/all/scholars/',
 'Supporting academically talented yet economically disadvantaged young Africans and Canadians.',
 'Academic excellence, leadership, financial need, commitment to giving back',
 'Young people with demonstrated financial need pursuing post-secondary',
 ARRAY['education','leadership','community','social-impact'],
 'Canada', true, true, 'internal', 'mastercard-foundation'),

('Environmental Youth Alliance Grant',
 'Environmental Youth Alliance',
 '$1,500', 500, 1500,
 '2026-03-15',
 'https://eya.ca',
 'For youth-led environmental projects that benefit local communities.',
 'Youth-led project, environmental focus, community benefit, BC-based',
 'Youth aged 14–24 in BC',
 ARRAY['environment','nature','conservation','community'],
 'BC', false, false, 'internal', 'eya-grant'),

('BCSPCA Kindness Award',
 'BC SPCA',
 '$1,000', 1000, 1000,
 '2026-04-30',
 'https://spca.bc.ca',
 'Recognizing young people who show outstanding kindness to animals through volunteer work.',
 'Animal welfare volunteer work, demonstrated compassion, BC resident',
 'BC youth under 18',
 ARRAY['environment','community','volunteering'],
 'BC', false, false, 'internal', 'bcspca-kindness'),

('Canadian Red Cross Youth Leadership Award',
 'Canadian Red Cross',
 '$2,500', 2500, 2500,
 '2026-05-30',
 'https://www.redcross.ca',
 'For young leaders who make an exceptional humanitarian contribution.',
 'Humanitarian volunteer work, leadership, Red Cross values',
 'Canadian youth under 25',
 ARRAY['health','community','volunteering','leadership','social-impact'],
 'Canada', false, false, 'internal', 'red-cross-youth')

ON CONFLICT (source, external_id) DO NOTHING;

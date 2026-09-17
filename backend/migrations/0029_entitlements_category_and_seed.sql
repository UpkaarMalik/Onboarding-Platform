-- 0029: Add category + description to entitlements and seed
--       department-specific benefits.
--
--       Engineering  → MacBook Pro, Dell UltraSharp 27" 4K
--       Operations   → Samsung Galaxy Book Neo, LG 24" FHD
--       Finance      → MacBook Air, Dell 24" FHD
--       Company-wide → Health Insurance, House Insurance,
--                       Gym Membership, Meal Card, Parking

ALTER TABLE entitlements
  ADD COLUMN IF NOT EXISTS category    TEXT NOT NULL DEFAULT 'perks'
    CHECK (category IN ('device', 'insurance', 'perks')),
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- ============================================================
-- Department-scoped devices
-- ============================================================

-- Engineering laptops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'MacBook Pro 16" M3 Max', 'device',
       'Apple MacBook Pro 16-inch, M3 Max chip, 36 GB unified memory, 1 TB SSD — Space Black.',
       'department', d.id, 20, 20
FROM departments d WHERE d.name = 'Engineering';

-- Engineering desktops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'Dell UltraSharp 27" 4K Monitor', 'device',
       'Dell U2723QE 27-inch 4K USB-C Hub Monitor with 90 W power delivery.',
       'department', d.id, 20, 20
FROM departments d WHERE d.name = 'Engineering';

-- Operations laptops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'Samsung Galaxy Book4 Neo', 'device',
       'Samsung Galaxy Book4 Neo 14-inch, Intel Core Ultra 7, 16 GB RAM, 512 GB SSD.',
       'department', d.id, 15, 15
FROM departments d WHERE d.name = 'Operations';

-- Operations desktops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'LG 24" FHD IPS Monitor', 'device',
       'LG 24MR400 24-inch Full HD IPS Monitor with AMD FreeSync.',
       'department', d.id, 15, 15
FROM departments d WHERE d.name = 'Operations';

-- Finance laptops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'MacBook Air 15" M3', 'device',
       'Apple MacBook Air 15-inch, M3 chip, 16 GB unified memory, 512 GB SSD — Midnight.',
       'department', d.id, 15, 15
FROM departments d WHERE d.name = 'Finance';

-- Finance desktops
INSERT INTO entitlements (name, category, description, scope, department_id, total_quantity, available_quantity)
SELECT 'Dell 24" FHD Monitor', 'device',
       'Dell P2422H 24-inch Full HD IPS Monitor with USB-C connectivity.',
       'department', d.id, 15, 15
FROM departments d WHERE d.name = 'Finance';

-- ============================================================
-- Company-wide insurance
-- ============================================================

INSERT INTO entitlements (name, category, description, scope, department_id)
VALUES
  ('Health Insurance', 'insurance',
   'Comprehensive group medical + dental + OPD for employee and family. Sum insured ₹10,00,000.',
   'company_wide', NULL),
  ('House Insurance', 'insurance',
   'Corporate home and property protection covering fire, burglary, electrical, and storm damage.',
   'company_wide', NULL);

-- ============================================================
-- Company-wide perks
-- ============================================================

INSERT INTO entitlements (name, category, description, scope, department_id)
VALUES
  ('Gym Membership', 'perks',
   'Cultpass ELITE corporate — unlimited multi-city gym, swimming, yoga, and boxing access.',
   'company_wide', NULL),
  ('Meal Card', 'perks',
   'Tax-exempt ₹4,500/month food voucher on Zeta/Sodexo wallet. Recharges on 1st of each month.',
   'company_wide', NULL),
  ('Parking', 'perks',
   'Reserved basement parking slot with RFID access and direct elevator to office floors.',
   'company_wide', NULL);

DELETE FROM users
WHERE full_name  IN (
  'Bootstrap Admin',
  'New Super Admin',
  'Bhupendra'
);




INSERT INTO users (
  full_name, phone_number,
  password_hash,
  role, department_id,
  status, must_reset_password
) VALUES (
  'Bootstrap Admin', '+918009191175',
  crypt('Test@1234', gen_salt('bf', 12)),
  'superadmin_hr', NULL,
  'invited', true
);

INSERT INTO users (
  full_name,
  phone_number,
  password_hash,
  role,
  department_id,
  status,
  must_reset_password
) VALUES (
  'Ramesh Pokhriyal',
  '+918009191093',
  crypt('Test@1234', gen_salt('bf', 12)),
  'superadmin_hr',
  NULL,
  'active',
  true
);


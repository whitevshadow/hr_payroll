INSERT INTO compliance_schema.compliance_settings (id, tenant_id, client_id, state, pf_enabled, pf_employer_rate, pf_employee_rate, pf_wage_limit, esi_enabled, esi_employer_rate, esi_employee_rate, esi_wage_limit, pt_enabled, lwf_enabled, bonus_enabled, gratuity_enabled)
VALUES 
  (gen_random_uuid(), 'c302891a-dd2d-4b0e-9a2c-0ad65517d727', '30a3af2b-9bd3-4b12-9888-44273978a60e', 'KA', true, 12.00, 12.00, 15000.00, true, 3.25, 0.75, 21000.00, true, false, false, false),
  (gen_random_uuid(), 'c302891a-dd2d-4b0e-9a2c-0ad65517d727', '30a3af2b-9bd3-4b12-9888-44273978a60e', 'ALL', true, 12.00, 12.00, 15000.00, true, 3.25, 0.75, 21000.00, false, false, false, false)
ON CONFLICT DO NOTHING;

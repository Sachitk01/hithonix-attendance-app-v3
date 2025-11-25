-- 006_create_employee_hierarchy_v.sql
-- Denormalized employee → manager view for org graph queries

CREATE OR REPLACE VIEW employee_hierarchy_v AS
SELECT
    -- Employee side
    e.id                               AS employee_id,
    e.keka_id                          AS employee_keka_id,
    e.email                            AS employee_email,
    e.raw_keka_profile ->> 'displayName'
                                       AS employee_name,
    e.department                       AS employee_department,
    e.designation                      AS employee_designation,
    e.secondary_designation            AS employee_secondary_designation,
    e.location                         AS employee_location,
    e.employment_status                AS employee_employment_status,
    e.date_of_joining                  AS employee_date_of_joining,

    -- Manager side (may be NULL)
    m.id                               AS manager_employee_id,
    m.keka_id                          AS manager_keka_id,
    m.email                            AS manager_email,
    m.raw_keka_profile ->> 'displayName'
                                       AS manager_name,
    m.department                       AS manager_department,
    m.designation                      AS manager_designation,
    m.location                         AS manager_location

FROM employees e
LEFT JOIN employees m
    ON e.manager_employee_id = m.id;

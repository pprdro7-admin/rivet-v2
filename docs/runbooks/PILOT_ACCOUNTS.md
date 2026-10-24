# Pilot accounts (SDO Lapu-Lapu City, Toledo City, City of Naga, Cebu)

Everyone signs in at the same link: https://ro7-rivet.netlify.app

| Account | Role code | SDO code | School ID |
| --- | --- | --- | --- |
| Division Engineer | `de` | `LLC`, `TOL` or `NAG` | leave blank |
| Division Planning Officer | `dpo` | `LLC`, `TOL` or `NAG` | leave blank |
| School (School Head or staff) | `school` | the school's SDO | the 6-digit School ID |

## 1. Create the sign-in

Supabase > Authentication > Users > **Add user** > **Create new user**. Enter the email and a
password of letters and digits, and tick **Auto Confirm User**. Do not use "Send invitation".

## 2. Give the account its role (SQL Editor)

Copy one line per person, change the email, name, role, SDO and School ID, and run:

```sql
insert into profiles (id, email, full_name, role, sdo_code, school_id)
select id, email, 'Juan dela Cruz', 'de', 'TOL', null from auth.users where email = 'juan.delacruz@deped.gov.ph';

insert into profiles (id, email, full_name, role, sdo_code, school_id)
select id, email, 'Maria Santos', 'dpo', 'TOL', null from auth.users where email = 'maria.santos@deped.gov.ph';

insert into profiles (id, email, full_name, role, sdo_code, school_id)
select id, email, 'Luas ES (School Head)', 'school', 'TOL', '120730' from auth.users where email = 'luas.es@deped.gov.ph';
```

"INSERT 0 1" means it worked. "INSERT 0 0" means that email has no sign-in yet (step 1).

## Finding a School ID

```sql
select school_id, school_name, district from cycle_schools
where cycle_id = 'SY2025-2026' and sdo_code = 'TOL' order by school_name;
```

## Checking the accounts

```sql
select email, full_name, role, sdo_code, school_id, active from profiles
where sdo_code in ('LLC', 'TOL', 'NAG') order by sdo_code, role, email;
```

To stop an account: `update profiles set active = false where email = '...';`

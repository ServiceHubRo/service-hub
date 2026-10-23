-- Security audit (T42, 23 Oct 2026): /verifica no longer shows a report's whole license plate.
--
-- Report codes run in order (SH-2026-000001, -000002, ...) and verify_report answers anyone,
-- signed in or not: walking the codes listed the plate of every car with a report. The page now
-- shows the county letters and the last two characters ("BV •• •BC"): enough to match the report
-- someone holds against the car in front of them, not to collect plates. The rest is unchanged.

-- "BV 12 ABC" → "BV •• •BC", "B 123 ABC" → "B ••• •BC": the leading letters and the last two
-- letters or digits stay, every other letter or digit becomes "•", spaces and dashes stay.
create function public.mask_plate(p_plate text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_plate text := btrim(coalesce(p_plate, ''));
  v_lead int := char_length(substring(v_plate from '^[A-Za-z]*'));
  v_alnum int := char_length(regexp_replace(v_plate, '[^A-Za-z0-9]', '', 'g'));
  v_seen int := 0;
  v_out text := '';
  v_ch text;
begin
  if v_plate = '' then
    return null;
  end if;
  for i in 1 .. char_length(v_plate) loop
    v_ch := substr(v_plate, i, 1);
    if v_ch ~ '[A-Za-z0-9]' then
      v_seen := v_seen + 1;
      v_out := v_out || case when i <= v_lead or v_seen > v_alnum - 2 then v_ch else '•' end;
    else
      v_out := v_out || v_ch;
    end if;
  end loop;
  return v_out;
end
$$;
revoke execute on function public.mask_plate(text) from public, anon, authenticated;

create or replace function public.verify_report(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_digits text := regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
  v_code text;
  v public.history_reports%rowtype;
begin
  if v_digits !~ '^SH[0-9]{10}$' then
    return jsonb_build_object('found', false);
  end if;
  v_code := 'SH-' || substr(v_digits, 3, 4) || '-' || substr(v_digits, 7, 6);
  select * into v from public.history_reports
  where code = v_code and status in ('generated', 'void');
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'code', v.code,
    'make', v.car_snapshot->>'make',
    'model', v.car_snapshot->>'model',
    'plate', public.mask_plate(v.car_snapshot->>'plate'),
    'job_count', v.job_count,
    'period_from', v.period_from,
    'period_to', v.period_to,
    'generated_at', v.generated_at,
    'void', v.status = 'void');
end
$$;

update public.schema_version set version = 83;

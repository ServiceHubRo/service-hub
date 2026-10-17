-- T37c — A single quote line may say which part it is (Eduard, 17 Oct 2026): original part or
-- alternative part, with the alternative's brand, when there is no choice to offer (the original
-- part is not available, or only one is quoted). ARCHITECTURE §5.
--
-- · quote_items.variant (and brand) may be set on a plain line (option_group null); a group's
--   lines still always carry both.
-- · The composer sends {"name", "price", "part": "original" | "alternative", "brand"} for such a
--   line. total_sent counts every plain line (whatever its part) and the originals of the groups.

alter table public.quote_items drop constraint quote_items_variant_both;
alter table public.quote_items
  add constraint quote_items_group_variant_set check (option_group is null or variant is not null);

create or replace function public.clean_quote_lines(p_items jsonb)
returns table (pos int, name text, price numeric, option_group smallint, variant text, brand text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_line int := 0;
  v_pos int := 0;
  v_group smallint := 0;
  v_name text;
  v_alt jsonb;
  v_brand text;
  v_part text;
  v_total numeric := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform public.fail('quote_items_required');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform public.fail('quote_too_many_items', jsonb_build_object('limit', 50));
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    v_name := btrim(v_item->>'name');
    if coalesce(v_name, '') = '' or char_length(v_name) > 200
       or not public.is_quote_price(v_item->>'price') then
      perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
    end if;
    v_alt := v_item->'alt';
    if v_alt is null or jsonb_typeof(v_alt) = 'null' then
      -- A single line may say which part it is: "part": "original" | "alternative", with a brand.
      v_part := nullif(v_item->>'part', '');
      v_brand := nullif(btrim(v_item->>'brand'), '');
      if (v_part is not null and v_part not in ('original', 'alternative'))
         or (v_brand is not null and v_part is null) or char_length(v_brand) > 80 then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_item->>'price')::numeric(10,2);
      option_group := null; variant := v_part; brand := v_brand;
      v_total := v_total + price;
      return next;
    else
      v_brand := nullif(btrim(v_alt->>'brand'), '');
      if jsonb_typeof(v_alt) <> 'object' or not public.is_quote_price(v_alt->>'price')
         or char_length(v_brand) > 80 then
        perform public.fail('quote_item_invalid', jsonb_build_object('position', v_line));
      end if;
      v_group := v_group + 1;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_item->>'price')::numeric(10,2);
      option_group := v_group; variant := 'original'; brand := null;
      v_total := v_total + price;
      return next;
      v_pos := v_pos + 1;
      pos := v_pos; name := v_name; price := (v_alt->>'price')::numeric(10,2);
      option_group := v_group; variant := 'alternative'; brand := v_brand;
      return next;
    end if;
  end loop;
  if v_total <= 0 then
    perform public.fail('quote_total_zero');
  end if;
end
$$;

create or replace function public.insert_quote(p_booking public.bookings, p_items jsonb, p_note text)
returns public.quotes
language plpgsql
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(p_note), '');
  v_versions int;
  v_quote public.quotes%rowtype;
begin
  if char_length(v_note) > 2000 then
    perform public.fail('note_too_long');
  end if;
  select count(*) into v_versions from public.quotes where booking_id = p_booking.id;
  if v_versions >= public.app_limit('quote_versions_max', 20) then
    perform public.fail('limit_quote_versions', jsonb_build_object('limit', public.app_limit('quote_versions_max', 20)));
  end if;

  insert into public.quotes (booking_id, version, status, note, inspection_fee, total_sent, sent_at,
                             expires_at, sent_by)
  select p_booking.id, v_versions + 1, 'sent', v_note, s.inspection_fee,
         (select sum(l.price) from public.clean_quote_lines(p_items) l
          where l.option_group is null or l.variant = 'original'),
         now(), now() + make_interval(days => ps.quote_expiry_days), auth.uid()
  from public.shops s cross join public.platform_settings ps
  where s.id = p_booking.shop_id and ps.id = 1
  returning * into v_quote;

  insert into public.quote_items (quote_id, position, name, price, option_group, variant, brand)
  select v_quote.id, l.pos, l.name, l.price, l.option_group, l.variant, l.brand
  from public.clean_quote_lines(p_items) l;
  return v_quote;
end
$$;

update public.schema_version set version = 79;

-- Zones (Eduard, 8 Oct). Service-Hub opens county by county. A client whose position falls in a
-- county where it does not work yet sees "În curând și în zona ta" and can ask to be told: the
-- county (never the position), optionally the locality and the kinds of work they need. When the
-- county starts, each of them gets one email + push ("area_launched"), even if the app is gone.
--
-- A zone is one of the 41 counties or Bucharest. Its state is automatic by default (it works as
-- soon as one shop there is public) and the admin can force it on or off (Admin → Cont → Zone).
--
-- Also here: the catalog service "Constatare tehnică" for clients who cannot tell what is wrong
-- with the car, added to every shop that already does mechanical or electrical work.

-- ------------------------------------------------------------------------------------ the zones

create table public.service_areas (
  code text primary key check (code ~ '^[A-Z]{1,2}$'),
  name_ro text not null,
  name_en text not null,
  -- The county seat first, then other towns: [{"n": "Codlea", "lat": 45.70, "lng": 25.45}, …].
  -- A position belongs to the zone of its nearest town (the browser does the same, so the client's
  -- position never leaves the phone); a shop's typed city is matched against the names.
  anchors jsonb not null check (jsonb_typeof(anchors) = 'array' and jsonb_array_length(anchors) > 0),
  mode text not null default 'auto' check (mode in ('auto', 'on', 'off')),
  -- The first time the zone was seen working.
  launched_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.service_areas enable row level security;
-- No direct access: list_service_areas() for clients, admin_list_service_areas() for the admin.

insert into public.service_areas (code, name_ro, name_en, anchors) values
  ('AB', 'Alba', 'Alba', '[{"n": "Alba Iulia", "lat": 46.07, "lng": 23.57}, {"n": "Aiud", "lat": 46.31, "lng": 23.72}, {"n": "Sebeș", "lat": 45.96, "lng": 23.57}, {"n": "Blaj", "lat": 46.18, "lng": 23.92}, {"n": "Câmpeni", "lat": 46.36, "lng": 23.05}, {"n": "Zlatna", "lat": 46.11, "lng": 23.22}]'),
  ('AR', 'Arad', 'Arad', '[{"n": "Arad", "lat": 46.18, "lng": 21.31}, {"n": "Lipova", "lat": 46.09, "lng": 21.69}, {"n": "Ineu", "lat": 46.43, "lng": 21.84}, {"n": "Sebiș", "lat": 46.37, "lng": 22.12}, {"n": "Chișineu-Criș", "lat": 46.52, "lng": 21.52}]'),
  ('AG', 'Argeș', 'Argeș', '[{"n": "Pitești", "lat": 44.86, "lng": 24.87}, {"n": "Câmpulung", "lat": 45.27, "lng": 25.05}, {"n": "Curtea de Argeș", "lat": 45.14, "lng": 24.68}, {"n": "Mioveni", "lat": 44.96, "lng": 24.94}, {"n": "Costești", "lat": 44.67, "lng": 24.88}]'),
  ('BC', 'Bacău', 'Bacău', '[{"n": "Bacău", "lat": 46.57, "lng": 26.91}, {"n": "Onești", "lat": 46.25, "lng": 26.77}, {"n": "Moinești", "lat": 46.47, "lng": 26.49}, {"n": "Comănești", "lat": 46.42, "lng": 26.44}, {"n": "Buhuși", "lat": 46.72, "lng": 26.7}, {"n": "Podu Turcului", "lat": 46.2, "lng": 27.38}]'),
  ('BH', 'Bihor', 'Bihor', '[{"n": "Oradea", "lat": 47.05, "lng": 21.92}, {"n": "Salonta", "lat": 46.8, "lng": 21.66}, {"n": "Marghita", "lat": 47.35, "lng": 22.34}, {"n": "Beiuș", "lat": 46.67, "lng": 22.35}, {"n": "Aleșd", "lat": 47.06, "lng": 22.4}, {"n": "Ștei", "lat": 46.53, "lng": 22.46}]'),
  ('BN', 'Bistrița-Năsăud', 'Bistrița-Năsăud', '[{"n": "Bistrița", "lat": 47.13, "lng": 24.49}, {"n": "Năsăud", "lat": 47.28, "lng": 24.4}, {"n": "Beclean", "lat": 47.18, "lng": 24.18}, {"n": "Sângeorz-Băi", "lat": 47.37, "lng": 24.68}]'),
  ('BT', 'Botoșani', 'Botoșani', '[{"n": "Botoșani", "lat": 47.75, "lng": 26.67}, {"n": "Dorohoi", "lat": 47.96, "lng": 26.4}, {"n": "Darabani", "lat": 48.19, "lng": 26.59}, {"n": "Săveni", "lat": 47.95, "lng": 26.86}, {"n": "Flămânzi", "lat": 47.56, "lng": 26.87}]'),
  ('BV', 'Brașov', 'Brașov', '[{"n": "Brașov", "lat": 45.65, "lng": 25.61}, {"n": "Făgăraș", "lat": 45.84, "lng": 24.97}, {"n": "Codlea", "lat": 45.7, "lng": 25.45}, {"n": "Săcele", "lat": 45.62, "lng": 25.69}, {"n": "Rupea", "lat": 46.04, "lng": 25.22}, {"n": "Zărnești", "lat": 45.56, "lng": 25.32}]'),
  ('BR', 'Brăila', 'Brăila', '[{"n": "Brăila", "lat": 45.27, "lng": 27.96}, {"n": "Ianca", "lat": 45.13, "lng": 27.48}, {"n": "Însurăței", "lat": 44.92, "lng": 27.6}, {"n": "Făurei", "lat": 45.08, "lng": 27.27}]'),
  ('B', 'București', 'Bucharest', '[{"n": "București", "lat": 44.43, "lng": 26.1}, {"n": "Sector 1", "lat": 44.47, "lng": 26.06}, {"n": "Sector 2", "lat": 44.46, "lng": 26.13}, {"n": "Sector 6", "lat": 44.43, "lng": 26.02}, {"n": "Sector 5", "lat": 44.4, "lng": 26.06}, {"n": "Sector 4", "lat": 44.38, "lng": 26.12}, {"n": "Sector 3", "lat": 44.42, "lng": 26.16}]'),
  ('BZ', 'Buzău', 'Buzău', '[{"n": "Buzău", "lat": 45.15, "lng": 26.82}, {"n": "Râmnicu Sărat", "lat": 45.38, "lng": 27.06}, {"n": "Nehoiu", "lat": 45.42, "lng": 26.3}, {"n": "Pogoanele", "lat": 44.92, "lng": 27.0}, {"n": "Pătârlagele", "lat": 45.32, "lng": 26.36}]'),
  ('CS', 'Caraș-Severin', 'Caraș-Severin', '[{"n": "Reșița", "lat": 45.3, "lng": 21.89}, {"n": "Caransebeș", "lat": 45.42, "lng": 22.22}, {"n": "Oravița", "lat": 45.04, "lng": 21.69}, {"n": "Moldova Nouă", "lat": 44.73, "lng": 21.66}, {"n": "Băile Herculane", "lat": 44.88, "lng": 22.41}, {"n": "Bocșa", "lat": 45.37, "lng": 21.71}]'),
  ('CL', 'Călărași', 'Călărași', '[{"n": "Călărași", "lat": 44.2, "lng": 27.33}, {"n": "Oltenița", "lat": 44.09, "lng": 26.64}, {"n": "Lehliu-Gară", "lat": 44.44, "lng": 26.85}, {"n": "Budești", "lat": 44.24, "lng": 26.46}]'),
  ('CJ', 'Cluj', 'Cluj', '[{"n": "Cluj-Napoca", "lat": 46.77, "lng": 23.6}, {"n": "Turda", "lat": 46.57, "lng": 23.78}, {"n": "Dej", "lat": 47.14, "lng": 23.88}, {"n": "Câmpia Turzii", "lat": 46.55, "lng": 23.88}, {"n": "Gherla", "lat": 47.03, "lng": 23.91}, {"n": "Huedin", "lat": 46.87, "lng": 23.04}]'),
  ('CT', 'Constanța', 'Constanța', '[{"n": "Constanța", "lat": 44.17, "lng": 28.63}, {"n": "Medgidia", "lat": 44.25, "lng": 28.27}, {"n": "Mangalia", "lat": 43.82, "lng": 28.58}, {"n": "Cernavodă", "lat": 44.34, "lng": 28.03}, {"n": "Hârșova", "lat": 44.69, "lng": 27.95}, {"n": "Băneasa", "lat": 44.07, "lng": 27.7}, {"n": "Năvodari", "lat": 44.32, "lng": 28.61}]'),
  ('CV', 'Covasna', 'Covasna', '[{"n": "Sfântu Gheorghe", "lat": 45.86, "lng": 25.79}, {"n": "Târgu Secuiesc", "lat": 46.0, "lng": 26.14}, {"n": "Covasna", "lat": 45.85, "lng": 26.18}, {"n": "Baraolt", "lat": 46.08, "lng": 25.6}, {"n": "Întorsura Buzăului", "lat": 45.68, "lng": 26.03}]'),
  ('DB', 'Dâmbovița', 'Dâmbovița', '[{"n": "Târgoviște", "lat": 44.93, "lng": 25.46}, {"n": "Moreni", "lat": 44.98, "lng": 25.65}, {"n": "Pucioasa", "lat": 45.08, "lng": 25.43}, {"n": "Găești", "lat": 44.72, "lng": 25.32}, {"n": "Titu", "lat": 44.66, "lng": 25.57}, {"n": "Fieni", "lat": 45.13, "lng": 25.42}]'),
  ('DJ', 'Dolj', 'Dolj', '[{"n": "Craiova", "lat": 44.32, "lng": 23.8}, {"n": "Băilești", "lat": 44.03, "lng": 23.35}, {"n": "Calafat", "lat": 43.99, "lng": 22.94}, {"n": "Filiași", "lat": 44.55, "lng": 23.52}, {"n": "Segarcea", "lat": 44.1, "lng": 23.75}, {"n": "Bechet", "lat": 43.78, "lng": 23.96}]'),
  ('GL', 'Galați', 'Galați', '[{"n": "Galați", "lat": 45.44, "lng": 28.05}, {"n": "Tecuci", "lat": 45.85, "lng": 27.43}, {"n": "Târgu Bujor", "lat": 45.87, "lng": 27.91}, {"n": "Berești", "lat": 46.1, "lng": 27.89}]'),
  ('GR', 'Giurgiu', 'Giurgiu', '[{"n": "Giurgiu", "lat": 43.9, "lng": 25.97}, {"n": "Bolintin-Vale", "lat": 44.45, "lng": 25.76}, {"n": "Mihăilești", "lat": 44.33, "lng": 25.91}, {"n": "Ghimpați", "lat": 44.19, "lng": 25.79}]'),
  ('GJ', 'Gorj', 'Gorj', '[{"n": "Târgu Jiu", "lat": 45.04, "lng": 23.27}, {"n": "Motru", "lat": 44.8, "lng": 22.97}, {"n": "Rovinari", "lat": 44.91, "lng": 23.16}, {"n": "Novaci", "lat": 45.18, "lng": 23.67}, {"n": "Turceni", "lat": 44.67, "lng": 23.37}]'),
  ('HR', 'Harghita', 'Harghita', '[{"n": "Miercurea Ciuc", "lat": 46.36, "lng": 25.8}, {"n": "Odorheiu Secuiesc", "lat": 46.3, "lng": 25.3}, {"n": "Gheorgheni", "lat": 46.72, "lng": 25.59}, {"n": "Toplița", "lat": 46.92, "lng": 25.35}, {"n": "Cristuru Secuiesc", "lat": 46.29, "lng": 25.03}, {"n": "Bălan", "lat": 46.65, "lng": 25.81}]'),
  ('HD', 'Hunedoara', 'Hunedoara', '[{"n": "Deva", "lat": 45.88, "lng": 22.9}, {"n": "Hunedoara", "lat": 45.75, "lng": 22.9}, {"n": "Petroșani", "lat": 45.41, "lng": 23.37}, {"n": "Orăștie", "lat": 45.84, "lng": 23.2}, {"n": "Brad", "lat": 46.13, "lng": 22.79}, {"n": "Hațeg", "lat": 45.61, "lng": 22.95}, {"n": "Lupeni", "lat": 45.36, "lng": 23.23}]'),
  ('IL', 'Ialomița', 'Ialomița', '[{"n": "Slobozia", "lat": 44.56, "lng": 27.37}, {"n": "Urziceni", "lat": 44.72, "lng": 26.64}, {"n": "Fetești", "lat": 44.38, "lng": 27.83}, {"n": "Țăndărei", "lat": 44.64, "lng": 27.66}]'),
  ('IS', 'Iași', 'Iași', '[{"n": "Iași", "lat": 47.16, "lng": 27.59}, {"n": "Pașcani", "lat": 47.25, "lng": 26.72}, {"n": "Hârlău", "lat": 47.43, "lng": 26.9}, {"n": "Târgu Frumos", "lat": 47.21, "lng": 27.01}, {"n": "Podu Iloaiei", "lat": 47.22, "lng": 27.27}, {"n": "Răducăneni", "lat": 46.95, "lng": 27.93}]'),
  ('IF', 'Ilfov', 'Ilfov', '[{"n": "Buftea", "lat": 44.56, "lng": 25.95}, {"n": "Otopeni", "lat": 44.55, "lng": 26.07}, {"n": "Voluntari", "lat": 44.49, "lng": 26.19}, {"n": "Popești-Leordeni", "lat": 44.38, "lng": 26.17}, {"n": "Bragadiru", "lat": 44.37, "lng": 25.98}, {"n": "Chitila", "lat": 44.51, "lng": 25.98}, {"n": "Măgurele", "lat": 44.35, "lng": 26.03}, {"n": "Pantelimon", "lat": 44.45, "lng": 26.21}, {"n": "Snagov", "lat": 44.7, "lng": 26.17}, {"n": "Cernica", "lat": 44.42, "lng": 26.28}, {"n": "Ciorogârla", "lat": 44.44, "lng": 25.88}]'),
  ('MM', 'Maramureș', 'Maramureș', '[{"n": "Baia Mare", "lat": 47.66, "lng": 23.58}, {"n": "Sighetu Marmației", "lat": 47.93, "lng": 23.89}, {"n": "Borșa", "lat": 47.65, "lng": 24.66}, {"n": "Vișeu de Sus", "lat": 47.71, "lng": 24.43}, {"n": "Târgu Lăpuș", "lat": 47.45, "lng": 23.86}]'),
  ('MH', 'Mehedinți', 'Mehedinți', '[{"n": "Drobeta-Turnu Severin", "lat": 44.63, "lng": 22.66}, {"n": "Orșova", "lat": 44.72, "lng": 22.4}, {"n": "Strehaia", "lat": 44.62, "lng": 23.2}, {"n": "Vânju Mare", "lat": 44.43, "lng": 22.87}, {"n": "Baia de Aramă", "lat": 45.0, "lng": 22.81}]'),
  ('MS', 'Mureș', 'Mureș', '[{"n": "Târgu Mureș", "lat": 46.54, "lng": 24.56}, {"n": "Reghin", "lat": 46.78, "lng": 24.71}, {"n": "Sighișoara", "lat": 46.22, "lng": 24.79}, {"n": "Târnăveni", "lat": 46.33, "lng": 24.28}, {"n": "Luduș", "lat": 46.48, "lng": 24.1}, {"n": "Sovata", "lat": 46.6, "lng": 25.07}]'),
  ('NT', 'Neamț', 'Neamț', '[{"n": "Piatra Neamț", "lat": 46.93, "lng": 26.37}, {"n": "Roman", "lat": 46.92, "lng": 26.93}, {"n": "Târgu Neamț", "lat": 47.2, "lng": 26.36}, {"n": "Bicaz", "lat": 46.91, "lng": 26.09}, {"n": "Roznov", "lat": 46.84, "lng": 26.51}]'),
  ('OT', 'Olt', 'Olt', '[{"n": "Slatina", "lat": 44.43, "lng": 24.37}, {"n": "Caracal", "lat": 44.11, "lng": 24.35}, {"n": "Balș", "lat": 44.35, "lng": 24.1}, {"n": "Corabia", "lat": 43.78, "lng": 24.5}, {"n": "Scornicești", "lat": 44.57, "lng": 24.55}]'),
  ('PH', 'Prahova', 'Prahova', '[{"n": "Ploiești", "lat": 44.94, "lng": 26.02}, {"n": "Câmpina", "lat": 45.13, "lng": 25.73}, {"n": "Sinaia", "lat": 45.35, "lng": 25.55}, {"n": "Vălenii de Munte", "lat": 45.18, "lng": 26.04}, {"n": "Mizil", "lat": 45.0, "lng": 26.44}, {"n": "Băicoi", "lat": 45.04, "lng": 25.85}]'),
  ('SM', 'Satu Mare', 'Satu Mare', '[{"n": "Satu Mare", "lat": 47.79, "lng": 22.89}, {"n": "Carei", "lat": 47.69, "lng": 22.47}, {"n": "Negrești-Oaș", "lat": 47.87, "lng": 23.42}, {"n": "Tășnad", "lat": 47.48, "lng": 22.58}]'),
  ('SJ', 'Sălaj', 'Sălaj', '[{"n": "Zalău", "lat": 47.19, "lng": 23.06}, {"n": "Șimleu Silvaniei", "lat": 47.23, "lng": 22.8}, {"n": "Jibou", "lat": 47.26, "lng": 23.25}, {"n": "Cehu Silvaniei", "lat": 47.41, "lng": 23.18}]'),
  ('SB', 'Sibiu', 'Sibiu', '[{"n": "Sibiu", "lat": 45.79, "lng": 24.15}, {"n": "Mediaș", "lat": 46.16, "lng": 24.35}, {"n": "Cisnădie", "lat": 45.71, "lng": 24.15}, {"n": "Agnita", "lat": 45.97, "lng": 24.62}, {"n": "Avrig", "lat": 45.72, "lng": 24.38}, {"n": "Dumbrăveni", "lat": 46.23, "lng": 24.58}]'),
  ('SV', 'Suceava', 'Suceava', '[{"n": "Suceava", "lat": 47.65, "lng": 26.26}, {"n": "Fălticeni", "lat": 47.46, "lng": 26.3}, {"n": "Rădăuți", "lat": 47.84, "lng": 25.92}, {"n": "Câmpulung Moldovenesc", "lat": 47.53, "lng": 25.55}, {"n": "Vatra Dornei", "lat": 47.35, "lng": 25.36}, {"n": "Gura Humorului", "lat": 47.55, "lng": 25.89}]'),
  ('TR', 'Teleorman', 'Teleorman', '[{"n": "Alexandria", "lat": 43.97, "lng": 25.33}, {"n": "Roșiorii de Vede", "lat": 44.11, "lng": 24.99}, {"n": "Turnu Măgurele", "lat": 43.75, "lng": 24.87}, {"n": "Zimnicea", "lat": 43.66, "lng": 25.37}, {"n": "Videle", "lat": 44.28, "lng": 25.53}]'),
  ('TM', 'Timiș', 'Timiș', '[{"n": "Timișoara", "lat": 45.75, "lng": 21.23}, {"n": "Lugoj", "lat": 45.69, "lng": 21.9}, {"n": "Sânnicolau Mare", "lat": 46.07, "lng": 20.63}, {"n": "Jimbolia", "lat": 45.79, "lng": 20.72}, {"n": "Făget", "lat": 45.85, "lng": 22.18}, {"n": "Deta", "lat": 45.39, "lng": 21.22}]'),
  ('TL', 'Tulcea', 'Tulcea', '[{"n": "Tulcea", "lat": 45.18, "lng": 28.8}, {"n": "Măcin", "lat": 45.24, "lng": 28.14}, {"n": "Babadag", "lat": 44.89, "lng": 28.71}, {"n": "Isaccea", "lat": 45.27, "lng": 28.46}, {"n": "Sulina", "lat": 45.16, "lng": 29.65}]'),
  ('VS', 'Vaslui', 'Vaslui', '[{"n": "Vaslui", "lat": 46.64, "lng": 27.73}, {"n": "Bârlad", "lat": 46.23, "lng": 27.67}, {"n": "Huși", "lat": 46.67, "lng": 28.06}, {"n": "Negrești", "lat": 46.84, "lng": 27.44}, {"n": "Murgeni", "lat": 46.2, "lng": 28.02}]'),
  ('VL', 'Vâlcea', 'Vâlcea', '[{"n": "Râmnicu Vâlcea", "lat": 45.1, "lng": 24.37}, {"n": "Drăgășani", "lat": 44.66, "lng": 24.26}, {"n": "Horezu", "lat": 45.15, "lng": 24.0}, {"n": "Brezoi", "lat": 45.34, "lng": 24.25}, {"n": "Băbeni", "lat": 44.97, "lng": 24.23}, {"n": "Călimănești", "lat": 45.24, "lng": 24.34}]'),
  ('VN', 'Vrancea', 'Vrancea', '[{"n": "Focșani", "lat": 45.7, "lng": 27.18}, {"n": "Adjud", "lat": 46.1, "lng": 27.18}, {"n": "Mărășești", "lat": 45.88, "lng": 27.23}, {"n": "Panciu", "lat": 45.91, "lng": 27.09}, {"n": "Năruja", "lat": 45.83, "lng": 26.78}]')
;

-- A county or town name as typed, reduced to letters and digits: "Jud. Bistrița-Năsăud" →
-- "bistritanasaud", "Municipiul București" → "bucuresti".
create function public.area_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(
    regexp_replace(public.fold_text(btrim(coalesce(p, ''))),
                   '^(judetul|judet|jud\.?|municipiul|mun\.?|orasul|oras|comuna|com\.?)\s+', ''),
    '[^a-z0-9]', '', 'g'), '')
$$;

-- The zone of a point: the zone of its nearest town (flat-earth distance, enough at this scale).
-- Null outside Romania's box.
create function public.area_for_point(p_lat double precision, p_lng double precision)
returns text
language sql
stable
set search_path = ''
as $$
  select a.code
  from public.service_areas a
  cross join lateral jsonb_array_elements(a.anchors) t
  where p_lat between 43.5 and 48.4 and p_lng between 20.2 and 29.8
  order by power(p_lat - (t->>'lat')::double precision, 2)
         + power((p_lng - (t->>'lng')::double precision) * cos(radians(p_lat)), 2)
  limit 1
$$;

-- A shop's zone: the county it typed (name or two-letter code), else its city when that is a town
-- we know (or Bucharest and its sectors), else its coordinates, else none.
create function public.area_for_address(p_county text, p_city text, p_lat double precision, p_lng double precision)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_county text := public.area_key(p_county);
  v_city text := public.area_key(p_city);
  v_code text;
begin
  if v_county is not null then
    select a.code into v_code from public.service_areas a
    where public.area_key(a.name_ro) = v_county or public.area_key(a.name_en) = v_county
       or (char_length(v_county) <= 2 and lower(a.code) = v_county)
    limit 1;
    if v_code is not null then
      return v_code;
    end if;
  end if;
  if v_city is not null then
    if v_city like 'bucuresti%' or v_city ~ '^sector[1-6]$' then
      return 'B';
    end if;
    select a.code into v_code from public.service_areas a
    cross join lateral jsonb_array_elements(a.anchors) t
    where public.area_key(t->>'n') = v_city
    limit 1;
    if v_code is not null then
      return v_code;
    end if;
  end if;
  if p_lat is not null and p_lng is not null then
    return public.area_for_point(p_lat, p_lng);
  end if;
  return null;
end
$$;
revoke execute on function public.area_key(text), public.area_for_point(double precision, double precision),
  public.area_for_address(text, text, double precision, double precision) from public, anon, authenticated;

-- Every shop carries its zone, kept by a trigger (the browser has no grant on the column).
alter table public.shops add column area text references public.service_areas (code);
create index shops_area_idx on public.shops (area);

create function public.shops_set_area()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.area := public.area_for_address(new.county, new.city, new.latitude, new.longitude);
  return new;
end
$$;
create trigger shops_set_area before insert or update of county, city, latitude, longitude on public.shops
  for each row execute function public.shops_set_area();

-- The shops there now (without touching their updated_at).
alter table public.shops disable trigger shops_updated_at;
update public.shops set area = public.area_for_address(county, city, latitude, longitude);
alter table public.shops enable trigger shops_updated_at;

-- A zone works when the admin turned it on, or, left on automatic, when one of its shops is public.
create function public.area_live(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case a.mode
             when 'on' then true
             when 'off' then false
             else exists (select 1 from public.shops s where s.area = a.code and public.is_shop_public(s.id))
           end
    from public.service_areas a where a.code = p_code), false)
$$;
revoke execute on function public.area_live(text) from public, anon, authenticated;

-- For the client's card on Caută: every zone with its towns and whether it works now. The browser
-- finds the zone of the client's position itself.
create function public.list_service_areas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', a.code, 'name_ro', a.name_ro, 'name_en', a.name_en, 'anchors', a.anchors,
           'live', public.area_live(a.code)) order by a.name_ro collate "C"), '[]'::jsonb)
  from public.service_areas a
  where auth.uid() is not null
$$;
revoke execute on function public.list_service_areas() from public, anon;
grant execute on function public.list_service_areas() to authenticated;

-- ------------------------------------------------------------------------------------ the waiting list

create table public.area_waitlist (
  client_id uuid primary key references public.profiles (id) on delete cascade,
  area text not null references public.service_areas (code),
  locality text check (char_length(locality) between 1 and 80),
  categories text[] not null default '{}' check (cardinality(categories) <= 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The "area_launched" message went out (once per joining: a new county starts over).
  notified_at timestamptz
);
create index area_waitlist_area_idx on public.area_waitlist (area) where notified_at is null;
alter table public.area_waitlist enable row level security;
create policy area_waitlist_own on public.area_waitlist for select to authenticated using (client_id = auth.uid());
grant select on public.area_waitlist to authenticated;
-- Written only through join_area_waitlist / leave_area_waitlist.

-- "Anunță-mă": a client joins (or changes) their zone's list. Refused for a zone that already
-- works (area_live) — the client can book there.
create function public.join_area_waitlist(p_area text, p_locality text, p_categories text[], p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_me public.profiles%rowtype;
  v_locality text := nullif(btrim(coalesce(p_locality, '')), '');
  v_categories text[];
  v public.area_waitlist%rowtype;
  v_result jsonb;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    perform public.fail('not_signed_in');
  end if;
  if v_me.role <> 'client' or v_me.deleted_at is not null then
    perform public.fail('not_allowed');
  end if;
  v_seen := public.request_begin(p_request_id, 'join_area_waitlist');
  if v_seen is not null then
    return v_seen;
  end if;
  if not exists (select 1 from public.service_areas a where a.code = p_area) then
    perform public.fail('area_not_found');
  end if;
  if public.area_live(p_area) then
    perform public.fail('area_live');
  end if;
  if v_locality is not null and char_length(v_locality) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'locality'));
  end if;
  select coalesce(array_agg(c order by c), '{}') into v_categories
  from (select distinct unnest(coalesce(p_categories, '{}')) as c) x;
  if exists (select 1 from unnest(v_categories) c
             where not exists (select 1 from public.service_categories sc where sc.key = c and sc.enabled)) then
    perform public.fail('category_not_found');
  end if;

  insert into public.area_waitlist (client_id, area, locality, categories)
  values (v_me.id, p_area, v_locality, v_categories)
  on conflict (client_id) do update
    set area = excluded.area, locality = excluded.locality, categories = excluded.categories, updated_at = now(),
        notified_at = case when public.area_waitlist.area = excluded.area then public.area_waitlist.notified_at end
  returning * into v;

  v_result := to_jsonb(v) - 'client_id';
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.join_area_waitlist(text, text, text[], uuid) from public, anon;
grant execute on function public.join_area_waitlist(text, text, text[], uuid) to authenticated;

-- "Nu mai vreau": off the list.
create function public.leave_area_waitlist(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_n int;
begin
  if auth.uid() is null then
    perform public.fail('not_signed_in');
  end if;
  v_seen := public.request_begin(p_request_id, 'leave_area_waitlist');
  if v_seen is not null then
    return v_seen;
  end if;
  delete from public.area_waitlist where client_id = auth.uid();
  get diagnostics v_n = row_count;
  perform public.request_finish(p_request_id, jsonb_build_object('removed', v_n));
  return jsonb_build_object('removed', v_n);
end
$$;
revoke execute on function public.leave_area_waitlist(uuid) from public, anon;
grant execute on function public.leave_area_waitlist(uuid) to authenticated;

-- ------------------------------------------------------------------------------------ the zone starts

-- Every working zone (or only p_area): stamps launched_at the first time, then tells each client
-- still waiting there, once — push + email, in their language, after the quiet hours.
create function public.notify_area_launches(p_now timestamptz default now(), p_area text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  a record;
  w record;
  v_shops int;
  v_n int := 0;
begin
  for a in
    select * from public.service_areas
    where (p_area is null or code = p_area) and public.area_live(code)
    for update
  loop
    if a.launched_at is null then
      update public.service_areas set launched_at = p_now where code = a.code;
    end if;
    select count(*) into v_shops from public.shops s where s.area = a.code and public.is_shop_public(s.id);
    for w in
      select l.client_id from public.area_waitlist l
      join public.profiles p on p.id = l.client_id
      where l.area = a.code and l.notified_at is null
      for update of l
    loop
      update public.area_waitlist set notified_at = p_now where client_id = w.client_id;
      if exists (select 1 from public.profiles p
                 where p.id = w.client_id and p.deleted_at is null and not p.suspended) then
        perform public.notify_user(w.client_id, 'area_launched',
          jsonb_build_object('area', a.code, 'area_ro', a.name_ro, 'area_en', a.name_en, 'shops', v_shops),
          null, array['push', 'email']);
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.notify_area_launches(timestamptz, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------ admin

-- Admin → Cont → Zone: every zone with its state, shops and who waits (what they need, where).
create function public.admin_list_service_areas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'areas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', a.code, 'name_ro', a.name_ro, 'name_en', a.name_en, 'mode', a.mode,
        'live', public.area_live(a.code), 'launched_at', a.launched_at,
        'shops_public', (select count(*) from public.shops s where s.area = a.code and public.is_shop_public(s.id)),
        'shops_total', (select count(*) from public.shops s where s.area = a.code),
        'waiting', (select count(*) from public.area_waitlist l where l.area = a.code and l.notified_at is null),
        'notified', (select count(*) from public.area_waitlist l where l.area = a.code and l.notified_at is not null),
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object('key', x.c, 'count', x.n) order by x.n desc, x.c)
          from (select c, count(*) as n from public.area_waitlist l, unnest(l.categories) c
                where l.area = a.code and l.notified_at is null group by c) x), '[]'::jsonb),
        'localities', coalesce((
          select jsonb_agg(jsonb_build_object('name', x.name, 'count', x.n) order by x.n desc, x.name)
          from (select min(l.locality) as name, count(*) as n from public.area_waitlist l
                where l.area = a.code and l.notified_at is null and l.locality is not null
                group by public.area_key(l.locality) order by count(*) desc limit 5) x), '[]'::jsonb)
      ) order by a.name_ro collate "C")
      from public.service_areas a), '[]'::jsonb),
    -- Shops whose address names no zone we know: fix their county or city.
    'unplaced', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'city', s.city, 'county', s.county) order by s.name)
      from public.shops s where s.area is null), '[]'::jsonb));
end
$$;
revoke execute on function public.admin_list_service_areas() from public, anon;
grant execute on function public.admin_list_service_areas() to authenticated;

-- Automatic, forced on or forced off. A zone that works now tells its waiting clients at once.
create function public.admin_set_area_mode(p_code text, p_mode text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_old public.service_areas%rowtype;
  v public.service_areas%rowtype;
  v_notified int;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_set_area_mode');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_mode is null or p_mode not in ('auto', 'on', 'off') then
    perform public.fail('mode_invalid');
  end if;
  select * into v_old from public.service_areas where code = p_code for update;
  if not found then
    perform public.fail('area_not_found');
  end if;
  update public.service_areas set mode = p_mode where code = p_code returning * into v;
  if v.mode is distinct from v_old.mode then
    perform public.admin_audit_key('update_area', 'service_area', v.code,
      jsonb_build_object('area_mode', v_old.mode), jsonb_build_object('area_mode', v.mode));
  end if;
  v_notified := public.notify_area_launches(now(), p_code);
  v_result := jsonb_build_object('code', v.code, 'mode', v.mode, 'live', public.area_live(v.code), 'notified', v_notified);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;
revoke execute on function public.admin_set_area_mode(text, text, uuid) from public, anon;
grant execute on function public.admin_set_area_mode(text, text, uuid) to authenticated;

-- ------------------------------------------------------------------------------------ jobs and notifications

-- The zone's message is nobody's doing right now: it waits out the quiet hours.
create or replace function public.is_quiet_event(p_event text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_event in ('appointment_reminder', 'quote_expiring', 'quote_expired', 'doc_expiry', 'review_request',
    'service_due', 'trial_ending', 'shop_inactive', 'payment_failed', 'referral_reward',
    'referral_revoked', 'broadcast', 'tire_season', 'welcome', 'favorite_offer', 'booking_request_waiting',
    'monthly_report', 'company_problem', 'company_name_mismatch', 'company_hidden', 'company_ok',
    'request_expired', 'booking_followup', 'booking_auto_closed', 'booking_request_last_call', 'area_launched')
$$;

-- Hourly: as before, plus the zones that started working (automatic mode follows the shops).
create or replace function public.run_hourly_jobs(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Bucharest';
  v_result jsonb;
begin
  v_result := jsonb_build_object(
    'appointment_reminders', public.send_appointment_reminders(p_now),
    'digests', public.send_daily_digests(p_now),
    'trials_ended', public.end_expired_trials(p_now),
    'area_launches', public.notify_area_launches(p_now));
  if extract(hour from v_local) = 7 then
    v_result := v_result || jsonb_build_object(
      'trial_warnings', public.send_trial_warnings(p_now),
      'request_log_purged', public.purge_request_log(p_now));
  end if;
  -- The month's ANAF checks and the companies due again (verify-company, in the background), then
  -- an hour later the shops whose company stayed unconfirmed past the deadline leave the search.
  if extract(hour from v_local) = 6 then
    v_result := v_result || jsonb_build_object('company_checks', public.kick_company_checks());
  end if;
  if extract(hour from v_local) = 8 then
    v_result := v_result || jsonb_build_object(
      'company_hidden', public.enforce_company_deadlines(p_now),
      'admin_digest', public.send_admin_digest(p_now));
  end if;
  -- Every morning, the requests still waiting for an answer (Eduard, 3 oct).
  if extract(hour from v_local) = 9 then
    v_result := v_result || jsonb_build_object('requests_daily', public.send_request_daily_reminders(p_now));
  end if;
  if extract(hour from v_local) = 10 then
    v_result := v_result || jsonb_build_object(
      'doc_reminders', public.send_doc_expiry_reminders(v_local::date),
      'review_requests', public.send_review_requests(p_now),
      'service_reminders', public.send_service_reminders(v_local::date),
      'tire_season', public.send_tire_season_reminders(p_now),
      'welcome_tips', public.send_welcome_tips(p_now),
      'monthly_reports', public.send_monthly_reports(p_now),
      'booking_followups', public.send_booking_followups(p_now),
      'bookings_closed', public.close_stale_bookings(p_now));
  end if;
  return v_result;
end
$$;

-- Welcome tips: a client waiting for their zone has no shop to book yet, so "find a shop near you"
-- is left out; only the Garage tip (documents reminders) on day 14 for someone without a car.
create or replace function public.send_welcome_tips(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Europe/Bucharest')::date;
  r record;
  v_n int := 0;
begin
  for r in
    select p.id,
           case when v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 14 and 16 then 14 else 3 end as day,
           exists (select 1 from public.cars c where c.owner_id = p.id) as has_car,
           exists (select 1 from public.area_waitlist l where l.client_id = p.id and l.notified_at is null) as waiting
    from public.profiles p
    where p.role = 'client' and p.deleted_at is null and not p.suspended and p.app_tips
      and (v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 3 and 5
           or v_today - (p.created_at at time zone 'Europe/Bucharest')::date between 14 and 16)
      and not exists (select 1 from public.bookings b where b.client_id = p.id)
  loop
    if r.waiting and not (r.day = 14 and not r.has_car) then
      continue;
    end if;
    if public.send_tip(r.id, 'welcome', r.id || ':' || r.day, 'welcome',
                       jsonb_build_object('day', r.day, 'has_car', r.has_car), p_now) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end
$$;
revoke execute on function public.send_welcome_tips(timestamptz) from public, anon, authenticated;

-- "Datele mele": the export also holds the waiting-list entry.
alter function public.export_my_data() rename to export_my_data_base;
revoke execute on function public.export_my_data_base() from public, anon, authenticated;

create function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.export_my_data_base() || jsonb_build_object('area_waitlist', (
    select jsonb_build_object('area', a.name_ro, 'locality', l.locality, 'categories', to_jsonb(l.categories),
                              'created_at', l.created_at, 'notified_at', l.notified_at)
    from public.area_waitlist l join public.service_areas a on a.code = l.area
    where l.client_id = auth.uid()))
$$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- ------------------------------------------------------------------------------------ constatare tehnică

-- A client who cannot tell what is wrong books an inspection: the shop looks at the car and sends
-- the quote, as for any booking. First in "ITP & Verificări".
insert into public.services (id, category_key, icon, name_ro, name_en, position)
values ('constatare', 'cat_itp', 'Stethoscope', 'Constatare tehnică', 'Diagnostic inspection', 0)
on conflict (id) do nothing;

-- Offered from now on by every shop that already does mechanical or electrical work (the owner can
-- untick it in Setări → Servicii).
insert into public.shop_services (shop_id, service_id)
select distinct ss.shop_id, 'constatare'
from public.shop_services ss
join public.services s on s.id = ss.service_id
where s.category_key in ('cat_rev', 'cat_mot', 'cat_tra', 'cat_fra', 'cat_sus', 'cat_esa', 'cat_rac', 'cat_ele', 'cat_ev')
on conflict do nothing;

update public.schema_version set version = 64;

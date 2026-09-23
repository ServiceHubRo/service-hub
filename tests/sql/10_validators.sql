-- Validators (ARCHITECTURE §14): the SQL functions accept exactly the vectors the TypeScript
-- validators accept (tests/fixtures/validator-vectors.json), and the tables refuse invalid
-- values even when written straight to the database.
\set vectors `cat tests/fixtures/validator-vectors.json`
begin;
select set_config('test.vectors', :'vectors', true);

do $$
declare
  v jsonb := current_setting('test.vectors')::jsonb;
  x text;
begin
  for x in select jsonb_array_elements_text(v->'cui'->'valid') loop
    perform test.ok(public.is_valid_cui(x), 'CUI should be valid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'cui'->'invalid') loop
    perform test.ok(not public.is_valid_cui(x), 'CUI should be invalid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'regcom'->'valid') loop
    perform test.ok(public.is_valid_regcom(x), 'Trade Register should be valid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'regcom'->'invalid') loop
    perform test.ok(not public.is_valid_regcom(x), 'Trade Register should be invalid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'iban'->'valid') loop
    perform test.ok(public.is_valid_iban(x), 'IBAN should be valid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'iban'->'invalid') loop
    perform test.ok(not public.is_valid_iban(x), 'IBAN should be invalid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'postal_code'->'valid') loop
    perform test.ok(public.is_valid_postal_code(x), 'Postal code should be valid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'postal_code'->'invalid') loop
    perform test.ok(not public.is_valid_postal_code(x), 'Postal code should be invalid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'vin'->'valid') loop
    perform test.ok(public.is_valid_vin(x), 'VIN should be valid: ' || x);
  end loop;
  for x in select jsonb_array_elements_text(v->'vin'->'invalid') loop
    perform test.ok(not public.is_valid_vin(x), 'VIN should be invalid: ' || x);
  end loop;
  perform test.ok(not public.is_valid_cui(null), 'null CUI is not valid');
  perform test.ok(not public.is_valid_iban(null), 'null IBAN is not valid');
end
$$;

-- Constraints use the validators; data is stored normalized.
select test.make_world();

select test.fails($$update public.shop_billing set vat_id = '14872302' where shop_id = test.id('shop1')$$,
  'shop_billing_vat_id_check', 'invalid CUI refused by the table');
select test.fails($$update public.shop_billing set iban = 'RO49AAAA1B31007593840001' where shop_id = test.id('shop1')$$,
  'shop_billing_iban_check', 'invalid IBAN refused by the table');
select test.fails($$update public.shop_billing set reg_com = 'J08-1234-2015' where shop_id = test.id('shop1')$$,
  'shop_billing_reg_com_check', 'invalid Trade Register refused by the table');
select test.fails($$update public.shops set postal_code = '5000' where id = test.id('shop1')$$,
  'shops_postal_code_check', 'invalid postal code refused by the table');
select test.fails($$update public.cars set vin = 'WVWZZZAUZGW12345O' where id = test.id('car_a')$$,
  'cars_vin_check', 'invalid VIN refused by the table');

update public.shop_billing
  set vat_id = 'ro 14872301', iban = 'ro49 aaaa 1b31 0075 9384 0000', reg_com = 'j08/1245/2009',
      billing_email = '  Facturi@Atelier.RO '
  where shop_id = test.id('shop1');
select test.eq(vat_id, 'RO14872301', 'CUI stored normalized'),
       test.eq(iban, 'RO49AAAA1B31007593840000', 'IBAN stored normalized'),
       test.eq(reg_com, 'J08/1245/2009', 'Trade Register stored normalized'),
       test.eq(billing_email, 'facturi@atelier.ro', 'billing email stored lower-case')
from public.shop_billing where shop_id = test.id('shop1');

update public.cars set vin = 'wvwzzz auzgw123456', plate = 'bv-12 abc' where id = test.id('car_a');
select test.eq(vin, 'WVWZZZAUZGW123456', 'VIN stored upper-case without spaces'),
       test.eq(plate, 'bv-12 abc', 'plate stored as typed'),
       test.eq(plate_norm, 'BV12ABC', 'plate_norm upper-case without spaces or dashes')
from public.cars where id = test.id('car_a');

rollback;

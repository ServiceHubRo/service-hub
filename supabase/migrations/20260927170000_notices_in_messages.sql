-- Notices from the Service-Hub team live in Mesaje (T20a, Eduard after testing): at the top of the
-- list, marked new until read, instead of banners on the screens. So the choice of where a notice
-- shows (migration notice_placement, never merged to main) goes away again: the column and the
-- extra parameter of admin_send_notice are removed, the function is the T16b one.

drop function public.admin_send_notice(text, text, text, text, text, text, boolean, uuid, text);

alter table public.notices drop column placement;

-- Sends a notice: it appears in Mesaje for its audience (marked new until read), and with p_push a
-- push notification goes to everyone in it who has push on a device. English left empty = the
-- Romanian text. Logged with its audience and content.
create function public.admin_send_notice(p_audience text, p_city text, p_title_ro text, p_body_ro text,
                                         p_title_en text, p_body_en text, p_push boolean, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen jsonb;
  v_city text := public.clean_text(p_city);
  v_title_ro text := public.clean_text(p_title_ro);
  v_body_ro text := public.clean_text(p_body_ro);
  v_title_en text := coalesce(public.clean_text(p_title_en), public.clean_text(p_title_ro));
  v_body_en text := coalesce(public.clean_text(p_body_en), public.clean_text(p_body_ro));
  v public.notices%rowtype;
  v_recipients int;
  v_push int := 0;
  v_result jsonb;
begin
  perform public.require_admin();
  v_seen := public.request_begin(p_request_id, 'admin_send_notice');
  if v_seen is not null then
    return v_seen;
  end if;
  if p_audience is null or p_audience not in ('shops', 'clients', 'all') then
    perform public.fail('audience_invalid');
  end if;
  if char_length(v_city) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'city'));
  end if;
  if v_title_ro is null or char_length(v_title_ro) > 80 or char_length(v_title_en) > 80 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'notice_title'));
  end if;
  if v_body_ro is null or char_length(v_body_ro) > 500 or char_length(v_body_en) > 500 then
    perform public.fail('field_invalid', jsonb_build_object('field', 'notice_body'));
  end if;

  select count(*) into v_recipients from public.profiles p
  where p.role in ('client', 'shop') and public.in_notice_audience(p.id, p_audience, v_city);
  if v_recipients = 0 then
    perform public.fail('no_recipients');
  end if;

  insert into public.notices (audience, city, title_ro, body_ro, title_en, body_en, send_push, created_by, recipients)
  values (p_audience, v_city, v_title_ro, v_body_ro, v_title_en, v_body_en, coalesce(p_push, false), auth.uid(),
          v_recipients)
  returning * into v;

  if coalesce(p_push, false) then
    insert into public.notification_events (user_id, event, params, channels)
    select p.id, 'broadcast',
           jsonb_build_object('notice_id', v.id, 'title_ro', v.title_ro, 'body_ro', v.body_ro,
                              'title_en', v.title_en, 'body_en', v.body_en),
           array['push']
    from public.profiles p
    where p.role in ('client', 'shop') and public.in_notice_audience(p.id, p_audience, v_city)
      and exists (select 1 from public.push_subscriptions ps where ps.user_id = p.id);
    get diagnostics v_push = row_count;
    update public.notices set push_recipients = v_push where id = v.id returning * into v;
  end if;

  perform public.admin_audit('send_notice', 'notice', v.id, null, jsonb_build_object(
    'audience', v.audience, 'city', v.city, 'title_ro', v.title_ro, 'body_ro', v.body_ro,
    'title_en', v.title_en, 'body_en', v.body_en, 'send_push', v.send_push,
    'recipients', v.recipients, 'push_recipients', v.push_recipients));
  v_result := to_jsonb(v);
  perform public.request_finish(p_request_id, v_result);
  return v_result;
end
$$;

grant execute on function public.admin_send_notice(text, text, text, text, text, text, boolean, uuid) to authenticated;

update public.schema_version set version = 37;

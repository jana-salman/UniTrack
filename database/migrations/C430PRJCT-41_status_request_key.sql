begin;

alter table public.equipment_status_history
add column if not exists request_key text;

create unique index if not exists
equipment_status_history_request_key_unique
on public.equipment_status_history (request_key)
where request_key is not null;

commit;

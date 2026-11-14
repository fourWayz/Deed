-- Deed indexer schema. `events` is the only source of truth; everything else is a view over it,
-- so a rollback (reorg) is just deleting rows and nothing derived can drift.

create table if not exists events (
  chain_id      integer     not null,
  version       text        not null,           -- v2, v3
  block_number  bigint      not null,
  block_hash    text        not null,
  block_time    timestamptz not null,
  tx_hash       text        not null,
  log_index     integer     not null,
  address       text        not null,           -- emitting contract, lowercase
  contract      text        not null,           -- DeedNFT, DeedFactory, DeedMarket, RescueAuction, PositionVault
  name          text        not null,
  token_id      numeric(78,0),
  args          jsonb       not null,
  volume        numeric(78,0) not null default 0, -- MUSD (18 decimals) that changed hands in this event
  fee           numeric(78,0) not null default 0, -- MUSD fee taken by the protocol in this event
  primary key (chain_id, tx_hash, log_index)
);
create index if not exists events_order    on events (version, block_number, log_index);
create index if not exists events_name     on events (contract, name, version);
create index if not exists events_token    on events (version, token_id);
create index if not exists events_address  on events (address);

-- addresses that took part in an event, with the role they played
create table if not exists event_wallets (
  chain_id  integer not null,
  tx_hash   text    not null,
  log_index integer not null,
  wallet    text    not null,
  role      text    not null,
  primary key (chain_id, tx_hash, log_index, wallet, role),
  foreign key (chain_id, tx_hash, log_index) references events (chain_id, tx_hash, log_index) on delete cascade
);
create index if not exists event_wallets_wallet on event_wallets (wallet);

-- block hashes seen per version, used to notice a reorg after a restart
create table if not exists blocks (
  version text   not null,
  number  bigint not null,
  hash    text   not null,
  primary key (version, number)
);

-- one cursor per deployment version
create table if not exists sync_state (
  version    text primary key,
  block      bigint not null,
  hash       text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- views

create or replace view v_listings as
select
  l.version,
  l.token_id,
  (l.args->>'seller')                    as seller,
  (l.args->>'price')::numeric            as price,
  (l.args->>'expiry')::numeric           as expiry,
  (l.args->>'minICR')::numeric           as min_icr,
  (l.args->>'snapshot')                  as snapshot,
  l.block_number, l.log_index, l.tx_hash, l.block_time as listed_at,
  case t.name when 'Sold' then 'sold' when 'Cancelled' then 'cancelled' else 'active' end as status,
  t.block_time as closed_at,
  t.tx_hash    as closed_tx,
  (t.args->>'buyer')                     as buyer
from events l
left join lateral (
  select e.* from events e
  where e.contract = 'DeedMarket' and e.name in ('Sold', 'Cancelled')
    and e.version = l.version and e.token_id = l.token_id
    and (e.block_number, e.log_index) > (l.block_number, l.log_index)
  order by e.block_number, e.log_index limit 1
) t on true
where l.contract = 'DeedMarket' and l.name = 'Listed';

create or replace view v_auctions as
select
  a.version,
  a.token_id,
  (a.args->>'seller')                    as seller,
  (a.args->>'byOwner')::boolean          as by_owner,
  (a.args->>'startPrice')::numeric       as start_price,
  (a.args->>'floorPrice')::numeric       as floor_price,
  (a.args->>'duration')::numeric         as duration,
  a.block_number, a.log_index, a.tx_hash, a.block_time as started_at,
  case t.name when 'Won' then 'won' when 'Ended' then 'ended' else 'open' end as status,
  t.block_time as closed_at,
  t.tx_hash    as closed_tx,
  (t.args->>'winner')                    as winner,
  (t.args->>'price')::numeric            as final_price,
  (t.args->>'topUp')::numeric            as top_up
from events a
left join lateral (
  select e.* from events e
  where e.contract = 'RescueAuction' and e.name in ('Won', 'Ended')
    and e.version = a.version and e.token_id = a.token_id
    and (e.block_number, e.log_index) > (a.block_number, a.log_index)
  order by e.block_number, e.log_index limit 1
) t on true
where a.contract = 'RescueAuction' and a.name = 'Started';

-- one row per position. Owner is the last ERC-721 Transfer. Collateral and debt come from the vault's
-- own events: they track what was deposited, withdrawn and repaid through the vault, and they do not
-- include interest, borrowing fees, redemptions or liquidations (those happen inside Mezo).
create or replace view v_positions as
select
  c.version,
  c.token_id,
  (c.args->>'vault')                     as vault,
  (c.args->>'owner')                     as creator,
  own.owner                              as owner,
  (c.args->>'collateral')::numeric
    + coalesce(v.added, 0) - coalesce(v.withdrawn, 0)                    as collateral,
  (c.args->>'debt')::numeric + coalesce(v.borrowed, 0) - coalesce(v.repaid, 0) as debt_principal,
  (c.args->>'collateral')::numeric                                       as opened_collateral,
  (c.args->>'debt')::numeric                                             as opened_debt,
  v.closed,
  case
    when v.closed then 'closed'
    when exists (select 1 from v_auctions a where a.version = c.version and a.token_id = c.token_id and a.status = 'open') then 'auction'
    when exists (select 1 from v_listings l where l.version = c.version and l.token_id = c.token_id and l.status = 'active') then 'listed'
    else 'held'
  end                                    as status,
  c.block_number as created_block, c.tx_hash as created_tx, c.block_time as created_at
from events c
left join lateral (
  select e.args->>'to' as owner from events e
  where e.contract = 'DeedNFT' and e.name = 'Transfer' and e.version = c.version and e.token_id = c.token_id
  order by e.block_number desc, e.log_index desc limit 1
) own on true
left join lateral (
  select
    sum((e.args->>'amount')::numeric) filter (where e.name = 'CollateralAdded') as added,
    sum((e.args->>'amount')::numeric) filter (where e.name = 'Withdrawn')       as withdrawn,
    sum((e.args->>'amount')::numeric) filter (where e.name = 'Repaid')          as repaid,
    sum((e.args->>'amount')::numeric) filter (where e.name = 'Borrowed')        as borrowed,
    bool_or(e.name = 'Closed')                                                  as closed
  from events e
  where e.contract = 'PositionVault' and e.address = (c.args->>'vault') and e.version = c.version
) v on true
where c.contract = 'DeedFactory' and c.name = 'PositionCreated';

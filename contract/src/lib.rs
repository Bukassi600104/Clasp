#![no_std]
//! Clasp escrow contract — the non-custodial trust layer for Pi commerce.
//!
//! Mirrors PRD §8 exactly. No admin keys, no upgrade key, no pause key, no
//! operator withdrawal beyond the automatic fee split (§8.4.1). Funds only ever
//! sit inside this contract; the operator wallet receives fees only, paid by the
//! contract on success. Forfeited bonds are burned to a provably unspendable
//! address, never collected (§2.6, §8.1 NUCLEAR).
//!
//! Amounts are i128 in the token's smallest unit (stroops; 1 Pi = 10_000_000).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, BytesN, Env,
};

// ── Parameters (PRD §8.2), in stroops ────────────────────────────────────────
const PI: i128 = 10_000_000; // 1 Pi = 10^7 stroops
const AMOUNT_FLOOR: i128 = 1 * PI;
const AMOUNT_CAP: i128 = 50 * PI;
const BOND_FLOOR: i128 = 1 * PI;
const FEE_MIN: i128 = PI / 20; // 0.05 Pi
const BOND_BPS: i128 = 1500; // 15%
const FEE_BPS: i128 = 150; // 1.5%
const BPS_DEN: i128 = 10_000;

const FUNDING_WINDOW: u64 = 24 * 3600;
const SHIP_MIN: u64 = 24 * 3600;
const SHIP_MAX: u64 = 14 * 24 * 3600;
const INSPECT_MIN: u64 = 24 * 3600;
const INSPECT_MAX: u64 = 7 * 24 * 3600;
const SETTLEMENT_WINDOW: u64 = 7 * 24 * 3600;
const SETTLEMENT_STEP: u32 = 5;

// Storage TTL bumps (~30 days of ledgers at 5s each) so live trades never expire.
const BUMP_AMOUNT: u32 = 535_000;
const BUMP_THRESHOLD: u32 = 518_000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum State {
    Created,
    Funded,
    Shipped,
    Disputed,
    Completed,
    Settled,
    Refunded,
    Cancelled,
    Nuclear,
}

#[contracttype]
#[derive(Clone)]
pub struct Trade {
    pub seller: Address,
    pub buyer: Option<Address>,
    pub amount: i128,
    pub buyer_bond: i128,
    pub seller_bond: i128,
    pub ship_window: u64,
    pub inspect_window: u64,
    pub state: State,
    pub funding_deadline: u64,
    pub ship_deadline: u64,
    pub inspect_deadline: u64,
    pub settlement_deadline: u64,
    pub memo_hash: BytesN<32>,
    // All-zero hash means "no evidence yet" (set on mark_shipped).
    pub evidence_hash: BytesN<32>,
    // Open settlement proposal: proposer = Some(addr), else None. pct in 5% steps.
    pub proposal_by: Option<Address>,
    pub proposal_pct: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub fee_account: Address, // operator fee wallet — receives fees only
    pub burn_account: Address, // provably unspendable sink (§8.4.10)
    pub token: Address,       // Pi token contract (SAC)
}

#[contracttype]
pub enum DataKey {
    Config,
    Counter,
    Trade(u64),
}

#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    TradeNotFound = 3,
    WrongState = 4,
    Unauthorized = 5,
    DeadlinePassed = 6,
    DeadlineNotReached = 7,
    AmountOutOfRange = 8,
    WindowOutOfRange = 9,
    BadProposal = 10,
    SelfFunding = 11,
    NoOpenProposal = 12,
}

#[contract]
pub struct ClaspEscrow;

#[contractimpl]
impl ClaspEscrow {
    /// One-time configuration. Sets the fee/burn/token addresses. There is no
    /// admin role beyond this — none of these can be changed afterward, and the
    /// contract has no upgrade/pause/withdraw capability (§8.4.1).
    pub fn initialize(env: Env, fee_account: Address, burn_account: Address, token: Address) {
        if env.storage().instance().has(&DataKey::Config) {
            panic_with_error!(&env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(
            &DataKey::Config,
            &Config { fee_account, burn_account, token },
        );
        env.storage().instance().set(&DataKey::Counter, &0u64);
    }

    /// `create_trade` — locks the seller bond, returns the trade id (§8.3).
    pub fn create_trade(
        env: Env,
        seller: Address,
        amount: i128,
        ship_window: u64,
        inspect_window: u64,
        memo_hash: BytesN<32>,
    ) -> u64 {
        seller.require_auth();
        if amount < AMOUNT_FLOOR || amount > AMOUNT_CAP {
            panic_with_error!(&env, Error::AmountOutOfRange);
        }
        if ship_window < SHIP_MIN || ship_window > SHIP_MAX
            || inspect_window < INSPECT_MIN || inspect_window > INSPECT_MAX
        {
            panic_with_error!(&env, Error::WindowOutOfRange);
        }
        let cfg = Self::config(&env);
        let bond = bond_for(amount);
        let now = env.ledger().timestamp();

        // Effects before interactions (§8.4.2): reserve id + write, then pull funds.
        let id: u64 = env.storage().instance().get(&DataKey::Counter).unwrap_or(0);
        env.storage().instance().set(&DataKey::Counter, &(id + 1));

        let trade = Trade {
            seller: seller.clone(),
            buyer: None,
            amount,
            buyer_bond: bond,
            seller_bond: bond,
            ship_window,
            inspect_window,
            state: State::Created,
            funding_deadline: now + FUNDING_WINDOW,
            ship_deadline: 0,
            inspect_deadline: 0,
            settlement_deadline: 0,
            memo_hash,
            evidence_hash: BytesN::from_array(&env, &[0u8; 32]),
            proposal_by: None,
            proposal_pct: 0,
        };
        Self::put(&env, id, &trade);

        token::Client::new(&env, &cfg.token).transfer(
            &seller,
            &env.current_contract_address(),
            &bond,
        );
        env.events().publish((symbol_short!("created"), id), (seller, amount));
        id
    }

    /// `fund_trade` — buyer locks price + buyer bond (§8.3).
    pub fn fund_trade(env: Env, buyer: Address, id: u64) {
        buyer.require_auth();
        let mut t = Self::load(&env, id);
        if t.state != State::Created {
            panic_with_error!(&env, Error::WrongState);
        }
        if env.ledger().timestamp() > t.funding_deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        if buyer == t.seller {
            panic_with_error!(&env, Error::SelfFunding);
        }
        let cfg = Self::config(&env);
        let now = env.ledger().timestamp();
        t.buyer = Some(buyer.clone());
        t.state = State::Funded;
        t.ship_deadline = now + t.ship_window;
        let lock = t.amount + t.buyer_bond;
        Self::put(&env, id, &t);

        token::Client::new(&env, &cfg.token).transfer(
            &buyer,
            &env.current_contract_address(),
            &lock,
        );
        env.events().publish((symbol_short!("funded"), id), buyer);
    }

    /// `cancel_unfunded` — seller anytime before funding, or anyone after the
    /// funding window passes; seller bond returned (§8.3).
    pub fn cancel_unfunded(env: Env, caller: Address, id: u64) {
        caller.require_auth();
        let mut t = Self::load(&env, id);
        if t.state != State::Created {
            panic_with_error!(&env, Error::WrongState);
        }
        let now = env.ledger().timestamp();
        if caller != t.seller && now <= t.funding_deadline {
            panic_with_error!(&env, Error::Unauthorized);
        }
        t.state = State::Cancelled;
        Self::put(&env, id, &t);
        Self::pay(&env, &t.seller, t.seller_bond);
        env.events().publish((symbol_short!("cancelled"), id), ());
    }

    /// `mark_shipped` — seller only, within ship window, evidence required (§8.3).
    pub fn mark_shipped(env: Env, id: u64, evidence_hash: BytesN<32>) {
        let mut t = Self::load(&env, id);
        t.seller.require_auth();
        if t.state != State::Funded {
            panic_with_error!(&env, Error::WrongState);
        }
        if env.ledger().timestamp() > t.ship_deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        let now = env.ledger().timestamp();
        t.state = State::Shipped;
        t.evidence_hash = evidence_hash;
        t.inspect_deadline = now + t.inspect_window;
        Self::put(&env, id, &t);
        env.events().publish((symbol_short!("shipped"), id), ());
    }

    /// `confirm_receipt` — buyer only; executes COMPLETED payout (§8.3).
    pub fn confirm_receipt(env: Env, id: u64) {
        let mut t = Self::load(&env, id);
        let buyer = Self::buyer(&env, &t);
        buyer.require_auth();
        if t.state != State::Shipped {
            panic_with_error!(&env, Error::WrongState);
        }
        Self::complete(&env, id, &mut t);
    }

    /// `open_dispute` — buyer only, within inspection window (§8.3).
    pub fn open_dispute(env: Env, id: u64) {
        let mut t = Self::load(&env, id);
        let buyer = Self::buyer(&env, &t);
        buyer.require_auth();
        if t.state != State::Shipped {
            panic_with_error!(&env, Error::WrongState);
        }
        if env.ledger().timestamp() > t.inspect_deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        t.state = State::Disputed;
        t.settlement_deadline = env.ledger().timestamp() + SETTLEMENT_WINDOW;
        Self::put(&env, id, &t);
        env.events().publish((symbol_short!("disputed"), id), ());
    }

    /// `propose_settlement` — either party while DISPUTED, splits in 5% steps (§8.3).
    pub fn propose_settlement(env: Env, caller: Address, id: u64, seller_pct: u32) {
        caller.require_auth();
        let mut t = Self::load(&env, id);
        if t.state != State::Disputed {
            panic_with_error!(&env, Error::WrongState);
        }
        if env.ledger().timestamp() > t.settlement_deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        let buyer = Self::buyer(&env, &t);
        if caller != t.seller && caller != buyer {
            panic_with_error!(&env, Error::Unauthorized);
        }
        if seller_pct > 100 || seller_pct % SETTLEMENT_STEP != 0 {
            panic_with_error!(&env, Error::BadProposal);
        }
        t.proposal_by = Some(caller);
        t.proposal_pct = seller_pct;
        Self::put(&env, id, &t);
        env.events().publish((symbol_short!("proposed"), id), seller_pct);
    }

    /// `accept_settlement` — the counterparty accepts; executes SETTLED payout (§8.3).
    pub fn accept_settlement(env: Env, caller: Address, id: u64) {
        caller.require_auth();
        let mut t = Self::load(&env, id);
        if t.state != State::Disputed {
            panic_with_error!(&env, Error::WrongState);
        }
        let proposer = match t.proposal_by.clone() {
            Some(p) => p,
            None => panic_with_error!(&env, Error::NoOpenProposal),
        };
        let buyer = Self::buyer(&env, &t);
        if caller != t.seller && caller != buyer {
            panic_with_error!(&env, Error::Unauthorized);
        }
        // The counterparty (not the proposer) must accept (§8.4.5).
        if caller == proposer {
            panic_with_error!(&env, Error::Unauthorized);
        }
        let pct = t.proposal_pct;
        Self::settle(&env, id, &mut t, pct);
    }

    /// `claim_timeout` — permissionless (§8.4.4). Executes whichever deadline
    /// transition is due: REFUNDED, COMPLETED-via-silence, NUCLEAR, or expiry-cancel.
    pub fn claim_timeout(env: Env, id: u64) {
        let mut t = Self::load(&env, id);
        let now = env.ledger().timestamp();
        match t.state {
            State::Created if now > t.funding_deadline => {
                t.state = State::Cancelled;
                Self::put(&env, id, &t);
                Self::pay(&env, &t.seller, t.seller_bond);
                env.events().publish((symbol_short!("cancelled"), id), ());
            }
            State::Funded if now > t.ship_deadline => Self::refund(&env, id, &mut t),
            State::Shipped if now > t.inspect_deadline => Self::complete(&env, id, &mut t),
            State::Disputed if now > t.settlement_deadline => Self::nuclear(&env, id, &mut t),
            _ => panic_with_error!(&env, Error::DeadlineNotReached),
        }
    }

    // ── Read functions ──
    pub fn get_trade(env: Env, id: u64) -> Trade {
        Self::load(&env, id)
    }
    pub fn get_state(env: Env, id: u64) -> State {
        Self::load(&env, id).state
    }
    pub fn get_config(env: Env) -> Config {
        Self::config(&env)
    }

    // ── Payout executors (state finalized before transfers — §8.4.2) ──
    fn complete(env: &Env, id: u64, t: &mut Trade) {
        let cfg = Self::config(env);
        let fee = fee_for(t.amount);
        let buyer = Self::buyer(env, t);
        t.state = State::Completed;
        Self::put(env, id, t);
        Self::pay(env, &t.seller, t.amount - fee + t.seller_bond);
        Self::pay(env, &buyer, t.buyer_bond);
        Self::pay(env, &cfg.fee_account, fee);
        env.events().publish((symbol_short!("completed"), id), fee);
    }

    fn refund(env: &Env, id: u64, t: &mut Trade) {
        let buyer = Self::buyer(env, t);
        t.state = State::Refunded;
        Self::put(env, id, t);
        Self::pay(env, &buyer, t.amount + t.buyer_bond);
        Self::pay(env, &t.seller, t.seller_bond);
        env.events().publish((symbol_short!("refunded"), id), ());
    }

    fn settle(env: &Env, id: u64, t: &mut Trade, seller_pct: u32) {
        let cfg = Self::config(env);
        let seller_principal = t.amount * (seller_pct as i128) / 100;
        let fee = fee_for(seller_principal);
        let buyer = Self::buyer(env, t);
        let buyer_principal = t.amount - seller_principal; // remainder incl. dust → buyer (§8.4.6)
        t.state = State::Settled;
        Self::put(env, id, t);
        Self::pay(env, &t.seller, seller_principal - fee + t.seller_bond);
        Self::pay(env, &buyer, buyer_principal + t.buyer_bond);
        Self::pay(env, &cfg.fee_account, fee);
        env.events().publish((symbol_short!("settled"), id), seller_pct);
    }

    fn nuclear(env: &Env, id: u64, t: &mut Trade) {
        let cfg = Self::config(env);
        let seller_half = t.amount / 2; // floor; dust → buyer
        let buyer_half = t.amount - seller_half;
        let buyer = Self::buyer(env, t);
        t.state = State::Nuclear;
        Self::put(env, id, t);
        Self::pay(env, &t.seller, seller_half);
        Self::pay(env, &buyer, buyer_half);
        // Both bonds burned to the unspendable address — never collected (§2.6).
        Self::pay(env, &cfg.burn_account, t.seller_bond + t.buyer_bond);
        env.events().publish((symbol_short!("nuclear"), id), ());
    }

    // ── Internal helpers ──
    fn config(env: &Env) -> Config {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }
    fn load(env: &Env, id: u64) -> Trade {
        env.storage()
            .persistent()
            .get(&DataKey::Trade(id))
            .unwrap_or_else(|| panic_with_error!(env, Error::TradeNotFound))
    }
    fn put(env: &Env, id: u64, t: &Trade) {
        let key = DataKey::Trade(id);
        env.storage().persistent().set(&key, t);
        env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP_AMOUNT);
    }
    fn buyer(env: &Env, t: &Trade) -> Address {
        t.buyer.clone().unwrap_or_else(|| panic_with_error!(env, Error::WrongState))
    }
    fn pay(env: &Env, to: &Address, amount: i128) {
        if amount > 0 {
            let cfg = Self::config(env);
            token::Client::new(env, &cfg.token).transfer(
                &env.current_contract_address(),
                to,
                &amount,
            );
        }
    }
}

// ── Pure money math (PRD §8.2) ──
fn bond_for(amount: i128) -> i128 {
    let pct = amount * BOND_BPS / BPS_DEN;
    if pct > BOND_FLOOR { pct } else { BOND_FLOOR }
}
fn fee_for(released: i128) -> i128 {
    if released <= 0 {
        return 0;
    }
    let pct = released * FEE_BPS / BPS_DEN;
    if pct > FEE_MIN { pct } else { FEE_MIN }
}

mod test;

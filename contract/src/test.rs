#![cfg(test)]
use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env,
};

const PI_: i128 = 10_000_000;

struct Fixture<'a> {
    env: Env,
    client: ClaspEscrowClient<'a>,
    token: token::Client<'a>,
    sac: token::StellarAssetClient<'a>,
    fee: Address,
    burn: Address,
}

fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let sac_contract = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = sac_contract.address();
    let token = token::Client::new(&env, &token_addr);
    let sac = token::StellarAssetClient::new(&env, &token_addr);

    let contract_id = env.register_contract(None, ClaspEscrow);
    let client = ClaspEscrowClient::new(&env, &contract_id);

    let fee = Address::generate(&env);
    let burn = Address::generate(&env);
    client.initialize(&fee, &burn, &token_addr);

    Fixture { env, client, token, sac, fee, burn }
}

fn hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn fund_account(f: &Fixture, who: &Address, amount: i128) {
    f.sac.mint(who, &amount);
}

#[test]
fn happy_path_completes_and_splits_fee() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    let amount = 20 * PI_;
    let bond = 3 * PI_; // 15% of 20
    let fee = amount * 150 / 10_000; // 0.3 Pi

    fund_account(&f, &seller, bond);
    fund_account(&f, &buyer, amount + bond);

    let id = f.client.create_trade(&seller, &amount, &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&buyer, &id);
    f.client.mark_shipped(&id, &hash(&f.env));
    f.client.confirm_receipt(&id);

    assert_eq!(f.client.get_state(&id), State::Completed);
    assert_eq!(f.token.balance(&seller), amount - fee + bond); // 22.7 Pi
    assert_eq!(f.token.balance(&buyer), bond); // bond back
    assert_eq!(f.token.balance(&f.fee), fee); // 0.3 Pi
    assert_eq!(f.token.balance(&f.client.address), 0); // contract drained
}

#[test]
fn ship_timeout_refunds_buyer() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    let amount = 10 * PI_;
    let bond = amount * 1500 / 10_000; // 1.5 Pi (15%, above the 1 Pi floor)

    fund_account(&f, &seller, bond);
    fund_account(&f, &buyer, amount + bond);

    let id = f.client.create_trade(&seller, &amount, &(24 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&buyer, &id);

    // Advance past the ship deadline; anyone calls claim_timeout.
    f.env.ledger().with_mut(|l| l.timestamp += 25 * 3600);
    f.client.claim_timeout(&id);

    assert_eq!(f.client.get_state(&id), State::Refunded);
    assert_eq!(f.token.balance(&buyer), amount + bond); // price + bond back
    assert_eq!(f.token.balance(&seller), bond); // seller bond back
    assert_eq!(f.token.balance(&f.fee), 0); // no fee on failure
}

#[test]
fn dispute_settles_on_agreement() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    let amount = 20 * PI_;
    let bond = 3 * PI_;
    let seller_pct = 60u32;
    let seller_principal = amount * 60 / 100; // 12 Pi
    let fee = seller_principal * 150 / 10_000; // 0.18 Pi

    fund_account(&f, &seller, bond);
    fund_account(&f, &buyer, amount + bond);

    let id = f.client.create_trade(&seller, &amount, &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&buyer, &id);
    f.client.mark_shipped(&id, &hash(&f.env));
    f.client.open_dispute(&id);
    f.client.propose_settlement(&seller, &id, &seller_pct);
    f.client.accept_settlement(&buyer, &id); // counterparty accepts

    assert_eq!(f.client.get_state(&id), State::Settled);
    assert_eq!(f.token.balance(&seller), seller_principal - fee + bond); // 14.82 Pi
    assert_eq!(f.token.balance(&buyer), (amount - seller_principal) + bond); // 11 Pi
    assert_eq!(f.token.balance(&f.fee), fee);
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn nuclear_burns_both_bonds_and_splits_5050() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    let amount = 20 * PI_;
    let bond = 3 * PI_;

    fund_account(&f, &seller, bond);
    fund_account(&f, &buyer, amount + bond);

    let id = f.client.create_trade(&seller, &amount, &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&buyer, &id);
    f.client.mark_shipped(&id, &hash(&f.env));
    f.client.open_dispute(&id);

    // No settlement within the window → permissionless nuclear.
    f.env.ledger().with_mut(|l| l.timestamp += 8 * 24 * 3600);
    f.client.claim_timeout(&id);

    assert_eq!(f.client.get_state(&id), State::Nuclear);
    assert_eq!(f.token.balance(&seller), amount / 2); // 10 Pi
    assert_eq!(f.token.balance(&buyer), amount - amount / 2); // 10 Pi
    assert_eq!(f.token.balance(&f.burn), bond + bond); // 6 Pi burned
    assert_eq!(f.token.balance(&f.client.address), 0);
}

#[test]
fn unfunded_expiry_returns_seller_bond() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let bond = 3 * PI_;
    fund_account(&f, &seller, bond);

    let id = f.client.create_trade(&seller, &(20 * PI_), &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.env.ledger().with_mut(|l| l.timestamp += 25 * 3600);
    f.client.claim_timeout(&id);

    assert_eq!(f.client.get_state(&id), State::Cancelled);
    assert_eq!(f.token.balance(&seller), bond);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // SelfFunding
fn seller_cannot_fund_own_trade() {
    let f = setup();
    let seller = Address::generate(&f.env);
    fund_account(&f, &seller, 3 * PI_ + 23 * PI_);
    let id = f.client.create_trade(&seller, &(20 * PI_), &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&seller, &id);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // AmountOutOfRange
fn amount_above_cap_rejected() {
    let f = setup();
    let seller = Address::generate(&f.env);
    fund_account(&f, &seller, 100 * PI_);
    f.client.create_trade(&seller, &(60 * PI_), &(72 * 3600), &(72 * 3600), &hash(&f.env));
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // WrongState (silence==acceptance already completed)
fn cannot_dispute_after_completion() {
    let f = setup();
    let seller = Address::generate(&f.env);
    let buyer = Address::generate(&f.env);
    fund_account(&f, &seller, 3 * PI_);
    fund_account(&f, &buyer, 23 * PI_);
    let id = f.client.create_trade(&seller, &(20 * PI_), &(72 * 3600), &(72 * 3600), &hash(&f.env));
    f.client.fund_trade(&buyer, &id);
    f.client.mark_shipped(&id, &hash(&f.env));
    f.client.confirm_receipt(&id);
    f.client.open_dispute(&id); // should panic — trade already completed
}

//! A NEAR vault. Users deposit NEAR, read their recorded balance, and
//! withdraw to a named receiver. The owner can pause deposits.

use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseResult,
};

const GAS_FOR_WITHDRAW_CALLBACK: Gas = Gas::from_tgas(10);

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    deposits_paused: bool,
    balances: LookupMap<AccountId, NearToken>,
}

#[near]
impl Vault {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        Self {
            owner,
            deposits_paused: false,
            balances: LookupMap::new(b"b"),
        }
    }

    /// Adds the attached deposit to the caller's recorded balance.
    #[payable]
    pub fn deposit(&mut self) {
        require!(!self.deposits_paused, "deposits are paused");
        let amount = env::attached_deposit();
        require!(!amount.is_zero(), "attach a deposit");
        let account = env::predecessor_account_id();
        let balance = self.balance_of(account.clone());
        self.balances.insert(account, balance.saturating_add(amount));
    }

    /// Sends `amount` of the caller's recorded balance to `receiver_id`.
    /// If the transfer fails, `on_withdraw_complete` restores the balance.
    pub fn withdraw(&mut self, amount: NearToken, receiver_id: AccountId) -> Promise {
        require!(!amount.is_zero(), "amount must be positive");
        let account = env::predecessor_account_id();
        let balance = self.balance_of(account.clone());
        require!(balance >= amount, "insufficient balance");
        self.balances
            .insert(account.clone(), balance.saturating_sub(amount));
        Promise::new(receiver_id).transfer(amount).then(
            Self::ext(env::current_account_id())
                .with_static_gas(GAS_FOR_WITHDRAW_CALLBACK)
                .on_withdraw_complete(account, amount),
        )
    }

    /// Returns true when the transfer succeeded. On failure the refunded
    /// amount is credited back to `account_id`'s recorded balance.
    #[private]
    pub fn on_withdraw_complete(&mut self, account_id: AccountId, amount: NearToken) -> bool {
        require!(env::promise_results_count() == 1, "expected one promise result");
        #[allow(deprecated)]
        let result = env::promise_result(0);
        match result {
            PromiseResult::Successful(_) => true,
            _ => {
                let balance = self.balance_of(account_id.clone());
                self.balances.insert(account_id, balance.saturating_add(amount));
                false
            }
        }
    }

    pub fn balance_of(&self, account_id: AccountId) -> NearToken {
        self.balances
            .get(&account_id)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0))
    }

    /// Owner only. Pauses or resumes deposits. Touches no balance.
    pub fn set_deposits_paused(&mut self, paused: bool) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the owner can pause deposits"
        );
        self.deposits_paused = paused;
    }

    pub fn deposits_paused(&self) -> bool {
        self.deposits_paused
    }

    pub fn owner(&self) -> AccountId {
        self.owner.clone()
    }
}

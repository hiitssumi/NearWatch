use near_sdk::{near, AccountId};

#[near(contract_state)]
pub struct Vault { owner: AccountId }

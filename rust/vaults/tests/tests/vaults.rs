//! Sandbox tests for the demo vaults (spec, "Seam 2").
//!
//! Each test runs against both the buggy and the fixed vault. The only
//! behaviour that differs is a withdrawal whose transfer fails: the buggy
//! vault keeps the balance reduced, the fixed vault restores it.

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::json;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Vault {
    Buggy,
    Fixed,
}

impl Vault {
    fn path(self) -> &'static str {
        match self {
            Vault::Buggy => "../buggy",
            Vault::Fixed => "../fixed",
        }
    }
}

struct Setup {
    worker: Worker<Sandbox>,
    vault: Contract,
    owner: Account,
    alice: Account,
    bob: Account,
}

async fn setup(which: Vault) -> anyhow::Result<Setup> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = near_workspaces::compile_project(which.path()).await?;
    let vault = worker.dev_deploy(&wasm).await?;
    let root = worker.root_account()?;
    let owner = create_user(&root, "owner").await?;
    let alice = create_user(&root, "alice").await?;
    let bob = create_user(&root, "bob").await?;
    vault
        .call("new")
        .args_json(json!({ "owner": owner.id() }))
        .transact()
        .await?
        .into_result()?;
    Ok(Setup { worker, vault, owner, alice, bob })
}

async fn create_user(root: &Account, name: &str) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(20))
        .transact()
        .await?
        .into_result()?)
}

async fn balance_of(vault: &Contract, account: &AccountId) -> anyhow::Result<NearToken> {
    Ok(vault
        .view("balance_of")
        .args_json(json!({ "account_id": account }))
        .await?
        .json()?)
}

async fn deposit(vault: &Contract, from: &Account, amount: NearToken) -> anyhow::Result<()> {
    from.call(vault.id(), "deposit")
        .deposit(amount)
        .transact()
        .await?
        .into_result()?;
    Ok(())
}

async fn withdraw(
    vault: &Contract,
    from: &Account,
    amount: NearToken,
    receiver: &AccountId,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(from
        .call(vault.id(), "withdraw")
        .args_json(json!({ "amount": amount, "receiver_id": receiver }))
        .max_gas()
        .transact()
        .await?)
}

async fn deposit_then_withdraw_returns_the_money(which: Vault) -> anyhow::Result<()> {
    let s = setup(which).await?;
    let five = NearToken::from_near(5);
    deposit(&s.vault, &s.alice, five).await?;
    assert_eq!(balance_of(&s.vault, s.alice.id()).await?, five);

    let bob_before = s.bob.view_account().await?.balance;
    let outcome = withdraw(&s.vault, &s.alice, five, s.bob.id()).await?;
    assert!(outcome.is_success(), "{which:?}: {outcome:#?}");
    assert!(outcome.receipt_failures().is_empty(), "{which:?}");

    let bob_after = s.bob.view_account().await?.balance;
    assert_eq!(bob_after, bob_before.saturating_add(five), "{which:?}: bob got the money");
    assert_eq!(balance_of(&s.vault, s.alice.id()).await?, NearToken::from_yoctonear(0));
    Ok(())
}

#[tokio::test]
async fn buggy_deposit_then_withdraw_returns_the_money() -> anyhow::Result<()> {
    deposit_then_withdraw_returns_the_money(Vault::Buggy).await
}

#[tokio::test]
async fn fixed_deposit_then_withdraw_returns_the_money() -> anyhow::Result<()> {
    deposit_then_withdraw_returns_the_money(Vault::Fixed).await
}

/// Withdraws to an account that does not exist, so the transfer fails.
/// Returns alice's recorded balance afterwards.
async fn withdraw_to_missing_account(which: Vault) -> anyhow::Result<(NearToken, NearToken)> {
    let s = setup(which).await?;
    let five = NearToken::from_near(5);
    deposit(&s.vault, &s.alice, five).await?;

    let ghost: AccountId = format!("ghost.{}", s.worker.root_account()?.id()).parse()?;
    assert!(s.worker.view_account(&ghost).await.is_err(), "ghost must not exist");

    let outcome = withdraw(&s.vault, &s.alice, NearToken::from_near(3), &ghost).await?;
    assert!(
        !outcome.receipt_failures().is_empty(),
        "{which:?}: the transfer to {ghost} should have failed: {outcome:#?}"
    );
    assert!(s.worker.view_account(&ghost).await.is_err(), "ghost was not created");
    Ok((five, balance_of(&s.vault, s.alice.id()).await?))
}

#[tokio::test]
async fn buggy_vault_loses_the_balance_when_the_transfer_fails() -> anyhow::Result<()> {
    let (deposited, after) = withdraw_to_missing_account(Vault::Buggy).await?;
    assert_eq!(after, NearToken::from_near(2), "balance stays reduced by 3 NEAR nobody received");
    assert!(after < deposited);
    Ok(())
}

#[tokio::test]
async fn fixed_vault_restores_the_balance_when_the_transfer_fails() -> anyhow::Result<()> {
    let (deposited, after) = withdraw_to_missing_account(Vault::Fixed).await?;
    assert_eq!(after, deposited, "callback restored the balance");
    Ok(())
}

async fn only_the_owner_can_pause_and_pausing_changes_no_balance(which: Vault) -> anyhow::Result<()> {
    let s = setup(which).await?;
    let five = NearToken::from_near(5);
    deposit(&s.vault, &s.alice, five).await?;

    let paused = |v: &Contract| {
        let v = v.clone();
        async move { anyhow::Ok(v.view("deposits_paused").await?.json::<bool>()?) }
    };

    let by_alice = s
        .alice
        .call(s.vault.id(), "set_deposits_paused")
        .args_json(json!({ "paused": true }))
        .transact()
        .await?;
    assert!(by_alice.is_failure(), "{which:?}: a non-owner paused deposits");
    assert!(!paused(&s.vault).await?);

    s.owner
        .call(s.vault.id(), "set_deposits_paused")
        .args_json(json!({ "paused": true }))
        .transact()
        .await?
        .into_result()?;
    assert!(paused(&s.vault).await?);
    assert_eq!(balance_of(&s.vault, s.alice.id()).await?, five, "{which:?}: pausing changed a balance");

    let blocked = s
        .bob
        .call(s.vault.id(), "deposit")
        .deposit(NearToken::from_near(1))
        .transact()
        .await?;
    assert!(blocked.is_failure(), "{which:?}: deposit accepted while paused");
    assert_eq!(balance_of(&s.vault, s.bob.id()).await?, NearToken::from_yoctonear(0));

    s.owner
        .call(s.vault.id(), "set_deposits_paused")
        .args_json(json!({ "paused": false }))
        .transact()
        .await?
        .into_result()?;
    assert!(!paused(&s.vault).await?);
    assert_eq!(balance_of(&s.vault, s.alice.id()).await?, five, "{which:?}: resuming changed a balance");
    Ok(())
}

#[tokio::test]
async fn buggy_only_the_owner_can_pause_deposits() -> anyhow::Result<()> {
    only_the_owner_can_pause_and_pausing_changes_no_balance(Vault::Buggy).await
}

#[tokio::test]
async fn fixed_only_the_owner_can_pause_deposits() -> anyhow::Result<()> {
    only_the_owner_can_pause_and_pausing_changes_no_balance(Vault::Fixed).await
}

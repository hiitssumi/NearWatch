//! Runs one Scenario in a fresh local sandbox.
//!
//! The only network this module ever creates is `near_workspaces::sandbox()`: a local sandbox node
//! the harness starts itself. It has no testnet or mainnet worker and takes no RPC address, so it
//! cannot send a transaction anywhere else.

use std::collections::HashMap;

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{AccessKey, Gas, KeyType, NearToken, SecretKey};
use near_workspaces::{Account, AccountId, Worker};

use crate::check;
use crate::request::{
    internal, Args, HarnessError, ObservationSet, Observations, Request, SandboxAction,
    ScenarioOutcome, SlotBinding, ViewCall,
};

/// The sandbox's registrar may create short top-level accounts such as "alice".
const REGISTRAR: &str = "registrar";
const CONTRACT_BALANCE: NearToken = NearToken::from_near(100);
const MAX_GAS: u64 = 300_000_000_000_000;
/// Blocks produced before each observation, so receipts still in flight (gas refunds, a deposit
/// returned after a failed call) have landed and balances are final.
const SETTLE_BLOCKS: u64 = 3;

/// A Scenario action with its amounts and account names already checked.
enum Step {
    CreateAccount { account: AccountId, balance: NearToken },
    Call { signer: AccountId, method: String, args: Args, deposit: NearToken, gas: Gas },
    View { method: String, args: Args },
    Snapshot,
}

enum Binding {
    View(ViewCall),
    Account(AccountId),
}

/// Checks the whole request before the sandbox starts, so a malformed Scenario costs nothing.
fn prepare(req: &Request) -> Result<(Vec<Step>, Vec<(String, Binding)>), HarnessError> {
    check::validate(&req.check, &req.scenario)?;
    let snapshots = req.scenario.actions.iter().filter(|a| matches!(a, SandboxAction::Snapshot {})).count();
    if snapshots > 1 {
        return Err(HarnessError::invalid(format!(
            "scenario.actions has {snapshots} snapshot actions; at most one is allowed"
        )));
    }
    let steps = req
        .scenario
        .actions
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let at = format!("scenario.actions[{i}]");
            Ok(match a {
                SandboxAction::Snapshot {} => Step::Snapshot,
                SandboxAction::CreateAccount { account, balance } => Step::CreateAccount {
                    account: account_id(account, &format!("{at}.account"))?,
                    balance: yocto(balance, &format!("{at}.balance"))?,
                },
                SandboxAction::Call { signer, method, args, deposit, gas } => {
                    let gas_units: u64 = gas.parse().map_err(|_| {
                        HarnessError::invalid(format!("{at}.gas is \"{gas}\", not a whole number of gas units"))
                    })?;
                    if gas_units > MAX_GAS {
                        return Err(HarnessError::invalid(format!(
                            "{at}.gas is {gas_units}, more than the 300 Tgas limit"
                        )));
                    }
                    Step::Call {
                        signer: account_id(signer, &format!("{at}.as"))?,
                        method: method.clone(),
                        args: args.clone(),
                        deposit: yocto(deposit, &format!("{at}.deposit"))?,
                        gas: Gas::from_gas(gas_units),
                    }
                }
                SandboxAction::View { method, args } => {
                    Step::View { method: method.clone(), args: args.clone() }
                }
            })
        })
        .collect::<Result<Vec<_>, HarnessError>>()?;
    let bindings = req
        .scenario
        .bind
        .iter()
        .map(|(slot, b)| {
            Ok((
                slot.clone(),
                match b {
                    SlotBinding::View(v) => Binding::View(v.clone()),
                    SlotBinding::Account(a) => {
                        Binding::Account(account_id(a, &format!("scenario.bind.{slot}.account"))?)
                    }
                },
            ))
        })
        .collect::<Result<Vec<_>, HarnessError>>()?;
    account_id(&req.setup.contract, "setup.contract")?;
    for (name, balance) in &req.setup.accounts {
        account_id(name, "setup.accounts")?;
        yocto(balance, &format!("setup.accounts.{name}"))?;
    }
    if !std::path::Path::new(&req.wasm).is_file() {
        return Err(HarnessError::invalid(format!("wasm file not found: {}", req.wasm)));
    }
    Ok((steps, bindings))
}

fn account_id(s: &str, at: &str) -> Result<AccountId, HarnessError> {
    s.parse()
        .map_err(|e| HarnessError::invalid(format!("{at} is \"{s}\", not a valid NEAR account id: {e}")))
}

fn yocto(s: &str, at: &str) -> Result<NearToken, HarnessError> {
    s.parse::<u128>()
        .map(NearToken::from_yoctonear)
        .map_err(|_| HarnessError::invalid(format!("{at} is \"{s}\", not a whole number of yoctoNEAR")))
}

struct Sandboxed {
    worker: Worker<Sandbox>,
    registrar: Account,
    contract: AccountId,
    /// Every account the harness created, with its key. Only these can sign calls.
    keys: HashMap<AccountId, Account>,
    failed: Vec<String>,
}

impl Sandboxed {
    async fn start(req: &Request) -> Result<Self, HarnessError> {
        let worker = near_workspaces::sandbox().await.map_err(internal)?;
        let registrar_id: AccountId = REGISTRAR.parse().map_err(internal)?;
        let key = SecretKey::from_random(KeyType::ED25519);
        worker
            .patch(&registrar_id)
            .access_key(key.public_key(), AccessKey::full_access())
            .transact()
            .await
            .map_err(internal)?;
        let registrar = Account::from_secret_key(registrar_id, key, &worker);
        let contract: AccountId = req.setup.contract.parse().map_err(internal)?;
        let mut s = Self { worker, registrar, contract: contract.clone(), keys: HashMap::new(), failed: vec![] };

        for (name, balance) in &req.setup.accounts {
            let balance = NearToken::from_yoctonear(balance.parse().map_err(internal)?);
            let ok = s.create_account(&name.parse().map_err(internal)?, balance, "setup").await?;
            if !ok {
                return Err(HarnessError::internal(format!("setup: could not create {name}: {:?}", s.failed)));
            }
        }
        if !s.create_account(&contract, CONTRACT_BALANCE, "setup").await? {
            return Err(HarnessError::internal(format!("setup: could not create {contract}: {:?}", s.failed)));
        }
        let wasm = std::fs::read(&req.wasm).map_err(internal)?;
        s.keys[&contract].deploy(&wasm).await.map_err(internal)?.into_result().map_err(|e| {
            HarnessError::internal(format!("setup: deploying {} failed: {e:?}", req.wasm))
        })?;
        if let Some(init) = &req.setup.init {
            let signer = s.keys.get(&init.signer.parse::<AccountId>().map_err(internal)?).ok_or_else(|| {
                HarnessError::invalid(format!("setup.init.as names {}, which setup does not create", init.signer))
            })?;
            let outcome = signer
                .call(&contract, &init.method)
                .args_json(&init.args)
                .max_gas()
                .transact()
                .await
                .map_err(internal)?;
            if !outcome.is_success() {
                return Err(HarnessError::internal(format!(
                    "setup: {}({}) failed: {}",
                    init.method,
                    serde_json::Value::Object(init.args.clone()),
                    describe_failures(&outcome).join("; ")
                )));
            }
        }
        Ok(s)
    }

    /// Creates a top-level account through the registrar. Returns false (and records why) on failure.
    async fn create_account(&mut self, id: &AccountId, balance: NearToken, label: &str) -> Result<bool, HarnessError> {
        if self.keys.contains_key(id) || self.worker.view_account(id).await.is_ok() {
            self.failed.push(format!("{label}: createAccount {id}: account already exists"));
            return Ok(false);
        }
        let key = SecretKey::from_random(KeyType::ED25519);
        let outcome = self
            .registrar
            .batch(id)
            .create_account()
            .add_key(key.public_key(), AccessKey::full_access())
            .transfer(balance)
            .transact()
            .await;
        match outcome {
            Ok(o) if o.is_success() => {
                self.keys.insert(id.clone(), Account::from_secret_key(id.clone(), key, &self.worker));
                Ok(true)
            }
            Ok(o) => {
                for f in describe_failures(&o) {
                    self.failed.push(format!("{label}: createAccount {id}: {f}"));
                }
                Ok(false)
            }
            Err(e) => {
                self.failed.push(format!("{label}: createAccount {id} rejected: {e}"));
                Ok(false)
            }
        }
    }

    async fn step(&mut self, i: usize, step: &Step) -> Result<(), HarnessError> {
        let label = format!("action {i}");
        match step {
            Step::CreateAccount { account, balance } => {
                self.create_account(account, *balance, &label).await?;
            }
            Step::Call { signer, method, args, deposit, gas } => {
                let Some(acc) = self.keys.get(signer) else {
                    self.failed.push(format!(
                        "{label}: call {method} as {signer} not sent: {signer} was not created by this Scenario"
                    ));
                    return Ok(());
                };
                let what = format!("{label}: call {method} as {signer}");
                match acc.call(&self.contract, method).args_json(args).deposit(*deposit).gas(*gas).transact().await {
                    Ok(o) => {
                        for f in describe_failures(&o) {
                            self.failed.push(format!("{what}: {f}"));
                        }
                    }
                    Err(e) => self.failed.push(format!("{what} rejected: {e}")),
                }
            }
            Step::View { method, args } => {
                if let Err(e) = self.view(method, args).await {
                    self.failed.push(format!("{label}: view {method} failed: {e}"));
                }
            }
            Step::Snapshot => {}
        }
        Ok(())
    }

    async fn view(&self, method: &str, args: &Args) -> Result<String, String> {
        let result = self
            .worker
            .view(&self.contract, method)
            .args_json(args)
            .await
            .map_err(|e| e.to_string())?;
        let value: serde_json::Value = result.json().map_err(|e| format!("result is not JSON: {e}"))?;
        Ok(match value {
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        })
    }

    async fn observe(&self, bindings: &[(String, Binding)], when: &str) -> Result<ObservationSet, HarnessError> {
        self.worker.fast_forward(SETTLE_BLOCKS).await.map_err(internal)?;
        let mut set = ObservationSet::default();
        for (slot, b) in bindings {
            match b {
                Binding::View(v) => {
                    let value = self.view(&v.method, &v.args).await.map_err(|e| {
                        HarnessError::invalid(format!("slot \"{slot}\" ({when}): view {} failed: {e}", v.method))
                    })?;
                    set.views.insert(slot.clone(), value);
                }
                Binding::Account(id) => {
                    // An account that does not exist has a balance of zero.
                    let balance = match self.worker.view_account(id).await {
                        Ok(a) => a.balance.as_yoctonear(),
                        Err(_) => 0,
                    };
                    set.balances.insert(slot.clone(), balance.to_string());
                }
            }
        }
        Ok(set)
    }
}

/// One line per failed receipt: which account it ran on and why it failed.
fn describe_failures(outcome: &ExecutionFinalResult) -> Vec<String> {
    let mut out: Vec<String> = outcome
        .receipt_failures()
        .into_iter()
        .map(|r| match r.clone().into_result() {
            Err(e) => {
                let why = match e.into_inner() {
                    Ok(inner) => inner.to_string(),
                    Err(e) => e.to_string(),
                };
                format!("receipt on {} failed: {}", r.executor_id, failure_text(&why))
            }
            Ok(_) => format!("receipt on {} failed", r.executor_id),
        })
        .collect();
    if out.is_empty() && outcome.is_failure() {
        if let Err(e) = outcome.clone().into_result() {
            out.push(format!("transaction failed: {}", failure_text(&e.to_string())));
        }
    }
    out
}

/// Keeps failure text to one short line.
fn failure_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(400).collect()
}

pub async fn run(req: Request) -> Result<ScenarioOutcome, HarnessError> {
    let (steps, bindings) = prepare(&req)?;
    let mut sb = Sandboxed::start(&req).await?;
    sb.failed.clear();

    // "before" is taken at the Scenario's snapshot action, or, when it has none, once its opening
    // createAccount actions have run.
    let opening = match steps.iter().position(|s| matches!(s, Step::Snapshot)) {
        Some(at) => at,
        None => steps.iter().take_while(|s| matches!(s, Step::CreateAccount { .. })).count(),
    };
    for (i, s) in steps.iter().enumerate().take(opening) {
        sb.step(i, s).await?;
    }
    let before = sb.observe(&bindings, "before").await?;
    for (i, s) in steps.iter().enumerate().skip(opening) {
        sb.step(i, s).await?;
    }
    let after = sb.observe(&bindings, "after").await?;

    let rule_check_true = check::evaluate(&req.check, &before, &after)?;
    Ok(ScenarioOutcome {
        observations: Observations { before, after, failed_receipts: sb.failed },
        rule_check_true,
    })
}

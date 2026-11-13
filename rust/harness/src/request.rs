//! The harness's input and output, as JSON. The shapes match `src/domain.ts`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Args = serde_json::Map<String, serde_json::Value>;

/// One run: a Scenario and the Rule check to evaluate over what it observed.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// Path to the compiled contract (.wasm).
    pub wasm: String,
    #[serde(default)]
    pub setup: Setup,
    pub scenario: Scenario,
    pub check: RuleCheck,
}

/// What exists before the Scenario starts. The defaults suit the demo vaults.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setup {
    /// The account the contract is deployed to.
    #[serde(default = "default_contract")]
    pub contract: String,
    /// Accounts created before the contract is initialised, with their balances in yoctoNEAR.
    #[serde(default = "default_accounts")]
    pub accounts: BTreeMap<String, String>,
    /// The call that initialises the contract, if any.
    #[serde(default = "default_init")]
    pub init: Option<InitCall>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct InitCall {
    #[serde(rename = "as")]
    pub signer: String,
    pub method: String,
    #[serde(default)]
    pub args: Args,
}

fn default_contract() -> String {
    "vault".into()
}
fn default_accounts() -> BTreeMap<String, String> {
    BTreeMap::from([("owner".into(), "100000000000000000000000000".into())])
}
fn default_init() -> Option<InitCall> {
    let mut args = Args::new();
    args.insert("owner".into(), "owner".into());
    Some(InitCall { signer: "owner".into(), method: "new".into(), args })
}

impl Default for Setup {
    fn default() -> Self {
        Self { contract: default_contract(), accounts: default_accounts(), init: default_init() }
    }
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    /// Actions run before the "before" observations: accounts, deposits, anything the call needs.
    pub setup: Vec<SandboxAction>,
    /// The one call the Rule check is about. "before" is observed just before it, "after" just after.
    pub call: CallAction,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct CallAction {
    #[serde(rename = "as")]
    pub signer: String,
    pub method: String,
    pub args: Args,
    pub deposit: String,
    pub gas: String,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum SandboxAction {
    CreateAccount {
        account: String,
        balance: String,
    },
    Call {
        #[serde(rename = "as")]
        signer: String,
        method: String,
        args: Args,
        deposit: String,
        gas: String,
    },
    View {
        method: String,
        args: Args,
    },
}

/// What a slot reads, written by the Rules agent. Account names and string view arguments may be
/// references to the call under test: "$caller", "$contract" or "$arg:<name>" (a string argument).
/// Any other string is a literal account name the Scenario must create.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum SlotBinding {
    View(ViewCall),
    Account(String),
}

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct ViewCall {
    pub method: String,
    pub args: Args,
}

#[derive(Deserialize, Debug)]
pub struct RuleCheck {
    /// The contract methods the Rule is about. The call under test must be one of them.
    pub methods: Vec<String>,
    pub slots: Vec<ObservationSlot>,
    pub condition: Condition,
}

#[derive(Deserialize, Debug)]
pub struct ObservationSlot {
    pub name: String,
    pub kind: SlotKind,
    pub bind: SlotBinding,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    View,
    Balance,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum When {
    Before,
    After,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum Expr {
    Slot { slot: String, when: When },
    Number { number: String },
    /// An account id: a reference to the call under test ("$caller", "$contract", "$arg:<name>") or a
    /// literal name. Compared only with "==" or "!=", against another account or a view returning one.
    Account { account: String },
    Op { op: ArithOp, left: Box<Expr>, right: Box<Expr> },
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum ArithOp {
    Add,
    Sub,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
pub enum Condition {
    Compare { compare: CompareOp, left: Expr, right: Expr },
    All { all: Vec<Condition> },
    Any { any: Vec<Condition> },
}

#[derive(Deserialize, Debug, Clone, Copy)]
pub enum CompareOp {
    #[serde(rename = "<")]
    Lt,
    #[serde(rename = "<=")]
    Le,
    #[serde(rename = "==")]
    Eq,
    #[serde(rename = "!=")]
    Ne,
    #[serde(rename = ">=")]
    Ge,
    #[serde(rename = ">")]
    Gt,
}

// ---- Output ----

#[derive(Serialize, Debug, Default, Clone, PartialEq)]
pub struct ObservationSet {
    pub views: BTreeMap<String, String>,
    pub balances: BTreeMap<String, String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Observations {
    pub before: ObservationSet,
    pub after: ObservationSet,
    pub failed_receipts: Vec<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioOutcome {
    pub observations: Observations,
    pub rule_check_true: bool,
}

/// The one line the harness prints.
#[derive(Serialize, Debug)]
#[serde(untagged)]
pub enum Response {
    Ok { ok: bool, outcome: ScenarioOutcome },
    Err { ok: bool, kind: ErrorKind, error: String },
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ErrorKind {
    /// The request is malformed: the caller's fault, and the message names the problem.
    Invalid,
    /// The sandbox or the harness failed.
    Internal,
}

#[derive(Debug)]
pub struct HarnessError {
    pub kind: ErrorKind,
    pub message: String,
}

impl HarnessError {
    pub fn invalid(message: impl Into<String>) -> Self {
        Self { kind: ErrorKind::Invalid, message: message.into() }
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self { kind: ErrorKind::Internal, message: message.into() }
    }
}

/// For `.map_err(internal)` on sandbox calls.
pub fn internal(e: impl std::fmt::Display) -> HarnessError {
    HarnessError::internal(e.to_string())
}

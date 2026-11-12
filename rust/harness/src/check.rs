//! Evaluates a Rule check over observations. True means the Rule has been broken.

use crate::request::{
    ArithOp, CompareOp, Condition, Expr, HarnessError, ObservationSet, RuleCheck, Scenario,
    SlotBinding, SlotKind, When,
};

/// Checks that the call under test is one of the Rule's methods, that every slot the condition uses
/// is declared, and that each slot's binding matches its kind. Runs before the sandbox starts.
pub fn validate(check: &RuleCheck, scenario: &Scenario) -> Result<(), HarnessError> {
    if check.methods.is_empty() {
        return Err(HarnessError::invalid("the Rule check names no methods"));
    }
    if !check.methods.contains(&scenario.call.method) {
        return Err(HarnessError::invalid(format!(
            "Scenario {}: call.method is \"{}\", but this Rule is about {}",
            scenario.id,
            scenario.call.method,
            check.methods.join(", ")
        )));
    }
    for slot in &check.slots {
        match (slot.kind, &slot.bind) {
            (SlotKind::View, SlotBinding::Account(_)) => {
                return Err(HarnessError::invalid(format!(
                    "slot \"{}\" is a view slot but is bound to an account",
                    slot.name
                )))
            }
            (SlotKind::Balance, SlotBinding::View(_)) => {
                return Err(HarnessError::invalid(format!(
                    "slot \"{}\" is a balance slot but is bound to a view call",
                    slot.name
                )))
            }
            _ => {}
        }
    }
    let declared: Vec<&str> = check.slots.iter().map(|s| s.name.as_str()).collect();
    visit_condition(&check.condition, &mut |e| match e {
        Expr::Slot { slot, .. } if !declared.contains(&slot.as_str()) => Err(HarnessError::invalid(
            format!("condition uses undeclared slot \"{slot}\""),
        )),
        Expr::Number { number } => parse_number(number, "number").map(|_| ()),
        _ => Ok(()),
    })
}

fn visit_condition(
    c: &Condition,
    f: &mut impl FnMut(&Expr) -> Result<(), HarnessError>,
) -> Result<(), HarnessError> {
    match c {
        Condition::Compare { left, right, .. } => {
            visit_expr(left, f)?;
            visit_expr(right, f)
        }
        Condition::All { all: cs } | Condition::Any { any: cs } => {
            if cs.is_empty() {
                return Err(HarnessError::invalid("\"all\" or \"any\" with no conditions"));
            }
            cs.iter().try_for_each(|c| visit_condition(c, f))
        }
    }
}

fn visit_expr(
    e: &Expr,
    f: &mut impl FnMut(&Expr) -> Result<(), HarnessError>,
) -> Result<(), HarnessError> {
    f(e)?;
    if let Expr::Op { left, right, .. } = e {
        visit_expr(left, f)?;
        visit_expr(right, f)?;
    }
    Ok(())
}

/// Observed values are decimal strings (yoctoNEAR, counts) or booleans, read as 1 and 0.
fn parse_number(s: &str, what: &str) -> Result<i128, HarnessError> {
    match s {
        "true" => Ok(1),
        "false" => Ok(0),
        _ => s.parse::<i128>().map_err(|_| {
            HarnessError::invalid(format!("{what} is \"{s}\", which is not a whole number"))
        }),
    }
}

pub fn evaluate(
    check: &RuleCheck,
    before: &ObservationSet,
    after: &ObservationSet,
) -> Result<bool, HarnessError> {
    let lookup = |slot: &str, when: When| -> Result<i128, HarnessError> {
        let set = if when == When::Before { before } else { after };
        let raw = set
            .views
            .get(slot)
            .or_else(|| set.balances.get(slot))
            .ok_or_else(|| HarnessError::internal(format!("no observation for slot \"{slot}\"")))?;
        let label = format!("slot \"{slot}\" ({})", if when == When::Before { "before" } else { "after" });
        parse_number(raw, &label)
    };
    eval_condition(&check.condition, &lookup)
}

fn eval_condition(
    c: &Condition,
    lookup: &impl Fn(&str, When) -> Result<i128, HarnessError>,
) -> Result<bool, HarnessError> {
    Ok(match c {
        Condition::Compare { compare, left, right } => {
            let (l, r) = (eval_expr(left, lookup)?, eval_expr(right, lookup)?);
            match compare {
                CompareOp::Lt => l < r,
                CompareOp::Le => l <= r,
                CompareOp::Eq => l == r,
                CompareOp::Ne => l != r,
                CompareOp::Ge => l >= r,
                CompareOp::Gt => l > r,
            }
        }
        Condition::All { all } => {
            for c in all {
                if !eval_condition(c, lookup)? {
                    return Ok(false);
                }
            }
            true
        }
        Condition::Any { any } => {
            for c in any {
                if eval_condition(c, lookup)? {
                    return Ok(true);
                }
            }
            false
        }
    })
}

fn eval_expr(
    e: &Expr,
    lookup: &impl Fn(&str, When) -> Result<i128, HarnessError>,
) -> Result<i128, HarnessError> {
    match e {
        Expr::Slot { slot, when } => lookup(slot, *when),
        Expr::Number { number } => parse_number(number, "number"),
        Expr::Op { op, left, right } => {
            let (l, r) = (eval_expr(left, lookup)?, eval_expr(right, lookup)?);
            match op {
                ArithOp::Add => l.checked_add(r),
                ArithOp::Sub => l.checked_sub(r),
            }
            .ok_or_else(|| HarnessError::invalid("arithmetic overflow in the Rule check"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn set(views: &[(&str, &str)], balances: &[(&str, &str)]) -> ObservationSet {
        let m = |xs: &[(&str, &str)]| -> BTreeMap<String, String> {
            xs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
        };
        ObservationSet { views: m(views), balances: m(balances) }
    }

    fn check(json: serde_json::Value) -> RuleCheck {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn compares_with_arithmetic_and_negative_intermediates() {
        let c = check(serde_json::json!({
            "methods": ["m"],
            "slots": [{"name": "r", "kind": "balance", "bind": {"account": "$caller"}},
                      {"name": "v", "kind": "view", "bind": {"view": {"method": "v", "args": {}}}}],
            "condition": {"compare": "<", "left": {"op": "sub",
                "left": {"slot": "r", "when": "before"}, "right": {"slot": "r", "when": "after"}},
                "right": {"slot": "v", "when": "after"}}
        }));
        let before = set(&[("v", "5")], &[("r", "1")]);
        let after = set(&[("v", "0")], &[("r", "3")]);
        // 1 - 3 = -2 < 0
        assert!(evaluate(&c, &before, &after).unwrap());
    }

    #[test]
    fn all_any_and_booleans() {
        let c = check(serde_json::json!({
            "methods": ["m"],
            "slots": [{"name": "p", "kind": "view", "bind": {"view": {"method": "p", "args": {}}}}],
            "condition": {"all": [
                {"compare": "==", "left": {"slot": "p", "when": "after"}, "right": {"number": "1"}},
                {"any": [{"compare": "!=", "left": {"slot": "p", "when": "before"}, "right": {"number": "0"}},
                         {"compare": ">=", "left": {"number": "2"}, "right": {"number": "2"}}]}
            ]}
        }));
        let before = set(&[("p", "false")], &[]);
        let after = set(&[("p", "true")], &[]);
        assert!(evaluate(&c, &before, &after).unwrap());
    }

    #[test]
    fn non_numeric_view_is_named_in_the_error() {
        let c = check(serde_json::json!({
            "methods": ["m"],
            "slots": [{"name": "o", "kind": "view", "bind": {"view": {"method": "o", "args": {}}}}],
            "condition": {"compare": "==", "left": {"slot": "o", "when": "after"}, "right": {"number": "0"}}
        }));
        let s = set(&[("o", "owner")], &[]);
        let e = evaluate(&c, &s, &s).unwrap_err();
        assert!(e.message.contains("slot \"o\" (after)"), "{}", e.message);
    }

    fn scenario(method: &str) -> Scenario {
        serde_json::from_value(serde_json::json!({
            "id": "S1", "setup": [],
            "call": {"as": "alice", "method": method, "args": {}, "deposit": "0", "gas": "1"}
        }))
        .unwrap()
    }

    #[test]
    fn the_call_under_test_must_be_one_of_the_rules_methods() {
        let c = check(serde_json::json!({
            "methods": ["withdraw"],
            "slots": [{"name": "w", "kind": "balance", "bind": {"account": "$caller"}}],
            "condition": {"compare": "<", "left": {"slot": "w", "when": "after"}, "right": {"number": "0"}}
        }));
        assert!(validate(&c, &scenario("withdraw")).is_ok());
        let e = validate(&c, &scenario("deposit")).unwrap_err();
        assert!(e.message.contains("call.method is \"deposit\", but this Rule is about withdraw"), "{}", e.message);
    }

    #[test]
    fn a_binding_must_match_its_slot_kind() {
        let c = check(serde_json::json!({
            "methods": ["m"],
            "slots": [{"name": "w", "kind": "view", "bind": {"account": "$caller"}}],
            "condition": {"compare": "<", "left": {"slot": "w", "when": "after"}, "right": {"number": "0"}}
        }));
        assert!(validate(&c, &scenario("m")).unwrap_err().message.contains("view slot but is bound to an account"));
    }
}

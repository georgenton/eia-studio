# The three environments, and what each one is for

Every Cinta Vera product has three permanent environments. They are not three copies of the same
thing: each answers a different question, and confusing two of them is how a demo becomes an
outage or a staging test proves nothing.

## DEMO — a showcase that is always ready

**Question it answers:** *what does this product do?*

Audience: Cinta Vera Labs, prospective clients, partners, invited users. Synthetic data only, no
real customer PII, limited demo identities.

**It does not follow `main`.** It runs a deliberately chosen **demo-certified digest**, and it may
lag production on purpose — a showcase that changes under the presenter is not a showcase. Its
reset is reproducible from an empty database, so the state seen in a demonstration is the state
the next demonstration starts from.

Criticality is lower than production, but availability still matters: a broken demo is a sales
problem.

## STAGING — pre-production, and nothing else

**Question it answers:** *will this release candidate work in production?*

Production-like topology, the same image digest that production will receive, the same migration
procedure, the same storage adapter, the same auth behaviour. The differences should be limited to
domain, credentials, data, resource size and integrations explicitly disabled.

**Do not use demo as staging.** Demo carries showcase state and a demo-certified digest; staging
carries a release candidate and UAT fixtures. Validating against the wrong one validates nothing.

No real PII by default. If a production-like dataset is ever needed, it arrives through an
anonymisation procedure, not a clone.

## PRODUCTION — the real one

Real customers, real projects, real permitted data, production secrets, backups, PITR, recovery
procedures and explicit deployment approval.

**Production receives only a digest that passed staging**, and the same digest. No rebuild between
the two: a rebuild produces a different artefact, and then staging validated something else.

## What is never shared

| | demo | staging | production |
|---|---|---|---|
| web, worker | separate | separate | separate |
| database and credentials | separate | separate | separate |
| object bucket and credentials | separate | separate | separate |
| auth secret | separate | separate | separate |
| domain | separate | separate | separate |
| users | separate | separate | separate |
| data | synthetic | synthetic | real |
| release lifecycle | certified | release candidate | promoted |

No cross-environment database access. No cross-environment bucket access. No shared application
secret. These are not guidelines: each is enforced by configuration that differs, and by the
absence of any code path that reads another environment's.

## Activation order

Demo first, then measure. Staging next, measure again, and reserve headroom before production.
Logical isolation on one host is not failure isolation, and production must never be starved by a
demonstration.

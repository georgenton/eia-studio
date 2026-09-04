# Internal manual

Living operator and reviewer guides for EIA Studio. They describe **what the product does today**,
on the staging Preview and locally — not what is planned, and not what a client would be shown.

Rules for these pages:

- they never contain a password, a token or a credential of any kind;
- they say plainly when a surface is not built yet, rather than describing an intention;
- every figure they mention is demo or reconstructed data, and they say which;
- they are updated in the same pull request as the behaviour they describe.

| Page                                                            | Covers                                                                   | State   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | ------- |
| [01 · Access and roles](01-access-and-roles.md)                 | signing in, the synthetic identities, what each role may do, signing out | current |
| [02 · Command Center](02-command-center.md)                     | the project's operational view and the deterministic forecast            | current |
| [03 · GIS and Parcel Workspace](03-gis-parcel-workspace.md)     | the map, the parcel table, one parcel's file                             | current |
| [04 · FieldFlow for a coordinator](04-fieldflow-coordinator.md) | campaigns, assignments, the inbox of submitted responses                 | current |
| [05 · FieldFlow for a technician](05-fieldflow-technician.md)   | capturing a visit and a response on a phone                              | current |
| [06 · Social Intelligence](06-social-intelligence.md)           | tabulation, assisted coding, specialist validation                       | current |
| [07 · Quality Gate](07-quality-gate.md)                         | findings, evidence, specialist review                                    | current |
| [08 · Document assistant](08-document-assistant.md)             | project documents, evidence retrieval, cited answers                     | current |
| [09 · Report generation](09-report-generation.md)               | the social chapter draft and its traceability                            | current |
| [10 · Demo walkthrough](10-demo-walkthrough.md)                 | one end-to-end path through everything above                             | current |

Beside them, and not one of them: [`docs/MVP_REVIEW_HANDOFF.md`](../MVP_REVIEW_HANDOFF.md) is the
end-of-wave hand-off — where the Preview is, which identities exist, what was verified, what is
known not to work, and which decisions are waiting on the owner.

# The Cinta Vera platform on OVH

The OVH VPS is **shared infrastructure for several Cinta Vera products**, not an EIA Studio
server. EIA Studio is the first tenant; the shape has to work for the second before the first
moves in.

    Cinta Vera platform (OVH + Coolify)
    ├── EIA Studio      ── demo · staging · production
    ├── product B       ── demo · staging · production
    └── product C       ── demo · staging · production

One Coolify project per product, three environments per project, one application stack per
environment. **Not one compose stack for everything**: a shared stack makes every product's
release the other products' risk.

## Measured host

Verified 29 September 2026, read-only:

    6 vCPU · 12 GB RAM · 100 GB disk (7% used) · Ubuntu 24.04 · x86_64 · KVM/OpenStack
    no swap · Docker 29.8.1 · live-restore disabled

These are **planning inputs, not capacity proof**. Nothing has been deployed and nothing has been
measured under load.

**No swap** means memory pressure kills processes rather than slowing them. **`live-restore`
disabled** means restarting the Docker daemon stops every container on the host — including all
three EIA environments at once.

## Network posture already in place

- P1A: Coolify's administrative ports are bound to loopback.
- P1B.1: a Docker-aware firewall permits TCP 80, TCP 443 and UDP 443 to published ports and
  drops every other new DNAT'd connection, IPv4 and IPv6. A port published by accident is
  unreachable from the internet before anyone notices it exists.
- P2B.1: SSH is public-key only, with `AuthenticationMethods publickey`.
- P3: Coolify's own control plane is backed up off-site to Cloudflare R2.

**P3 does not back up application databases.** That is a separate policy per environment, and it
does not exist yet.

## Resource discipline

Coolify exposes CPU and memory limits per resource; today every one is `0`. Before a second
environment shares this host those limits must be set, and **production takes priority over
demo**. The order is deploy demo, measure idle and load, set limits, deploy staging, measure
again, reserve the remainder for production.

Logical isolation is not failure isolation. Three environments on one host share a kernel, a
disk and a memory ceiling.

## What is still an owner decision

The domain. The database provider for staging and production. The object-storage provider and
its four buckets. Whether staging migrates off Vercel and Railway or coexists. Commercial
MapTiler licensing.

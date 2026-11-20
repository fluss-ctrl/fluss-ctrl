---
status: proposed
date: 2026-11-20
decision-makers: Thomas
consulted: Claude (issue #4)
informed: —
---

# Resolve outbound hostnames over DNS-over-HTTPS for the SSRF guard

## Context and Problem Statement

Every URL the system calls that a user supplied (webhooks, provider links) must resolve only to
public addresses, checked at creation and before every request (SPEC §8.2, PLAN §8). Issue #4 asks
how DNS resolution works for that check on Workers. Workers' `fetch()` resolves names itself and
exposes neither the resolved address nor a hook to veto it, and Workers has no DNS API.

## Decision Drivers

* Refuse before anything is sent: a blocked destination must never receive a byte.
* Platform interfaces only (CLAUDE.md): no Node `dns`, nothing outside WebCrypto/fetch.
* Testable without the network.
* Cheap on the command path, where provider calls already carry an intercontinental round trip.

## Considered Options

* DNS-over-HTTPS lookup before each request, then a normal `fetch()`
* `connect()` from `cloudflare:sockets` with our own HTTP/1.1 and TLS handling, checking the peer
* Check only IP literals and rely on Cloudflare's network to refuse private destinations

## Decision Outcome

Chosen option: "DNS-over-HTTPS lookup before each request", because it is the only option that
refuses before sending, uses plain `fetch`, and keeps the check in `packages/core/http` where tests
can inject a resolver.

`packages/core/http` resolves A and AAAA records through Cloudflare's JSON DoH endpoint
(`cloudflare-dns.com/dns-query`) and calls `fetch()` with `redirect: 'manual'` only if all of
these hold (the stricter design chosen in review, 2026-11-20):

* `https://` on port 443, no user info, and a hostname: IP literals are refused, public or not.
* `localhost`, dotless names and `.local`/`.internal`-style suffixes are refused without a lookup.
* Every A and AAAA address is public, and there is at least one.
* Every answer's TTL is at least 30 s (`MIN_DNS_TTL_S`). Rebinding needs an answer that changes
  between our lookup and `fetch()`'s own; refusing short-lived answers narrows that window.
* Any resolver failure fails closed. The lookup runs inside the request deadline.

After the response, the name is resolved again. If any address is now non-public the request fails
with `destination_changed` and the body is discarded. That cannot unsend a request, but a rebinding
attempt becomes a visible failure instead of a silent success. A failed second lookup is ignored, so
a DoH hiccup cannot turn a sent command into an ambiguous one.

### Consequences

* Good, because nothing reaches a blocked destination, and redirects cannot bounce a request to one.
* Good, because the resolver is an interface: tests use a static table, and a later platform
  adapter (SPEC §21.3) can supply its own.
* Bad, because the rebinding gap is narrowed, not closed: `fetch()` resolves again, and nothing on
  Workers can pin it to the address we checked. Whether Cloudflare refuses Worker subrequests to
  private addresses has not been verified, so the guard does not count on it. Closing the gap
  needs an egress proxy outside Workers that checks the address it actually connects to (for
  example Stripe's Smokescreen); that is a stack change with its own ADR, to decide before webhook
  delivery calls user-supplied URLs.
* Bad, because four DoH queries (two before, two after) add latency to every guarded request (low,
  since 1.1.1.1 answers from the same edge). A short cache bounded by the record TTL is a possible
  follow-up.
* Bad, because hosts whose DNS TTL is under 30 s, or that need a port other than 443, cannot be
  webhook destinations or provider endpoints.

### Confirmation

`packages/core/src/http/*.test.ts`: refusal of IP literals, other ports, local names, names
resolving to private, loopback, link-local, metadata, IPv4-mapped or NAT64 addresses, short TTLs
and unresolvable names, with no request sent; a name that rebinds after the request failing with
`destination_changed`; the deadline covering the lookup.

## Pros and Cons of the Options

### `connect()` with our own HTTP client

* Good, because the check and the connection would use the same address, closing the rebinding gap.
* Bad, because `connect()` takes a hostname and does not expose the peer address either, and we
  would be writing an HTTP/1.1 client with TLS by hand: far more code on the command path.

### Egress proxy outside Workers

* Good, because the proxy resolves once, checks, and connects to that same address: no gap.
* Bad, because it is a service to host, patch and monitor, adds a hop to every guarded request,
  and changes the stack (PLAN §3). Left for its own ADR.

### IP literals only

* Good, because it is trivial.
* Bad, because any hostname pointing at a private or metadata address passes, which is the
  attack the guard exists to stop.

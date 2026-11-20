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
(`cloudflare-dns.com/dns-query`), refuses the request unless every address is public, and then
calls `fetch()` with `redirect: 'manual'`. IP literals are checked directly; `localhost`, dotless
names and `.local`/`.internal`-style suffixes are refused without a lookup. Any resolver failure
fails closed. The lookup runs inside the request deadline.

### Consequences

* Good, because nothing reaches a blocked destination, and redirects cannot bounce a request to one.
* Good, because the resolver is an interface: tests use a static table, and a later platform
  adapter (SPEC §21.3) can supply its own.
* Bad, because of DNS rebinding: `fetch()` resolves again, so a name with a very short TTL could
  answer differently a moment later. Whether Cloudflare refuses Worker subrequests to private
  addresses has not been verified, so the guard does not count on it.
* Bad, because two DoH queries add latency to every guarded request (low, since 1.1.1.1 answers
  from the same edge). A short cache bounded by the record TTL is a possible follow-up.

### Confirmation

`packages/core/src/http/*.test.ts`: refusal of private, loopback, link-local, metadata, IPv4-mapped
and NAT64 addresses, of names resolving to any of them, and of unresolvable names, with no request
sent; the deadline covering the lookup.

## Pros and Cons of the Options

### `connect()` with our own HTTP client

* Good, because the check and the connection would use the same address, closing the rebinding gap.
* Bad, because `connect()` takes a hostname and does not expose the peer address either, and we
  would be writing an HTTP/1.1 client with TLS by hand: far more code on the command path.

### IP literals only

* Good, because it is trivial.
* Bad, because any hostname pointing at a private or metadata address passes, which is the
  attack the guard exists to stop.

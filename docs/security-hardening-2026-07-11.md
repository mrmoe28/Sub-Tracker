# Security Hardening — 2026-07-11

Record of infrastructure security changes made in response to an external
"BotStop" scan of `sub.lock28.com` / `lock28.com`. None of these changes are in
application code — they live in Cloudflare DNS and on the self-hosted Proxmox
host. This file exists only as an audit trail.

## 1. Email authentication (Cloudflare DNS, zone `lock28.com`)

Verified sending reality first: the app (`src/lib/email.ts`) sends via
`smtp.gmail.com` from a `@gmail.com` address (`GMAIL_USER`), MX is Namecheap
email forwarding, and there is **no Google Workspace**. Conclusion: no mail
stream sends as `@lock28.com`, so the domain can be locked down hard.

| Record | Before | After |
| --- | --- | --- |
| SPF (`lock28.com` TXT) | `v=spf1 include:spf.efwd.registrar-servers.com include:_spf.google.com ~all` | `... -all` |
| DMARC (`_dmarc.lock28.com` TXT) | `v=DMARC1; p=none; rua=mailto:ekosolarize@gmail.com; fo=1` | `v=DMARC1; p=reject; sp=reject; rua=mailto:ekosolarize@gmail.com; fo=1` |

- `-all` = hard-fail any sender not in the include list (real senders still pass).
- `p=reject; sp=reject` = reject forged mail for the domain and all subdomains.
- Both verified live at Cloudflare's authoritative nameservers via `dig`.

**DKIM: intentionally not added.** No signer exists for `@lock28.com`
(Namecheap forwards, the app sends as gmail.com, no Workspace). Publishing a
selector nothing uses would be theater. Revisit only if a Google Workspace or
an ESP (SendGrid/Mailchimp) that signs as `lock28.com` is adopted.

## 2. "Open ports" scan findings — false positive

The scan flagged `104.21.17.55` and `172.67.222.85` on ports 80/443/8080.
Those are **Cloudflare's shared anycast edge**, not the origin
(`lock28.com` DNS is at Cloudflare and both hosts are proxied). Nothing to
close there; those ports are Cloudflare's by design.

## 3. Proxmox host firewall (`192.168.50.2`)

The origin sits behind a Cloudflare Tunnel (`cloudflared` runs inside LXC
CT 104, outbound-only), so no inbound ports need to be open. However
`pve-firewall` was **disabled** — the only thing keeping the Proxmox UI
(`:8006`), Coolify panel (`:8000`), rpcbind (`:111`), Netdata (`:19999`), and
Squid (`:3128`) off the internet was the home router's NAT. That is
single-layer defense.

Enabled a host firewall for defense-in-depth:

- `/etc/pve/firewall/cluster.fw`: `enable: 1`, `policy_in: DROP`, `policy_out: ACCEPT`.
- `/etc/pve/nodes/pve/host.fw` rules: `IN ACCEPT` from `192.168.50.0/24` and
  `192.168.1.0/24` (trusted LANs); everything else inbound dropped.
- CT 104 is unfiltered (no `104.fw`), so the tunnel/app path is unaffected.

Verified after enabling: fresh SSH login works (no lockout), `sub.lock28.com`
still returns HTTP 200 through the tunnel, `cloudflared` active, firewall
persists at boot. A 10-minute auto-rollback was armed during the change as a
lockout safety net, then disarmed on success.

### Lockout-safe procedure (reuse for remote firewall changes)

1. Stage config with `enable: 0`; validate with `pve-firewall compile`.
2. Arm auto-rollback: `nohup bash -c 'sleep 600; [ -f /tmp/fw_ok ] || /root/fw-rollback.sh' &`.
3. Flip `enable: 1`; confirm the source-allow rule is in `iptables-save` **and**
   a fresh SSH connection succeeds.
4. `touch /tmp/fw_ok` to disarm; otherwise it auto-reverts.

## Open follow-ups (not done)

- rpcbind / Squid / Netdata still listen on `0.0.0.0` (LAN-reachable, now
  internet-blocked); could bind-restrict or disable.
- Coolify panel + Proxmox UI could go behind Cloudflare Access for an auth layer.
- External port probe was run from the same LAN (NAT hairpin) so it is not an
  authoritative internet-view; confirm with an off-LAN scan
  (e.g. grc.com/shieldsup) against the public IP.

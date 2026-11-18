/**
 * Which proxy hops in front of the app are trusted when working out the visitor's IP (req.ip).
 *
 * On Render the chain is: visitor -> Cloudflare -> Render's load balancer (private address) -> app.
 * Each hop appends the address it received the request from to X-Forwarded-For. Express walks that
 * list from the right, skipping trusted hops, and the first untrusted address is the visitor.
 * Trusting only the private hops stopped at Cloudflare's edge (every visitor showed as a 104.x
 * Cloudflare address), so Cloudflare's published ranges are trusted too.
 *
 * Spoofing is not possible: anything a visitor puts in X-Forwarded-For sits to the LEFT of the
 * address Cloudflare appends for them, and the walk stops there.
 * Source: https://www.cloudflare.com/ips/ (update if Cloudflare publishes new ranges).
 * Extra ranges can be added with TRUSTED_PROXIES (comma-separated CIDRs).
 */
export const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
  '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
];

export function trustedProxies(extra = process.env.TRUSTED_PROXIES) {
  const more = String(extra || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ['loopback', 'linklocal', 'uniquelocal', ...CLOUDFLARE_RANGES, ...more];
}

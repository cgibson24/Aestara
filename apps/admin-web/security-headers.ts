// The admin portal's Content Security Policy and companion headers
// (SECURITY_REQUIREMENTS.md open item 9; spec §6.1.10; ADR-0022). The portal
// loads only its own hashed bundles and talks only to the api on the same
// site, so everything else is refused. CloudFront serves these headers in
// deployed environments; `vite preview` serves them locally and in the
// end-to-end tests; the production build also carries the policy in a meta
// tag, which cannot express frame-ancestors.
const directives: Record<string, string> = {
  "default-src": "'none'",
  "script-src": "'self'",
  "style-src": "'self'",
  "img-src": "'self'",
  "font-src": "'self'",
  "connect-src": "'self'",
  "manifest-src": "'self'",
  "base-uri": "'none'",
  "form-action": "'self'",
  "object-src": "'none'",
};

export const CONTENT_SECURITY_POLICY = Object.entries(directives)
  .map(([name, value]) => `${name} ${value}`)
  .join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": `${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

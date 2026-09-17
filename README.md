# Cited

Public marketing / offer site for **Cited** — AI visibility on autopilot.

## Product

Bot AEO Monthly landing page featuring:
- AI citation & answer-engine optimization retainer service
- Targeting B2B SaaS founders and heads of growth
- Pricing tiers: Pilot ($499/$750), Focus ($1,500/mo), Standard ($2,500/mo)
- Focus tier as primary CTA with Stripe Payment Links

## Structure

- `index.html` — Main landing page
- `checkout/success.html` — Payment success page
- `checkout/cancel.html` — Payment cancelled page

## Local Development

Open `index.html` in a browser, or serve statically:

```bash
npx --yes serve .
```

## Deploy

Cloudflare Pages auto-deploys from `main` branch via GitHub webhook.
Push to `main` triggers production deployment to citedhq.ai.

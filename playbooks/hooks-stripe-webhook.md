# Stripe Webhook Worker Setup — hooks.citedhq.ai

**Goal:** Deploy dedicated Cloudflare Worker for Stripe webhooks at `hooks.citedhq.ai`, separating payment processing from main marketing site.

## Overview

- **Worker Name:** `cited-stripe-webhook`
- **Custom Domain:** `hooks.citedhq.ai`
- **Webhook URL:** `https://hooks.citedhq.ai/`
- **Worker Location:** `workers/stripe-webhook/`

## Deployment Steps

### 1. Deploy Cloudflare Worker

**Option A: Command Line (Recommended)**
```bash
cd workers/stripe-webhook
npm install
npx wrangler deploy
```

**Option B: Cloudflare Dashboard**
1. Go to **Cloudflare Dashboard** → **Workers & Pages**
2. Click **"Create application"** → **"Create Worker"**
3. Name: `cited-stripe-webhook`
4. Copy-paste code from `workers/stripe-webhook/index.ts`
5. Click **"Save and Deploy"**

### 2. Add Custom Domain

1. In **Cloudflare Dashboard** → **Workers & Pages** → **cited-stripe-webhook**
2. Go to **Settings** → **Triggers** → **Custom Domains**
3. Click **"Add Custom Domain"**
4. Enter: `hooks.citedhq.ai`
5. Click **"Add Custom Domain"**

### 3. DNS Configuration

Add this CNAME record to your DNS (replace `<worker-subdomain>` with actual value from Cloudflare):

```dns
hooks CNAME <worker-subdomain>.workers.dev
```

**Example:**
```dns
hooks CNAME cited-stripe-webhook.vikash-sparx.workers.dev
```

**To find the exact target:**
- After deploying worker, check Dashboard → Workers & Pages → cited-stripe-webhook → Settings → Triggers
- Copy the `*.workers.dev` URL shown and use that as CNAME target

### 4. Verify Worker is Live

**Test with curl:**
```bash
# Test GET request (should return 405 with status message)
curl -X GET https://hooks.citedhq.ai/

# Expected response (with 405 status):
# "Cited Stripe Webhook Worker is live at hooks.citedhq.ai..."

# Test POST without signature (should return 400)
curl -X POST https://hooks.citedhq.ai/

# Expected response: "Missing signature"
```

**✅ Only proceed to Stripe setup AFTER curl confirms the worker is responding.**

## Stripe Configuration

### 5. Set Environment Variable

In **Cloudflare Dashboard** → **Workers & Pages** → **cited-stripe-webhook** → **Settings** → **Environment Variables**:

| Variable | Value | Notes |
|----------|--------|-------|
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | From Stripe Dashboard webhook endpoint |

**Alternative via CLI:**
```bash
cd workers/stripe-webhook
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# Enter the whsec_... value when prompted
```

### 6. Update Stripe Endpoint

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Find existing webhook endpoint OR click **"+ Add endpoint"**
3. Set **Endpoint URL:** `https://hooks.citedhq.ai/`
4. Select **Events to listen to:**
   - ✅ `checkout.session.completed`
   - ✅ `invoice.paid`
   - ✅ `customer.subscription.created` (optional)
   - ✅ `customer.subscription.updated` (optional)

### 7. Get Webhook Secret

1. Click on the webhook endpoint in Stripe Dashboard
2. Click **"Reveal"** in **Signing secret** section
3. Copy the `whsec_...` value
4. Set as `STRIPE_WEBHOOK_SECRET` in Cloudflare (step 5 above)

## Testing & Verification

### End-to-End Test

1. **Create test payment** using Stripe test mode
2. **Check Worker logs:**
   ```bash
   cd workers/stripe-webhook
   npx wrangler tail
   ```
3. **Verify webhook receives events** — look for:
   - `Processing Stripe event: checkout.session.completed <event-id>`
   - `Payment receipt processed: <event-id> <sku>`

### Webhook Health Check

**Quick verification commands:**
```bash
# Worker is live (should return 405 with status text)
curl -v -X GET https://hooks.citedhq.ai/

# Worker handles POST (should return 400 "Missing signature")  
curl -v -X POST https://hooks.citedhq.ai/

# Wrong method (should return 405 "Method not allowed")
curl -v -X PUT https://hooks.citedhq.ai/
```

## Monitoring

### Real-time Logs
```bash
cd workers/stripe-webhook
npx wrangler tail --format pretty
```

### Cloudflare Dashboard Logs
**Workers & Pages** → **cited-stripe-webhook** → **Logs** → **Real-time Logs**

### Stripe Dashboard
**Developers** → **Webhooks** → **[hooks.citedhq.ai endpoint]** → check delivery success rates

## Architecture Notes

### Separation of Concerns
- **hooks.citedhq.ai** (this Worker) — Stripe webhooks only
- **citedhq.ai** (nginx/Pages) — Marketing site continues unchanged

### Event Processing
- Same logic as existing `functions/api/stripe/webhook.ts`
- Handles: `checkout.session.completed`, `invoice.paid`
- SKU mapping: PILOT-499, PILOT-750, FOCUS, STD, FULL
- Logs payment receipts for Conductor queue processing

### Future Enhancements
- **Durable Storage:** Cloudflare KV/R2 for receipt persistence
- **Dead Letter Queue:** Failed event retry handling
- **Monitoring:** Real-time alerts for webhook failures

## Troubleshooting

### Worker Not Responding
1. Check deployment: `npx wrangler whoami` and `npx wrangler list`
2. Verify custom domain: Cloudflare Dashboard → Workers & Pages → Settings → Triggers
3. Check DNS propagation: `dig hooks.citedhq.ai CNAME`

### "Invalid signature" Errors
1. Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
2. Check webhook endpoint URL in Stripe: `https://hooks.citedhq.ai/`
3. Test with: `curl -X POST https://hooks.citedhq.ai/` (should return "Missing signature")

### Events Not Processing  
1. Check worker logs: `npx wrangler tail`
2. Verify supported events in Stripe Dashboard
3. Test with Stripe CLI: `stripe trigger checkout.session.completed`

## Rollback Plan

If issues arise, disable the new webhook:
1. **Stripe Dashboard** → **Webhooks** → **[hooks.citedhq.ai endpoint]** → **"Disable"**
2. Keep existing `citedhq.ai/api/stripe/webhook` as backup
3. Re-enable original endpoint if needed

## Security

- **Signature Verification:** HMAC-SHA256 with 5-minute timestamp tolerance
- **Environment Variables:** STRIPE_WEBHOOK_SECRET stored securely in Cloudflare
- **HTTPS Only:** Worker only accessible via HTTPS
- **Event Whitelisting:** Only processes known event types
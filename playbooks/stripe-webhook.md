# Stripe Webhook Setup — Cited

**Goal:** Configure Stripe webhook for Cited payment processing with Cloudflare Pages Functions.

## Webhook Endpoint

- **URL:** `https://citedhq.ai/api/stripe/webhook`
- **Method:** POST
- **Function Location:** `functions/api/stripe/webhook.ts`

## Required Environment Variables

### Cloudflare Pages Configuration

Set in **Cloudflare Dashboard** → **Pages** → **cited project** → **Settings** → **Environment Variables**:

| Variable | Value | Notes |
|----------|--------|-------|
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Webhook endpoint secret from Stripe Dashboard |

⚠️ **Never commit the webhook secret to git** — it's for verification only.

## Stripe Dashboard Setup

### 1. Create Webhook Endpoint

1. Go to **Stripe Dashboard** → **Developers** → **Webhooks**
2. Click **"+ Add endpoint"**
3. Set **Endpoint URL:** `https://citedhq.ai/api/stripe/webhook`
4. Select **Events to listen to:** (see below)

### 2. Recommended Events

Select these events for Cited payment processing:

#### Required Events
- ✅ `checkout.session.completed` — One-time payments complete
- ✅ `invoice.paid` — Subscription payments and invoices paid

#### Optional Events (Subscription Management)
- ✅ `customer.subscription.created` — New subscription started
- ✅ `customer.subscription.updated` — Subscription modified

#### Other Useful Events (Future)
- `invoice.payment_failed` — Failed subscription payments
- `customer.subscription.deleted` — Subscription cancelled

### 3. Get Webhook Secret

After creating the endpoint:
1. Click on the webhook endpoint
2. Click **"Reveal"** in the **Signing secret** section
3. Copy the `whsec_...` value
4. Set as `STRIPE_WEBHOOK_SECRET` in Cloudflare Pages environment

## Testing Webhook

### Local Testing (Optional)

Use Stripe CLI for local development:

```bash
# Install Stripe CLI
# Forward events to local server
stripe listen --forward-to localhost:8788/api/stripe/webhook

# Test with specific event
stripe trigger checkout.session.completed
```

### Production Testing

1. **Create test payment** using Stripe test mode payment links
2. **Check Cloudflare Function logs** in Cloudflare Dashboard
3. **Verify receipt creation** in `queue/payments/`
4. **Monitor Conductor processing** for state transitions

## Function Behavior

### Success Response
- **HTTP 200** with body "OK"
- Payment receipt stored in `queue/payments/`
- Event logged (without secrets)

### Error Responses
- **HTTP 400** — Missing signature header
- **HTTP 401** — Invalid signature (webhook secret mismatch)
- **HTTP 405** — Wrong HTTP method (only POST supported)
- **HTTP 500** — Internal processing error (Stripe will retry)

## Security Features

### Signature Verification
- Uses HMAC-SHA256 with webhook secret
- Rejects events older than 5 minutes
- Constant-time signature comparison

### Data Handling
- Only processes whitelisted event types
- Never logs webhook secret value
- Stores minimal payment metadata (no card details)

## Monitoring

### Cloudflare Function Logs

Check **Cloudflare Dashboard** → **Pages** → **cited** → **Functions** → **Real-time Logs**

Look for:
- `Processing Stripe event: {type} {id}`
- `Payment receipt processed: {event_id} {sku}`

### Stripe Dashboard

Check **Stripe Dashboard** → **Developers** → **Webhooks** → **[endpoint]**

Monitor:
- Event delivery success rate
- Failed delivery attempts
- Response times

## Troubleshooting

### Common Issues

**"Invalid signature" errors:**
- Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
- Check webhook endpoint URL is correct
- Ensure function is deployed and accessible

**Events not processing:**
- Check selected events in Stripe Dashboard
- Verify function logs in Cloudflare
- Test endpoint accessibility: `curl -X POST https://citedhq.ai/api/stripe/webhook`

**Missing receipts:**
- Check function logs for errors
- Verify `queue/payments/` directory structure
- For production: check KV/R2 storage (when implemented)

### Webhook Secret Rotation

When rotating webhook secrets:
1. Generate new secret in Stripe Dashboard
2. Update `STRIPE_WEBHOOK_SECRET` in Cloudflare Pages
3. Deploy changes (environment updates are immediate)
4. Test with new payments

## Production Considerations

### Current Implementation (Day-0)
- File-based receipt storage (logged to console)
- Sync processing within 10-second Stripe timeout

### Future Improvements
- **Durable storage:** Cloudflare KV or R2 for receipt persistence
- **Async processing:** Queue webhook events for later processing
- **Database integration:** Direct ticket creation in Notion/Supabase
- **Monitoring:** Real-time alerts for webhook failures
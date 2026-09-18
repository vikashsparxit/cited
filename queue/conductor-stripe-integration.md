# Conductor ↔ Stripe Webhook Integration

**Integration path:** Stripe webhook → Payment receipt → Conductor state transition → Intake opens

## Overview

The Stripe webhook at `https://citedhq.ai/api/stripe/webhook` creates verified payment receipts in `queue/payments/` for Conductor to process. This enables the critical state transition: `paid` → `intake_open`.

## Processing Flow

### 1. Webhook Receipt Processing

**Conductor should monitor** `queue/payments/` for new JSON receipts:

```bash
# Example monitoring (could be cron, file watcher, etc.)
for receipt in queue/payments/payment_*.json; do
  process_payment_receipt "$receipt"
done
```

### 2. Receipt Validation

Before creating tickets, verify:
- `status === "paid"`
- `event_type` is supported (`checkout.session.completed`, `invoice.paid`, etc.)
- Receipt has valid `customer_email` and `payment_metadata.sku`

### 3. Ticket Creation

From each verified receipt, create Conductor ticket with:

```json
{
  "ticket_id": "cited-{timestamp}-{short_event_id}",
  "state": "intake_open",
  "sku_code": "{payment_metadata.sku}",
  "client_email": "{customer_email}",
  "amount": "{amount}",
  "currency": "{currency}",
  "stripe_event_id": "{event_id}",
  "owners": ["Intake"],
  "blockers": "",
  "pack_path": "",
  "created_at": "{timestamp}",
  "updated_at": "{timestamp}"
}
```

### 4. Post-Processing

After successful ticket creation:
1. **Move receipt** to `queue/payments/processed/`
2. **Notify Intake** (per Conductor playbook rules)
3. **Log state transition**: `paid` → `intake_open`

## SKU → Ticket Mapping

| Receipt SKU | Conductor sku_code | Notes |
|-------------|-------------------|--------|
| `PILOT-499` | `PILOT` | One-time $499 |
| `PILOT-750` | `PILOT` | One-time $750 |
| `FOCUS` | `FOCUS` | $1,500/mo recurring |
| `STD` | `STD` | $2,500/mo recurring | 
| `FULL` | `FULL` | $3,500/mo recurring |

## Error Handling

**Failed receipt processing:**
- Log error with `event_id`
- Move receipt to `queue/payments/failed/`
- Alert Billing for manual resolution

**Duplicate events:**
- Check existing tickets by `stripe_event_id`
- Skip if already processed
- Archive duplicate receipt

## Notification Flow

Per Conductor playbook, when `paid` → `intake_open`:

> **Paid verified** → Notify Intake (+ Billing ack)

Implementation:
1. **Intake notification**: Create ticket, email client brief request
2. **Billing acknowledgment**: Log successful webhook processing

## Implementation Notes

### Day-0 File-Based Processing

```python
# Simple Python processor example
import json
import os
from datetime import datetime

def process_payment_receipt(receipt_path):
    with open(receipt_path) as f:
        receipt = json.load(f)
    
    if receipt['status'] != 'paid':
        return False
        
    ticket = create_conductor_ticket(receipt)
    notify_intake(ticket)
    
    # Archive processed receipt
    processed_path = receipt_path.replace('/payments/', '/payments/processed/')
    os.rename(receipt_path, processed_path)
    
    return True
```

### Production Considerations

- **Cloudflare Integration**: Webhook writes to KV/R2, Conductor reads from there
- **Database Integration**: Store tickets in Supabase/Notion instead of file-based
- **Real-time Processing**: Use Cloudflare Workers + webhooks instead of polling
- **Monitoring**: Add alerting for failed webhook processing

## Security Notes

- Webhook verifies Stripe signature before creating receipts
- Never log `STRIPE_WEBHOOK_SECRET` value
- Receipts contain no sensitive payment details (only metadata)
- Customer email is the only PII in receipts
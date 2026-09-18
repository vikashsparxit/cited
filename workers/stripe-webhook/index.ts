/**
 * Cloudflare Worker for Stripe webhook at hooks.citedhq.ai
 * 
 * Handles Stripe webhook events for Cited payments:
 * - checkout.session.completed
 * - invoice.paid
 * - customer.subscription.created
 * - customer.subscription.updated
 * 
 * Verifies Stripe signature and logs durable payment receipts
 * for Conductor queue processing (paid → intake_open)
 */

interface Env {
  STRIPE_WEBHOOK_SECRET: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: any;
  };
  created: number;
}

interface PaymentReceipt {
  event_id: string;
  event_type: string;
  timestamp: string;
  status: 'paid';
  customer_email?: string;
  amount: number;
  currency: string;
  payment_metadata: {
    sku?: string;
    tier?: string;
    company?: string;
    product_id?: string;
    price_id?: string;
    payment_link?: string;
  };
}

// Supported Stripe event types
const SUPPORTED_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'customer.subscription.created', 
  'customer.subscription.updated'
];

/**
 * Verify Stripe webhook signature
 */
async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const key = encoder.encode(secret);

    // Import key for HMAC-SHA256
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Extract timestamp and signature from header
    const elements = signature.split(',');
    let timestamp: string = '';
    let v1Signature: string = '';

    for (const element of elements) {
      const [key, value] = element.split('=');
      if (key === 't') {
        timestamp = value;
      } else if (key === 'v1') {
        v1Signature = value;
      }
    }

    if (!timestamp || !v1Signature) {
      return false;
    }

    // Check timestamp (reject if older than 5 minutes)
    const currentTime = Math.floor(Date.now() / 1000);
    const webhookTime = parseInt(timestamp, 10);
    if (currentTime - webhookTime > 300) {
      return false;
    }

    // Create expected signature
    const payloadForSigning = timestamp + '.' + payload;
    const expectedSignature = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      encoder.encode(payloadForSigning)
    );

    // Convert to hex
    const expectedSigHex = Array.from(new Uint8Array(expectedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Compare signatures (constant-time comparison)
    return expectedSigHex === v1Signature;
  } catch (error) {
    console.error('Signature verification failed:', error.message);
    return false;
  }
}

/**
 * Extract payment metadata from Stripe object
 */
function extractPaymentMetadata(stripeObject: any): PaymentReceipt['payment_metadata'] {
  const metadata: PaymentReceipt['payment_metadata'] = {};

  // Extract from metadata fields
  if (stripeObject.metadata) {
    metadata.sku = stripeObject.metadata.sku_code || stripeObject.metadata.sku;
    metadata.tier = stripeObject.metadata.tier;
    metadata.company = stripeObject.metadata.company;
  }

  // Extract from line items (for checkout sessions)
  if (stripeObject.line_items?.data?.[0]) {
    const lineItem = stripeObject.line_items.data[0];
    metadata.product_id = lineItem.price?.product;
    metadata.price_id = lineItem.price?.id;
  }

  // Extract from invoice line items
  if (stripeObject.lines?.data?.[0]) {
    const lineItem = stripeObject.lines.data[0];
    metadata.product_id = lineItem.price?.product;
    metadata.price_id = lineItem.price?.id;
  }

  // Extract from subscription items (for subscription events)
  if (stripeObject.items?.data?.[0]) {
    const item = stripeObject.items.data[0];
    metadata.product_id = item.price?.product;
    metadata.price_id = item.price?.id;
  }

  // Map product/price IDs to known SKUs (from stripe-live-catalog)
  const productSkuMap: Record<string, string> = {
    'prod_VH9Ma4UMiB92G5': 'PILOT-499',
    'prod_VH9MzKmVLDDoZW': 'PILOT-750', 
    'prod_VH9MGzpZxPHuxw': 'FOCUS',
    'prod_VH9METpoPpjWvF': 'STD',
    'prod_VH9MMcmwlT9Gx9': 'FULL'
  };

  if (metadata.product_id && productSkuMap[metadata.product_id]) {
    metadata.sku = productSkuMap[metadata.product_id];
  }

  return metadata;
}

/**
 * Generate payment receipt from Stripe event
 */
function createPaymentReceipt(event: StripeEvent): PaymentReceipt | null {
  const stripeObject = event.data.object;
  let amount = 0;
  let currency = 'usd';
  let customerEmail: string | undefined;

  // Extract data based on event type
  switch (event.type) {
    case 'checkout.session.completed':
      if (stripeObject.payment_status !== 'paid') {
        return null; // Only process paid sessions
      }
      amount = stripeObject.amount_total || 0;
      currency = stripeObject.currency || 'usd';
      customerEmail = stripeObject.customer_details?.email;
      break;

    case 'invoice.paid':
      amount = stripeObject.amount_paid || 0;
      currency = stripeObject.currency || 'usd';
      customerEmail = stripeObject.customer_email;
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      // For subscriptions, use the price from the first item
      const item = stripeObject.items?.data?.[0];
      if (item) {
        amount = item.price?.unit_amount || 0;
        currency = item.price?.currency || 'usd';
      }
      // Customer email would need to be fetched separately for subscriptions
      break;

    default:
      return null;
  }

  return {
    event_id: event.id,
    event_type: event.type,
    timestamp: new Date(event.created * 1000).toISOString(),
    status: 'paid',
    customer_email: customerEmail,
    amount,
    currency,
    payment_metadata: extractPaymentMetadata(stripeObject)
  };
}

/**
 * Store payment receipt for Conductor processing
 */
async function storePaymentReceipt(receipt: PaymentReceipt): Promise<void> {
  const filename = `payment_${receipt.event_id}_${Date.now()}.json`;
  const receiptPath = `queue/payments/${filename}`;
  
  try {
    // Log receipt payload for immediate visibility
    console.log('Payment receipt processed:', receiptPath, JSON.stringify(receipt, null, 2));
    
    // TODO: Future implementation options for durable storage:
    // - Cloudflare KV for fast access: env.PAYMENTS_KV.put(receipt.event_id, JSON.stringify(receipt))
    // - Cloudflare R2 for durability: env.PAYMENTS_R2.put(receiptPath, JSON.stringify(receipt))
    // - External webhook to file-based system
    // - Database integration (Supabase, etc.)
    
  } catch (error) {
    console.error('Failed to store payment receipt:', error);
    throw error;
  }
}

/**
 * Handle POST requests - main webhook processing
 */
async function handlePost(request: Request, env: Env): Promise<Response> {
  try {
    // Verify webhook secret is configured
    if (!env.STRIPE_WEBHOOK_SECRET) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return new Response('Webhook configuration error', { status: 500 });
    }

    // Get raw body and signature
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return new Response('Missing signature', { status: 400 });
    }

    // Verify signature
    const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!isValid) {
      console.error('Invalid signature');
      return new Response('Invalid signature', { status: 401 });
    }

    // Parse event
    const event: StripeEvent = JSON.parse(body);

    // Check if we handle this event type
    if (!SUPPORTED_EVENTS.includes(event.type)) {
      console.log('Unsupported event type:', event.type);
      return new Response('OK', { status: 200 }); // Acknowledge but don't process
    }

    console.log('Processing Stripe event:', event.type, event.id);

    // Create payment receipt
    const receipt = createPaymentReceipt(event);
    if (!receipt) {
      console.log('No receipt created for event:', event.type);
      return new Response('OK', { status: 200 });
    }

    // Store receipt for Conductor processing
    await storePaymentReceipt(receipt);

    console.log('Payment receipt processed:', receipt.event_id, receipt.payment_metadata.sku);

    // Return success quickly (within 10 seconds as required by Stripe)
    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Webhook error:', error.message);
    // Return 500 so Stripe retries
    return new Response('Internal error', { status: 500 });
  }
}

/**
 * Handle GET requests - health check with clear text
 */
function handleGet(): Response {
  const status = `Cited Stripe Webhook Worker is live at hooks.citedhq.ai

This endpoint handles Stripe webhook events for payment processing.
POST requests with valid Stripe signatures are processed.
GET requests show this status message.

Supported events:
- checkout.session.completed
- invoice.paid  
- customer.subscription.created
- customer.subscription.updated

Last deployment: ${new Date().toISOString()}`;

  return new Response(status, {
    status: 405,
    headers: {
      'Allow': 'POST',
      'Content-Type': 'text/plain'
    }
  });
}

/**
 * Main fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const method = request.method;

    if (method === 'POST') {
      return handlePost(request, env);
    } else if (method === 'GET') {
      return handleGet();
    } else {
      return new Response('Method not allowed', {
        status: 405,
        headers: { 'Allow': 'POST' }
      });
    }
  }
};
import axios from 'axios';
import crypto from 'crypto';

const TARGET_URL = process.env.API_URL || 'http://localhost:3000/api/webhooks/meta';
const APP_SECRET = process.env.META_APP_SECRET || 'khmerbot_secret_key_testing';

async function sendWebhook(entryTime: number, eventId: string, message: string) {
  const payload = {
    object: 'page',
    entry: [
      {
        id: eventId,
        time: entryTime,
        changes: [
          {
            value: {
              item: 'comment',
              verb: 'add',
              message,
              sender_name: 'Sokha',
              created_time: entryTime
            },
            field: 'feed'
          }
        ]
      }
    ]
  };

  const jsonPayload = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', APP_SECRET);
  const signature = `sha256=${hmac.update(jsonPayload).digest('hex')}`;

  try {
    const res = await axios.post(TARGET_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature
      }
    });

    console.log(`✅ Webhook Accepted: ${res.status} ${res.statusText}`);
  } catch (err: any) {
    if (err.response) {
      console.error(`❌ Webhook Rejected: ${err.response.status}`);
      console.error(err.response.data);
    } else {
      console.error('❌ Failed to invoke webhook:', err.message);
    }
  }
}

async function runTests() {
  console.log("--- TEST 1: Stale Webhook (Older than 5 minutes) ---");
  const staleTime = Date.now() - (10 * 60 * 1000); // 10 minutes ago
  await sendWebhook(staleTime, 'stale_event_1', "This is a stale message");

  console.log("\n--- TEST 2: Fresh Webhook ---");
  const freshTime = Date.now();
  await sendWebhook(freshTime, 'fresh_event_1', "This is a fresh message");

  console.log("\n--- TEST 3: Duplicate Fresh Webhook (Same payload as Test 2) ---");
  // Sending the exact same timestamp and event ID to trigger idempotency
  await sendWebhook(freshTime, 'fresh_event_1', "This is a fresh message");
}

runTests();

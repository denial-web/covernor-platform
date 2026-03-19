import axios from 'axios';
import crypto from 'crypto';

const TARGET_URL = process.env.API_URL || 'http://localhost:3000/api/webhooks/meta';
const APP_SECRET = process.env.META_APP_SECRET || 'khmerbot_secret_key_testing';

async function sendWebhook(timestamp: number, eventId: string) {
  const payload = {
    object: 'page',
    entry: [
      {
        id: eventId,
        time: timestamp,
        changes: [
          {
            value: {
              item: 'comment',
              verb: 'add',
              message: 'Check out this order issue please!',
              sender_name: 'TestUser',
              created_time: timestamp
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
    console.log(`✅ Webhook Enqueued [${eventId}]: ${res.status}`);
  } catch (err: any) {
    console.error(`❌ Webhook Failed [${eventId}]:`, err.message);
  }
}

async function runNoisyNeighborTest() {
  console.log("🚀 Simulating a Viral Post (5 rapid webhooks for default_tenant)");
  
  // We send 5 distinct webhooks simultaneously 
  // (Using slightly different timestamps/IDs to bypass phase 9 idempotency guard)
  const burstTime = Date.now();
  
  const requests = [];
  for (let i = 1; i <= 5; i++) {
     requests.push(sendWebhook(burstTime, `noisy_event_${i}`));
  }

  await Promise.all(requests);
  console.log("\n✅ Burst Sent! Watch the server logs to see tasks 3, 4, and 5 get delayed.");
}

runNoisyNeighborTest();

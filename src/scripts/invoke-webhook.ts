import axios from 'axios';
import crypto from 'crypto';

const TARGET_URL = process.env.API_URL || 'http://localhost:3000/api/webhooks/meta';
const APP_SECRET = process.env.META_APP_SECRET || 'khmerbot_secret_key_testing';

const payload = {
  object: 'page',
  entry: [
    {
      id: '1234567890',
      time: Date.now(),
      changes: [
        {
          value: {
            item: 'comment',
            verb: 'add',
            message: 'My order #999 did not arrive yet, can someone please check this?',
            sender_name: 'Sokha',
            created_time: Date.now()
          },
          field: 'feed'
        }
      ]
    }
  ]
};

async function invokeWebhook() {
  const jsonPayload = JSON.stringify(payload);
  const hmac = crypto.createHmac('sha256', APP_SECRET);
  const signature = `sha256=${hmac.update(jsonPayload).digest('hex')}`;

  try {
    console.log(`🚀 Sending mock Meta Webhook to ${TARGET_URL}...`);
    const res = await axios.post(TARGET_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature
      }
    });

    console.log(`✅ Webhook Accepted: ${res.status} ${res.statusText}`);
    console.log('Response body:', res.data);
  } catch (err: any) {
    if (err.response) {
      console.error(`❌ Webhook Rejected: ${err.response.status}`);
      console.error(err.response.data);
    } else {
      console.error('❌ Failed to invoke webhook:', err.message);
    }
  }
}

invokeWebhook();

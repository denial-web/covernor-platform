import { KMSService, ApprovalTokenPayload } from '../core/crypto/kms.service';

function testV2Token() {
   const payload: any = {
      actionType: 'TRANSFER_FUNDS',
      parameters: { amount: 100, recipient: 'vendor_01' }
   };

   const hashA = KMSService.generatePayloadHash('t1', 'task1', 'prop1', 'dec1', payload, 'none1');
   
   // Mutate the parameters slightly
   const payloadMutated: any = {
      actionType: 'TRANSFER_FUNDS',
      parameters: { amount: 1000, recipient: 'vendor_01' }
   };

   const hashB = KMSService.generatePayloadHash('t1', 'task1', 'prop1', 'dec1', payloadMutated, 'none1');

   if (hashA === hashB) {
       console.log("❌ FAIL: Hash didn't detect parameter mutation!");
       process.exit(1);
   }

   console.log("✅ SUCCESS: Hashes correctly detect internal payload mutations.");
   console.log(`Hash A (100):  ${hashA}`);
   console.log(`Hash B (1000): ${hashB}`);
}

testV2Token();

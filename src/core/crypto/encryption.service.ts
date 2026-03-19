import crypto from 'crypto';
import { logger } from '../../utils/logger';

// 32-byte (256-bit) key for AES-256-GCM
// Fallback key only for local dev. In production, provide a strong secret key via ENCRYPTION_MASTER_KEY.
const ENCRYPTION_KEY = process.env.ENCRYPTION_MASTER_KEY 
  ? Buffer.from(process.env.ENCRYPTION_MASTER_KEY, 'base64') 
  : crypto.scryptSync('development_fallback_secret_do_not_use_v4', 'salt', 32);

const ALGORITHM = 'aes-256-gcm';

export class EncryptionService {
  /**
   * Encrypts a plaintext string using AES-256-GCM.
   * Returns a base64 encoded string containing the IV, auth tag, and ciphertext.
   */
  public static encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;
    
    try {
      const iv = crypto.randomBytes(12); // 96-bit IV is standard for GCM
      const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      
      let ciphertext = cipher.update(plaintext, 'utf8', 'base64');
      ciphertext += cipher.final('base64');
      const authTag = cipher.getAuthTag();
      
      // Format: iv:authTag:ciphertext
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext}`;
    } catch (e: any) {
      logger.error('Encryption failed', { error: e.message });
      throw new Error('Failed to encrypt secret data.');
    }
  }

  /**
   * Decrypts a base64 encoded string returned by `encrypt`.
   */
  public static decrypt(encryptedData: string): string {
    if (!encryptedData) return encryptedData;
    
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
         throw new Error('Invalid encrypted data format');
      }
      
      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const ciphertext = parts[2];
      
      const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
      decipher.setAuthTag(authTag);
      
      let plaintext = decipher.update(ciphertext, 'base64', 'utf8');
      plaintext += decipher.final('utf8');
      
      return plaintext;
    } catch (e: any) {
      // logger.error('Decryption failed', { error: e.message });
      throw new Error('Failed to decrypt secret data.');
    }
  }
}

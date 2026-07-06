import crypto from 'crypto';

export function computeSHA1(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
}

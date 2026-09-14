export function publicHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname.endsWith('.invalid') || url.hostname === 'example.com') return null;
    return url.toString();
  } catch { return null; }
}
export const legalLinks = {
  privacy: publicHttpsUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL),
  deletion: publicHttpsUrl(process.env.EXPO_PUBLIC_DATA_DELETION_URL),
};

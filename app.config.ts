import { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = process.env.APP_VARIANT ?? 'development';
  if (!['development', 'preview', 'production'].includes(variant)) throw new Error('APP_VARIANT must be development, preview or production.');
  const version = process.env.APP_VERSION ?? config.version ?? '0.1.0';
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('APP_VERSION must have major.minor.patch format.');
  const projectId = process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId;
  if (projectId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(projectId)) throw new Error('EAS_PROJECT_ID must be a project UUID.');
  const legalUrl = (value: string | undefined) => {
    if (!value) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hostname.endsWith('.invalid') && url.hostname !== 'example.com'; }
    catch { return false; }
  };
  if (variant === 'production') {
    if (!legalUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL) || !legalUrl(process.env.EXPO_PUBLIC_DATA_DELETION_URL)) {
      throw new Error('Production requires real HTTPS privacy-policy and data-deletion URLs. Configure the EXPO_PUBLIC_* URL variables.');
    }
    for (const name of ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID']) {
      if (!/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(process.env[name] ?? '')) throw new Error(`Production requires ${name}.`);
    }
  }
  const iCloudEnvironment = process.env.ICLOUD_CONTAINER_ENVIRONMENT ?? 'Production';
  if (!['Development', 'Production'].includes(iCloudEnvironment)) {
    throw new Error('ICLOUD_CONTAINER_ENVIRONMENT must be Development or Production.');
  }
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (iosClientId && !/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(iosClientId)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be a public iOS OAuth client ID, not a URL or secret.');
  }
  return {
    ...config,
    name: variant === 'production' ? 'ReceiptMind' : variant === 'preview' ? 'ReceiptMind Preview' : 'ReceiptMind Dev',
    slug: config.slug ?? 'scanreciept', version,
    ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
    extra: { ...config.extra, appVariant: variant, ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}) },
    plugins: [...(config.plugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === 'expo-document-picker'
      ? [plugin[0], { ...plugin[1], iCloudContainerEnvironment: iCloudEnvironment }] as [string, Record<string, unknown>]
      : plugin), ...(iosClientId ? [
      ['@react-native-google-signin/google-signin', { iosUrlScheme: iosClientId.split('.').reverse().join('.') }] as [string, { iosUrlScheme: string }],
    ] : [])],
  };
};

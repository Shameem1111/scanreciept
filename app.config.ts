import { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
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
    name: config.name ?? 'ReceiptMind', slug: config.slug ?? 'scanreciept',
    plugins: [...(config.plugins ?? []).map(plugin => Array.isArray(plugin) && plugin[0] === 'expo-document-picker'
      ? [plugin[0], { ...plugin[1], iCloudContainerEnvironment: iCloudEnvironment }] as [string, Record<string, unknown>]
      : plugin), ...(iosClientId ? [
      ['@react-native-google-signin/google-signin', { iosUrlScheme: iosClientId.split('.').reverse().join('.') }] as [string, { iosUrlScheme: string }],
    ] : [])],
  };
};

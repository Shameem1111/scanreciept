import { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (iosClientId && !/^[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(iosClientId)) {
    throw new Error('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be a public iOS OAuth client ID, not a URL or secret.');
  }
  return {
    ...config,
    name: config.name ?? 'ReceiptMind', slug: config.slug ?? 'scanreciept',
    plugins: [...(config.plugins ?? []), ...(iosClientId ? [
      ['@react-native-google-signin/google-signin', { iosUrlScheme: iosClientId.split('.').reverse().join('.') }] as [string, { iosUrlScheme: string }],
    ] : [])],
  };
};

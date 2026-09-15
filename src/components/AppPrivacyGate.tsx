import React, { PropsWithChildren, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { SecondaryButton } from './Ui';
import { prepareScreenPrivacy } from '../services/deviceSecurity';
import { colors } from '../theme';

export function AppPrivacyGate({ children }: PropsWithChildren) {
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);

  async function prepare() {
    setPrivacyError(false);
    try {
      await prepareScreenPrivacy();
      setPrivacyReady(true);
    } catch {
      setPrivacyError(true);
    }
  }

  useEffect(() => { void prepare(); }, []);

  if (privacyReady) return <>{children}</>;
  return <SafeAreaView style={styles.safe}>
    <View style={styles.securitySetup}>
      <Text style={styles.title}>ReceiptMind</Text>
      {privacyError ? <>
        <Text accessibilityRole="alert" style={styles.error}>Screen privacy could not be enabled. Install a native ReceiptMind build, then retry.</Text>
        <SecondaryButton label="Retry security setup" onPress={() => { void prepare(); }} />
      </> : <ActivityIndicator color={colors.primary} size="large" />}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  securitySetup: { flex: 1, justifyContent: 'center', padding: 32, gap: 20 },
  title: { color: colors.text, fontSize: 34, fontWeight: '900' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});

import React, { PropsWithChildren, useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Platform, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Card, SecondaryButton } from './Ui';
import { clearReceiptSession, getReceiptAuthExpiresAt, isReceiptGoogleConfigured, isReceiptSignedIn, signInForReceipts, subscribeReceiptAuth } from '../services/receiptAuth';
import { prepareScreenPrivacy } from '../services/deviceSecurity';
import { colors } from '../theme';

export function useAppAuthentication() {
  const signedIn = useSyncExternalStore(subscribeReceiptAuth, isReceiptSignedIn, () => false);
  useEffect(() => {
    const check = () => { if (signedIn && !isReceiptSignedIn()) clearReceiptSession(); };
    const expiresAt = getReceiptAuthExpiresAt();
    const timer = signedIn && expiresAt ? setTimeout(clearReceiptSession, Math.max(0, expiresAt - Date.now() - 30_000)) : undefined;
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { if (timer !== undefined) clearTimeout(timer); subscription.remove(); };
  }, [signedIn]);
  return signedIn;
}

function LoginScreen() {
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const googleAvailable = isReceiptGoogleConfigured();

  useEffect(() => {
    let active = true;
    const availability = Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false);
    void availability.catch(() => false).then(value => {
      if (active) { setAppleAvailable(value); setChecking(false); }
    });
    return () => { active = false; };
  }, []);

  async function signIn(provider: 'apple' | 'google') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await signInForReceipts(provider); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in could not finish. Try again.'); }
    finally { setBusy(false); }
  }

  return <SafeAreaView style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}>
        <Text style={styles.mark}>R</Text>
        <Text style={styles.title}>ReceiptMind</Text>
        <Text style={styles.subtitle}>Your private, searchable purchase memory.</Text>
      </View>
      <Card style={styles.card}>
        <Text style={styles.heading}>Sign in to continue</Text>
        <Text style={styles.copy}>Use Google or Apple before accessing ReceiptMind. New users are registered securely by their chosen provider; returning users use the same account.</Text>
        {appleAvailable && <View pointerEvents={busy ? 'none' : 'auto'} accessibilityElementsHidden={busy}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={styles.appleButton}
            onPress={() => { void signIn('apple'); }}
          />
        </View>}
        {googleAvailable && <SecondaryButton label="Sign in with Google" disabled={busy} onPress={() => { void signIn('google'); }} />}
        {busy && <View style={styles.progress}><ActivityIndicator color={colors.primary} /><Text style={styles.copy}>Signing in…</Text></View>}
        {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!checking && !appleAvailable && !googleAvailable &&
          <Text accessibilityRole="alert" style={styles.error}>{Platform.OS === 'ios'
            ? 'Sign in with Apple is unavailable in this installed build. Install a newly built ReceiptMind app on a physical iPhone with Apple sign-in enabled; a JavaScript update cannot add the native capability.'
            : 'Sign-in is not configured in this app version. Install a native ReceiptMind build with Google sign-in enabled.'}</Text>}
        <Text style={styles.privacy}>Your password stays with Google or Apple. ReceiptMind never receives or stores it. Original receipts use local device storage by default.</Text>
      </Card>
    </ScrollView>
  </SafeAreaView>;
}

export function AppAuthenticationGate({ children }: PropsWithChildren) {
  const signedIn = useAppAuthentication();
  const [privacyReady, setPrivacyReady] = useState(false);
  const [privacyError, setPrivacyError] = useState(false);
  async function prepare() {
    setPrivacyError(false);
    try { await prepareScreenPrivacy(); setPrivacyReady(true); }
    catch { setPrivacyError(true); }
  }
  useEffect(() => { void prepare(); }, []);

  if (!privacyReady) return <SafeAreaView style={styles.safe}>
    <View style={styles.securitySetup}>
      <Text style={styles.title}>ReceiptMind</Text>
      {privacyError ? <>
        <Text accessibilityRole="alert" style={styles.error}>Screen privacy could not be enabled. Install a native ReceiptMind build, then retry.</Text>
        <SecondaryButton label="Retry security setup" onPress={() => { void prepare(); }} />
      </> : <ActivityIndicator color={colors.primary} size="large" />}
    </View>
  </SafeAreaView>;
  return signedIn ? <>{children}</> : <LoginScreen />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 28 },
  securitySetup: { flex: 1, justifyContent: 'center', padding: 32, gap: 20 },
  brand: { alignItems: 'center', gap: 8 },
  mark: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.primary, color: '#fff', fontSize: 38, lineHeight: 62, fontWeight: '900', textAlign: 'center' },
  title: { color: colors.text, fontSize: 34, fontWeight: '900' },
  subtitle: { color: colors.muted, fontSize: 16, textAlign: 'center' },
  card: { gap: 14 },
  heading: { color: colors.text, fontSize: 22, fontWeight: '800' },
  copy: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  appleButton: { width: '100%', height: 52 },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  privacy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
});

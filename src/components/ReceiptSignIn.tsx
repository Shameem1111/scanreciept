import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Card, SecondaryButton } from './Ui';
import { clearReceiptSession, isReceiptGoogleConfigured, isReceiptSignedIn, signInForReceipts, subscribeReceiptAuth } from '../services/receiptAuth';

export function useReceiptSignIn() {
  const signedIn = useSyncExternalStore(subscribeReceiptAuth, isReceiptSignedIn, () => false);
  useEffect(() => {
    const check = () => { if (signedIn && !isReceiptSignedIn()) clearReceiptSession(); };
    const timer = setInterval(check, 15_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') check(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [signedIn]);
  return signedIn;
}

export function ReceiptSignIn({ disabled }: { disabled: boolean }) {
  const signedIn = useReceiptSignIn();
  const [apple, setApple] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = isReceiptGoogleConfigured();
  useEffect(() => {
    let active = true;
    const availability = Platform.OS === 'ios' ? AppleAuthentication.isAvailableAsync() : Promise.resolve(false);
    void availability.catch(() => false).then(value => { if (active) { setApple(value); setChecking(false); } });
    return () => { active = false; };
  }, []);
  async function signIn(provider: 'apple' | 'google') {
    if (busy || disabled) return;
    setBusy(true); setError(null);
    try { await signInForReceipts(provider); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Sign-in could not finish. Try again.'); }
    finally { setBusy(false); }
  }
  if (signedIn) return <SecondaryButton label="Sign out of receipt scanning" disabled={disabled} onPress={clearReceiptSession} />;
  return <Card>
    <Text style={{ fontWeight: '700', fontSize: 18 }}>Sign in to scan receipts</Text>
    <Text style={{ marginVertical: 12 }}>Sign in once for this session to unlock scanning and uploads. Your receipt storage choice stays separate.</Text>
    {apple && <View pointerEvents={busy || disabled ? 'none' : 'auto'} accessibilityElementsHidden={busy || disabled}>
      <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={8}
        style={{ width: '100%', height: 48 }} onPress={() => { void signIn('apple'); }} />
    </View>}
    {google && <SecondaryButton label="Sign in with Google" disabled={busy || disabled} onPress={() => { void signIn('google'); }} />}
    {checking ? <Text>Checking sign-in availability…</Text> : !apple && !google ? <Text>Scanning is unavailable in this app version. Install a version with sign-in configured.</Text> : null}
    {busy && <Text accessibilityRole="alert">Signing in…</Text>}
    {error && <Text accessibilityRole="alert">{error}</Text>}
  </Card>;
}

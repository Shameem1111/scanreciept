import React, { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { AppLock, type LockState } from '../services/appLock';
import { authenticateDevice, prepareScreenPrivacy, readLockSettings, writeLockSettings } from '../services/deviceSecurity';
import { PrimaryButton } from './Ui';
import { colors } from '../theme';

const LockContext = createContext<{ lock: AppLock; state: LockState } | null>(null);
export function useAppLock() {
  const value = useContext(LockContext);
  if (!value) throw new Error('App lock context is required');
  return value;
}
export function AppLockProvider({ children }: PropsWithChildren) {
  const [lock] = useState(() => new AppLock({ read: async () => { await prepareScreenPrivacy(); return readLockSettings(); },
    write: writeLockSettings, authenticate: authenticateDevice, now: Date.now }, state => setState(state)));
  const [state, setState] = useState(lock.state);
  useEffect(() => {
    lock.activity(AppState.currentState);
    const listener = AppState.addEventListener('change', next => lock.activity(next));
    // Android's notification shade may emit blur without an AppState change.
    const blur = AppState.addEventListener('blur', () => lock.activity('inactive'));
    const focus = AppState.addEventListener('focus', () => lock.activity(AppState.currentState));
    void lock.load();
    return () => { listener.remove(); blur.remove(); focus.remove(); };
  }, [lock]);
  return <LockContext.Provider value={{ lock, state }}>{children}</LockContext.Provider>;
}
export function LockedScreen() {
  const { lock, state } = useAppLock();
  return <View style={styles.cover} accessibilityViewIsModal testID="app-lock-screen">
    <Text style={styles.title}>ReceiptMind</Text>
    <Text style={styles.copy}>{state.active ? 'Your purchase memory is private.' : 'Your receipts are hidden.'}</Text>
    {state.active && <>
      {state.error && <Text accessibilityRole="alert" style={styles.copy}>{state.error}</Text>}
      {state.busy ? <ActivityIndicator color={colors.primary} /> :
        <PrimaryButton label={state.ready ? 'Unlock with device authentication' : 'Retry security setup'}
          onPress={() => { void (state.ready ? lock.unlock() : lock.load()); }} />}
    </>}
  </View>;
}
// On a cold launch, history does not hydrate until authentication succeeds.
// Once mounted, the store stays alive to let pending encrypted writes finish safely.
export function InitialUnlockGate({ children }: PropsWithChildren) {
  const { state } = useAppLock();
  return state.ready && state.sessionStarted ? <>{children}</> : <LockedScreen />;
}
export function AppLockBoundary({ children }: PropsWithChildren) {
  const { state } = useAppLock();
  if (!state.ready || state.locked) return <LockedScreen />;
  return <View style={styles.root}>
    <View style={[styles.root, !state.active && styles.hidden]} pointerEvents={state.active ? 'auto' : 'none'}
      accessibilityElementsHidden={!state.active} importantForAccessibility={state.active ? 'auto' : 'no-hide-descendants'}>{children}</View>
    {!state.active && <LockedScreen />}
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, hidden: { display: 'none' },
  cover: { flex: 1, backgroundColor: colors.background, padding: 32, justifyContent: 'center', gap: 20 },
  title: { fontSize: 32, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  copy: { color: colors.text, fontSize: 16, lineHeight: 24, textAlign: 'center' } });

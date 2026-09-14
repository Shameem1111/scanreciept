import React, { useEffect, useState } from 'react';
import { Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SectionTitle } from '../components/Ui';
import { storageErrorMessage } from '../services/storageErrors';
import { storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { StorageProviderId } from '../types';

const options: { id: StorageProviderId; title: string; subtitle: string }[] = [
  { id: 'local', title: '📱 This device', subtitle: 'Working now. Originals stay in ReceiptMind local files.' },
  { id: 'google-drive', title: '🔵 Google Drive', subtitle: 'Connect your Google account to store originals in your own Drive.' },
  { id: 'icloud', title: '☁️ iCloud Drive', subtitle: 'iOS capability is declared; Apple signing/container setup is required.' },
];

export function SettingsScreen() {
  const { storageProvider, setStorageProvider, deleteHistory, deleteEverything, exportPurchaseHistory, receipts, recovery, hydrate, hydrated, storageWarning, retryStorageCleanup, connectStorage, disconnectStorage } = useReceiptStore();
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<Partial<Record<StorageProviderId, string>>>({});
  async function refreshConnections() {
    const entries = await Promise.all(Object.values(storageProviders).filter(p => p.connectionStatus).map(async p => {
      try { return [p.id, await p.connectionStatus!()] as const; }
      catch { return [p.id, 'Connection unavailable. Retry.'] as const; }
    }));
    setConnections(Object.fromEntries(entries));
  }
  useEffect(() => {
    void refreshConnections();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refreshConnections(); });
    return () => subscription.remove();
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) { Alert.alert('Action could not finish', storageErrorMessage(error, 'Free device storage, unlock the device and retry. If deletion was interrupted, retry the same deletion action to finish.')); }
    finally { setBusy(false); void refreshConnections(); }
  }
  function confirmDelete(everything: boolean) {
    Alert.alert(everything ? 'Delete everything from this device?' : 'Delete purchase history only?',
      everything ? 'Permanently removes structured history, all ReceiptMind local originals, temporary exports, settings, connected sessions and the encryption key. Google Drive/iCloud originals and copies you exported elsewhere require separate deletion.' :
        'Permanently removes all structured purchase records. All original files and the encryption key stay on this device. Google Drive/iCloud originals stay in your account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void run(everything ? deleteEverything : deleteHistory); } },
    ]);
  }

  async function choose(id: StorageProviderId) {
    if (id === 'icloud' && Platform.OS !== 'ios') {
      return Alert.alert('iCloud is for Apple devices', 'Choose This device or Google Drive on Android.');
    }
    await run(() => setStorageProvider(id));
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy & storage</Text>
      <Text style={styles.subtitle}>Receipt originals stay where you choose. ReceiptMind never needs card or bank information.</Text>

      {recovery && <Card>
        <Text accessibilityRole="alert" style={styles.blocked}>{recovery}</Text>
        <PrimaryButton label="Retry recovery" disabled={busy || !hydrated} onPress={() => { void run(hydrate); }} />
      </Card>}
      {storageWarning && <Card>
        <Text accessibilityRole="alert" style={styles.note}>{storageWarning}</Text>
        <PrimaryButton label="Retry original cleanup" disabled={busy || !hydrated || !!recovery} onPress={() => { void run(retryStorageCleanup); }} />
      </Card>}
      <SectionTitle>Original receipt storage</SectionTitle>
      <View style={{ gap: 10 }}>
        {options.map((option) => {
          const selected = storageProvider === option.id;
          const provider = storageProviders[option.id];
          const ready = provider.isConfigured();
          return (
            <View key={option.id} style={{ gap: 8 }}>
            <Pressable disabled={busy || !hydrated || !!recovery} onPress={() => choose(option.id)} style={[styles.option, selected && styles.optionSelected]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{option.title} {selected ? '✓' : ''}</Text>
                <Text style={styles.optionSubtitle}>{provider.description ?? option.subtitle}</Text>
              </View>
              <Text style={[styles.status, ready ? styles.ready : styles.setup]}>{ready ? (provider.connect ? 'Configured' : 'Ready') : 'Setup'}</Text>
            </Pressable>
            {provider.connect && <>
              <Text accessibilityLiveRegion="polite" style={styles.note}>{connections[option.id] ?? 'Checking connection...'}</Text>
              <PrimaryButton label={`Connect / reconnect ${provider.label}`} disabled={busy || !hydrated} onPress={() => Alert.alert(`Connect ${provider.label}?`, 'Original receipts will upload to your account only after you select this storage option and save a receipt. Originals may contain payment information. Existing receipt references will stay unchanged.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Connect', onPress: () => { void run(() => connectStorage(option.id)); } },
              ])} />
              <PrimaryButton label={`Disconnect ${provider.label}`} disabled={busy || !hydrated || !ready} onPress={() => Alert.alert(`Disconnect ${provider.label}?`, 'Sign out on this device and revoke access when online. Structured history and cloud originals are kept. New receipts will use local storage if this provider was selected.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', onPress: () => { void run(() => disconnectStorage(option.id)); } },
              ])} />
            </>}
            </View>
          );
        })}
      </View>

      <View style={{ height: 24 }} />
      <SectionTitle>Financial-data protection</SectionTitle>
      <Card>
        <Text style={styles.protection}>✓ Product, merchant, date and price may be stored</Text>
        <Text style={styles.protection}>✓ Original receipt remains in your chosen storage</Text>
        <Text style={styles.blocked}>✕ Card numbers are not extracted or stored</Text>
        <Text style={styles.blocked}>✕ IBAN/BIC/account numbers are not extracted or stored</Text>
        <Text style={styles.blocked}>✕ Authorization codes, terminal IDs and payment references are discarded</Text>
        <Text style={styles.note}>The app intentionally has no database fields for banking credentials.</Text>
      </Card>

      <View style={{ height: 24 }} />
      <SectionTitle>My data</SectionTitle>
      <Card>
        {recovery ? <Text style={styles.note}>History is unavailable until recovery finishes.</Text> :
          <Text style={styles.note}>{receipts.length} structured receipt records are stored locally with encryption.</Text>}
        <Text style={styles.note}>JSON export contains readable purchase details and original references, but no original files or encryption key. Anyone with the exported copy can read it. Choose a trusted destination; exported copies require separate deletion.</Text>
        <PrimaryButton label="Export purchase history as JSON" disabled={busy || !hydrated || !!recovery} onPress={() => Alert.alert('Export readable purchase history?', 'The exported JSON is not encrypted. Choose where to share or save it.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Export', onPress: () => { void run(exportPurchaseHistory); } },
        ])} />
        <View style={{ height: 12 }} />
        <PrimaryButton label="Delete purchase history only" disabled={busy || !hydrated} onPress={() => confirmDelete(false)} />
        <Text style={styles.note}>History-only deletion keeps all original files and the encryption key. To remove those too, use the separate device deletion action.</Text>
        <View style={{ height: 12 }} />
        <PrimaryButton label="Delete everything from this device" disabled={busy || !hydrated} onPress={() => confirmDelete(true)} />
        <Text style={styles.note}>Google Drive and iCloud originals require separate deletion in those services unless their provider supports deletion. These deletion actions do not delete cloud originals. Files you imported from outside ReceiptMind and exported copies also remain at their source.</Text>
      </Card>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 30, backgroundColor: colors.background, flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 22, marginTop: 8, marginBottom: 24 },
  option: { flexDirection: 'row', gap: 12, padding: 16, backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  optionSubtitle: { color: colors.muted, lineHeight: 19, marginTop: 4, fontSize: 13 },
  status: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 11, overflow: 'hidden' },
  ready: { color: colors.primary, backgroundColor: '#DDF0E4' },
  setup: { color: colors.warning, backgroundColor: '#FFF2CC' },
  protection: { color: colors.text, lineHeight: 24 },
  blocked: { color: colors.danger, lineHeight: 24 },
  note: { color: colors.muted, lineHeight: 20, fontSize: 13, marginTop: 8 },
});

import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SectionTitle } from '../components/Ui';
import { storageErrorMessage } from '../services/storageErrors';
import { storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { StorageProviderId } from '../types';
import { clearReceiptSession, getReceiptAuthProvider } from '../services/receiptAuth';
import { legalLinks } from '../services/legalLinks';

const options: { id: StorageProviderId; title: string; subtitle: string }[] = [
  { id: 'local', title: '📱 This device', subtitle: 'Working now. Originals stay in ReceiptMind local files.' },
  { id: 'google-drive', title: '🔵 Google Drive', subtitle: 'Connect your Google account to store originals in your own Drive.' },
  { id: 'icloud', title: '☁️ iCloud Drive', subtitle: 'Store originals in your own iCloud Drive on iPhone.' },
];

export function SettingsScreen() {
  const { storageProvider, setStorageProvider, deleteHistory, deleteEverything, exportPurchaseHistory, receipts, recovery, hydrate, hydrated, storageWarning, retryStorageCleanup, connectStorage, disconnectStorage } = useReceiptStore();
  const [busy, setBusy] = useState(false);
  const [connections, setConnections] = useState<Partial<Record<StorageProviderId, { message: string; connected: boolean }>>>({});
  async function refreshConnections() {
    const entries = await Promise.all(Object.values(storageProviders).filter(p => p.connectionStatus).map(async p => {
      try {
        const [message, connected] = await Promise.all([p.connectionStatus!(), p.isAvailable()]);
        return [p.id, { message, connected }] as const;
      }
      catch { return [p.id, { message: 'Connection unavailable. Retry.', connected: false }] as const; }
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
    await run(() => setStorageProvider(id));
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy & storage</Text>
      <Text style={styles.subtitle}>Receipt originals stay where you choose. ReceiptMind never needs card or bank information.</Text>

      <SectionTitle>Account</SectionTitle>
      <Card>
        <Text style={styles.note}>Signed in with {getReceiptAuthProvider() === 'apple' ? 'Apple' : 'Google'}. Google or Apple handles your password; ReceiptMind never receives or stores it.</Text>
        <PrimaryButton label="Sign out of ReceiptMind" disabled={busy} onPress={() => Alert.alert('Sign out of ReceiptMind?', 'App menus will be hidden until you sign in again. Local purchase history and original receipts will not be deleted. Storage connections remain unchanged.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: clearReceiptSession },
        ])} />
      </Card>
      <SectionTitle>Privacy information</SectionTitle>
      <Card>
        <Text style={styles.note}>Receipt images go to the extraction service and Google for AI reading. Google may retain prompts for abuse monitoring. Local deletion does not delete originals in your Drive/iCloud or provider-retained data.</Text>
        {(['privacy', 'deletion'] as const).map(kind => <View key={kind}>
          <PrimaryButton label={kind === 'privacy' ? 'Privacy policy' : 'Data deletion and account requests'} disabled={!legalLinks[kind] || busy}
            onPress={() => { const url = legalLinks[kind]; if (url) void run(async () => { try { await Linking.openURL(url); } catch { throw new Error('The information page could not open. Check your connection and retry.'); } }); }} />
          {!legalLinks[kind] && <Text style={styles.note}>{kind === 'privacy' ? 'Privacy policy' : 'Deletion request page'} is not configured in this preview. The owner must provide it before store release.</Text>}
        </View>)}
      </Card>

      {recovery && <Card>
        <Text accessibilityRole="alert" style={styles.blocked}>{recovery}</Text>
        <PrimaryButton label="Retry recovery" disabled={busy || !hydrated} onPress={() => { void run(hydrate); }} />
      </Card>}
      {storageWarning && <Card>
        <Text accessibilityRole="alert" style={styles.note}>{storageWarning}</Text>
        <PrimaryButton label="Retry original cleanup" disabled={busy || !hydrated || !!recovery} onPress={() => { void run(retryStorageCleanup); }} />
      </Card>}
      <SectionTitle>Original receipt storage</SectionTitle>
      <Card>
        <Text style={styles.note}>New accounts use This device by default. App sign-in is separate from receipt storage. Google Drive must be connected explicitly; iCloud Drive access is managed in iPhone Settings.</Text>
      </Card>
      <View style={{ gap: 10 }}>
        {options.map((option) => {
          const selected = storageProvider === option.id;
          const provider = storageProviders[option.id];
          const ready = provider.isConfigured();
          const connection = connections[option.id];
          const connected = option.id === 'local' || connection?.connected === true;
          return (
            <View key={option.id} style={{ gap: 8 }}>
            <Pressable disabled={busy || !hydrated || !!recovery} onPress={() => choose(option.id)} style={[styles.option, selected && styles.optionSelected]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{option.title} {selected ? '✓' : ''}</Text>
                <Text style={styles.optionSubtitle}>{provider.description ?? option.subtitle}</Text>
              </View>
              <Text style={[styles.status, ready && connected ? styles.ready : styles.setup]}>{!ready ? 'Setup' : connected ? (option.id === 'local' ? 'Available' : 'Connected') : 'Not connected'}</Text>
            </Pressable>
            {provider.connectionStatus && <Text accessibilityLiveRegion="polite" style={styles.note}>{connection?.message ?? 'Checking connection...'}</Text>}
            {provider.connect && !connected &&
              <PrimaryButton label={`Connect ${provider.label}`} disabled={busy || !hydrated || !ready} onPress={() => Alert.alert(`Connect ${provider.label}?`, 'Original receipts will upload to your account only after you select this storage option and save a receipt. Originals may contain payment information. Existing receipt references will stay unchanged.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Connect', onPress: () => { void run(() => connectStorage(option.id)); } },
              ])} />}
            {provider.disconnect && connected &&
              <PrimaryButton label={`Disconnect ${provider.label}`} disabled={busy || !hydrated || !ready} onPress={() => Alert.alert(`Disconnect ${provider.label}?`, 'Sign out on this device and revoke access when online. Structured history and cloud originals are kept. New receipts will use local storage if this provider was selected.', [
                { text: 'Cancel', style: 'cancel' }, { text: 'Disconnect', onPress: () => { void run(() => disconnectStorage(option.id)); } },
              ])} />}
            {provider.manageConnection && ready &&
              <PrimaryButton label={connected ? `Disconnect ${provider.label} in iPhone Settings` : `Connect ${provider.label} in iPhone Settings`}
                disabled={busy || !hydrated} onPress={() => { void run(provider.manageConnection!); }} />}
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

import React, { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SectionTitle } from '../components/Ui';
import { storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { StorageProviderId } from '../types';

const options: { id: StorageProviderId; title: string; subtitle: string }[] = [
  { id: 'local', title: '📱 This device', subtitle: 'Working now. Originals stay in ReceiptMind local files.' },
  { id: 'google-drive', title: '🔵 Google Drive', subtitle: 'Architecture ready; Google OAuth setup required before automatic upload.' },
  { id: 'icloud', title: '☁️ iCloud Drive', subtitle: 'iOS capability is declared; Apple signing/container setup is required.' },
];

export function SettingsScreen() {
  const { storageProvider, setStorageProvider, deleteHistory, deleteEverything, exportPurchaseHistory, receipts, recovery, hydrate, hydrated } = useReceiptStore();
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch { Alert.alert('Action could not finish', 'Free device storage, unlock the device and retry. If deletion was interrupted, retry the same deletion action to finish.'); }
    finally { setBusy(false); }
  }
  function confirmDelete(everything: boolean) {
    Alert.alert(everything ? 'Delete everything from this device?' : 'Delete purchase history only?',
      everything ? 'Permanently removes structured history, all ReceiptMind local originals, temporary exports, settings and the encryption key. Google Drive/iCloud originals and copies you exported elsewhere require separate deletion.' :
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
      <SectionTitle>Original receipt storage</SectionTitle>
      <View style={{ gap: 10 }}>
        {options.map((option) => {
          const selected = storageProvider === option.id;
          const ready = storageProviders[option.id].isConfigured();
          return (
            <Pressable disabled={busy || !hydrated || !!recovery} key={option.id} onPress={() => choose(option.id)} style={[styles.option, selected && styles.optionSelected]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>{option.title} {selected ? '✓' : ''}</Text>
                <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
              </View>
              <Text style={[styles.status, ready ? styles.ready : styles.setup]}>{ready ? 'Ready' : 'Setup'}</Text>
            </Pressable>
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
        <Text style={styles.note}>Google Drive and iCloud originals require separate deletion in those services unless their provider supports deletion. This build does not support external original deletion. Files you imported from outside ReceiptMind and exported copies also remain at their source.</Text>
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

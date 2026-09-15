import React, { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SectionTitle } from '../components/Ui';
import { storageErrorMessage } from '../services/storageErrors';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { StorageProviderId } from '../types';
import { legalLinks } from '../services/legalLinks';

const options: { id: StorageProviderId; title: string; subtitle: string; disabled?: boolean }[] = [
  { id: 'local', title: '📱 This device', subtitle: 'Available now. Originals stay in ReceiptMind local files.' },
  { id: 'google-drive', title: '🔵 Google Drive', subtitle: 'Cloud receipt storage will be available in a future update.', disabled: true },
  { id: 'icloud', title: '☁️ iCloud Drive', subtitle: 'Cloud receipt storage will be available in a future update.', disabled: true },
];

export function SettingsScreen() {
  const { storageProvider, setStorageProvider, deleteHistory, deleteEverything, exportPurchaseHistory, receipts, recovery, hydrate, hydrated, storageWarning, retryStorageCleanup } = useReceiptStore();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await action(); }
    catch (error) { Alert.alert('Action could not finish', storageErrorMessage(error, 'Free device storage, unlock the device and retry. If deletion was interrupted, retry the same deletion action to finish.')); }
    finally { setBusy(false); }
  }

  function confirmDelete(everything: boolean) {
    Alert.alert(everything ? 'Delete everything from this device?' : 'Delete purchase history only?',
      everything ? 'Permanently removes structured history, all ReceiptMind local originals, temporary exports, settings and the encryption key.' :
        'Permanently removes all structured purchase records. All original files and the encryption key stay on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void run(everything ? deleteEverything : deleteHistory); } },
    ]);
  }

  async function choose(id: StorageProviderId) {
    if (id !== 'local') return;
    await run(() => setStorageProvider(id));
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy & storage</Text>
      <Text style={styles.subtitle}>Receipt originals stay on this device for now. ReceiptMind never needs card or bank information.</Text>

      <SectionTitle>Privacy information</SectionTitle>
      <Card>
        <Text style={styles.note}>Receipt images go to the extraction service and Google for AI reading. Google may retain prompts for abuse monitoring. Local deletion removes only data stored by ReceiptMind on this device.</Text>
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
        <Text style={styles.note}>This device is currently the only available storage option. Google Drive and iCloud Drive are coming soon.</Text>
      </Card>
      <View style={{ gap: 10 }}>
        {options.map((option) => {
          const selected = option.id === 'local' && storageProvider === 'local';
          return (
            <Pressable
              key={option.id}
              disabled={busy || !hydrated || !!recovery || option.disabled}
              onPress={() => { void choose(option.id); }}
              style={[styles.option, selected && styles.optionSelected, option.disabled && styles.optionDisabled]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, option.disabled && styles.optionTitleDisabled]}>{option.title} {selected ? '✓' : ''}</Text>
                <Text style={[styles.optionSubtitle, option.disabled && styles.optionSubtitleDisabled]}>{option.subtitle}</Text>
              </View>
              <Text style={[styles.status, option.disabled ? styles.comingSoon : styles.ready]}>{option.disabled ? 'Coming soon' : 'Available'}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ height: 24 }} />
      <SectionTitle>Financial-data protection</SectionTitle>
      <Card>
        <Text style={styles.protection}>✓ Product, merchant, date and price may be stored</Text>
        <Text style={styles.protection}>✓ Original receipt remains in local app storage</Text>
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
        <Text style={styles.note}>This removes ReceiptMind data stored on this device. Files you imported from outside ReceiptMind and exported copies remain at their source.</Text>
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
  optionDisabled: { opacity: 0.58 },
  optionTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  optionTitleDisabled: { color: colors.muted },
  optionSubtitle: { color: colors.muted, lineHeight: 19, marginTop: 4, fontSize: 13 },
  optionSubtitleDisabled: { color: colors.muted },
  status: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, fontSize: 11, overflow: 'hidden' },
  ready: { color: colors.primary, backgroundColor: '#DDF0E4' },
  comingSoon: { color: colors.muted, backgroundColor: '#ECECEC' },
  protection: { color: colors.text, lineHeight: 24 },
  blocked: { color: colors.danger, lineHeight: 24 },
  note: { color: colors.muted, lineHeight: 20, fontSize: 13, marginTop: 8 },
});

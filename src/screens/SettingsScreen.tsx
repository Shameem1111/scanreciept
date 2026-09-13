import React from 'react';
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
  const { storageProvider, setStorageProvider, clearAll, receipts } = useReceiptStore();

  async function choose(id: StorageProviderId) {
    if (id === 'icloud' && Platform.OS !== 'ios') {
      return Alert.alert('iCloud is for Apple devices', 'Choose This device or Google Drive on Android.');
    }
    await setStorageProvider(id);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Privacy & storage</Text>
      <Text style={styles.subtitle}>Receipt originals stay where you choose. ReceiptMind never needs card or bank information.</Text>

      <SectionTitle>Original receipt storage</SectionTitle>
      <View style={{ gap: 10 }}>
        {options.map((option) => {
          const selected = storageProvider === option.id;
          const ready = storageProviders[option.id].isConfigured();
          return (
            <Pressable key={option.id} onPress={() => choose(option.id)} style={[styles.option, selected && styles.optionSelected]}>
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
        <Text style={styles.note}>{receipts.length} structured receipt records are currently stored in the local app database.</Text>
        <View style={{ height: 12 }} />
        <PrimaryButton label="Delete local purchase history" onPress={() => Alert.alert('Delete local history?', 'This removes structured purchase history from this app. It does not delete originals stored outside the app.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => clearAll() },
        ])} />
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

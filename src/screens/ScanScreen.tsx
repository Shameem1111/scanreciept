import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SecondaryButton } from '../components/Ui';
import { ReceiptReview } from '../components/ReceiptReview';
import { createReviewDraft, ReviewDraft, validateReview } from '../services/receiptReview';
import { demoReceipt } from '../data';
import { extractReceipt } from '../services/receiptAi';
import { storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { hasDuplicate } from '../services/historyData';
import { colors } from '../theme';
import { ReceiptAsset } from '../types';

export function ScanScreen() {
  const { saveReceipt, receipts, storageProvider } = useReceiptStore();
  const [asset, setAsset] = useState<ReceiptAsset | null>(null);
  const [extracted, setExtracted] = useState<ReviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);

  async function scanCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert('Camera permission required', 'Enable camera permission to scan a receipt.');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled) {
      const image = result.assets[0];
      if (!image) return;
      const next = { uri: image.uri, name: image.fileName ?? `receipt-${Date.now()}.jpg`, mimeType: image.mimeType ?? 'image/jpeg' };
      setAsset(next);
      setExtracted(null);
      await runExtraction(next);
    }
  }

  async function uploadReceipt() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    if (!result.canceled) {
      const file = result.assets[0];
      if (!file) return;
      const next = { uri: file.uri, name: file.name, mimeType: file.mimeType ?? 'application/octet-stream' };
      setAsset(next);
      setExtracted(null);
      await runExtraction(next);
    }
  }

  async function runExtraction(nextAsset: ReceiptAsset) {
    setBusy(true);
    setExtracted(null);
    setExtractionError(null);
    try {
      setExtracted(createReviewDraft(await extractReceipt(nextAsset)));
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : 'Could not read receipt. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function useDemo() {
    setExtractionError(null);
    setAsset({ uri: '', name: 'demo-receipt.jpg', mimeType: 'image/jpeg' });
    setExtracted(createReviewDraft(demoReceipt));
  }

  async function save(allowDuplicate = false) {
    if (busy || !asset || !extracted) return;
    const checked = validateReview(extracted);
    if (!checked.receipt) return Alert.alert('Check receipt', 'Correct the marked fields before saving.');
    if (!storageProviders[storageProvider].isConfigured()) {
      return Alert.alert(
        'Storage provider not configured',
        `${storageProviders[storageProvider].label} needs account/capability configuration first. Choose This device in Settings for a working build now.`,
      );
    }

    if (!allowDuplicate && hasDuplicate(receipts, checked.receipt)) {
      Alert.alert('Possible duplicate receipt', 'A receipt with the same merchant, date and total already exists. Check Purchases before saving another copy.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Save anyway', onPress: () => { void save(true); } },
      ]);
      return;
    }
    setBusy(true);
    try {
      await saveReceipt(checked.receipt, asset, allowDuplicate);
      setAsset(null);
      setExtracted(null);
      Alert.alert('Receipt saved', 'Purchase items are now searchable. Payment/card/bank details are never added to the purchase database.');
    } catch (error) {
      Alert.alert('Could not save receipt', 'Purchase history could not be saved. Free device storage, unlock the device and retry. Check Settings if recovery is required.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add receipt</Text>
      <Text style={styles.subtitle}>Use the camera for a new receipt or upload an existing image/PDF.</Text>

      <View style={styles.actions}>
        <PrimaryButton label="📷  Scan Receipt" onPress={scanCamera} disabled={busy} />
        <SecondaryButton label="⬆  Upload Receipt" onPress={uploadReceipt} disabled={busy} />
        <SecondaryButton label="Use demo receipt" onPress={useDemo} disabled={busy} />
      </View>

      {busy && <ActivityIndicator color={colors.primary} size="large" style={{ marginVertical: 24 }} />}
      {extractionError && (
        <Card>
          <Text style={styles.merchant} accessibilityRole="alert">Could not read receipt</Text>
          <Text style={styles.small}>{extractionError}</Text>
          {asset?.uri ? <SecondaryButton label="Retry reading receipt" onPress={() => runExtraction(asset)} disabled={busy} /> : null}
        </Card>
      )}

      {asset?.uri && asset.mimeType.startsWith('image/') ? <Image source={{ uri: asset.uri }} style={styles.preview} resizeMode="cover" /> : null}
      {asset && !asset.uri ? <Card><Text style={styles.small}>Demo receipt selected.</Text></Card> : null}
      {asset?.mimeType === 'application/pdf' ? <Card><Text style={styles.small}>PDF selected: {asset.name}</Text></Card> : null}

      {extracted && <ReceiptReview draft={extracted} onChange={setExtracted} onSave={() => save()} busy={busy} />}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 30, backgroundColor: colors.background, flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
  subtitle: { color: colors.muted, lineHeight: 22, marginTop: 8, marginBottom: 18 },
  actions: { gap: 10 },
  preview: { width: '100%', height: 280, borderRadius: 18, marginTop: 22, backgroundColor: colors.border },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  merchant: { fontSize: 21, color: colors.text, fontWeight: '800' },
  amount: { fontSize: 21, color: colors.text, fontWeight: '900' },
  small: { fontSize: 13, color: colors.muted, marginTop: 4 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  itemName: { fontSize: 15, color: colors.text, fontWeight: '700' },
  itemPrice: { color: colors.text, fontWeight: '800' },
  privacy: { marginTop: 14, color: colors.primary, lineHeight: 20, fontSize: 13 },
});

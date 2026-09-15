import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SecondaryButton } from '../components/Ui';
import { ReceiptReview } from '../components/ReceiptReview';
import { createReviewDraft, ReviewDraft, validateReview } from '../services/receiptReview';
import { demoReceipt } from '../data';
import { storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { storageErrorMessage } from '../services/storageErrors';
import { hasDuplicate } from '../services/historyData';
import { colors } from '../theme';
import { ReceiptAsset } from '../types';
import { pickReceipt, ReceiptInputError, type ReceiptInput } from '../services/receiptInput';
import { extractReceipt } from '../services/receiptAi';
import { isReceiptSignedIn, signInForReceipts } from '../services/receiptAuth';

export function ScanScreen() {
  const { saveReceipt, receipts, storageProvider } = useReceiptStore();
  const [asset, setAsset] = useState<ReceiptAsset | null>(null);
  const [extracted, setExtracted] = useState<ReviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [readingError, setReadingError] = useState<string | null>(null);

  async function readReceipt(nextAsset: ReceiptAsset) {
    setAsset(nextAsset);
    setExtracted(null);
    setReadingError(null);
    try {
      if (!isReceiptSignedIn()) {
        await signInForReceipts(Platform.OS === 'ios' ? 'apple' : 'google');
      }
      const result = await extractReceipt(nextAsset);
      setExtracted(createReviewDraft(result));
      if (hasDuplicate(receipts, result)) {
        Alert.alert('Receipt already available', 'A matching receipt is already in Purchases. Review the existing entry before saving another copy.');
      }
    } catch (error) {
      setReadingError(error instanceof Error ? error.message : 'Could not read this receipt. Please retry.');
    }
  }

  async function retryReading() {
    if (busy || !asset) return;
    setBusy(true);
    try { await readReceipt(asset); } finally { setBusy(false); }
  }

  function startManualReview(nextAsset: ReceiptAsset) {
    setReadingError(null);
    setAsset(nextAsset);
    setExtracted(createReviewDraft({
      merchant: '',
      purchaseDate: '',
      total: 0,
      currency: 'EUR',
      source: 'manual',
      items: [{
        id: `item-${Date.now()}`,
        originalText: '',
        name: '',
        category: 'Other',
        quantity: 1,
        price: 0,
        confidence: 0,
      }],
    }));
  }

  async function selectReceipt(source: ReceiptInput) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await pickReceipt(source);
      if (!next) return;
      await readReceipt(next);
    } catch (error) {
      Alert.alert('Receipt input unavailable', error instanceof ReceiptInputError ? error.message : 'Please try selecting the receipt again.',
        error instanceof ReceiptInputError && error.openSettings ? [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => { void Linking.openSettings().catch(() => Alert.alert('Open device Settings', 'Allow camera access for ReceiptMind in your device settings.')); } },
        ] : undefined);
    } finally { setBusy(false); }
  }
  function uploadReceipt() {
    if (busy) return;
    Alert.alert('Upload Receipt', 'Choose a photo or an existing image/PDF file.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Photo gallery', onPress: () => { void selectReceipt('gallery'); } },
      { text: 'Files / PDF', onPress: () => { void selectReceipt('file'); } },
    ]);
  }

  async function useDemo() {
    if (!__DEV__) return;
    setReadingError(null);
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
      Alert.alert('Receipt already available', 'A matching receipt is already in Purchases based on the shop, date, receipt number or amount and available time. Check the existing entry before saving another copy.', [
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
      Alert.alert('Could not save receipt', storageErrorMessage(error, 'Purchase history could not be saved. Free device storage, unlock the device and retry. Check Settings if recovery is required.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      <Text style={styles.title}>Add receipt</Text>
      <Text style={styles.subtitle}>Use the camera for a new receipt or upload an existing image/PDF.</Text>

      <Card>
        <Text style={styles.small}>Scan or upload to read the merchant, date, total and purchased items automatically. Then edit the detected details or add extra items before saving. Apple/Google sign-in is required for automatic reading; the receipt is sent securely to the AI service for processing.</Text>
      </Card>

      <View style={styles.actions}>
        <PrimaryButton label="📷  Scan Receipt" onPress={() => { void selectReceipt('camera'); }} disabled={busy} />
        <SecondaryButton label="⬆  Upload Receipt" onPress={uploadReceipt} disabled={busy} />
        {__DEV__ && <SecondaryButton label="Use demo receipt (sample data)" onPress={useDemo} disabled={busy} />}
      </View>

      {busy && <ActivityIndicator color={colors.primary} size="large" style={{ marginVertical: 24 }} />}
      {busy && asset && !extracted && <Text style={styles.small}>Reading receipt — complete sign-in if prompted.</Text>}
      {asset?.uri && asset.mimeType.startsWith('image/') ? <Image source={{ uri: asset.uri }} style={styles.preview} resizeMode="cover" /> : null}
      {asset && !asset.uri ? <Card><Text style={styles.small}>Demo receipt selected.</Text></Card> : null}
      {asset?.mimeType === 'application/pdf' ? <Card><Text style={styles.small}>PDF selected: {asset.name}</Text></Card> : null}

      {readingError && asset && <Card>
        <Text accessibilityRole="alert" style={styles.small}>Automatic reading could not finish. {readingError}</Text>
        <SecondaryButton label="Retry automatic reading" onPress={() => { void retryReading(); }} disabled={busy} />
        <SecondaryButton label="Enter details manually" onPress={() => startManualReview(asset)} disabled={busy} />
      </Card>}
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

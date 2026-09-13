import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SecondaryButton, SectionTitle } from '../components/Ui';
import { demoReceipt } from '../data';
import { extractReceipt } from '../services/receiptAi';
import { saveReceiptAsset, storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { ExtractedReceipt, Receipt, ReceiptAsset } from '../types';

export function ScanScreen() {
  const { addReceipt, storageProvider } = useReceiptStore();
  const [asset, setAsset] = useState<ReceiptAsset | null>(null);
  const [extracted, setExtracted] = useState<ExtractedReceipt | null>(null);
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
      setExtracted(await extractReceipt(nextAsset));
    } catch (error) {
      setExtractionError(error instanceof Error ? error.message : 'Could not read receipt. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function useDemo() {
    setExtractionError(null);
    setAsset({ uri: '', name: 'demo-receipt.jpg', mimeType: 'image/jpeg' });
    setExtracted(demoReceipt);
  }

  async function save() {
    if (!asset || !extracted) return;
    if (!storageProviders[storageProvider].isConfigured()) {
      return Alert.alert(
        'Storage provider not configured',
        `${storageProviders[storageProvider].label} needs account/capability configuration first. Choose This device in Settings for a working build now.`,
      );
    }

    const receiptId = `receipt-${Date.now()}`;
    setBusy(true);
    try {
      const saved = asset.uri
        ? await saveReceiptAsset(storageProvider, asset, receiptId)
        : { provider: storageProvider, reference: 'demo://receipt' };

      const receipt: Receipt = {
        ...extracted,
        id: receiptId,
        storageProvider: saved.provider,
        storageReference: saved.reference,
        originalFilename: asset.name,
        createdAt: new Date().toISOString(),
      };
      await addReceipt(receipt);
      setAsset(null);
      setExtracted(null);
      Alert.alert('Receipt saved', 'Purchase items are now searchable. Payment/card/bank details are never added to the purchase database.');
    } catch (error) {
      Alert.alert('Could not save receipt', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
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

      {extracted && (
        <View style={{ marginTop: 22 }}>
          <SectionTitle>Review</SectionTitle>
          <Card>
            <View style={styles.summaryRow}><Text style={styles.merchant}>{extracted.merchant}</Text><Text style={styles.amount}>€{extracted.total.toFixed(2)}</Text></View>
            <Text style={styles.small}>{extracted.purchaseDate} · {extracted.source === 'demo' ? 'Demo extraction' : 'AI extraction'}</Text>
            <View style={styles.divider} />
            {extracted.items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={{ flex: 1 }}><Text style={styles.itemName}>{item.name}</Text><Text style={styles.small}>{item.category} · {Math.round(item.confidence * 100)}% confidence</Text></View>
                <Text style={styles.itemPrice}>€{item.price.toFixed(2)}</Text>
              </View>
            ))}
            <Text style={styles.privacy}>🔒 Card numbers, IBANs, payment references and banking credentials are excluded from stored purchase data.</Text>
          </Card>
          <View style={{ marginTop: 14 }}><PrimaryButton label="Save receipt" onPress={save} disabled={busy} /></View>
        </View>
      )}
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

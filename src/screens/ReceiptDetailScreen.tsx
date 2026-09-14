import React, { useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, PrimaryButton, SecondaryButton, SectionTitle } from '../components/Ui';
import { ReceiptReview } from '../components/ReceiptReview';
import { createReviewDraft, ReviewDraft } from '../services/receiptReview';
import { storageErrorMessage } from '../services/storageErrors';
import { isReceiptAvailable, openReceipt, storageProviders } from '../services/storage';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';

export function ReceiptDetailScreen({ receiptId, onBack, backLabel = 'Back to purchases' }: { receiptId: string; onBack: () => void; backLabel?: string }) {
  const { receipts, updateReceipt, deleteReceipt } = useReceiptStore();
  const receipt = receipts.find(value => value.id === receiptId);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const check = async () => {
      const result = receipt ? await isReceiptAvailable(receipt) : false;
      if (active) setAvailable(result);
    };
    void check();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
    return () => { active = false; subscription.remove(); };
  }, [receipt]);

  async function viewOriginal() {
    if (!receipt || busy) return;
    setBusy(true); setError('');
    try { await openReceipt(receipt); setAvailable(true); }
    catch (error) {
      setAvailable(await isReceiptAvailable(receipt));
      setError(storageErrorMessage(error, 'Original receipt unavailable. Check the file, connection and selected account, or install an image/PDF viewer. Structured history is kept.'));
    } finally { setBusy(false); }
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError('');
    try { await updateReceipt(receiptId, draft); setDraft(null); }
    catch { setError('Could not save changes. Your previous receipt is preserved. Free device storage, unlock the device and try again.'); }
    finally { setBusy(false); }
  }

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <SecondaryButton label={draft ? 'Cancel editing' : backLabel} disabled={busy}
      onPress={() => { if (draft) { setDraft(null); setError(''); } else onBack(); }} />
    <Text style={styles.title}>{draft ? 'Edit receipt' : 'Receipt details'}</Text>
    {!receipt ? <Text style={styles.text}>Receipt no longer exists.</Text> : <>
      {error !== '' && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {draft ? <ReceiptReview draft={draft} onChange={setDraft} onSave={save} busy={busy} /> : <>
        <Card>
          <Text style={styles.merchant}>{receipt.merchant}</Text>
          <Text style={styles.text}>Date: {receipt.purchaseDate}</Text>
          <Text style={styles.text}>Total: EUR {receipt.total.toFixed(2)}</Text>
          <Text style={styles.text}>Storage provider: {storageProviders[receipt.storageProvider]?.label ?? 'Unknown provider'}</Text>
        </Card>
        <View style={styles.actions}>
          {available === null && <Text style={styles.text}>Checking original receipt…</Text>}
          {available === false && <Text accessibilityRole="alert" style={styles.text}>Original receipt unavailable</Text>}
          <PrimaryButton label="View original receipt" onPress={viewOriginal} disabled={busy || available === null} />
          <SecondaryButton label="Delete receipt" disabled={busy} onPress={() => Alert.alert('Delete this receipt from history?', 'This removes the structured receipt and its items. The original file stays in its storage location. Google Drive/iCloud originals require separate deletion. Use Settings to delete all ReceiptMind data from this device.', [
            { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => {
              setBusy(true); setError('');
              try { await deleteReceipt(receiptId); onBack(); }
              catch { setError('Could not delete receipt. Your previous history is preserved. Free storage and retry.'); }
              finally { setBusy(false); }
            } },
          ])} />
          <SecondaryButton label="Edit receipt" disabled={busy} onPress={() => { setDraft(createReviewDraft(receipt)); setError(''); }} />
        </View>
        <SectionTitle>Extracted items</SectionTitle>
        {receipt.items.map((item, index) => <Card key={`${item.id}-${index}`} style={{ marginBottom: 12 }}>
          <Text style={styles.merchant}>{item.name}</Text>
          <Text style={styles.text}>Original text: {item.originalText || 'Manually added item'}</Text>
          <Text style={styles.text}>Category: {item.category}</Text>
          <Text style={styles.text}>Quantity: {item.quantity} · Line total: EUR {item.price.toFixed(2)}</Text>
        </Card>)}
      </>}
    </>}
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, flexGrow: 1, backgroundColor: colors.background },
  title: { fontSize: 28, fontWeight: '900', color: colors.text, marginVertical: 20 },
  merchant: { fontSize: 18, fontWeight: '700', color: colors.text },
  text: { color: colors.text, lineHeight: 23, marginTop: 6 },
  error: { color: '#B42318', marginVertical: 12 },
  actions: { gap: 12, marginVertical: 20 },
});

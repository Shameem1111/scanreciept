import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { itemTotal, lowConfidence, reviewCategories, ReviewDraft, ReviewItem, validateReview } from '../services/receiptReview';
import { colors } from '../theme';
import { Card, PrimaryButton, SecondaryButton, SectionTitle } from './Ui';

function Field({ label, value, onChange, error, uncertain, numeric, disabled }: {
  label: string; value: string; onChange: (value: string) => void; error?: string; uncertain?: boolean; numeric?: boolean; disabled: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    {uncertain && <Text style={styles.warning}>Needs confirmation — low or unknown confidence</Text>}
    <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} editable={!disabled}
      keyboardType={numeric ? 'decimal-pad' : 'default'} autoCorrect={false}
      style={[styles.input, uncertain && styles.uncertain, !!error && styles.invalid]} />
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
  </View>;
}

export function ReceiptReview({ draft, onChange, onSave, busy }: {
  draft: ReviewDraft; onChange: (draft: ReviewDraft) => void; onSave: () => void; busy: boolean;
}) {
  const { errors, receipt } = validateReview(draft);
  const sum = itemTotal(draft.items);
  const updateItem = (index: number, patch: Partial<Pick<ReviewItem, 'name' | 'quantity' | 'price' | 'category'>>) =>
    onChange({ ...draft, items: draft.items.map((item, i) => i === index ? { ...item, ...patch } : item) });
  return <View style={styles.content}>
    <SectionTitle>Review and confirm</SectionTitle>
    <Text style={styles.help}>Check every field against your receipt. Highlighted values need special attention.</Text>
    <Card>
      <Field label="Merchant" value={draft.merchant} onChange={merchant => onChange({ ...draft, merchant })} error={errors.merchant} uncertain={draft.source === 'ai'} disabled={busy} />
      <Field label="Purchase date (YYYY-MM-DD)" value={draft.purchaseDate} onChange={purchaseDate => onChange({ ...draft, purchaseDate })} error={errors.purchaseDate} uncertain={draft.source === 'ai' || !draft.purchaseDate} disabled={busy} />
      <Field label="Confirmed receipt total (EUR)" value={draft.total} onChange={total => onChange({ ...draft, total })} error={errors.total} uncertain={draft.source === 'ai'} numeric disabled={busy} />
      <Text style={styles.help}>Printed total (extracted): EUR {draft.printedTotal.toFixed(2)}</Text>
      <Text style={styles.help}>Purchased item total: {sum === null ? 'Correct item prices to calculate' : `EUR ${sum.toFixed(2)}`}</Text>
      {receipt && sum !== null && Math.round(receipt.total * 100) !== Math.round(sum * 100) && <Text style={styles.warning}>Totals differ. Check discounts, tax, or missing items. The confirmed receipt total is saved separately.</Text>}
      <SecondaryButton label="Use item total" disabled={busy || sum === null || !draft.items.length} onPress={() => onChange({ ...draft, total: sum!.toFixed(2) })} />
    </Card>
    <Text style={styles.help}>Item price means the full line total for the quantity shown.</Text>
    {draft.items.map((item, index) => <Card key={item.id} style={{ marginTop: 12 }}>
      <Text style={styles.label}>Item {index + 1}</Text>
      <Text style={styles.help}>Original text: {item.originalText || 'Manually added item'}</Text>
      {(['name', 'quantity', 'price'] as const).map(key => <Field key={key}
        label={key === 'name' ? 'Item name' : key === 'quantity' ? 'Quantity' : 'Item price / line total (EUR)'}
        value={item[key]} onChange={value => updateItem(index, { [key]: value })}
        error={errors[`${index}.${key}`]} uncertain={lowConfidence(item.confidence)} numeric={key !== 'name'} disabled={busy} />)}
      <Text style={styles.label}>Category: {item.category}</Text>
      {lowConfidence(item.confidence) && <Text style={styles.warning}>Category needs confirmation</Text>}
      <View style={styles.categories}>{reviewCategories.map(category => <View key={category} style={{ marginBottom: 6 }}>
        <SecondaryButton label={`${item.category === category ? '✓ ' : ''}${category}`} disabled={busy} onPress={() => updateItem(index, { category })} />
      </View>)}</View>
      {errors[`${index}.category`] && <Text style={styles.error}>{errors[`${index}.category`]}</Text>}
      <SecondaryButton label={`Remove item ${index + 1}`} disabled={busy} onPress={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })} />
    </Card>)}
    <View style={styles.field}><SecondaryButton label="Add purchased item" disabled={busy} onPress={() => onChange({ ...draft, items: [...draft.items, {
      id: `manual-${Date.now()}`, originalText: '', name: '', quantity: '1', price: '', category: 'Other', confidence: 0,
    }] })} /></View>
    {errors.items && <Text style={styles.error}>{errors.items}</Text>}
    <Text style={styles.help}>Only purchase details are saved. Card, bank and payment identifiers are excluded.</Text>
    {!receipt && <Text style={styles.error}>Correct the marked fields before saving.</Text>}
    <PrimaryButton label="Confirm and save receipt" onPress={onSave} disabled={busy || !receipt} />
  </View>;
}

const styles = StyleSheet.create({
  content: { marginTop: 22 }, field: { marginVertical: 8 }, label: { color: colors.text, fontWeight: '700', fontSize: 15 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, color: colors.text, marginTop: 6 },
  uncertain: { borderColor: '#9A6700', backgroundColor: '#FFF8DF' }, invalid: { borderColor: '#B42318' },
  warning: { color: '#795000', marginVertical: 6 }, error: { color: '#B42318', marginVertical: 6 },
  help: { color: colors.muted, lineHeight: 21, marginVertical: 8 }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 8 },
});

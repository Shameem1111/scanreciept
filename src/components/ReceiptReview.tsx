import React, { useState } from 'react';
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

function BillView({ draft, onEdit, onSave, busy, canSave }: { draft: ReviewDraft; onEdit: () => void; onSave: () => void; busy: boolean; canSave: boolean }) {
  return <View style={styles.content}>
    <View style={styles.billHeader}>
      <View style={styles.billHeaderText}>
        <SectionTitle>Receipt details</SectionTitle>
        <Text style={styles.help}>Check the scanned information. Tap Edit only if something needs correction.</Text>
      </View>
      <SecondaryButton label="Edit" disabled={busy} onPress={onEdit} />
    </View>
    <Card>
      <Text style={styles.merchant}>{draft.merchant || 'Unknown merchant'}</Text>
      <View style={styles.rule} />
      <View style={styles.metaRow}><Text style={styles.metaLabel}>Date</Text><Text style={styles.metaValue}>{draft.purchaseDate || 'Not detected'}</Text></View>
      <View style={styles.metaRow}><Text style={styles.metaLabel}>Time</Text><Text style={styles.metaValue}>{draft.purchaseTime || 'Not detected'}</Text></View>
      <View style={styles.metaRow}><Text style={styles.metaLabel}>Receipt no.</Text><Text style={styles.metaValue}>{draft.receiptNumber || 'Not detected'}</Text></View>
      <View style={styles.rule} />
      <View style={styles.itemHeader}><Text style={[styles.columnTitle, styles.itemName]}>ITEM</Text><Text style={styles.columnTitle}>QTY</Text><Text style={styles.columnTitle}>EUR</Text></View>
      {draft.items.map((item, index) => <View key={item.id} style={styles.billItem}>
        <View style={styles.itemName}><Text style={styles.itemText}>{item.name || item.originalText || `Item ${index + 1}`}</Text><Text style={styles.category}>{item.category}</Text></View>
        <Text style={styles.numberCell}>{item.quantity || '—'}</Text>
        <Text style={styles.numberCell}>{item.price || '—'}</Text>
      </View>)}
      {!draft.items.length && <Text style={styles.help}>No purchased items were detected.</Text>}
      <View style={styles.rule} />
      <View style={styles.totalRow}><Text style={styles.totalLabel}>TOTAL</Text><Text style={styles.totalValue}>EUR {draft.total || draft.printedTotal.toFixed(2)}</Text></View>
    </Card>
    <Text style={styles.privacy}>Card, bank and payment identifiers are excluded from ReceiptMind data.</Text>
    {!canSave && <Text style={styles.warning}>Some required information needs correction. Tap Edit to complete it.</Text>}
    <PrimaryButton label="Confirm and save receipt" onPress={onSave} disabled={busy || !canSave} />
  </View>;
}

export function ReceiptReview({ draft, onChange, onSave, busy }: {
  draft: ReviewDraft; onChange: (draft: ReviewDraft) => void; onSave: () => void; busy: boolean;
}) {
  const [editing, setEditing] = useState(draft.source !== 'ai');
  const { errors, receipt } = validateReview(draft);
  const sum = itemTotal(draft.items);
  const updateItem = (index: number, patch: Partial<Pick<ReviewItem, 'name' | 'quantity' | 'price' | 'category'>>) =>
    onChange({ ...draft, items: draft.items.map((item, i) => i === index ? { ...item, ...patch } : item) });

  if (!editing) return <BillView draft={draft} onEdit={() => setEditing(true)} onSave={onSave} busy={busy} canSave={!!receipt} />;

  return <View style={styles.content}>
    <View style={styles.billHeader}>
      <View style={styles.billHeaderText}><SectionTitle>Edit receipt</SectionTitle><Text style={styles.help}>Correct only the information that was read incorrectly.</Text></View>
      {draft.source === 'ai' && <SecondaryButton label="Done" disabled={busy} onPress={() => setEditing(false)} />}
    </View>
    <Card>
      <Field label="Merchant" value={draft.merchant} onChange={merchant => onChange({ ...draft, merchant })} error={errors.merchant} uncertain={draft.source === 'ai'} disabled={busy} />
      <Field label="Purchase date (YYYY-MM-DD)" value={draft.purchaseDate} onChange={purchaseDate => onChange({ ...draft, purchaseDate })} error={errors.purchaseDate} uncertain={draft.source === 'ai' || !draft.purchaseDate} disabled={busy} />
      <Field label="Purchase time (HH:mm or HH:mm:ss, optional)" value={draft.purchaseTime ?? ''} onChange={purchaseTime => onChange({ ...draft, purchaseTime })} error={errors.purchaseTime} disabled={busy} />
      <Field label="Receipt number / Kassenbon Nr. (optional)" value={draft.receiptNumber ?? ''} onChange={receiptNumber => onChange({ ...draft, receiptNumber })} error={errors.receiptNumber} disabled={busy} />
      <Field label="Confirmed receipt total (EUR)" value={draft.total} onChange={total => onChange({ ...draft, total })} error={errors.total} uncertain={draft.source === 'ai'} numeric disabled={busy} />
      <Text style={styles.help}>Printed total (extracted): EUR {draft.printedTotal.toFixed(2)}</Text>
      <Text style={styles.help}>Purchased item total: {sum === null ? 'Correct item prices to calculate' : `EUR ${sum.toFixed(2)}`}</Text>
      {receipt && sum !== null && Math.round(receipt.total * 100) !== Math.round(sum * 100) && <Text style={styles.warning}>Totals differ. Check discounts, tax, or missing items.</Text>}
      <SecondaryButton label="Use item total" disabled={busy || sum === null || !draft.items.length} onPress={() => onChange({ ...draft, total: sum!.toFixed(2) })} />
    </Card>
    {draft.items.map((item, index) => <Card key={item.id} style={{ marginTop: 12 }}>
      <Text style={styles.label}>Item {index + 1}</Text>
      <Text style={styles.help}>Original text: {item.originalText || 'Manually added item'}</Text>
      {(['name', 'quantity', 'price'] as const).map(key => <Field key={key}
        label={key === 'name' ? 'Item name' : key === 'quantity' ? 'Quantity' : 'Item price / line total (EUR)'}
        value={item[key]} onChange={value => updateItem(index, { [key]: value })}
        error={errors[`${index}.${key}`]} uncertain={lowConfidence(item.confidence)} numeric={key !== 'name'} disabled={busy} />)}
      <Text style={styles.label}>Category: {item.category}</Text>
      <View style={styles.categories}>{reviewCategories.map(category => <View key={category} style={{ marginBottom: 6 }}><SecondaryButton label={`${item.category === category ? '✓ ' : ''}${category}`} disabled={busy} onPress={() => updateItem(index, { category })} /></View>)}</View>
      {errors[`${index}.category`] && <Text style={styles.error}>{errors[`${index}.category`]}</Text>}
      <SecondaryButton label={`Remove item ${index + 1}`} disabled={busy} onPress={() => onChange({ ...draft, items: draft.items.filter((_, i) => i !== index) })} />
    </Card>)}
    <View style={styles.field}><SecondaryButton label="Add purchased item" disabled={busy} onPress={() => onChange({ ...draft, items: [...draft.items, { id: `manual-${Date.now()}`, originalText: '', name: '', quantity: '1', price: '', category: 'Other', confidence: 0 }] })} /></View>
    {errors.items && <Text style={styles.error}>{errors.items}</Text>}
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
  billHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }, billHeaderText: { flex: 1 },
  merchant: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center', marginVertical: 8 }, rule: { borderTopWidth: 1, borderColor: colors.border, marginVertical: 12 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, paddingVertical: 4 }, metaLabel: { color: colors.muted }, metaValue: { color: colors.text, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  itemHeader: { flexDirection: 'row', gap: 8, paddingBottom: 8 }, columnTitle: { width: 54, color: colors.muted, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  billItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border }, itemName: { flex: 1 }, itemText: { color: colors.text, fontWeight: '600' }, category: { color: colors.muted, fontSize: 12, marginTop: 2 }, numberCell: { width: 54, color: colors.text, textAlign: 'right' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, totalLabel: { color: colors.text, fontSize: 17, fontWeight: '800' }, totalValue: { color: colors.text, fontSize: 20, fontWeight: '800' }, privacy: { color: colors.muted, fontSize: 12, lineHeight: 18, marginVertical: 12 },
});

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Ui';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';

export function PurchasesScreen() {
  const { receipts } = useReceiptStore();
  const [query, setQuery] = useState('');
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return receipts.flatMap((receipt) => receipt.items.map((item) => ({ ...item, merchant: receipt.merchant, date: receipt.purchaseDate, receiptId: receipt.id })))
      .filter((item) => !q || `${item.name} ${item.originalText} ${item.category} ${item.merchant}`.toLowerCase().includes(q));
  }, [receipts, query]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Purchases</Text>
      <TextInput value={query} onChangeText={setQuery} placeholder="Search medicine, bananas, REWE…" placeholderTextColor="#8A968D" style={styles.search} />
      {items.length === 0 ? <Card><Text style={styles.empty}>No matching purchases yet.</Text></Card> : items.map((item, index) => (
        <View key={`${item.receiptId}-${item.id}-${index}`} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.meta}>{item.category} · {item.merchant} · {item.date}</Text>
          </View>
          <Text style={styles.price}>€{item.price.toFixed(2)}</Text>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 30, backgroundColor: colors.background, flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text, marginBottom: 16 },
  search: { height: 52, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, color: colors.text, fontSize: 16, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  name: { fontSize: 16, color: colors.text, fontWeight: '700' },
  meta: { color: colors.muted, marginTop: 4, fontSize: 13 },
  price: { color: colors.text, fontWeight: '900' },
  empty: { color: colors.muted },
});

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, SectionTitle } from '../components/Ui';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';

export function HomeScreen() {
  const { receipts } = useReceiptStore();
  const stats = useMemo(() => {
    const total = receipts.reduce((sum, r) => sum + r.total, 0);
    const categoryTotals = new Map<string, number>();
    receipts.forEach((r) => r.items.forEach((item) => categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.price)));
    return { total, categoryTotals: [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]) };
  }, [receipts]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.eyebrow}>RECEIPTMIND</Text>
      <Text style={styles.title}>Your private purchase memory.</Text>
      <Text style={styles.subtitle}>Scan once. Find anything you bought later.</Text>

      <Card style={styles.hero}>
        <Text style={styles.muted}>Recorded spending</Text>
        <Text style={styles.total}>€{stats.total.toFixed(2)}</Text>
        <Text style={styles.muted}>{receipts.length} receipts stored</Text>
      </Card>

      <SectionTitle>By category</SectionTitle>
      {stats.categoryTotals.length === 0 ? (
        <Card><Text style={styles.empty}>Scan or upload your first receipt to see spending here.</Text></Card>
      ) : stats.categoryTotals.map(([category, amount]) => (
        <View key={category} style={styles.categoryRow}>
          <Text style={styles.categoryName}>{category}</Text>
          <Text style={styles.categoryAmount}>€{amount.toFixed(2)}</Text>
        </View>
      ))}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingTop: 30, backgroundColor: colors.background, flexGrow: 1 },
  eyebrow: { color: colors.primary, fontSize: 12, letterSpacing: 1.5, fontWeight: '800' },
  title: { color: colors.text, fontSize: 32, lineHeight: 38, fontWeight: '900', marginTop: 8 },
  subtitle: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 8, marginBottom: 22 },
  hero: { marginBottom: 24 },
  muted: { color: colors.muted, fontSize: 14 },
  total: { fontSize: 38, fontWeight: '900', color: colors.text, marginVertical: 6 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  categoryName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  categoryAmount: { color: colors.text, fontSize: 16, fontWeight: '800' },
  empty: { color: colors.muted, lineHeight: 22 },
});

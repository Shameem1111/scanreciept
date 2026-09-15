import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { ReceiptDetailScreen } from './ReceiptDetailScreen';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { Category } from '../types';
import { reviewCategories } from '../services/receiptReview';
import { dateRangeError, filterPurchases, groupPurchases, productKey, productPriceHistory, purchaseRows, PurchaseFilters, PurchaseGrouping, PurchaseRow, PurchaseSort, sortPurchases } from '../services/purchaseMemory';

const sorts: { value: PurchaseSort; label: string }[] = [
  { value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' },
  { value: 'lowest', label: 'Lowest price' }, { value: 'highest', label: 'Highest price' },
];
function Button({ label, onPress, selected = false }: { label: string; onPress: () => void; selected?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.button, selected && styles.selected]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
function PurchaseResult({ row, onReceipt, onHistory }: { row: PurchaseRow; onReceipt: (id: string) => void; onHistory?: (row: PurchaseRow) => void }) {
  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={`View receipt for ${row.name}, ${row.merchant}, ${row.date}`}
      onPress={() => onReceipt(row.receiptId)} style={styles.receiptLink}>
      <Text style={styles.name}>{row.name}</Text>
      <Text style={styles.meta}>Printed: {row.originalText || 'Not recorded'}</Text>
      <Text style={styles.meta}>{row.category} · {row.merchant} · {row.date}</Text>
      <Text style={styles.price}>EUR {(row.priceCents / 100).toFixed(2)} · Quantity {row.quantity}</Text>
      <Text style={styles.link}>View receipt ›</Text>
    </Pressable>
    {onHistory && <Button label="Price history & cheapest previous" onPress={() => onHistory(row)} />}
  </View>;
}

function fiveYearsAgoIso(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 5);
  return cutoff.toISOString().slice(0, 10);
}

function PriceHistoryGraph({ rows }: { rows: PurchaseRow[] }) {
  const [width, setWidth] = useState(0);
  const height = 220;
  const plotTop = 18;
  const plotBottom = 38;
  const plotHeight = height - plotTop - plotBottom;
  const cutoff = fiveYearsAgoIso();
  const visibleRows = rows.filter(row => row.date >= cutoff);
  if (!visibleRows.length) return <View style={styles.graphCard}><Text style={styles.meta}>No saved prices in the past 5 years.</Text></View>;

  const minPrice = Math.min(...visibleRows.map(row => row.priceCents));
  const maxPrice = Math.max(...visibleRows.map(row => row.priceCents));
  const range = Math.max(1, maxPrice - minPrice);
  const startMs = new Date(`${cutoff}T00:00:00`).getTime();
  const endMs = Date.now();
  const span = Math.max(1, endMs - startMs);
  const horizontalPadding = 18;
  const usableWidth = Math.max(1, width - horizontalPadding * 2);
  const points = visibleRows.map(row => {
    const dateMs = new Date(`${row.date}T00:00:00`).getTime();
    const x = horizontalPadding + Math.max(0, Math.min(1, (dateMs - startMs) / span)) * usableWidth;
    const y = plotTop + (1 - (row.priceCents - minPrice) / range) * plotHeight;
    return { row, x, y };
  });

  return <View style={styles.graphCard}>
    <View style={styles.graphSummary}>
      <Text style={styles.name}>Past 5 years</Text>
      <Text style={styles.meta}>{visibleRows.length} recorded purchase{visibleRows.length === 1 ? '' : 's'}</Text>
    </View>
    <View style={styles.graph} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      <Text style={[styles.graphPriceLabel, { top: 0 }]}>€{(maxPrice / 100).toFixed(2)}</Text>
      <Text style={[styles.graphPriceLabel, { bottom: 20 }]}>€{(minPrice / 100).toFixed(2)}</Text>
      {width > 0 && points.slice(1).map((point, index) => {
        const previous = points[index]!;
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return <View key={`line-${point.row.key}`} style={[styles.graphLine, {
          width: length, left: previous.x, top: previous.y,
          transform: [{ translateY: -1 }, { rotateZ: `${angle}deg` }],
        }]} />;
      })}
      {width > 0 && points.map(point => <View key={point.row.key} style={[styles.graphPoint, { left: point.x - 4, top: point.y - 4 }]} />)}
      <Text style={[styles.graphDateLabel, { left: 12 }]}>{cutoff.slice(0, 4)}</Text>
      <Text style={[styles.graphDateLabel, { right: 12 }]}>{new Date().getFullYear()}</Text>
    </View>
    <Text style={styles.meta}>Each point is a saved line-item price. Quantities can differ; this is not a unit-price comparison.</Text>
  </View>;
}

export function PurchasesScreen({ initialCategory }: { initialCategory?: Category }) {
  const { receipts, hydrated } = useReceiptStore();
  const [filters, setFilters] = useState<PurchaseFilters>(initialCategory ? { category: initialCategory } : {});
  const [sort, setSort] = useState<PurchaseSort>('newest');
  const [grouping, setGrouping] = useState<PurchaseGrouping>('receipt');
  const [controls, setControls] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const rows = useMemo(() => purchaseRows(receipts), [receipts]);
  const filtered = useMemo(() => sortPurchases(filterPurchases(rows, filters), sort), [rows, filters, sort]);
  const sections = useMemo(() => groupPurchases(filtered, grouping).map(group => ({ ...group, data: group.rows })), [filtered, grouping]);
  const merchants = useMemo(() => [...new Map(rows.map(row => [productKey(row.merchant), row.merchant])).values()].sort(), [rows]);
  const selected = rows.find(row => row.key === selectedKey);
  const history = selected ? productPriceHistory(rows, selected) : null;
  const fiveYearHistory = history ? history.history.filter(row => row.date >= fiveYearsAgoIso()) : [];
  const error = dateRangeError(filters);
  const activeCount = [filters.merchant, filters.category, filters.fromDate, filters.toDate].filter(Boolean).length;
  const setFilter = (patch: Partial<PurchaseFilters>) => setFilters(current => ({ ...current, ...patch }));
  const closeDetail = () => setReceiptId(null);
  const closeModal = () => { if (receiptId) closeDetail(); else { setControls(false); setSelectedKey(null); } };
  const summary = [filters.merchant, filters.category, filters.fromDate && `From ${filters.fromDate}`, filters.toDate && `Through ${filters.toDate}`].filter(Boolean).join(' · ');

  return <View style={styles.container}>
    <SectionList sections={sections} keyExtractor={row => row.key} keyboardShouldPersistTaps="handled" stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={styles.header}>
        <Text style={styles.title}>Purchases</Text>
        <Text style={styles.meta}>Your purchase memory, searched on this device.</Text>
        <TextInput value={filters.search ?? ''} onChangeText={search => setFilter({ search })} accessibilityLabel="Search purchases"
          placeholder="Search products or printed text" placeholderTextColor={colors.muted} style={styles.input} returnKeyType="search" />
        {!!summary && <Text style={styles.meta}>{summary}</Text>}
        <Text style={styles.meta}>{sorts.find(option => option.value === sort)?.label} · Grouped by {grouping}</Text>
        <Text style={styles.meta}>Prices are line totals; compare quantities. Groups follow their first result in the chosen sort.</Text>
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        <Text style={styles.name}>{filtered.length} purchase {filtered.length === 1 ? 'line' : 'lines'}</Text>
      </View>}
      renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
      renderItem={({ item }) => <PurchaseResult row={item} onReceipt={setReceiptId} onHistory={row => setSelectedKey(row.key)} />}
      ListEmptyComponent={<View style={styles.row}>
        <Text style={styles.name}>{!hydrated ? 'Loading purchase memory…' : !receipts.length ? 'Your purchase memory starts here' : error ? 'Check your date range' : 'No matching purchases'}</Text>
        <Text style={styles.meta}>{!hydrated ? 'Opening your saved history.' : !receipts.length ? 'Use the Scan tab to scan or upload your first receipt.' : error || 'Try another name or merchant, or widen the date range.'}</Text>
        {hydrated && receipts.length > 0 && <Button label="Clear search & filters" onPress={() => setFilters({})} />}
      </View>} />
    <View style={styles.toolbar}>
      <Button label={`Filters & sort${activeCount ? ` (${activeCount})` : ''}`} onPress={() => setControls(true)} />
      {(activeCount > 0 || !!filters.search) && <Button label="Clear" onPress={() => setFilters({})} />}
    </View>
    <Modal visible={controls || selectedKey !== null || receiptId !== null} animationType="slide" onRequestClose={closeModal}>
      <SafeAreaView style={styles.container}>
        {receiptId ? <ReceiptDetailScreen key={receiptId} receiptId={receiptId} onBack={closeDetail} backLabel={selectedKey ? 'Back to price history' : 'Back to purchases'} />
          : controls ? <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.title}>Filters & sort</Text>
              <Text style={styles.sectionTitle}>Merchant</Text>
              <View style={styles.choices}><Button label="All merchants" selected={!filters.merchant} onPress={() => setFilter({ merchant: undefined })} />
                {merchants.map(merchant => <Button key={merchant} label={merchant} selected={filters.merchant === merchant} onPress={() => setFilter({ merchant })} />)}</View>
              <Text style={styles.sectionTitle}>Category</Text>
              <View style={styles.choices}><Button label="All categories" selected={!filters.category} onPress={() => setFilter({ category: undefined })} />
                {reviewCategories.map((category: Category) => <Button key={category} label={category} selected={filters.category === category} onPress={() => setFilter({ category })} />)}</View>
              <Text style={styles.sectionTitle}>Date range (inclusive)</Text>
              <Text style={styles.meta}>Leave either date blank for an open-ended range.</Text>
              <Text style={styles.name}>From</Text>
              <TextInput accessibilityLabel="From date" value={filters.fromDate ?? ''} onChangeText={fromDate => setFilter({ fromDate })} placeholder="YYYY-MM-DD" style={styles.input} autoCorrect={false} maxLength={10} />
              <Text style={styles.name}>Through</Text>
              <TextInput accessibilityLabel="Through date" value={filters.toDate ?? ''} onChangeText={toDate => setFilter({ toDate })} placeholder="YYYY-MM-DD" style={styles.input} autoCorrect={false} maxLength={10} />
              {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
              <Text style={styles.sectionTitle}>Sort by</Text>
              <View style={styles.choices}>{sorts.map(option => <Button key={option.value} label={option.label} selected={sort === option.value} onPress={() => setSort(option.value)} />)}</View>
              <Text style={styles.sectionTitle}>Group by</Text>
              <View style={styles.choices}><Button label="Receipt" selected={grouping === 'receipt'} onPress={() => setGrouping('receipt')} />
                <Button label="Product" selected={grouping === 'product'} onPress={() => setGrouping('product')} /></View>
              <Button label="Clear search & filters" onPress={() => setFilters({})} />
            </ScrollView>
            <View style={styles.toolbar}><Button label={`Show ${filtered.length} purchase lines`} onPress={() => setControls(false)} /></View>
          </KeyboardAvoidingView> : <>
            <ScrollView contentContainerStyle={styles.content}>
              <Text style={styles.title}>Price history</Text>
              {selected && history ? <>
                <Text style={styles.name}>{selected.name}</Text>
                <Text style={styles.meta}>Price history shows saved purchases from the past 5 years only. Browse filters do not limit this view.</Text>
                <PriceHistoryGraph rows={fiveYearHistory} />
                <Text style={styles.sectionTitle}>Selected purchase</Text>
                <PurchaseResult row={selected} onReceipt={setReceiptId} />
                <Text style={styles.sectionTitle}>Cheapest before {selected.date}</Text>
                <Text style={styles.meta}>Earlier dates only; same-day order is unknown. All lowest-price ties are shown.</Text>
                {!history.cheapestPrevious.length && <Text style={styles.meta}>No earlier purchase recorded for this product.</Text>}
                {history.cheapestPrevious.map(row => <PurchaseResult key={row.key} row={row} onReceipt={setReceiptId} />)}
                <Text style={styles.sectionTitle}>Purchases in past 5 years ({fiveYearHistory.length})</Text>
                {!fiveYearHistory.length && <Text style={styles.meta}>No saved purchases for this product in the past 5 years.</Text>}
                {fiveYearHistory.map(row => <PurchaseResult key={row.key} row={row} onReceipt={setReceiptId} />)}
              </> : <Text style={styles.meta}>This purchase is no longer available. Return to purchases to select another.</Text>}
            </ScrollView>
            <View style={styles.toolbar}><Button label="Back to purchases" onPress={() => setSelectedKey(null)} /></View>
          </>}
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 24, paddingBottom: 32, flexGrow: 1 },
  header: { gap: 10, marginBottom: 12 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text },
  input: { minHeight: 52, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, color: colors.text, fontSize: 16, marginVertical: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginTop: 20, marginBottom: 10 },
  row: { backgroundColor: colors.surface, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 10, gap: 8 },
  receiptLink: { minHeight: 48, paddingVertical: 4 },
  name: { fontSize: 16, color: colors.text, fontWeight: '700' },
  meta: { color: colors.muted, marginTop: 4, fontSize: 14, lineHeight: 21 },
  price: { color: colors.text, fontWeight: '800', fontSize: 16, marginTop: 8 },
  link: { color: colors.primary, marginTop: 8, fontWeight: '700' },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  button: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 14, justifyContent: 'center' },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  buttonText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  error: { color: colors.danger, marginVertical: 8 },
  graphCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 14, marginTop: 16 },
  graphSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  graph: { height: 220, marginTop: 10, overflow: 'hidden', position: 'relative', borderBottomWidth: 1, borderBottomColor: colors.border },
  graphLine: { position: 'absolute', height: 2, backgroundColor: colors.primary, transformOrigin: 'left center' },
  graphPoint: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  graphPriceLabel: { position: 'absolute', left: 0, color: colors.muted, fontSize: 11, zIndex: 2 },
  graphDateLabel: { position: 'absolute', bottom: 2, color: colors.muted, fontSize: 11 },
});

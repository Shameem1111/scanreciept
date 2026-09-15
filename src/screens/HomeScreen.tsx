import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { Card, SectionTitle } from '../components/Ui';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { Category } from '../types';

const categoryColors: Record<Category, string> = {
  Food: '#2F7B53',
  Medicine: '#6B5DD3',
  Clothing: '#D36B9E',
  Household: '#C7892B',
  Electronics: '#3E7CB1',
  Transport: '#5F8D4E',
  Restaurant: '#C95A49',
  Travel: '#4A8F9E',
  'Personal Care': '#A66FB5',
  Entertainment: '#7A6C5D',
  Other: '#8A968D',
};

function categoryBackground(hex: string): string {
  return `${hex}22`;
}

type CategoryShare = { category: Category; amount: number; percentage: number };

function CategoryPieChart({ shares }: { shares: CategoryShare[] }) {
  const size = 220;
  const strokeWidth = 42;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  return <Card style={styles.chartCard}>
    <View style={styles.chartWrap}>
      <Svg width={size} height={size} accessibilityLabel="Spending by category percentage chart">
        <G rotation="-90" origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
          {shares.map(({ category, percentage }) => {
            const segment = (percentage / 100) * circumference;
            const offset = circumference - (accumulated / 100) * circumference;
            accumulated += percentage;
            return <Circle key={category} cx={size / 2} cy={size / 2} r={radius}
              stroke={categoryColors[category]} strokeWidth={strokeWidth} fill="none"
              strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={offset} strokeLinecap="butt" />;
          })}
        </G>
      </Svg>
      <View style={styles.chartCenter}>
        <Text style={styles.chartCenterValue}>100%</Text>
        <Text style={styles.chartCenterLabel}>categorized</Text>
      </View>
    </View>

    <View style={styles.legend}>
      {shares.map(({ category, percentage }) => <View key={category} style={styles.legendRow}>
        <View style={[styles.legendDot, { backgroundColor: categoryColors[category] }]} />
        <Text style={styles.legendCategory}>{category}</Text>
        <Text style={styles.legendPercentage}>{percentage.toFixed(1)}%</Text>
      </View>)}
    </View>
  </Card>;
}

export function HomeScreen({ onCategoryPress }: { onCategoryPress?: (category: Category) => void }) {
  const { receipts } = useReceiptStore();
  const stats = useMemo(() => {
    const total = receipts.reduce((sum, r) => sum + r.total, 0);
    const categoryTotals = new Map<Category, number>();
    receipts.forEach((r) => r.items.forEach((item) => categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.price)));
    const sorted = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]);
    const categorizedTotal = sorted.reduce((sum, [, amount]) => sum + amount, 0);
    const shares: CategoryShare[] = sorted.map(([category, amount]) => ({
      category,
      amount,
      percentage: categorizedTotal > 0 ? (amount / categorizedTotal) * 100 : 0,
    }));
    return { total, categoryTotals: sorted, shares };
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

      <SectionTitle>Spending share</SectionTitle>
      {stats.shares.length > 0 && <CategoryPieChart shares={stats.shares} />}

      <SectionTitle>By category</SectionTitle>
      {stats.categoryTotals.length === 0 ? (
        <Card><Text style={styles.empty}>Scan or upload your first receipt to see spending here.</Text></Card>
      ) : stats.categoryTotals.map(([category, amount]) => (
        <Pressable key={category} accessibilityRole="button" accessibilityLabel={`Show ${category} purchases`}
          onPress={() => onCategoryPress?.(category)}
          style={({ pressed }) => [
            styles.categoryRow,
            { backgroundColor: categoryBackground(categoryColors[category]), borderColor: categoryColors[category] },
            pressed && styles.categoryPressed,
          ]}>
          <View style={styles.categoryLeft}>
            <View style={[styles.categoryColorBar, { backgroundColor: categoryColors[category] }]} />
            <Text style={styles.categoryName}>{category}</Text>
          </View>
          <View style={styles.categoryRight}>
            <Text style={styles.categoryAmount}>€{amount.toFixed(2)}</Text>
            <Text style={[styles.chevron, { color: categoryColors[category] }]}>›</Text>
          </View>
        </Pressable>
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
  chartCard: { marginBottom: 22 },
  chartWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 8 },
  chartCenter: { position: 'absolute', alignItems: 'center' },
  chartCenterValue: { color: colors.text, fontSize: 26, fontWeight: '900' },
  chartCenterLabel: { color: colors.muted, fontSize: 12, marginTop: 2 },
  legend: { marginTop: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', minHeight: 34 },
  legendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 9 },
  legendCategory: { color: colors.text, fontSize: 14, flex: 1 },
  legendPercentage: { color: colors.text, fontSize: 14, fontWeight: '800' },
  categoryRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1, borderRadius: 14 },
  categoryPressed: { opacity: 0.55 },
  categoryLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  categoryColorBar: { width: 5, height: 28, borderRadius: 3, marginRight: 10 },
  categoryName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  categoryRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryAmount: { color: colors.text, fontSize: 16, fontWeight: '800' },
  chevron: { fontSize: 24, lineHeight: 24, fontWeight: '700' },
  empty: { color: colors.muted, lineHeight: 22 },
});

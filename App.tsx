import React, { useState } from 'react';
import { Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { AskScreen } from './src/screens/AskScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { PurchasesScreen } from './src/screens/PurchasesScreen';
import { ScanScreen } from './src/screens/ScanScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ReceiptStoreProvider } from './src/store/ReceiptStore';
import { colors } from './src/theme';

type Tab = 'home' | 'scan' | 'purchases' | 'ask' | 'settings';

const tabs: { id: Tab; icon: string; label: string }[] = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'scan', icon: '▣', label: 'Scan' },
  { id: 'purchases', icon: '⌕', label: 'Purchases' },
  { id: 'ask', icon: '✦', label: 'Ask' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

function AppShell() {
  const [tab, setTab] = useState<Tab>('home');
  const screen = tab === 'home' ? <HomeScreen /> : tab === 'scan' ? <ScanScreen /> : tab === 'purchases' ? <PurchasesScreen /> : tab === 'ask' ? <AskScreen /> : <SettingsScreen />;

  return (
    <SafeAreaView style={styles.safe}>
      <ExpoStatusBar style="dark" />
      <View style={styles.body}>{screen}</View>
      <View style={styles.tabBar}>
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Pressable key={item.id} onPress={() => setTab(item.id)} style={styles.tabButton}>
              <Text style={[styles.tabIcon, active && styles.active]}>{item.icon}</Text>
              <Text style={[styles.tabLabel, active && styles.active]} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ReceiptStoreProvider>
      <StatusBar barStyle="dark-content" />
      <AppShell />
    </ReceiptStoreProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  tabBar: { minHeight: 70, flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: 8, paddingTop: 7 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabIcon: { color: '#859188', fontSize: 22, lineHeight: 26 },
  tabLabel: { color: '#859188', fontSize: 10, fontWeight: '700' },
  active: { color: colors.primary },
});

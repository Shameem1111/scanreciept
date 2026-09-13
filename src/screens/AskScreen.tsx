import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';

function answerQuestion(question: string, receipts: ReturnType<typeof useReceiptStore>['receipts']): string {
  const q = question.toLowerCase();
  const items = receipts.flatMap((receipt) => receipt.items.map((item) => ({ ...item, merchant: receipt.merchant, date: receipt.purchaseDate })));
  if (!items.length) return 'Scan or upload a receipt first, then I can answer from your purchase history.';

  if (q.includes('medicine') || q.includes('medicines')) {
    const matches = items.filter((i) => i.category === 'Medicine');
    if (!matches.length) return 'I could not find medicine purchases.';
    return matches.map((i) => `${i.name} — €${i.price.toFixed(2)} — ${i.merchant} — ${i.date}`).join('\n');
  }
  if (q.includes('food')) {
    const amount = items.filter((i) => i.category === 'Food').reduce((sum, i) => sum + i.price, 0);
    return `You have recorded €${amount.toFixed(2)} in Food.`;
  }
  if (q.includes('total') || q.includes('spend') || q.includes('spent')) {
    const amount = receipts.reduce((sum, r) => sum + r.total, 0);
    return `Your recorded receipt total is €${amount.toFixed(2)} across ${receipts.length} receipt${receipts.length === 1 ? '' : 's'}.`;
  }

  const match = items.find((i) => q.includes(i.name.toLowerCase()) || i.name.toLowerCase().split(' ').some((word) => word.length > 3 && q.includes(word)));
  if (match) return `${match.name} — €${match.price.toFixed(2)} — ${match.merchant} — ${match.date}`;
  return 'I could not map that question yet. Try “What medicines did I buy?”, “How much did I spend on food?” or search for a product name.';
}

export function AskScreen() {
  const { receipts } = useReceiptStore();
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    { role: 'assistant', text: 'Ask me about purchases already saved on this device.' },
  ]);

  function send() {
    const value = question.trim();
    if (!value) return;
    setMessages((prev) => [...prev, { role: 'user', text: value }, { role: 'assistant', text: answerQuestion(value, receipts) }]);
    setQuestion('');
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Ask</Text>
        {messages.map((message, index) => (
          <View key={index} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            <Text style={[styles.bubbleText, message.role === 'user' && { color: '#fff' }]}>{message.text}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput value={question} onChangeText={setQuestion} onSubmitEditing={send} placeholder="Ask about your purchases…" placeholderTextColor="#8A968D" style={styles.input} returnKeyType="send" />
        <Pressable onPress={send} style={styles.send}><Text style={styles.sendText}>↑</Text></Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingTop: 30, gap: 10, flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '900', color: colors.text, marginBottom: 10 },
  bubble: { maxWidth: '86%', borderRadius: 18, padding: 13 },
  assistantBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignSelf: 'flex-start' },
  userBubble: { backgroundColor: colors.primary, alignSelf: 'flex-end' },
  bubbleText: { color: colors.text, lineHeight: 21 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  input: { flex: 1, height: 48, borderRadius: 15, backgroundColor: colors.background, paddingHorizontal: 14, color: colors.text },
  send: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#fff', fontSize: 24, fontWeight: '800' },
});

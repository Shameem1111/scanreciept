import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SecondaryButton } from '../components/Ui';
import { describePurchaseQuery, executePurchaseQuery, preparePurchaseQuestion, queryGuidance, summarizePurchaseResult } from '../services/purchaseQuery';
import { PurchaseQuery } from '../services/purchaseQueryTypes';
import { useReceiptStore } from '../store/ReceiptStore';
import { colors } from '../theme';
import { ReceiptDetailScreen } from './ReceiptDetailScreen';

type Message = { role: 'user' | 'assistant'; text: string; query?: PurchaseQuery };

function QueryAnswer({ query, onReceipt }: { query: PurchaseQuery; onReceipt: (id: string) => void }) {
  const { receipts } = useReceiptStore();
  const result = useMemo(() => executePurchaseQuery(query, receipts), [query, receipts]);
  const [limit, setLimit] = useState(20);
  return <View style={{ gap: 10 }}>
    <Text style={styles.bubbleText}>{describePurchaseQuery(query)}</Text>
    <Text style={styles.bubbleText}>{summarizePurchaseResult(result)}</Text>
    {result.rows.slice(0, limit).map((row, index) => <Pressable key={`${row.receiptId}-${index}`}
      accessibilityRole="button" accessibilityLabel={`View receipt: ${row.name}, ${row.merchant}, ${row.date}`}
      onPress={() => onReceipt(row.receiptId)} style={{ paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
      <Text style={styles.bubbleText}>{row.name} — EUR {(row.priceCents / 100).toFixed(2)}</Text>
      <Text style={styles.bubbleText}>{row.merchant} · {row.date}</Text>
      {row.quantity !== undefined && <Text style={styles.bubbleText}>Quantity: {row.quantity} · {row.category} · Line total</Text>}
      <Text style={{ color: colors.primary, marginTop: 6 }}>View receipt</Text>
    </Pressable>)}
    {result.rows.length > limit && <SecondaryButton label={`Show more (${result.rows.length - limit} remaining)`} onPress={() => setLimit(limit + 20)} />}
  </View>;
}

export function AskScreen() {
  const { hydrated } = useReceiptStore();
  const [question, setQuestion] = useState('');
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: 'Ask about saved purchases in English or German. All queries run on this device.\n\n' + queryGuidance },
  ]);

  function send() {
    if (!hydrated || !question.trim()) return;
    const prepared = preparePurchaseQuestion(question);
    setMessages(prev => [...prev, { role: 'user', text: prepared.text },
      { role: 'assistant', text: prepared.guidance ?? '', query: prepared.query }]);
    setQuestion('');
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Modal visible={receiptId !== null} animationType="slide" onRequestClose={() => setReceiptId(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          {receiptId && <ReceiptDetailScreen key={receiptId} receiptId={receiptId} backLabel="Back to Ask" onBack={() => setReceiptId(null)} />}
        </SafeAreaView>
      </Modal>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Ask</Text>
        {messages.map((message, index) => (
          <View key={index} style={[styles.bubble, message.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
            {message.query ? <QueryAnswer query={message.query} onReceipt={setReceiptId} />
              : <Text style={[styles.bubbleText, message.role === 'user' && { color: '#fff' }]}>{message.text}</Text>}
          </View>
        ))}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput accessibilityLabel="Ask about purchases" value={question} onChangeText={setQuestion} onSubmitEditing={send}
          maxLength={500} placeholder={hydrated ? 'Ask about your purchases…' : 'Loading purchases…'}
          placeholderTextColor="#8A968D" style={styles.input} returnKeyType="send" />
        <Pressable accessibilityRole="button" accessibilityLabel="Send question" disabled={!hydrated || !question.trim()} onPress={send} style={styles.send}><Text style={styles.sendText}>↑</Text></Pressable>
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

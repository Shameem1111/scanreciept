import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const exportDirectory = () => new Directory(Paths.cache, 'ReceiptMindExports');
export async function clearExportFiles(): Promise<void> {
  const directory = exportDirectory();
  if (directory.exists) directory.delete();
}
export async function shareHistoryJson(json: string): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is unavailable on this device.');
  await clearExportFiles();
  const directory = exportDirectory();
  try {
    directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, 'ReceiptMind-history.json');
    file.write(json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Export purchase history' });
  } finally { await clearExportFiles(); }
}

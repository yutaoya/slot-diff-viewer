import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';

export async function fetchSlotDiffs(storeId: string, dates: string[]) {
  const dataMap: Record<string, any[]> = {};

  if (dates.length === 0) return dataMap;

  // ⏬ 日付を数値に変換して min/max を取得
  const numericDates = dates.map(d => parseInt(d, 10));
  const minDate = Math.min(...numericDates);
  const maxDate = Math.max(...numericDates);

  // ⏬ Firestore クエリ：storeId 一致 & date 範囲内
  const q = query(
    collection(db, 'slot_diff'),
    where('storeId', '==', storeId),
    where('date', '>=', minDate),
    where('date', '<=', maxDate)
  );

  const snapshot = await getDocs(q);

  snapshot.forEach(doc => {
    const data = doc.data();
    // 🔑 Firestore 側の date は number なので string に戻す
    dataMap[data.date.toString()] = data.data;
  });

  return dataMap;
}
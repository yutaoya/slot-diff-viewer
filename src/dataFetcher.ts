import { getDoc, doc } from 'firebase/firestore';
import { db } from './firebase';

export async function fetchSlotDiffs(storeId: string, dates: string[]) {
  const dataMap: Record<string, any[]> = {};
  for (const date of dates) {
    const ref = doc(db, 'slot_diff', `${storeId}_${date}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      dataMap[date] = snap.data().data;
    }
  }
  return dataMap;
}

export const STORES = [
  { id: 'maruhan_chuou', label: 'マルハン浜松中央' },
  { id: 'maruhan_izumi', label: 'マルハン泉' },
  { id: 'concorde_ichino', label: 'SUPER CONCORDE 市野' },
  { id: 'rakuen_zaza', label: '楽園 ザザシティ' },
  { id: 'concorde_kido', label: 'FLOWERR CONCORDE 木戸' },
] as const;

export function getStoreLabel(storeId: string): string {
  return STORES.find((store) => store.id === storeId)?.label ?? storeId;
}

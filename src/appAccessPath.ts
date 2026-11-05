// Store pages and assets are served directly from the origin root.
export const ACCESS_ROOT_PATH = '';
export const LEGACY_ACCESS_ROOT_PATH = '/agtmagtm';
export const DEFAULT_STORE_ID = 'maruhan_chuou';

export function getStorePath(storeId: string): string {
  return `${ACCESS_ROOT_PATH}/${storeId}`;
}

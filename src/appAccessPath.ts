export const ACCESS_PATH_SEGMENT = 'agtmagtm';
export const ACCESS_ROOT_PATH = `/${ACCESS_PATH_SEGMENT}`;
export const DEFAULT_STORE_ID = 'maruhan_chuou';

export function getStorePath(storeId: string): string {
  return `${ACCESS_ROOT_PATH}/${storeId}`;
}

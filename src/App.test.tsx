import { ACCESS_ROOT_PATH, DEFAULT_STORE_ID, getStorePath } from './appAccessPath';

test('builds store URLs below the required access path', () => {
  expect(ACCESS_ROOT_PATH).toBe('/agtmagtm');
  expect(getStorePath(DEFAULT_STORE_ID)).toBe('/agtmagtm/maruhan_chuou');
});

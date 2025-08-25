export function transformToGridData(latest: any, allData: Record<string, any>) {
    const rowMap: Record<string, any> = {};
    const latestKeys = new Set(Object.keys(latest)); // 最新日のキーを取得
  
    for (const date in allData) {
      const data = allData[date];
      for (const key in data) {
        const item = data[key];
        const rowId = `${item.machineNumber}_${item.name}`;
  
        // 初回登録
        if (!rowMap[rowId]) {
          rowMap[rowId] = {
            id: rowId,
            machineNumber: item.machineNumber,
            name: item.name,
            dataKey: key, // ← ここを追加
          };
        }
  
        // 🔧 修正: flagオブジェクトの初期化
        if (!rowMap[rowId].flag) rowMap[rowId].flag = {};

        // 日付ごとの差枚データを埋める
        rowMap[rowId][date] = item.diff ?? '-';

        // 🔧 修正: 日付ごとの flag を格納
        rowMap[rowId].flag[date] = item.flag ?? undefined;
      }
    }
  
    // 最新日付のデータが存在する行のみ抽出
    const filteredRows = Object.values(rowMap).filter((row: any) => {
      const latestDate = Object.keys(allData).pop(); // 最も新しい日付
      return latestDate && row[latestDate] !== undefined;
    });
  
    // 台番号で昇順ソート（文字列→数値）
    filteredRows.sort((a: any, b: any) => parseInt(a.machineNumber) - parseInt(b.machineNumber));
  
    // 合計差枚の行を構築
    const totalRow: any = { id: '__total__', isTotalRow: true, name:'総差枚' };
    for (const date in allData) {
      let sum = 0;
      for (const key in allData[date]) {
        const d = allData[date][key].diff;
        if (typeof d === 'number') sum += d;
      }
      totalRow[date] = sum === 0 ? '-' : sum;
    }
  
    return [totalRow, ...filteredRows];
  }

// dataTransformer.ts
// latest: 最新日付の { [dataKey]: item } マップ（item は name, machineNumber, diff, flag など）
// allData: { [YYYYMMDD]: { [dataKey]: item } } の全日付データ
export function transformToGroupedGridData(latest: any, allData: Record<string, any>) {
  const rowMap: Record<string, any> = {};

  // 全日付のキー配列（最新日の特定や合計行用に使用）
  const dates = Object.keys(allData);
  if (dates.length === 0) return [];

  // ===== 1) 機種別の平均差枚（各日付ごと）を作成 =====
  for (const date in allData) {
    const data = allData[date];

    // name（機種名）ごとに集計バッファ
    const byName: Record<string, { sum: number; count: number; anyFlag9: boolean }> = {};

    for (const key in data) {
      const item = data[key];
      const name: string = item?.name ?? '';
      if (!name) continue;

      if (!byName[name]) {
        byName[name] = { sum: 0, count: 0, anyFlag9: false };
      }

      const diff = typeof item.diff === 'number' ? item.diff : 0;
      byName[name].sum += diff;
      byName[name].count += 1; // 行数で割る（“台数平均”）
      if (item.flag === 9) byName[name].anyFlag9 = true;
    }

    // 機種名ごとに行を作成・更新（machineNumber は空欄で表示）
    for (const name in byName) {
      const g = byName[name];
      const avg = g.count ? Math.round(g.sum / g.count) : '-';
      const rowId = `avg_${name}`;

      if (!rowMap[rowId]) {
        rowMap[rowId] = {
          id: rowId,
          machineNumber: '',  // ★ 台番は空欄
          name,               // ★ 機種名
          dataKey: `group_${name}`,
          flag: {},           // 日付ごとのフラグ（全台系=9など）
        };
      }

      rowMap[rowId][date] = avg;
      rowMap[rowId].flag[date] = g.anyFlag9 ? 9 : undefined;
    }
  }

  // ===== 2) 行のフィルタ：最新日に値がある機種だけ残す =====
  const latestDate = dates.sort()[dates.length - 1]; // 文字列 YYYYMMDD 昇順 → 最後が最新
  const rows = Object.values(rowMap).filter((row: any) => latestDate && row[latestDate] !== undefined);

  // ===== 3) 並び順：最新日付での“最小の台番”の昇順 =====
  // latest から「機種名 -> その日の最小 machineNumber」を作る
  const minNumberByName: Record<string, number> = {};
  for (const key in latest || {}) {
    const item = latest[key];
    const name: string = item?.name ?? '';
    if (!name) continue;
    const numRaw = item?.machineNumber;
    const num = typeof numRaw === 'number' ? numRaw : parseInt(String(numRaw), 10);
    if (Number.isFinite(num)) {
      minNumberByName[name] = Math.min(minNumberByName[name] ?? Infinity, num);
    }
  }

  rows.sort((a: any, b: any) => {
    const na = a.name ?? '';
    const nb = b.name ?? '';
    const ma = minNumberByName[na] ?? Infinity;
    const mb = minNumberByName[nb] ?? Infinity;
    if (ma !== mb) return ma - mb;          // 最小台番の昇順
    return String(na).localeCompare(nb, 'ja'); // 同値時は機種名でサブソート
  });

  // ===== 4) 合計行：全台の“平均差枚”に変更（各日付）=====
  //   ・その日の全台 diff の平均（Math.round）を表示
  //   ・diff が数値のものだけを分母にカウント
  const totalRow: any = {
    id: '__total__',
    isTotalRow: true,
    machineNumber: '',
    name: '平均差枚', // ラベル（必要なら '合計' に戻してください）
  };

  for (const date in allData) {
    let sum = 0;
    let cnt = 0;
    for (const key in allData[date]) {
      const d = allData[date][key]?.diff;
      if (typeof d === 'number') {
        sum += d;
        cnt += 1;
      }
    }
    totalRow[date] = cnt > 0 ? Math.round(sum / cnt) : '-';
  }

  // 合計行を先頭に
  return [totalRow, ...rows];
}

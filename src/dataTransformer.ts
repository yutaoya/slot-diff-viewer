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
    const totalRow: any = { id: '__total__', isTotalRow: true };
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

  export function transformToGroupedGridData(latest: any, allData: Record<string, any>) {
    const rowMap: Record<string, any> = {};
    const latestKeys = new Set(Object.keys(latest));
  
    for (const date in allData) {
      const data = allData[date];
      const machineMap: Record<string, any[]> = {};
  
      for (const key in data) {
        const item = data[key];
        const name = item.name;
  
        if (!machineMap[name]) {
          machineMap[name] = [];
        }
        machineMap[name].push(item);
      }
  
      for (const name in machineMap) {
        const group = machineMap[name];
  
        const total = group.reduce((sum, i) => sum + (typeof i.diff === 'number' ? i.diff : 0), 0);
        const avg = group.length ? Math.round(total / group.length) : '-';
  
        const rowId = `avg_${name}`;
  
        if (!rowMap[rowId]) {
          rowMap[rowId] = {
            id: rowId,
            name: name,
            isGroup: true,
            dataKey: `group_${name}`, // ← 🔧 修正追加
          };
        }
  
        rowMap[rowId][date] = avg;
  
        if (!rowMap[rowId].flag) rowMap[rowId].flag = {};
        const hasZentai = group.some((i) => i.flag === 9);
        rowMap[rowId].flag[date] = hasZentai ? 9 : undefined;
      }
    }
  
    const sorted = Object.values(rowMap).sort((a: any, b: any) => a.name.localeCompare(b.name, 'ja'));
  
    return sorted;
  }
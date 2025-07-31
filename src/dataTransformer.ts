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
          };
        }
  
        // 日付ごとの差枚データを埋める
        rowMap[rowId][date] = item.diff ?? '-';
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
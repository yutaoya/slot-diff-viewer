const path = require("path");
const ExcelJS = require("exceljs");

const outPath = path.resolve(
  process.argv[2] || path.join(__dirname, "..", "public", "maruhan_chuou", "floormap.xlsx")
);

const workbook = new ExcelJS.Workbook();
workbook.creator = "slot-diff-viewer";
workbook.created = new Date("2026-05-12T00:00:00+09:00");

const ws = workbook.addWorksheet("preview", {
  views: [{ showGridLines: false, zoomScale: 70 }],
});

const guide = workbook.addWorksheet("guide");
guide.columns = [
  { header: "項目", width: 22 },
  { header: "内容", width: 88 },
];
guide.addRow(["編集シート", "preview"]);
guide.addRow(["青いセル", "台番です。HTML変換時に data-machine-number が付きます。"]);
guide.addRow(["白いセル", "機種名・差枚を表示するための余白です。必要に応じて移動・追加・削除してください。"]);
guide.addRow(["注意", "台番セルは数値のみで入力してください。例: 761"]);
guide.addRow(["変換", "node scripts\\convert-floormap-xlsx-to-html.js"]);
guide.getRow(1).font = { bold: true };

for (let col = 1; col <= 150; col += 1) {
  ws.getColumn(col).width = 4;
}
for (let row = 1; row <= 95; row += 1) {
  ws.getRow(row).height = 14;
}

const border = {
  top: { style: "thin", color: { argb: "FFB8C4D0" } },
  left: { style: "thin", color: { argb: "FFB8C4D0" } },
  bottom: { style: "thin", color: { argb: "FFB8C4D0" } },
  right: { style: "thin", color: { argb: "FFB8C4D0" } },
};

function styleCell(cell, kind) {
  cell.border = border;
  cell.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
  if (kind === "number") {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123A5A" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 8 };
  } else {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FBFD" } };
    cell.font = { color: { argb: kind === "machine" ? "FF24728B" : "FF17202A" }, bold: true, size: 8 };
  }
}

function setCell(row, col, value, kind) {
  const cell = ws.getCell(row, col);
  cell.value = value;
  styleCell(cell, kind);
  return cell;
}

function blank(row, col, kind = "blank") {
  return setCell(row, col, "", kind);
}

function leftOuter(number, row, col) {
  setCell(row, col, number, "number");
  blank(row, col + 1, "machine");
  blank(row, col + 2, "diff");
}

function rightOuter(number, row, col) {
  blank(row, col, "diff");
  blank(row, col + 1, "machine");
  setCell(row, col + 2, number, "number");
}

function verticalLeft(number, row, col) {
  blank(row, col, "diff");
  blank(row, col + 1, "machine");
  setCell(row, col + 2, number, "number");
}

function verticalRight(number, row, col) {
  setCell(row, col, number, "number");
  blank(row, col + 1, "machine");
  blank(row, col + 2, "diff");
}

function horizontalTop(number, row, col) {
  blank(row, col, "diff");
  blank(row + 1, col, "machine");
  setCell(row + 2, col, number, "number");
}

function horizontalBottom(number, row, col) {
  setCell(row, col, number, "number");
  blank(row + 1, col, "machine");
  blank(row + 2, col, "diff");
}

function rangeAsc(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

function rangeDesc(from, to) {
  return Array.from({ length: from - to + 1 }, (_, index) => from - index);
}

function drawOuterColumn(numbers, row, col, side) {
  numbers.forEach((number, index) => {
    if (side === "left") leftOuter(number, row + index, col);
    else rightOuter(number, row + index, col);
  });
}

function drawVerticalPair(leftNumbers, rightNumbers, row, col) {
  const max = Math.max(leftNumbers.length, rightNumbers.length);
  for (let index = 0; index < max; index += 1) {
    if (leftNumbers[index] != null) verticalLeft(leftNumbers[index], row + index, col);
    if (rightNumbers[index] != null) verticalRight(rightNumbers[index], row + index, col + 3);
  }
}

function drawIsland(topNumbers, bottomNumbers, row, col, gap = 0) {
  topNumbers.forEach((number, index) => horizontalTop(number, row, col + index));
  bottomNumbers.forEach((number, index) => horizontalBottom(number, row + 3 + gap, col + index));
}

function mergeTitle(row, col, width, text, dark = false) {
  ws.mergeCells(row, col, row, col + width - 1);
  const cell = ws.getCell(row, col);
  cell.value = text;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  cell.font = { bold: true, size: dark ? 18 : 13, color: { argb: dark ? "FFFFFFFF" : "FF17202A" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark ? "FF050505" : "FFFFFFFF" } };
  for (let c = col; c < col + width; c += 1) {
    ws.getCell(row, c).border = border;
  }
}

// Top area.
drawOuterColumn(rangeAsc(761, 780), 4, 2, "left");
drawVerticalPair(rangeDesc(760, 741), rangeAsc(721, 740), 4, 14);
drawVerticalPair(rangeDesc(720, 701), rangeAsc(681, 700), 4, 34);
drawVerticalPair(rangeDesc(680, 661), rangeAsc(599, 618), 4, 54);
drawVerticalPair(rangeDesc(598, 579), rangeAsc(517, 536), 4, 74);
drawVerticalPair(rangeDesc(516, 497), rangeAsc(437, 456), 4, 94);
drawOuterColumn(rangeDesc(436, 417), 4, 114, "right");

// Left lower columns.
drawOuterColumn(rangeAsc(781, 800), 26, 2, "left");
drawOuterColumn(rangeAsc(801, 813), 55, 2, "left");

// Main horizontal islands.
drawIsland(rangeAsc(955, 965), rangeDesc(954, 944), 26, 14);
drawIsland([...rangeAsc(934, 943), 922], rangeDesc(933, 923), 36, 14);
drawIsland(rangeAsc(910, 921), rangeDesc(909, 898), 46, 14);

// Lower horizontal islands.
drawIsland(rangeAsc(887, 897), rangeDesc(886, 878), 55, 14);
drawIsland([...rangeAsc(868, 877), 867, 866], rangeDesc(865, 856), 64, 14);
drawIsland(rangeAsc(842, 855), rangeDesc(841, 828), 73, 14);
rangeAsc(814, 827).forEach((number, index) => horizontalTop(number, 84, 14 + index));

// Middle and right area.
drawVerticalPair(rangeDesc(660, 640), rangeAsc(619, 639), 26, 58);
drawVerticalPair(rangeDesc(578, 558), rangeAsc(537, 557), 26, 78);
drawOuterColumn(rangeDesc(496, 476), 26, 101, "right");

// Store title block.
mergeTitle(73, 78, 40, "マルハン浜松中央", true);
mergeTitle(74, 78, 40, "フロアマップ", false);

ws.pageSetup = {
  orientation: "landscape",
  fitToPage: true,
  fitToWidth: 1,
  fitToHeight: 1,
};

workbook.xlsx.writeFile(outPath).then(() => {
  console.log(`wrote ${outPath}`);
});

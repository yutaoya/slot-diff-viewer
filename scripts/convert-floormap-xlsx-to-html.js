const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const defaultXlsxPath = path.join(__dirname, "..", "public", "maruhan_chuou", "floormap.xlsx");
const defaultHtmlPath = path.join(__dirname, "..", "public", "maruhan_chuou", "floormap.html");

const xlsxPath = path.resolve(process.argv[2] || defaultXlsxPath);
const sheetName = process.argv[3] || "preview";
const htmlPath = path.resolve(process.argv[4] || defaultHtmlPath);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const fixedColumnWidthPx = 36;

function columnWidthToPx() {
  return fixedColumnWidthPx;
}

function rowHeightToPx(height) {
  return Math.max(8, Math.round((height || 15) * 96 / 72));
}

const themeColors = [
  "FFFFFF",
  "000000",
  "EEECE1",
  "1F497D",
  "4F81BD",
  "C0504D",
  "9BBB59",
  "8064A2",
  "4BACC6",
  "F79646",
];

const indexedColors = {
  0: "000000",
  1: "FFFFFF",
  2: "FF0000",
  3: "00FF00",
  4: "0000FF",
  5: "FFFF00",
  6: "FF00FF",
  7: "00FFFF",
  8: "000000",
  9: "FFFFFF",
  15: "C0C0C0",
  16: "808080",
  22: "C0C0C0",
  23: "808080",
  48: "969696",
  63: "333333",
};

function applyTint(hex, tint = 0) {
  const channel = (offset) => parseInt(hex.slice(offset, offset + 2), 16);
  const transform = (value) => {
    const adjusted = tint < 0
      ? value * (1 + tint)
      : value + (255 - value) * tint;
    return Math.max(0, Math.min(255, Math.round(adjusted)));
  };
  return [transform(channel(0)), transform(channel(2)), transform(channel(4))]
    .map((value) => value.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function excelColorToCss(color) {
  if (!color) return "";
  if (color.argb) {
    const hex = color.argb.length === 8 ? color.argb.slice(2) : color.argb;
    return `#${hex}`;
  }
  if (color.indexed != null && indexedColors[color.indexed]) {
    return `#${indexedColors[color.indexed]}`;
  }
  if (color.theme != null && themeColors[color.theme]) {
    return `#${applyTint(themeColors[color.theme], color.tint || 0)}`;
  }
  return "";
}

function cellText(cell) {
  const value = cell.value;
  if (value == null) return "";
  if (typeof value === "object") {
    if (value.richText) return value.richText.map((part) => part.text || "").join("");
    if (value.text) return value.text;
    if (value.result != null) return value.result;
    if (value.formula) return value.result ?? "";
  }
  return value;
}

function hasVisibleStyle(cell) {
  return Boolean(
    cell.fill?.fgColor ||
    cell.fill?.bgColor ||
    cell.font?.color ||
    cell.font?.bold ||
    cell.border?.top?.style ||
    cell.border?.right?.style ||
    cell.border?.bottom?.style ||
    cell.border?.left?.style
  );
}

function isMachineNumber(text) {
  return /^\d+$/.test(String(text).trim());
}

function borderCss(edge) {
  if (!edge?.style) return "";
  const color = excelColorToCss(edge.color) || "#cfd7df";
  return `1px solid ${color}`;
}

function styleForCell(cell, rowHeight) {
  const styles = [
    `height:${rowHeight}px`,
    "box-sizing:border-box",
    "overflow:hidden",
    "white-space:nowrap",
    "text-overflow:ellipsis",
    "text-align:center",
    "vertical-align:middle",
    "padding:0 2px",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "font-size:10px",
    "line-height:1",
  ];

  const fill = excelColorToCss(cell.fill?.fgColor) || excelColorToCss(cell.fill?.bgColor);
  if (fill) styles.push(`background:${fill}`);

  const fontColor = excelColorToCss(cell.font?.color);
  if (fontColor) styles.push(`color:${fontColor}`);
  if (cell.font?.bold) styles.push("font-weight:800");
  if (cell.font?.size) styles.push(`font-size:${Math.max(7, Math.round(cell.font.size))}px`);

  const top = borderCss(cell.border?.top);
  const right = borderCss(cell.border?.right);
  const bottom = borderCss(cell.border?.bottom);
  const left = borderCss(cell.border?.left);
  if (top) styles.push(`border-top:${top}`);
  if (right) styles.push(`border-right:${right}`);
  if (bottom) styles.push(`border-bottom:${bottom}`);
  if (left) styles.push(`border-left:${left}`);

  return styles.join(";");
}

function getUsedBounds(worksheet) {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = 0;
  let maxCol = 0;

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (cellText(cell) !== "" || hasVisibleStyle(cell)) {
        minRow = Math.min(minRow, rowNumber);
        minCol = Math.min(minCol, colNumber);
        maxRow = Math.max(maxRow, rowNumber);
        maxCol = Math.max(maxCol, colNumber);
      }
    });
  });

  if (!maxRow || !maxCol) {
    throw new Error(`Sheet "${worksheet.name}" has no visible cells.`);
  }

  return { minRow, minCol, maxRow, maxCol };
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);

  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" was not found in ${xlsxPath}`);
  }

  const bounds = getUsedBounds(worksheet);
  const rows = [];
  let machineCount = 0;

  for (let rowNumber = bounds.minRow; rowNumber <= bounds.maxRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rowHeight = rowHeightToPx(row.height);
    const cells = [];

    for (let colNumber = bounds.minCol; colNumber <= bounds.maxCol; colNumber += 1) {
      const cell = row.getCell(colNumber);
      const text = cellText(cell);
      const isMachine = isMachineNumber(text);
      if (isMachine) machineCount += 1;
      const attrs = [
        `style="${styleForCell(cell, rowHeight)}"`,
        isMachine ? `class="machine-cell"` : "",
        isMachine ? `data-machine-number="${escapeHtml(String(text).trim())}"` : "",
      ].filter(Boolean).join(" ");

      const content = escapeHtml(text);

      cells.push(`<td ${attrs}>${content}</td>`);
    }

    rows.push(`<tr style="height:${rowHeight}px">${cells.join("")}</tr>`);
  }

  const colgroup = [];
  let tableWidth = 0;
  for (let colNumber = bounds.minCol; colNumber <= bounds.maxCol; colNumber += 1) {
    const width = columnWidthToPx(worksheet.getColumn(colNumber).width);
    tableWidth += width;
    colgroup.push(`<col style="width:${width}px">`);
  }

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>floormap</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; }
    .floor-map-table {
      border-collapse: collapse;
      border-spacing: 0;
      table-layout: fixed;
      background: #fff;
      width: ${tableWidth}px;
    }
    .floor-map-table td {
      min-width: 0;
      max-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .machine-cell {
      cursor: pointer;
    }
  </style>
</head>
<body>
  <table class="floor-map-table" data-floor-map="maruhan_chuou" data-source-sheet="${escapeHtml(sheetName)}">
    <colgroup>${colgroup.join("")}</colgroup>
    <tbody>
${rows.join("\n")}
    </tbody>
  </table>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf8");
  console.log(`read ${xlsxPath}`);
  console.log(`sheet ${sheetName}`);
  console.log(`wrote ${htmlPath}`);
  console.log(`machine cells ${machineCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

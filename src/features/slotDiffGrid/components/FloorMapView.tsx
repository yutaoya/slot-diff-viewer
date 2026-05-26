import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type FloorMapMachineData = {
  machineNumber: string;
  name: string;
  diff: string;
  url: string | null;
  flagColor?: string;
  tooltipColor?: string;
};

type FloorMapDateOption = {
  field: string;
  label: string;
};

type Props = {
  htmlUrl: string;
  machineDataByNumber: Record<string, FloorMapMachineData>;
  dateOptions: FloorMapDateOption[];
  activeDateField: string;
  onDateFieldChange: (field: string) => void;
  scale: number;
  onScaleChange: (scale: number) => void;
  onOpenMachineData: (machineNumber: string) => void;
};

export const FloorMapView: React.FC<Props> = ({
  htmlUrl,
  machineDataByNumber,
  dateOptions,
  activeDateField,
  onDateFieldChange,
  scale,
  onScaleChange,
  onOpenMachineData,
}) => {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const didApplyInitialScaleRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number; active: boolean; moved: boolean }>({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    active: false,
    moved: false,
  });
  const lastTapRef = useRef<{ time: number; machineNumber: string }>({ time: 0, machineNumber: '' });
  const pinchRef = useRef<{
    active: boolean;
    distance: number;
    scale: number;
    appliedScale: number;
    nextScale: number;
    centerX: number;
    centerY: number;
    frame: number | null;
  }>({
    active: false,
    distance: 0,
    scale: 1,
    appliedScale: 1,
    nextScale: 1,
    centerX: 0,
    centerY: 0,
    frame: null,
  });

  const clampScale = useCallback((value: number) => (
    Math.max(0.5, Math.min(2.5, Math.round(value * 1000) / 1000))
  ), []);

  const applyContentScale = useCallback((value: number) => {
    const content = contentRef.current;
    if (!content) return;
    content.style.transform = `scale(${value})`;
    content.style.width = `${100 / value}%`;
  }, []);

  const getTouchDistance = (touches: React.TouchList | TouchList) => {
    if (touches.length < 2) return 0;
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const getTouchCenter = (touches: React.TouchList | TouchList) => {
    const a = touches[0];
    const b = touches[1];
    return {
      centerX: (a.clientX + b.clientX) / 2,
      centerY: (a.clientY + b.clientY) / 2,
    };
  };

  const applyPinchScaleAtCenter = useCallback((nextScale: number, centerX: number, centerY: number) => {
    const scroller = scrollRef.current;
    if (!scroller) {
      applyContentScale(nextScale);
      return;
    }
    const pinch = pinchRef.current;
    const rect = scroller.getBoundingClientRect();
    const localX = centerX - rect.left;
    const localY = centerY - rect.top;
    const contentX = (scroller.scrollLeft + localX) / pinch.appliedScale;
    const contentY = (scroller.scrollTop + localY) / pinch.appliedScale;

    applyContentScale(nextScale);
    scroller.scrollLeft = Math.max(0, contentX * nextScale - localX);
    scroller.scrollTop = Math.max(0, contentY * nextScale - localY);
    pinch.appliedScale = nextScale;
  }, [applyContentScale]);

  useEffect(() => {
    let cancelled = false;
    const url = `${htmlUrl}${htmlUrl.includes('?') ? '&' : '?'}v=${Date.now()}`;
    setLoading(true);
    setError(false);
    fetch(url, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load floor map: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        setHtml(text);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setHtml('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [htmlUrl]);

  useEffect(() => {
    didApplyInitialScaleRef.current = false;
  }, [htmlUrl]);

  useEffect(() => {
    if (!html || didApplyInitialScaleRef.current) return;
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    requestAnimationFrame(() => {
      const table = content.querySelector('.floor-map-table') as HTMLElement | null;
      const target = table ?? content;
      const mapWidth = target.scrollWidth;
      const viewportWidth = scroller.clientWidth;
      if (!mapWidth || !viewportWidth) return;
      const nextScale = clampScale(Math.min(1, viewportWidth / mapWidth));
      didApplyInitialScaleRef.current = true;
      onScaleChange(nextScale);
      scroller.scrollLeft = 0;
    });
  }, [clampScale, html, onScaleChange]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const preventBrowserPinch = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
      }
    };
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };
    scroller.addEventListener('touchmove', preventBrowserPinch, { passive: false });
    scroller.addEventListener('gesturestart', preventGesture, { passive: false } as AddEventListenerOptions);
    scroller.addEventListener('gesturechange', preventGesture, { passive: false } as AddEventListenerOptions);
    return () => {
      scroller.removeEventListener('touchmove', preventBrowserPinch);
      scroller.removeEventListener('gesturestart', preventGesture);
      scroller.removeEventListener('gesturechange', preventGesture);
    };
  }, []);

  const injectedHtml = useMemo(() => {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const rows = Array.from(doc.querySelectorAll<HTMLTableRowElement>('tr'));
    const isInjectTargetCell = (cell: HTMLTableCellElement | undefined) => {
      if (!cell) return false;
      const style = cell.getAttribute('style') ?? '';
      return /background:\s*#f8fbfd/i.test(style);
    };
    const isBlankCell = (cell: HTMLTableCellElement | undefined) => {
      if (!cell) return false;
      if (!isInjectTargetCell(cell)) return false;
      if (cell.dataset.machineNumber) return false;
      return (cell.textContent ?? '').trim() === '';
    };
    const writeDataCell = (
      cell: HTMLTableCellElement | undefined,
      text: string,
      className: string,
      backgroundColor?: string,
      machineNumber?: string
    ) => {
      if (!cell) return;
      cell.textContent = text;
      cell.classList.add(className);
      cell.title = text;
      if (machineNumber) {
        cell.dataset.machineNumber = machineNumber;
      }
      if (backgroundColor) {
        cell.style.backgroundColor = backgroundColor;
      }
    };
    const writeDiffCell = (
      cell: HTMLTableCellElement | undefined,
      text: string,
      backgroundColor?: string,
      machineNumber?: string
    ) => {
      if (!cell) return;
      writeDataCell(cell, text, 'floor-map-diff', backgroundColor, machineNumber);
      const parsed = Number(String(text).replace(/,/g, '').trim());
      if (!Number.isFinite(parsed)) return;
      cell.classList.add(parsed < 0 ? 'floor-map-diff-negative' : 'floor-map-diff-positive');
    };

    doc.querySelectorAll<HTMLElement>('[data-machine-number]').forEach((cell) => {
      const machineNumber = String(cell.dataset.machineNumber ?? '').trim();
      const data = machineDataByNumber[machineNumber];
      const tableCell = cell instanceof HTMLTableCellElement ? cell : null;
      cell.dataset.hasFloorMapData = data ? 'true' : 'false';
      cell.title = data
        ? `${machineNumber} / ${data.name || ''} / ${data.diff || '-'}`
        : `${machineNumber} / -`;
      if (data?.tooltipColor) {
        cell.style.backgroundColor = data.tooltipColor;
        cell.style.color = '#000';
      }

      if (!tableCell || !data) return;
      const row = tableCell.parentElement as HTMLTableRowElement | null;
      const rowIndex = row ? rows.indexOf(row) : -1;
      const colIndex = tableCell.cellIndex;
      const currentRowCells = row ? Array.from(row.cells) : [];
      const prev2 = currentRowCells[colIndex - 2];
      const prev1 = currentRowCells[colIndex - 1];
      const next1 = currentRowCells[colIndex + 1];
      const next2 = currentRowCells[colIndex + 2];
      const upper1 = rows[rowIndex - 1]?.cells[colIndex];
      const upper2 = rows[rowIndex - 2]?.cells[colIndex];
      const lower1 = rows[rowIndex + 1]?.cells[colIndex];
      const lower2 = rows[rowIndex + 2]?.cells[colIndex];

      const verticalCandidates = [
        { machine: lower1, diff: lower2 },
        { machine: upper1, diff: upper2 },
      ];
      const horizontalCandidates = [
        { machine: next1, diff: next2 },
        { machine: prev1, diff: prev2 },
      ];
      const verticalTarget = verticalCandidates.find(({ machine, diff }) => isBlankCell(machine) && isBlankCell(diff));
      const horizontalTarget = horizontalCandidates.find(({ machine, diff }) => isBlankCell(machine) && isBlankCell(diff));

      const target = verticalTarget ?? horizontalTarget;

      if (!target) return;
      writeDataCell(target.machine, data.name, 'floor-map-machine-name', data.flagColor, machineNumber);
      writeDiffCell(target.diff, data.diff, data.flagColor, machineNumber);
    });
    return doc.body.innerHTML;
  }, [html, machineDataByNumber]);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const cell = target?.closest?.('[data-machine-number]') as HTMLElement | null;
    const machineNumber = String(cell?.dataset?.machineNumber ?? '').trim();
    if (!machineNumber) return;
    onOpenMachineData(machineNumber);
  }, [onOpenMachineData]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (pinchRef.current.active) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
      active: true,
      moved: false,
    };
    scroller.setPointerCapture?.(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pinchRef.current.active) return;
    const scroller = scrollRef.current;
    const drag = dragRef.current;
    if (!scroller || !drag.active) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      drag.moved = true;
    }
    scroller.scrollLeft = drag.left - dx;
    scroller.scrollTop = drag.top - dy;
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag.moved) {
      const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = hit?.closest?.('[data-machine-number]') as HTMLElement | null;
      const machineNumber = String(cell?.dataset?.machineNumber ?? '').trim();
      const now = Date.now();
      const last = lastTapRef.current;
      if (machineNumber && last.machineNumber === machineNumber && now - last.time <= 350) {
        lastTapRef.current = { time: 0, machineNumber: '' };
        onOpenMachineData(machineNumber);
      } else {
        lastTapRef.current = { time: now, machineNumber };
      }
    }
    dragRef.current.active = false;
  }, [onOpenMachineData]);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) return;
    event.preventDefault();
    pinchRef.current = {
      active: true,
      distance: getTouchDistance(event.touches),
      scale,
      appliedScale: scale,
      nextScale: scale,
      ...getTouchCenter(event.touches),
      frame: null,
    };
    dragRef.current.active = false;
    dragRef.current.moved = true;
  }, [scale]);

  const handleTouchMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (!pinch.active || event.touches.length < 2 || pinch.distance <= 0) return;
    event.preventDefault();
    const nextDistance = getTouchDistance(event.touches);
    const center = getTouchCenter(event.touches);
    pinch.nextScale = clampScale(pinch.scale * (nextDistance / pinch.distance));
    pinch.centerX = center.centerX;
    pinch.centerY = center.centerY;
    if (pinch.frame != null) return;
    pinch.frame = requestAnimationFrame(() => {
      const current = pinchRef.current;
      current.frame = null;
      if (!current.active) return;
      applyPinchScaleAtCenter(current.nextScale, current.centerX, current.centerY);
    });
  }, [applyPinchScaleAtCenter, clampScale]);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length < 2) {
      const pinch = pinchRef.current;
      if (pinch.frame != null) {
        cancelAnimationFrame(pinch.frame);
        pinch.frame = null;
      }
      if (pinch.active) {
        applyPinchScaleAtCenter(pinch.nextScale, pinch.centerX, pinch.centerY);
        onScaleChange(pinch.nextScale);
      }
      pinch.active = false;
    }
  }, [applyPinchScaleAtCenter, onScaleChange]);

  const contentStyle = useMemo<React.CSSProperties>(() => ({
    transform: `scale(${scale})`,
    transformOrigin: '0 0',
    width: `${100 / scale}%`,
    minWidth: 'max-content',
  }), [scale]);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#555', fontSize: 14 }}>
        読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#555', fontSize: 14 }}>
        表示できません。
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          borderBottom: '1px solid #ddd',
          background: '#fff',
          flexShrink: 0,
        }}
      >
        <div
          className="floor-map-date-strip"
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            flex: 1,
            height: 38,
            paddingBottom: 8,
          }}
        >
          {dateOptions.map((option) => {
            const active = option.field === activeDateField;
            return (
              <button
                key={option.field}
                type="button"
                aria-pressed={active}
                onClick={() => onDateFieldChange(option.field)}
                style={{
                  minWidth: 58,
                  height: 30,
                  padding: '0 8px',
                  border: '1px solid #c9d4e2',
                  borderRight: 0,
                  background: active ? '#1976d2' : '#fff',
                  color: active ? '#fff' : '#222',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          paddingTop: 12,
          paddingLeft: 12,
          boxSizing: 'border-box',
          cursor: 'grab',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'none',
          overscrollBehavior: 'contain',
          background: '#fff',
        }}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div ref={contentRef} style={contentStyle}>
          <div dangerouslySetInnerHTML={{ __html: injectedHtml }} />
          <style>
            {`
              .floor-map-table {
                border-collapse: collapse !important;
                border-spacing: 0 !important;
                table-layout: fixed !important;
              }
              .floor-map-table td {
                padding: 0 !important;
                margin: 0 !important;
                max-width: 0 !important;
                overflow: hidden !important;
                white-space: nowrap !important;
                text-overflow: ellipsis !important;
              }
              .floor-map-table .floor-map-machine-name,
              .floor-map-table .floor-map-diff {
                font-size: 8px !important;
                font-weight: 800 !important;
                text-align: center !important;
                vertical-align: middle !important;
                overflow: hidden !important;
                white-space: nowrap !important;
                text-overflow: ellipsis !important;
                max-width: 0 !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
              }
              .floor-map-table .floor-map-machine-name {
                color: #24728b !important;
              }
              .floor-map-table .floor-map-diff {
                color: #17202a !important;
              }
              .floor-map-table .floor-map-diff-positive {
                color: #4c6cb3 !important;
                font-weight: 800 !important;
              }
              .floor-map-table .floor-map-diff-negative {
                color: #d9333f !important;
                font-weight: 800 !important;
              }
              .floor-map-date-strip {
                scrollbar-gutter: stable;
              }
            `}
          </style>
        </div>
      </div>
    </div>
  );
};

export type { FloorMapDateOption, FloorMapMachineData };

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

const FONT_NAME = 'Segoe UI';
const HEADER_BG = 'FFA3B18A'; // Soft Matcha Green
const TITLE_BG = 'FF3A5A40';  // Dark Forest Green
const ZEBRA_BG = 'FFF8F9F5';  // Soft warm gray-green
const WHITE_BG = 'FFFFFFFF';
const LIGHT_GRAY_BORDER = 'FFE2E8F0';

const titleFont = { name: FONT_NAME, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
const subtitleFont = { name: FONT_NAME, size: 10, italic: true, color: { argb: 'FFD3D3D3' } };
const sectionHeaderFont = { name: FONT_NAME, size: 12, bold: true, color: { argb: 'FF3A5A40' } };
const tableHeaderFont = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const dataFont = { name: FONT_NAME, size: 10, color: { argb: 'FF2D3748' } };
const dataFontBold = { name: FONT_NAME, size: 10, bold: true, color: { argb: 'FF2D3748' } };

const thinBorder = {
  top: { style: 'thin' as const, color: { argb: LIGHT_GRAY_BORDER } },
  left: { style: 'thin' as const, color: { argb: LIGHT_GRAY_BORDER } },
  bottom: { style: 'thin' as const, color: { argb: LIGHT_GRAY_BORDER } },
  right: { style: 'thin' as const, color: { argb: LIGHT_GRAY_BORDER } }
};

function isSchemaValidationError(error: unknown) {
  return error instanceof Error && (
    error.message.includes('Unknown argument `completedAt`') ||
    error.message.includes('Unknown argument `droppedAt`')
  );
}

export async function GET() {
  try {
    // 1. Fetch data from DB
    const [watching, completedCountResult, watchingCount, droppedCount, totalEpisodesResult, uniqueCountResult] = await Promise.all([
      db.anime.findMany({
        where: { status: 'incomplete' },
        orderBy: [
          { watchOrder: 'asc' },
          { createdAt: 'desc' }
        ]
      }),
      db.anime.count({ where: { status: 'completed' } }),
      db.anime.count({ where: { status: 'incomplete' } }),
      db.anime.count({ where: { status: 'dropped' } }),
      db.anime.aggregate({
        _sum: { episodesWatched: true }
      }),
      db.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT "normalizedName") as count 
        FROM "Anime" 
        WHERE status IN ('completed', 'incomplete')
      `
    ]);

    // Handle dropped with compatibility fallback
    let dropped = [];
    try {
      dropped = await db.anime.findMany({
        where: { status: 'dropped' },
        orderBy: [
          { droppedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' }
        ]
      });
    } catch (error) {
      if (isSchemaValidationError(error)) {
        dropped = await db.anime.findMany({
          where: { status: 'dropped' },
          orderBy: { createdAt: 'desc' }
        });
      } else {
        throw error;
      }
    }

    // Handle completed with compatibility fallback
    let completed = [];
    try {
      completed = await db.anime.findMany({
        where: { status: 'completed' },
        orderBy: [
          { completedAt: { sort: 'desc', nulls: 'last' } },
          { originalOrder: 'asc' }
        ]
      });
    } catch (error) {
      if (isSchemaValidationError(error)) {
        completed = await db.anime.findMany({
          where: { status: 'completed' },
          orderBy: { originalOrder: 'asc' }
        });
      } else {
        throw error;
      }
    }

    const uniqueTotal = Number(uniqueCountResult[0]?.count || 0);
    const totalEpisodes = totalEpisodesResult._sum.episodesWatched || 0;
    const completedCount = completedCountResult;

    // 2. Initialize Excel Workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'OtakuMind';
    workbook.created = new Date();

    // Helper to style sheet views (enable grid lines)
    const setupSheet = (sheet: ExcelJS.Worksheet) => {
      sheet.views = [{ showGridLines: true }];
    };

    // Helper to style beautiful header block
    const addHeaderBlock = (sheet: ExcelJS.Worksheet, title: string, subtitle: string, columnsCount: number) => {
      sheet.mergeCells(2, 1, 3, columnsCount);
      const titleCell = sheet.getCell(2, 1);
      titleCell.value = `${title.toUpperCase()}\n${subtitle}`;
      titleCell.font = titleFont;
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: TITLE_BG }
      };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      
      sheet.getRow(2).height = 25;
      sheet.getRow(3).height = 25;
    };

    // Helper to apply header row styles
    const styleTableHeader = (sheet: ExcelJS.Worksheet, rowNumber: number, columnsCount: number) => {
      const row = sheet.getRow(rowNumber);
      row.height = 24;
      for (let col = 1; col <= columnsCount; col++) {
        const cell = row.getCell(col);
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: HEADER_BG }
        };
        cell.font = tableHeaderFont;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = thinBorder;
      }
    };

    // ==========================================
    // SHEET 1: OVERVIEW
    // ==========================================
    const overviewSheet = workbook.addWorksheet('Overview');
    setupSheet(overviewSheet);
    addHeaderBlock(overviewSheet, 'OtakuMind Collection Overview', 'Your personal minimalist anime journal & archives', 4);

    overviewSheet.getRow(5).height = 20;
    overviewSheet.getCell(5, 1).value = 'COLLECTION STATISTICS';
    overviewSheet.getCell(5, 1).font = sectionHeaderFont;

    overviewSheet.columns = [
      { key: 'metric', width: 30 },
      { key: 'value', width: 18 },
      { key: 'spacer', width: 5 },
      { key: 'legend', width: 25 }
    ];

    // Stats Table headers
    overviewSheet.getCell(7, 1).value = 'Statistic Metric';
    overviewSheet.getCell(7, 2).value = 'Value';
    styleTableHeader(overviewSheet, 7, 2);

    const statsData = [
      { metric: 'Total Unique Anime', value: uniqueTotal },
      { metric: 'Currently Watching', value: watchingCount },
      { metric: 'Completed Anime', value: completedCount },
      { metric: 'Dropped Anime', value: droppedCount },
      { metric: 'Total Episodes Watched', value: totalEpisodes },
      { metric: 'Export Date', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }
    ];

    statsData.forEach((stat, idx) => {
      const rowNum = 8 + idx;
      const isEven = idx % 2 === 1;
      const row = overviewSheet.getRow(rowNum);
      row.height = 20;
      const bg = isEven ? ZEBRA_BG : WHITE_BG;

      const metricCell = row.getCell(1);
      metricCell.value = stat.metric;
      metricCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      metricCell.font = dataFont;
      metricCell.border = thinBorder;
      metricCell.alignment = { vertical: 'middle', horizontal: 'left' };

      const valueCell = row.getCell(2);
      valueCell.value = stat.value;
      valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      valueCell.font = dataFontBold;
      valueCell.border = thinBorder;
      valueCell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // Add a neat quote/info card on the side
    overviewSheet.mergeCells(7, 4, 13, 4);
    const cardCell = overviewSheet.getCell(7, 4);
    cardCell.value = "ABOUT OTAKUMIND\n\nThis spreadsheet contains your entire curated anime archive.\n\nEnjoy your viewing journey!\n\n\"Simplicity is the ultimate sophistication.\"\n— Leonardo da Vinci";
    cardCell.font = { name: FONT_NAME, size: 9, italic: true, color: { argb: 'FF5E6472' } };
    cardCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_BG } };
    cardCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cardCell.border = thinBorder;


    // ==========================================
    // SHEET 2: CURRENTLY WATCHING
    // ==========================================
    const watchingSheet = workbook.addWorksheet('Currently Watching');
    setupSheet(watchingSheet);
    addHeaderBlock(watchingSheet, 'Currently Watching List', 'Active entries in your watchlist', 8);

    watchingSheet.columns = [
      { header: 'No.', key: 'num', width: 6 },
      { header: 'Anime Title', key: 'name', width: 45 },
      { header: 'Season', key: 'season', width: 10 },
      { header: 'Progress', key: 'episodes', width: 12 },
      { header: 'Airing Status', key: 'airing', width: 15 },
      { header: 'Broadcast Info', key: 'broadcast', width: 25 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Date Added', key: 'added', width: 15 }
    ];

    styleTableHeader(watchingSheet, 4, 8);

    watching.forEach((anime, idx) => {
      const rowNum = 5 + idx;
      const isEven = idx % 2 === 1;
      const row = watchingSheet.getRow(rowNum);
      row.height = 20;
      const bg = isEven ? ZEBRA_BG : WHITE_BG;

      const dateStr = anime.createdAt ? new Date(anime.createdAt).toISOString().split('T')[0] : '-';
      const airingStr = anime.airing ? 'Currently Airing' : 'Finished Airing';
      const broadcastStr = anime.broadcastString || (anime.broadcastDay ? `${anime.broadcastDay} at ${anime.broadcastTime || ''}` : '-');

      const values = [
        idx + 1,
        anime.name,
        anime.season,
        `${anime.episodesWatched} eps`,
        airingStr,
        broadcastStr,
        anime.type || 'TV',
        dateStr
      ];

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = colIdx === 1 ? dataFontBold : dataFont;
        cell.border = thinBorder;
        
        // Centering alignment for S.No, Season, Progress, Airing Status, Type, and Date Added
        const shouldCenter = [0, 2, 3, 4, 6, 7].includes(colIdx);
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: shouldCenter ? 'center' : 'left',
          wrapText: true 
        };
      });
    });


    // ==========================================
    // SHEET 3: COMPLETED
    // ==========================================
    const completedSheet = workbook.addWorksheet('Completed');
    setupSheet(completedSheet);
    addHeaderBlock(completedSheet, 'Completed Archives', 'Successfully finished anime collection', 8);

    completedSheet.columns = [
      { header: 'No.', key: 'num', width: 6 },
      { header: 'Original No.', key: 'originalNum', width: 14 },
      { header: 'Anime Title', key: 'name', width: 45 },
      { header: 'Season', key: 'season', width: 10 },
      { header: 'Episodes Watched', key: 'episodes', width: 18 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Normalized Group Name', key: 'group', width: 35 },
      { header: 'Date Added', key: 'added', width: 15 }
    ];

    styleTableHeader(completedSheet, 4, 8);

    completed.forEach((anime, idx) => {
      const rowNum = 5 + idx;
      const isEven = idx % 2 === 1;
      const row = completedSheet.getRow(rowNum);
      row.height = 20;
      const bg = isEven ? ZEBRA_BG : WHITE_BG;

      const dateStr = anime.createdAt ? new Date(anime.createdAt).toISOString().split('T')[0] : '-';

      const values = [
        idx + 1,
        anime.originalOrder || '-',
        anime.name,
        anime.season,
        anime.episodesWatched,
        anime.type || 'TV',
        anime.normalizedName,
        dateStr
      ];

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = colIdx === 2 ? dataFontBold : dataFont;
        cell.border = thinBorder;

        // Centering alignment for S.No, Original No., Season, Episodes, Type, and Date Added
        const shouldCenter = [0, 1, 3, 4, 5, 7].includes(colIdx);
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: shouldCenter ? 'center' : 'left',
          wrapText: true 
        };
      });
    });


    // ==========================================
    // SHEET 4: DROPPED
    // ==========================================
    const droppedSheet = workbook.addWorksheet('Dropped');
    setupSheet(droppedSheet);
    addHeaderBlock(droppedSheet, 'Dropped Archives', 'Entries you decided to step away from', 6);

    droppedSheet.columns = [
      { header: 'No.', key: 'num', width: 6 },
      { header: 'Anime Title', key: 'name', width: 45 },
      { header: 'Season', key: 'season', width: 10 },
      { header: 'Progress', key: 'episodes', width: 12 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Date Dropped', key: 'droppedDate', width: 15 }
    ];

    styleTableHeader(droppedSheet, 4, 6);

    dropped.forEach((anime, idx) => {
      const rowNum = 5 + idx;
      const isEven = idx % 2 === 1;
      const row = droppedSheet.getRow(rowNum);
      row.height = 20;
      const bg = isEven ? ZEBRA_BG : WHITE_BG;

      const dateField = anime.droppedAt || anime.createdAt;
      const dateStr = dateField ? new Date(dateField).toISOString().split('T')[0] : '-';

      const values = [
        idx + 1,
        anime.name,
        anime.season,
        `${anime.episodesWatched} eps`,
        anime.type || 'TV',
        dateStr
      ];

      values.forEach((val, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = val;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = colIdx === 1 ? dataFontBold : dataFont;
        cell.border = thinBorder;

        // Centering alignment for S.No, Season, Progress, Type, and Date Dropped
        const shouldCenter = [0, 2, 3, 4, 5].includes(colIdx);
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: shouldCenter ? 'center' : 'left',
          wrapText: true 
        };
      });
    });

    // 3. Compile and write buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=OtakuMind_Anime_Collection.xlsx',
        'Cache-Control': 'no-store, max-age=0'
      }
    });

  } catch (error: any) {
    console.error('Failed to export anime:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to export anime to Excel' },
      { status: 500 }
    );
  }
}

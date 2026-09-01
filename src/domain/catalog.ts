import type { CategoryId, StockState } from './types';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** 出品フォームの見出しプレースホルダ */
  headlinePlaceholder: string;
  enabled: boolean;
  note: string;
}

/**
 * MVPは店頭在庫だけ。他は定義だけ置いて選べなくしておく。
 * 「同じ場所で売買が繰り返されるか」を1カテゴリで見きるまで広げない。
 */
export const CATEGORIES: CategoryDef[] = [
  {
    id: 'shelf_stock',
    label: '店頭の在庫',
    headlinePlaceholder: '例: ヨドバシ7Fに Switch2 の在庫',
    enabled: true,
    note: '棚にあるかどうか。写真が証拠になる',
  },
  {
    id: 'queue',
    label: '列・待ち時間',
    headlinePlaceholder: '例: 物販A列の待ち時間',
    enabled: false,
    note: '次の段階で開放',
  },
  {
    id: 'vacancy',
    label: '当日の空き',
    headlinePlaceholder: '例: 今夜の空室',
    enabled: false,
    note: '次の段階で開放',
  },
];

export const ENABLED_CATEGORIES = CATEGORIES.filter((c) => c.enabled);
export const DEFAULT_CATEGORY: CategoryId = 'shelf_stock';

export function categoryLabel(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export const STOCK_STATES: { id: StockState; label: string; short: string }[] = [
  { id: 'in_stock', label: 'ある', short: 'あり' },
  { id: 'few', label: '残りわずか', short: 'わずか' },
  { id: 'out', label: 'ない', short: 'なし' },
];

export function stockLabel(state: StockState): string {
  return STOCK_STATES.find((s) => s.id === state)?.label ?? state;
}

/**
 * 扱わない情報。出品と依頼の両方でこれに同意させ、通報の判断基準にもする。
 */
export const FORBIDDEN_RULES = [
  '特定の個人がどこにいるか（私人の所在・追跡）',
  '見た事実ではない予想（買い目、設定、勝ち負けの見立て）',
  '立入禁止の場所や、撮影が禁止されている場所の中身',
  '他人の顔や名前、車のナンバーが読み取れる写真',
];

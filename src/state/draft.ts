import { create } from 'zustand';

import type { LatLng, StockState } from '@/domain/types';

export interface SellDraft {
  lat?: number;
  lng?: number;
  placeLabel?: string;
  headline?: string;
  stockState?: StockState;
  quantityNote?: string;
  payloadText?: string;
  photoUri?: string;
}

interface DraftState {
  sellDraft: SellDraft | null;
  setSellDraft: (draft: SellDraft) => void;
  clearSellDraft: () => void;
}

/**
 * 採用された懸賞の報告を、そのまま売品ピンとして出し直すための受け渡し。
 * 出品フォームは A フローのものをそのまま使い回す。
 */
export const useDraft = create<DraftState>((set) => ({
  sellDraft: null,
  setSellDraft: (sellDraft) => set({ sellDraft }),
  clearSellDraft: () => set({ sellDraft: null }),
}));

export function draftFromReport(
  point: LatLng,
  areaLabel: string,
  targetText: string,
  reportText: string,
  photoUri: string | null
): SellDraft {
  return {
    lat: point.lat,
    lng: point.lng,
    placeLabel: areaLabel,
    headline: targetText.slice(0, 40),
    payloadText: reportText,
    photoUri: photoUri ?? undefined,
  };
}

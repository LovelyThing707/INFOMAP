import { feeFor, isBountyOpen, isOnMap } from '@/domain/rules';
import type {
  Bounty,
  BountyApplication,
  Pin,
  PriceAsk,
  Purchase,
  StockState,
  User,
  WalletEntry,
} from '@/domain/types';

import { newId } from './ids';
import {
  balanceOf,
  holdForBounty,
  holdForPurchase,
  payBounty,
  refundPurchase,
  returnBounty,
  settlePurchase,
  topUp,
} from './ledger';

export interface DB {
  version: number;
  users: User[];
  pins: Pin[];
  purchases: Purchase[];
  bounties: Bounty[];
  applications: BountyApplication[];
  asks: PriceAsk[];
  wallet: WalletEntry[];
  payouts: { id: string; userId: string; amount: number; status: 'requested' | 'paid'; createdAt: number }[];
  reports: { id: string; reporterId: string; targetKind: 'pin' | 'bounty'; targetId: string; reason: string; createdAt: number }[];
  currentUserId: string;
  /** サンプルを何周させたか。出し直すときの id に使う */
  loopCount: number;
}

export const DB_VERSION = 5;
export const ME = 'u_me';

const MIN = 60 * 1000;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 実写がないので、店内の棚を思わせるプレースホルダをSVGで作る。
 * 外部通信なしで、購入前後の見え方の違いだけは正しく確認できる。
 */
function shelfPhoto(label: string, hue: number): string {
  const text = escapeXml(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="hsl(${hue},30%,90%)"/><stop offset="1" stop-color="hsl(${hue},26%,68%)"/>
</linearGradient></defs>
<rect width="640" height="420" fill="url(#g)"/>
<g fill="hsl(${hue},22%,52%)" opacity="0.55">
<rect x="40" y="120" width="560" height="10" rx="4"/>
<rect x="40" y="240" width="560" height="10" rx="4"/>
<rect x="40" y="360" width="560" height="10" rx="4"/>
</g>
<g fill="hsl(${hue},34%,42%)" opacity="0.75">
<rect x="70" y="58" width="70" height="62" rx="6"/><rect x="160" y="72" width="70" height="48" rx="6"/>
<rect x="250" y="50" width="70" height="70" rx="6"/><rect x="340" y="80" width="70" height="40" rx="6"/>
<rect x="90" y="182" width="70" height="58" rx="6"/><rect x="180" y="196" width="70" height="44" rx="6"/>
<rect x="270" y="176" width="70" height="64" rx="6"/>
<rect x="110" y="306" width="70" height="54" rx="6"/><rect x="200" y="318" width="70" height="42" rx="6"/>
</g>
<rect x="0" y="352" width="640" height="68" fill="rgba(15,23,42,0.72)"/>
<text x="24" y="394" fill="#ffffff" font-family="sans-serif" font-size="26" font-weight="700">${text}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

interface SeedPin {
  id: string;
  seller: string;
  place: string;
  lat: number;
  lng: number;
  headline: string;
  payload: string;
  qty: string | null;
  stock: StockState;
  price: number;
  slots: number;
  agoMin: number;
  ttlMin: number;
  hue: number;
  voided?: boolean;
}

/**
 * 秋葉原・上野・神田・日本橋・銀座までを散らして、地図を動かすと別の街の情報が出る状態を作る。
 * 残り時間・残枠・価格・状態・出品者を意図的にばらけさせてあり、
 * 鮮度で色が変わること、枠が埋まると灰色になること、期限切れが消えることを1画面で確認できる。
 */
const SEED_PINS: SeedPin[] = [
  {
    id: 'p_yodobashi_switch', seller: 'u_kana', place: 'ヨドバシAkiba 7F',
    lat: 35.6987, lng: 139.7745, headline: 'Switch2 本体の在庫',
    payload: '7F ゲームコーナーのレジ横、展示台の下に3箱。整理券なしでそのまま買えた。店員いわく朝の入荷分の残りで、夕方の追加はないとのこと。',
    qty: '残り3台', stock: 'in_stock', price: 300, slots: 3, agoMin: 1, ttlMin: 15, hue: 210,
  },
  {
    id: 'p_yodobashi_acc', seller: ME, place: 'ヨドバシAkiba 6F',
    lat: 35.6985, lng: 139.7748, headline: '売り切れていた周辺機器',
    payload: '6Fのアクセサリ売場、レジ正面の什器に補充されていた。数は5個以上。',
    qty: '5個以上', stock: 'in_stock', price: 200, slots: 2, agoMin: 4, ttlMin: 30, hue: 205,
  },
  {
    id: 'p_bic_gpu', seller: 'u_rin', place: 'ビックカメラAKIBA 4F',
    lat: 35.6981, lng: 139.7726, headline: '入荷したGPUの棚',
    payload: '4F PCパーツ、エスカレーター上がって右奥の壁。値札が新しくなっていて2枚だけ在庫あり。ひとり1点の張り紙が出ている。',
    qty: '残り2枚', stock: 'few', price: 500, slots: 2, agoMin: 3, ttlMin: 30, hue: 260,
  },
  {
    id: 'p_sofmap_used', seller: 'u_sho', place: 'ソフマップAKIBA 1号店',
    lat: 35.7003, lng: 139.7715, headline: '中古の入替え棚',
    payload: '2Fの中古ワゴンが今さっき入れ替わった。ジャンク扱いだが動作品が数本混ざっている。',
    qty: null, stock: 'in_stock', price: 100, slots: 1, agoMin: 6, ttlMin: 15, hue: 190,
  },
  {
    id: 'p_akibaoo_figure', seller: 'u_mei', place: 'あきばおー 5号店',
    lat: 35.7005, lng: 139.7712, headline: '限定フィギュアの棚',
    payload: '入口入って左のワゴン、上段に1体だけ残っている。箱に少し傷あり。値下げ札が付いていた。',
    qty: '残り1体', stock: 'few', price: 200, slots: 2, agoMin: 12, ttlMin: 15, hue: 340,
  },
  {
    id: 'p_animate_bonus', seller: 'u_kana', place: 'アニメイト秋葉原',
    lat: 35.701, lng: 139.771, headline: '特典付き初回版の残り',
    payload: '3Fレジ前の平台。特典付きはあと2冊、特典なしは山積み。レジで特典の有無を聞かれる。',
    qty: '残り2冊', stock: 'few', price: 300, slots: 3, agoMin: 8, ttlMin: 30, hue: 20,
  },
  {
    id: 'p_radiokaikan_restock', seller: 'u_taku', place: '秋葉原ラジオ会館 3F',
    lat: 35.6982, lng: 139.7716, headline: '会場限定分の再入荷',
    payload: '再入荷の告知が出ていたが、行ったらもう棚は空だった。補充の予定も貼り紙なし。',
    qty: null, stock: 'out', price: 200, slots: 1, agoMin: 42, ttlMin: 15, hue: 30,
  },
  {
    id: 'p_donki_ticket', seller: 'u_rin', place: 'ドン・キホーテ秋葉原店',
    lat: 35.7003, lng: 139.7723, headline: '整理券の配布状況',
    payload: '1F入口横で整理券を配布中。今の時点で番号は40番台。配布は在庫がなくなり次第終了とのこと。',
    qty: '40番台', stock: 'in_stock', price: 200, slots: 2, agoMin: 2, ttlMin: 60, hue: 350,
  },
  {
    id: 'p_kotobukiya_kit', seller: 'u_mei', place: 'コトブキヤ秋葉原館',
    lat: 35.7, lng: 139.7718, headline: 'プラモの再販分',
    payload: '4Fの再販コーナーに山積み。数はまだ十分ある。夕方まではもちそう。',
    qty: '10箱以上', stock: 'in_stock', price: 200, slots: 2, agoMin: 5, ttlMin: 30, hue: 150,
  },
  {
    id: 'p_akizuki_parts', seller: 'u_sho', place: '秋月電子通商',
    lat: 35.6993, lng: 139.7703, headline: '欠品していたパーツ',
    payload: '店頭の引き出し棚、通路奥の左側。補充済みで在庫あり。ひとり5個までの制限あり。',
    qty: '在庫あり', stock: 'in_stock', price: 100, slots: 3, agoMin: 9, ttlMin: 60, hue: 100,
  },
  {
    id: 'p_gamers_bonus', seller: 'u_kana', place: 'ゲーマーズ本店',
    lat: 35.6989, lng: 139.7735, headline: '店舗特典の残数',
    payload: '1Fレジで確認。特典はあと5枚とのこと。予約分を除いた店頭在庫の数。',
    qty: '残り5枚', stock: 'few', price: 300, slots: 1, agoMin: 1, ttlMin: 15, hue: 280,
  },
  {
    id: 'p_labi_sale', seller: 'u_taku', place: 'ヤマダデンキ LABI秋葉原',
    lat: 35.6979, lng: 139.7742, headline: 'セール棚の残り',
    payload: '2Fの赤札コーナー。目当てのものは残り1点で、値札に「展示品限り」と書いてある。',
    qty: '残り1点', stock: 'few', price: 100, slots: 2, agoMin: 14, ttlMin: 15, hue: 40,
  },
  {
    id: 'p_toranoana_soldout', seller: 'u_rin', place: 'とらのあな秋葉原店',
    lat: 35.7002, lng: 139.7708, headline: '完売表示の有無',
    payload: '入口の完売リストに載っていない。棚を見に行ったら平積みで残っていた。',
    qty: '在庫あり', stock: 'in_stock', price: 200, slots: 1, agoMin: 4, ttlMin: 30, hue: 320,
  },
  {
    id: 'p_sengoku_stock', seller: 'u_mei', place: '千石電商 本店',
    lat: 35.6996, lng: 139.7702, headline: '在庫棚の状況',
    payload: 'B1の棚、右から3列目。在庫は潤沢。隣に互換品も並んでいる。',
    qty: '在庫あり', stock: 'in_stock', price: 100, slots: 2, agoMin: 7, ttlMin: 60, hue: 170,
  },
  {
    id: 'p_udx_goods', seller: 'u_sho', place: '秋葉原UDX 2F',
    lat: 35.7004, lng: 139.7735, headline: '物販の在庫状況',
    payload: '物販ブースの残り、Lサイズのみ。M以下は完売の札が出ている。',
    qty: 'Lのみ', stock: 'few', price: 200, slots: 2, agoMin: 2, ttlMin: 30, hue: 230,
  },
  {
    id: 'p_mandarake_case', seller: 'u_yuki', place: 'まんだらけ 秋葉原',
    lat: 35.7006, lng: 139.7719, headline: 'ショーケースの入替え',
    payload: '3Fのショーケースが今日入れ替わった。相場より安い値付けのものが2点。開店直後だから競合はまだ少ない。',
    qty: '2点', stock: 'few', price: 500, slots: 2, agoMin: 3, ttlMin: 45, hue: 300,
  },
  {
    id: 'p_radiodepart_conn', seller: 'u_gen', place: '東京ラジオデパート 2F',
    lat: 35.6989, lng: 139.7708, headline: '特殊コネクタの在庫',
    payload: '2Fの奥、右側の小さい店。袋詰めで壁にぶら下がっている。現金のみ。',
    qty: '10個以上', stock: 'in_stock', price: 100, slots: 3, agoMin: 22, ttlMin: 60, hue: 120,
  },
  {
    id: 'p_radiocenter_tube', seller: 'u_gen', place: '秋葉原ラジオセンター',
    lat: 35.6985, lng: 139.771, headline: '真空管の入荷',
    payload: 'ガード下、いちばん奥の店に入荷。状態の良いものが4本。試験済みの札が付いている。',
    qty: '4本', stock: 'in_stock', price: 300, slots: 2, agoMin: 18, ttlMin: 90, hue: 25,
  },
  {
    id: 'p_suehiro_cards', seller: 'u_hiro', place: '末広町 カードショップ',
    lat: 35.702, lng: 139.7714, headline: '再販パックの入荷',
    payload: 'レジ後ろの棚に3箱。ひとり1箱まで。開店から30分でこの数なので、昼には無くなりそう。',
    qty: '3箱', stock: 'few', price: 500, slots: 1, agoMin: 2, ttlMin: 20, hue: 265,
  },
  {
    id: 'p_takeya_kitchen', seller: 'u_nao', place: '多慶屋 A館 3F',
    lat: 35.7069, lng: 139.7752, headline: '型落ち調理家電の値下げ',
    payload: '3Fの奥、値札が黄色に貼り替わっている。同じ型が5台。展示品ではなく新品。',
    qty: '5台', stock: 'in_stock', price: 200, slots: 3, agoMin: 11, ttlMin: 60, hue: 45,
  },
  {
    id: 'p_yoshiike_fish', seller: 'u_tomo', place: '御徒町 吉池 B1',
    lat: 35.7072, lng: 139.774, headline: '半額シールの時間',
    payload: 'B1鮮魚、いま半額シールを貼り始めた。刺身のパックが中心で、20点ほど。',
    qty: '20点ほど', stock: 'in_stock', price: 100, slots: 3, agoMin: 1, ttlMin: 20, hue: 195,
  },
  {
    id: 'p_ameyoko_sneaker', seller: 'u_hiro', place: 'アメ横 中ほどの靴屋',
    lat: 35.7095, lng: 139.7745, headline: '在庫サイズの残り',
    payload: '店頭の山、27.0と28.0だけ残っている。26台は完売。値札は表示価格からさらに引ける。',
    qty: '27.0 / 28.0', stock: 'few', price: 200, slots: 2, agoMin: 6, ttlMin: 40, hue: 15,
  },
  {
    id: 'p_marui_cosme', seller: 'u_saki', place: '上野マルイ 5F',
    lat: 35.7079, lng: 139.7745, headline: '限定コフレの在庫',
    payload: '5Fのカウンター、取り置き分を除いて3セット。予約なしで買えるとのこと。',
    qty: '3セット', stock: 'few', price: 300, slots: 2, agoMin: 9, ttlMin: 45, hue: 335,
  },
  {
    id: 'p_matsuzakaya_food', seller: 'u_tomo', place: '上野松坂屋 本館B1',
    lat: 35.7071, lng: 139.7728, headline: '催事の行列と在庫',
    payload: 'B1催事場、目当ての店は列なしで買える。整理券も終了していて、そのまま並べば買える状態。',
    qty: null, stock: 'in_stock', price: 200, slots: 2, agoMin: 15, ttlMin: 45, hue: 340,
  },
  {
    id: 'p_ameyoko_center', seller: 'u_nao', place: 'アメ横センタービル B1',
    lat: 35.7098, lng: 139.774, headline: '輸入食材の入荷',
    payload: '地下の食品街、いちばん手前の店に入荷。棚の下段に箱ごと積んである。',
    qty: '箱で入荷', stock: 'in_stock', price: 100, slots: 3, agoMin: 26, ttlMin: 90, hue: 85,
  },
  {
    id: 'p_ueno_station_pop', seller: 'u_yuki', place: '上野駅 中央改札前',
    lat: 35.7141, lng: 139.7774, headline: '催事ブースの残数',
    payload: '改札前の期間限定ブース。人気の詰め合わせはあと6箱。撤収は19時とのこと。',
    qty: '6箱', stock: 'few', price: 200, slots: 2, agoMin: 4, ttlMin: 35, hue: 55,
  },
  {
    id: 'p_yushima_import', seller: 'u_saki', place: '湯島 天神下の輸入食品店',
    lat: 35.7076, lng: 139.7683, headline: '品切れしていた輸入菓子',
    payload: '入口右の棚に補充されている。賞味期限が近いぶん値引きされていた。',
    qty: '10個ほど', stock: 'in_stock', price: 100, slots: 2, agoMin: 33, ttlMin: 60, hue: 65,
  },
  {
    id: 'p_kanda_sports', seller: 'u_hiro', place: '神田 万世橋のスポーツ店',
    lat: 35.6968, lng: 139.7702, headline: 'セール棚のサイズ',
    payload: '2Fのセール棚、Mだけまとまって残っている。SとLは在庫なし。追加はないとのこと。',
    qty: 'Mのみ', stock: 'few', price: 100, slots: 2, agoMin: 19, ttlMin: 50, hue: 200,
  },
  {
    id: 'p_ogawamachi_shoes', seller: 'u_nao', place: '小川町 スポーツ用品店',
    lat: 35.6959, lng: 139.7654, headline: '型落ちモデルの在庫',
    payload: '3Fの壁面、旧モデルが半額。サイズは飛び飛びだが数は多い。',
    qty: '20足以上', stock: 'in_stock', price: 200, slots: 3, agoMin: 13, ttlMin: 70, hue: 220,
  },
  {
    id: 'p_jimbocho_book', seller: 'u_yuki', place: '神保町 書泉グランデ',
    lat: 35.696, lng: 139.7583, headline: 'サイン本の残り',
    payload: '1Fレジ横に平積み。あと4冊。数量限定でひとり1冊まで。',
    qty: '残り4冊', stock: 'few', price: 300, slots: 2, agoMin: 7, ttlMin: 40, hue: 30,
  },
  {
    id: 'p_jimbocho_used', seller: 'u_tomo', place: '神保町 古書店の均一台',
    lat: 35.6957, lng: 139.7576, headline: '均一台の入替え',
    payload: '店頭の100円均一が入れ替わったばかり。専門書がまとまって出ている。',
    qty: null, stock: 'in_stock', price: 100, slots: 2, agoMin: 3, ttlMin: 30, hue: 40,
  },
  {
    id: 'p_kanda_west', seller: 'u_gen', place: '神田駅 西口商店街',
    lat: 35.6919, lng: 139.7708, headline: '弁当の売り切れ状況',
    payload: '商店街の入口の店、人気の弁当はもう完売。隣の店はまだ並んでいる。',
    qty: null, stock: 'out', price: 100, slots: 2, agoMin: 8, ttlMin: 25, hue: 10,
  },
  {
    id: 'p_iwamotocho_sample', seller: 'u_saki', place: '岩本町 サンプル品の店',
    lat: 35.6944, lng: 139.7757, headline: 'サンプル放出の有無',
    payload: '月末のサンプル放出、今日は台に3列出ている。11時の開店直後で人はまばら。',
    qty: '3列', stock: 'in_stock', price: 200, slots: 2, agoMin: 5, ttlMin: 45, hue: 290,
  },
  {
    id: 'p_bakurocho_wholesale', seller: 'u_nao', place: '馬喰町 問屋街',
    lat: 35.6928, lng: 139.783, headline: '一般客可の店の在庫',
    payload: '角のビル2F、一般客も入れる日。奥の棚にまとめ買い向けの箱がある。',
    qty: null, stock: 'in_stock', price: 100, slots: 2, agoMin: 28, ttlMin: 60, hue: 175,
  },
  {
    id: 'p_asakusabashi_shimojima', seller: 'u_tomo', place: '浅草橋 シモジマ本店',
    lat: 35.6996, lng: 139.7857, headline: '季節資材の在庫',
    payload: '4Fの季節コーナー、まだ潤沢。レジは3台開いていて待ち時間なし。',
    qty: '潤沢', stock: 'in_stock', price: 100, slots: 3, agoMin: 16, ttlMin: 80, hue: 140,
  },
  {
    id: 'p_kuramae_bunbougu', seller: 'u_kana', place: '蔵前 文具店',
    lat: 35.7057, lng: 139.7912, headline: '限定インクの在庫',
    payload: '入って右の棚、限定色が2本だけ残っている。次回入荷は未定の札。',
    qty: '2本', stock: 'few', price: 300, slots: 1, agoMin: 2, ttlMin: 25, hue: 250,
  },
  {
    id: 'p_asakusa_nakamise', seller: 'u_mei', place: '浅草 仲見世 中ほど',
    lat: 35.713, lng: 139.7955, headline: '行列店の待ち状況',
    payload: '名物の店、いまは5人待ち。回転が速いので5分ほどで買える。売り切れ表示はまだ出ていない。',
    qty: '5人待ち', stock: 'in_stock', price: 100, slots: 3, agoMin: 1, ttlMin: 20, hue: 350,
  },
  {
    id: 'p_asakusa_marugoto', seller: 'u_yuki', place: '浅草 物産店',
    lat: 35.7118, lng: 139.7967, headline: '数量限定品の残り',
    payload: '2Fの入口すぐ、限定の詰め合わせが7つ。夕方までは持たなそう。',
    qty: '7つ', stock: 'few', price: 200, slots: 2, agoMin: 21, ttlMin: 55, hue: 75,
  },
  {
    id: 'p_mitsukoshi_gift', seller: 'u_hiro', place: '日本橋三越 本館B1',
    lat: 35.6862, lng: 139.774, headline: '数量限定の菓子',
    payload: 'B1の実演コーナー、焼き上がり待ちが3人。次の窯は10分後で20個焼けるとのこと。',
    qty: '10分後に20個', stock: 'in_stock', price: 300, slots: 2, agoMin: 3, ttlMin: 20, hue: 335,
  },
  {
    id: 'p_coredo_popup', seller: 'u_saki', place: 'コレド室町 3F',
    lat: 35.6866, lng: 139.7734, headline: 'ポップアップの在庫',
    payload: '3Fのポップアップ、初日で在庫は十分。レジ待ちもなし。',
    qty: '十分', stock: 'in_stock', price: 100, slots: 3, agoMin: 24, ttlMin: 70, hue: 305,
  },
  {
    id: 'p_ningyocho_amazake', seller: 'u_gen', place: '人形町 甘酒横丁',
    lat: 35.6863, lng: 139.7826, headline: '売り切れ時間の目安',
    payload: '横丁の名物店、いま残り12個。だいたい14時前には無くなる日が多いとのこと。',
    qty: '残り12個', stock: 'few', price: 100, slots: 2, agoMin: 10, ttlMin: 35, hue: 60,
  },
  {
    id: 'p_daimaru_dessert', seller: 'u_tomo', place: '東京駅 大丸 B1',
    lat: 35.6812, lng: 139.7671, headline: '土産菓子の行列',
    payload: 'B1の人気店、列は15人。ただし箱売りは別レジで待ちなしで買える。',
    qty: '15人待ち', stock: 'in_stock', price: 200, slots: 3, agoMin: 2, ttlMin: 30, hue: 20,
  },
  {
    id: 'p_gransta_bento', seller: 'u_rin', place: '東京駅 グランスタ地下',
    lat: 35.681, lng: 139.7666, headline: '限定弁当の残数',
    payload: '改札内の店、限定弁当はあと8個。夕方の入荷はないとのこと。',
    qty: '残り8個', stock: 'few', price: 200, slots: 2, agoMin: 5, ttlMin: 25, hue: 35,
  },
  {
    id: 'p_ginza_itoya', seller: 'u_kana', place: '銀座 伊東屋',
    lat: 35.672, lng: 139.7663, headline: '限定筆記具の在庫',
    payload: '4Fのカウンター、限定色は在庫なし。取り寄せは2週間待ちと言われた。',
    qty: null, stock: 'out', price: 200, slots: 2, agoMin: 12, ttlMin: 40, hue: 285,
  },
  {
    id: 'p_ginza_uniqlo', seller: 'u_mei', place: '銀座 ユニクロ',
    lat: 35.6717, lng: 139.765, headline: 'コラボ商品のサイズ',
    payload: '6Fのコラボ棚、MとLは完売。SとXLのみ。補充は明日とのこと。',
    qty: 'S / XL のみ', stock: 'few', price: 200, slots: 2, agoMin: 17, ttlMin: 50, hue: 0,
  },
  {
    id: 'p_yurakucho_bic', seller: 'u_sho', place: '有楽町 ビックカメラ',
    lat: 35.6748, lng: 139.7639, headline: '抽選販売の受付状況',
    payload: '5Fの特設、抽選の受付は今日いっぱい。応募は店頭のみで、購入履歴の提示が要る。',
    qty: null, stock: 'in_stock', price: 300, slots: 2, agoMin: 6, ttlMin: 60, hue: 240,
  },
  {
    id: 'p_voided_example', seller: 'u_taku', place: '秋葉原 中央通り',
    lat: 35.6998, lng: 139.7726, headline: '取り下げられた出品',
    payload: '出品者が内容の誤りに気づいて取り下げた。',
    qty: null, stock: 'in_stock', price: 200, slots: 2, agoMin: 20, ttlMin: 60, hue: 0, voided: true,
  },
  {
    id: 'p_expired_old', seller: 'u_nao', place: '秋葉原 昭和通り口',
    lat: 35.6989, lng: 139.7752, headline: '朝の入荷分の残り',
    payload: '開店直後の入荷分。この時点では棚に山積みだった。',
    qty: null, stock: 'in_stock', price: 100, slots: 2, agoMin: 180, ttlMin: 30, hue: 160,
  },
];

interface SeedBuy {
  pin: string;
  buyer: string;
  agoMin: number;
  /** held=判定待ち hit=当たり miss=外れ auto=猶予経過で自動確定 */
  outcome: 'held' | 'hit' | 'miss' | 'auto';
}

/**
 * 取引の段階をひととおり作る。slotTaken はここから数えるので、
 * 「売れた数」と購入レコードがずれることがない。
 */
const SEED_BUYS: SeedBuy[] = [
  { pin: 'p_bic_gpu', buyer: ME, agoMin: 3, outcome: 'held' },
  { pin: 'p_mandarake_case', buyer: ME, agoMin: 2, outcome: 'held' },
  { pin: 'p_radiokaikan_restock', buyer: ME, agoMin: 40, outcome: 'hit' },
  { pin: 'p_ginza_itoya', buyer: ME, agoMin: 11, outcome: 'miss' },
  { pin: 'p_expired_old', buyer: ME, agoMin: 175, outcome: 'auto' },
  { pin: 'p_ameyoko_sneaker', buyer: ME, agoMin: 5, outcome: 'held' },

  { pin: 'p_yodobashi_acc', buyer: 'u_rin', agoMin: 3, outcome: 'held' },

  { pin: 'p_yodobashi_switch', buyer: 'u_rin', agoMin: 1, outcome: 'held' },
  { pin: 'p_akibaoo_figure', buyer: 'u_sho', agoMin: 10, outcome: 'held' },
  { pin: 'p_akizuki_parts', buyer: 'u_mei', agoMin: 8, outcome: 'held' },
  { pin: 'p_udx_goods', buyer: 'u_kana', agoMin: 2, outcome: 'held' },
  { pin: 'p_animate_bonus', buyer: 'u_rin', agoMin: 7, outcome: 'hit' },
  { pin: 'p_animate_bonus', buyer: 'u_sho', agoMin: 6, outcome: 'hit' },
  { pin: 'p_animate_bonus', buyer: 'u_mei', agoMin: 5, outcome: 'held' },
  { pin: 'p_suehiro_cards', buyer: 'u_yuki', agoMin: 1, outcome: 'held' },
  { pin: 'p_gamers_bonus', buyer: 'u_tomo', agoMin: 1, outcome: 'held' },
  { pin: 'p_takeya_kitchen', buyer: 'u_saki', agoMin: 9, outcome: 'held' },
  { pin: 'p_takeya_kitchen', buyer: 'u_hiro', agoMin: 8, outcome: 'hit' },
  { pin: 'p_yoshiike_fish', buyer: 'u_nao', agoMin: 1, outcome: 'held' },
  { pin: 'p_matsuzakaya_food', buyer: 'u_gen', agoMin: 12, outcome: 'held' },
  { pin: 'p_ameyoko_center', buyer: 'u_saki', agoMin: 20, outcome: 'hit' },
  { pin: 'p_ueno_station_pop', buyer: 'u_tomo', agoMin: 3, outcome: 'held' },
  { pin: 'p_jimbocho_book', buyer: 'u_mei', agoMin: 6, outcome: 'held' },
  { pin: 'p_jimbocho_used', buyer: 'u_gen', agoMin: 2, outcome: 'held' },
  { pin: 'p_kanda_west', buyer: 'u_hiro', agoMin: 7, outcome: 'miss' },
  { pin: 'p_ogawamachi_shoes', buyer: 'u_yuki', agoMin: 12, outcome: 'held' },
  { pin: 'p_ogawamachi_shoes', buyer: 'u_kana', agoMin: 10, outcome: 'held' },
  { pin: 'p_asakusabashi_shimojima', buyer: 'u_nao', agoMin: 14, outcome: 'hit' },
  { pin: 'p_kuramae_bunbougu', buyer: 'u_hiro', agoMin: 1, outcome: 'held' },
  { pin: 'p_asakusa_nakamise', buyer: 'u_saki', agoMin: 1, outcome: 'held' },
  { pin: 'p_asakusa_marugoto', buyer: 'u_gen', agoMin: 19, outcome: 'held' },
  { pin: 'p_mitsukoshi_gift', buyer: 'u_yuki', agoMin: 2, outcome: 'held' },
  { pin: 'p_ningyocho_amazake', buyer: 'u_tomo', agoMin: 9, outcome: 'held' },
  { pin: 'p_daimaru_dessert', buyer: 'u_kana', agoMin: 1, outcome: 'held' },
  { pin: 'p_gransta_bento', buyer: 'u_mei', agoMin: 4, outcome: 'held' },
  { pin: 'p_gransta_bento', buyer: 'u_nao', agoMin: 3, outcome: 'held' },
  { pin: 'p_ginza_uniqlo', buyer: 'u_sho', agoMin: 15, outcome: 'miss' },
  { pin: 'p_yurakucho_bic', buyer: 'u_rin', agoMin: 5, outcome: 'held' },
  { pin: 'p_voided_example', buyer: 'u_saki', agoMin: 18, outcome: 'held' },
  { pin: 'p_labi_sale', buyer: 'u_gen', agoMin: 13, outcome: 'held' },
  { pin: 'p_labi_sale', buyer: 'u_tomo', agoMin: 12, outcome: 'held' },
];

const SEED_USERS: (Omit<User, 'restrictedUntil'> & { balance: number })[] = [
  { id: ME, handle: 'あなた', emoji: '🧭', hitCount: 6, missCount: 1, balance: 12000 },
  { id: 'u_kana', handle: 'kana', emoji: '🌿', hitCount: 12, missCount: 1, balance: 8000 },
  { id: 'u_rin', handle: 'rin', emoji: '🎧', hitCount: 8, missCount: 1, balance: 8000 },
  { id: 'u_mei', handle: 'mei', emoji: '🍙', hitCount: 21, missCount: 3, balance: 8000 },
  { id: 'u_sho', handle: 'sho', emoji: '📦', hitCount: 0, missCount: 0, balance: 8000 },
  { id: 'u_taku', handle: 'taku', emoji: '🛒', hitCount: 5, missCount: 4, balance: 8000 },
  { id: 'u_yuki', handle: 'yuki', emoji: '❄️', hitCount: 34, missCount: 2, balance: 15000 },
  { id: 'u_gen', handle: 'gen', emoji: '🔧', hitCount: 3, missCount: 0, balance: 8000 },
  { id: 'u_nao', handle: 'nao', emoji: '🚲', hitCount: 17, missCount: 6, balance: 8000 },
  { id: 'u_hiro', handle: 'hiro', emoji: '🎒', hitCount: 9, missCount: 0, balance: 8000 },
  // 残高がほとんど残らない状態。買えないときの表示を確認できる
  { id: 'u_saki', handle: 'saki', emoji: '🌸', hitCount: 2, missCount: 3, balance: 1200 },
  { id: 'u_tomo', handle: 'tomo', emoji: '☕', hitCount: 44, missCount: 5, balance: 20000 },
];

interface SeedBounty {
  id: string;
  requester: string;
  target: string;
  lat: number;
  lng: number;
  radiusM: number;
  areaLabel: string;
  reward: number;
  acceptCount: number;
  agoMin: number;
  ttlMin: number;
  /** 期限切れ・取り下げ済みとして作る場合 */
  close?: 'expired' | 'cancelled';
}

/**
 * 報酬・採用枠・残り時間・向かっている人数をばらけさせてある。
 * 「誰も向かっていない」「3人以上で警告色」「報告が届いて採用待ち」「採用済み」
 * 「期限切れで返還」「取り下げ」を1画面から追えるようにするのが狙い。
 */
const SEED_BOUNTIES: SeedBounty[] = [
  {
    id: 'b_switch_stock', requester: 'u_rin',
    target: 'この辺の家電量販店に Switch2 の在庫があるか',
    lat: 35.6987, lng: 139.7738, radiusM: 600, areaLabel: 'ヨドバシ〜ビック周辺',
    reward: 200, acceptCount: 1, agoMin: 8, ttlMin: 45,
  },
  {
    id: 'b_acrylic_restock', requester: ME,
    target: 'ラジオ会館で限定アクスタの再入荷があったか',
    lat: 35.6982, lng: 139.7716, radiusM: 300, areaLabel: 'ラジオ会館まわり',
    reward: 300, acceptCount: 1, agoMin: 6, ttlMin: 60,
  },
  {
    id: 'b_cable_left', requester: 'u_mei',
    target: 'あきばおーの店頭に例のケーブルが残っているか',
    lat: 35.7005, lng: 139.7712, radiusM: 400, areaLabel: 'あきばおー周辺',
    reward: 100, acceptCount: 2, agoMin: 3, ttlMin: 30,
  },
  {
    id: 'b_akiba_gpu', requester: 'u_yuki',
    target: 'ビックのPCパーツ売場、あのGPUの値札がいくらになっているか',
    lat: 35.6981, lng: 139.7726, radiusM: 300, areaLabel: 'ビックカメラAKIBA',
    reward: 500, acceptCount: 1, agoMin: 12, ttlMin: 20,
  },
  {
    id: 'b_akiba_gacha', requester: 'u_saki',
    target: 'ラジオ会館のガチャ、あの台にまだ在庫が入っているか',
    lat: 35.6983, lng: 139.7718, radiusM: 250, areaLabel: 'ラジオ会館 6F',
    reward: 200, acceptCount: 1, agoMin: 7, ttlMin: 40,
  },
  {
    id: 'b_akiba_ticket', requester: 'u_tomo',
    target: 'ヨドバシの整理券配布、いまから並んで間に合うか',
    lat: 35.6987, lng: 139.7745, radiusM: 300, areaLabel: 'ヨドバシAkiba',
    reward: 300, acceptCount: 1, agoMin: 13, ttlMin: 15,
  },
  {
    id: 'b_akiba_junk', requester: 'u_gen',
    target: 'ジャンク通りのあの店、今日は営業しているか',
    lat: 35.6995, lng: 139.7707, radiusM: 350, areaLabel: '秋葉原 ジャンク通り',
    reward: 100, acceptCount: 2, agoMin: 25, ttlMin: 90,
  },
  {
    id: 'b_akiba_cafe', requester: 'u_nao',
    target: '中央通りのカフェ、当日の入店枠が残っているか',
    lat: 35.6999, lng: 139.7723, radiusM: 300, areaLabel: '秋葉原 中央通り',
    reward: 200, acceptCount: 1, agoMin: 9, ttlMin: 25,
  },
  {
    id: 'b_akiba_doujin', requester: 'u_kana',
    target: 'とらのあな、あの新刊が棚に出ているか',
    lat: 35.7002, lng: 139.7708, radiusM: 250, areaLabel: 'とらのあな秋葉原',
    reward: 100, acceptCount: 3, agoMin: 4, ttlMin: 35,
  },
  {
    id: 'b_akiba_expired', requester: 'u_sho',
    target: '朝イチの入荷、開店時点で並びがあったか',
    lat: 35.7003, lng: 139.7715, radiusM: 300, areaLabel: 'ソフマップ前',
    reward: 100, acceptCount: 1, agoMin: 200, ttlMin: 30, close: 'expired',
  },
  {
    id: 'b_suehiro_cards', requester: 'u_hiro',
    target: '末広町のカードショップ、再販パックの整理券があるか',
    lat: 35.702, lng: 139.7714, radiusM: 300, areaLabel: '末広町',
    reward: 500, acceptCount: 1, agoMin: 2, ttlMin: 25,
  },
  {
    id: 'b_yushima_sweets', requester: 'u_kana',
    target: '湯島の輸入食品店、あの菓子が補充されているか',
    lat: 35.7076, lng: 139.7683, radiusM: 350, areaLabel: '湯島 天神下',
    reward: 100, acceptCount: 2, agoMin: 18, ttlMin: 50,
  },
  {
    id: 'b_ameyoko_size', requester: 'u_hiro',
    target: 'アメ横の靴屋に 27.5 が残っているか、値札はいくらか',
    lat: 35.7095, lng: 139.7745, radiusM: 500, areaLabel: 'アメ横',
    reward: 300, acceptCount: 1, agoMin: 14, ttlMin: 50,
  },
  {
    id: 'b_ueno_goods', requester: 'u_mei',
    target: '上野の限定グッズ、まだ在庫があるか',
    lat: 35.7141, lng: 139.7774, radiusM: 400, areaLabel: '上野駅 構内',
    reward: 200, acceptCount: 2, agoMin: 6, ttlMin: 35,
  },
  {
    id: 'b_takeya_price', requester: 'u_sho',
    target: '多慶屋のあの棚、値下げ後の値段がいくらか',
    lat: 35.7069, lng: 139.7752, radiusM: 250, areaLabel: '多慶屋 A館',
    reward: 100, acceptCount: 1, agoMin: 21, ttlMin: 60,
  },
  {
    id: 'b_matsuzakaya_event', requester: 'u_tomo',
    target: '上野松坂屋の催事、目当ての店の列が何人か',
    lat: 35.7071, lng: 139.7728, radiusM: 300, areaLabel: '上野松坂屋',
    reward: 300, acceptCount: 1, agoMin: 11, ttlMin: 20,
  },
  {
    id: 'b_ameyoko_fish', requester: 'u_nao',
    target: 'アメ横の鮮魚店、値引きが始まっているか',
    lat: 35.7098, lng: 139.774, radiusM: 300, areaLabel: 'アメ横センター',
    reward: 100, acceptCount: 3, agoMin: 3, ttlMin: 30,
  },
  {
    id: 'b_kanda_lunch', requester: 'u_gen',
    target: '神田西口で、まだ売っている弁当屋があるか',
    lat: 35.6919, lng: 139.7708, radiusM: 350, areaLabel: '神田駅 西口',
    reward: 100, acceptCount: 2, agoMin: 4, ttlMin: 25,
  },
  {
    id: 'b_jimbocho_book', requester: 'u_yuki',
    target: '神保町でこの本の在庫がある店があるか',
    lat: 35.6958, lng: 139.758, radiusM: 600, areaLabel: '神保町 すずらん通り',
    reward: 500, acceptCount: 1, agoMin: 120, ttlMin: 60, close: 'expired',
  },
  {
    id: 'b_jimbocho_zine', requester: 'u_saki',
    target: '神保町の古書店、均一台が入れ替わっているか',
    lat: 35.6957, lng: 139.7576, radiusM: 400, areaLabel: '神保町 靖国通り',
    reward: 200, acceptCount: 1, agoMin: 16, ttlMin: 45,
  },
  {
    id: 'b_ogawamachi_shoes', requester: 'u_hiro',
    target: '小川町のスポーツ店、旧モデルに 26.5 があるか',
    lat: 35.6959, lng: 139.7654, radiusM: 350, areaLabel: '小川町',
    reward: 300, acceptCount: 2, agoMin: 8, ttlMin: 40,
  },
  {
    id: 'b_asakusa_line', requester: 'u_nao',
    target: '浅草の名物店、閉店前で在庫が残っているか',
    lat: 35.7126, lng: 139.7958, radiusM: 400, areaLabel: '浅草 仲見世',
    reward: 200, acceptCount: 1, agoMin: 30, ttlMin: 25, close: 'cancelled',
  },
  {
    id: 'b_kuramae_ink', requester: ME,
    target: '蔵前の文具店、限定インクがまだ棚にあるか',
    lat: 35.7057, lng: 139.7912, radiusM: 300, areaLabel: '蔵前',
    reward: 300, acceptCount: 1, agoMin: 5, ttlMin: 35,
  },
  {
    id: 'b_asakusabashi_beads', requester: 'u_kana',
    target: '浅草橋の資材店、あの色がまだあるか',
    lat: 35.6996, lng: 139.7857, radiusM: 350, areaLabel: '浅草橋',
    reward: 100, acceptCount: 2, agoMin: 27, ttlMin: 55,
  },
  {
    id: 'b_asakusa_matsuri', requester: 'u_tomo',
    target: '浅草の催事、いまから入れる場所が残っているか',
    lat: 35.7118, lng: 139.7967, radiusM: 500, areaLabel: '浅草 雷門周辺',
    reward: 800, acceptCount: 1, agoMin: 6, ttlMin: 40,
  },
  {
    id: 'b_tokyo_bento', requester: ME,
    target: '東京駅グランスタで、あの限定弁当がまだ買えるか',
    lat: 35.681, lng: 139.7668, radiusM: 300, areaLabel: '東京駅 構内',
    reward: 200, acceptCount: 1, agoMin: 2, ttlMin: 30,
  },
  {
    id: 'b_nihonbashi_gift', requester: 'u_rin',
    target: '日本橋三越の実演、次の焼き上がりが何分後か',
    lat: 35.6862, lng: 139.774, radiusM: 300, areaLabel: '日本橋三越',
    reward: 300, acceptCount: 1, agoMin: 10, ttlMin: 30,
  },
  {
    id: 'b_ningyocho_taiyaki', requester: 'u_gen',
    target: '人形町の甘酒横丁、残りいくつか',
    lat: 35.6863, lng: 139.7826, radiusM: 300, areaLabel: '人形町',
    reward: 100, acceptCount: 2, agoMin: 12, ttlMin: 20,
  },
  {
    id: 'b_ginza_queue', requester: 'u_tomo',
    target: '銀座の期間限定店、いま何人待ちか',
    lat: 35.6718, lng: 139.7657, radiusM: 400, areaLabel: '銀座 中央通り',
    reward: 200, acceptCount: 2, agoMin: 5, ttlMin: 40,
  },
  {
    id: 'b_ginza_popup', requester: 'u_yuki',
    target: '銀座のポップアップ、整理券の配布がまだ続いているか',
    lat: 35.6717, lng: 139.765, radiusM: 350, areaLabel: '銀座 数寄屋橋',
    reward: 500, acceptCount: 2, agoMin: 15, ttlMin: 60,
  },
  {
    id: 'b_tokyo_souvenir', requester: 'u_mei',
    target: '東京駅の土産店、あの詰め合わせの在庫',
    lat: 35.6812, lng: 139.7671, radiusM: 250, areaLabel: '東京駅 大丸',
    reward: 200, acceptCount: 1, agoMin: 19, ttlMin: 25,
  },
  {
    id: 'b_yurakucho_lottery', requester: 'u_kana',
    target: '有楽町の抽選、応募券の配布はまだやっているか',
    lat: 35.6748, lng: 139.7639, radiusM: 300, areaLabel: '有楽町',
    reward: 300, acceptCount: 1, agoMin: 22, ttlMin: 50,
  },
  {
    id: 'b_coredo_popup', requester: 'u_hiro',
    target: 'コレド室町のポップアップ、レジ待ちが何分か',
    lat: 35.6866, lng: 139.7734, radiusM: 250, areaLabel: 'コレド室町',
    reward: 100, acceptCount: 2, agoMin: 31, ttlMin: 70,
  },
];

interface SeedApplication {
  bounty: string;
  applicant: string;
  agoMin: number;
  status: BountyApplication['status'];
  report?: { text: string; label: string; hue: number; reportedAgoMin: number };
}

const SEED_APPLICATIONS: SeedApplication[] = [
  // 向かっている人数を見せる。3人以上で警告色になる
  { bounty: 'b_switch_stock', applicant: 'u_kana', agoMin: 6, status: 'heading' },
  { bounty: 'b_switch_stock', applicant: 'u_taku', agoMin: 5, status: 'heading' },
  { bounty: 'b_switch_stock', applicant: 'u_sho', agoMin: 4, status: 'heading' },

  // 自分の依頼に報告が届いていて、採用を押せる状態
  {
    bounty: 'b_acrylic_restock', applicant: 'u_kana', agoMin: 5, status: 'reported',
    report: {
      text: '3Fの該当ブース、再入荷して棚に並んでいました。残り4点です。',
      label: 'ラジオ会館 3F', hue: 300, reportedAgoMin: 2,
    },
  },

  // 自分が応募して向かっている最中
  { bounty: 'b_cable_left', applicant: ME, agoMin: 2, status: 'heading' },
  { bounty: 'b_cable_left', applicant: 'u_gen', agoMin: 1, status: 'heading' },

  // 自分が報告して、依頼者の確認待ち
  {
    bounty: 'b_akiba_gacha', applicant: ME, agoMin: 6, status: 'reported',
    report: {
      text: '6Fの台、補充されていました。左から3台目にまだ入っています。',
      label: 'ラジオ会館 6F', hue: 265, reportedAgoMin: 3,
    },
  },

  // 自分が採用された。ここから売品ピンとして出し直せる
  {
    bounty: 'b_nihonbashi_gift', applicant: ME, agoMin: 9, status: 'accepted',
    report: {
      text: '実演コーナー、次の窯は8分後で20個焼けるとのことでした。いまの待ちは3人です。',
      label: '日本橋三越 B1', hue: 335, reportedAgoMin: 6,
    },
  },

  // 他人の採用済み。成立して枠が埋まった依頼になる
  {
    bounty: 'b_matsuzakaya_event', applicant: 'u_hiro', agoMin: 9, status: 'accepted',
    report: {
      text: '催事場の目当ての店、いまは4人待ちでした。整理券は終了しています。',
      label: '上野松坂屋 催事場', hue: 340, reportedAgoMin: 7,
    },
  },
  {
    bounty: 'b_akiba_ticket', applicant: 'u_nao', agoMin: 11, status: 'accepted',
    report: {
      text: '整理券は残り20枚ほど。いまから並べば十分間に合います。',
      label: 'ヨドバシAkiba 1F', hue: 210, reportedAgoMin: 9,
    },
  },

  // 報告が届いているが、まだ採用も不採用も決まっていない
  {
    bounty: 'b_ameyoko_size', applicant: 'u_nao', agoMin: 12, status: 'reported',
    report: {
      text: '27.5 は在庫ありました。値札は表示から2割引になっています。',
      label: 'アメ横 靴屋', hue: 15, reportedAgoMin: 9,
    },
  },
  { bounty: 'b_ameyoko_size', applicant: 'u_saki', agoMin: 11, status: 'rejected' },
  {
    bounty: 'b_ginza_popup', applicant: 'u_tomo', agoMin: 13, status: 'reported',
    report: {
      text: '配布は継続中でした。1人1枚で、いまの待ちは6人です。',
      label: '銀座 数寄屋橋', hue: 285, reportedAgoMin: 4,
    },
  },

  // 混み具合のばらつき
  { bounty: 'b_ginza_queue', applicant: 'u_yuki', agoMin: 4, status: 'heading' },
  { bounty: 'b_kanda_lunch', applicant: 'u_tomo', agoMin: 3, status: 'heading' },
  { bounty: 'b_kanda_lunch', applicant: 'u_mei', agoMin: 2, status: 'heading' },
  { bounty: 'b_akiba_doujin', applicant: 'u_rin', agoMin: 3, status: 'heading' },
  { bounty: 'b_akiba_doujin', applicant: 'u_sho', agoMin: 3, status: 'heading' },
  { bounty: 'b_akiba_doujin', applicant: 'u_gen', agoMin: 2, status: 'heading' },
  { bounty: 'b_akiba_doujin', applicant: 'u_nao', agoMin: 1, status: 'heading' },
  { bounty: 'b_asakusa_matsuri', applicant: 'u_kana', agoMin: 5, status: 'heading' },
  { bounty: 'b_asakusa_matsuri', applicant: 'u_hiro', agoMin: 4, status: 'heading' },
  { bounty: 'b_asakusa_matsuri', applicant: 'u_yuki', agoMin: 4, status: 'heading' },
  { bounty: 'b_asakusa_matsuri', applicant: 'u_mei', agoMin: 3, status: 'heading' },
  { bounty: 'b_asakusa_matsuri', applicant: 'u_sho', agoMin: 2, status: 'heading' },
  { bounty: 'b_suehiro_cards', applicant: 'u_taku', agoMin: 1, status: 'heading' },
  { bounty: 'b_akiba_gpu', applicant: 'u_tomo', agoMin: 10, status: 'heading' },
  { bounty: 'b_akiba_gpu', applicant: 'u_rin', agoMin: 9, status: 'heading' },
  { bounty: 'b_ueno_goods', applicant: 'u_saki', agoMin: 5, status: 'heading' },
  { bounty: 'b_ameyoko_fish', applicant: 'u_gen', agoMin: 2, status: 'heading' },
  { bounty: 'b_ogawamachi_shoes', applicant: 'u_kana', agoMin: 6, status: 'heading' },
  { bounty: 'b_yushima_sweets', applicant: 'u_taku', agoMin: 14, status: 'heading' },
  { bounty: 'b_ningyocho_taiyaki', applicant: 'u_yuki', agoMin: 10, status: 'heading' },
  { bounty: 'b_akiba_cafe', applicant: 'u_hiro', agoMin: 7, status: 'heading' },

  // 期限切れになった依頼の応募は流れている
  { bounty: 'b_jimbocho_book', applicant: 'u_gen', agoMin: 118, status: 'lapsed' },
  { bounty: 'b_akiba_expired', applicant: 'u_mei', agoMin: 195, status: 'lapsed' },
];

export function buildSeed(now: number): DB {
  const wallet: WalletEntry[] = [];

  const users: User[] = SEED_USERS.map(({ balance, ...user }) => {
    void balance;
    return {
      ...user,
      // taku は外れ率 44% で判定実績も十分なので、制限がかかっている状態を最初から見せる
      restrictedUntil: user.id === 'u_taku' ? now + 6 * 60 * MIN : null,
    };
  });

  for (const user of SEED_USERS) {
    topUp(wallet, user.id, user.balance, now - 7 * 24 * 60 * MIN);
  }

  const db: DB = {
    version: DB_VERSION,
    users,
    pins: SEED_PINS.map((seed) => pinFromSeed(seed, now, 0)),
    purchases: [],
    bounties: [],
    applications: [],
    asks: [],
    wallet,
    payouts: [],
    reports: [],
    currentUserId: ME,
    loopCount: 0,
  };

  const pinById = new Map(db.pins.map((p) => [p.id, p]));
  for (const buy of SEED_BUYS) {
    const pin = pinById.get(buy.pin);
    if (pin) applyBuy(db, pin, buy, now);
  }

  for (const seed of SEED_BOUNTIES) {
    const bounty = bountyFromSeed(db, seed, now, 0);
    if (bounty) db.bounties.push(bounty);
  }
  const bountyById = new Map(db.bounties.map((b) => [b.id, b]));
  for (const seed of SEED_APPLICATIONS) {
    const bounty = bountyById.get(seed.bounty);
    if (bounty) applyApplication(db, bounty, seed, now);
  }
  for (const seed of SEED_BOUNTIES) {
    const bounty = bountyById.get(seed.id);
    if (bounty) closeSeedBounty(db, bounty, seed.close);
  }

  db.asks.push(...seedAsks(now));
  return db;
}

// ---------------------------------------------------------------- 生成の部品

function instanceId(seedId: string, instance: number): string {
  return instance === 0 ? seedId : `${seedId}#${instance}`;
}

/** 出し直したサンプルも元のテンプレートをたどれるようにする */
export function sampleKeyOf(id: string): string {
  const hash = id.indexOf('#');
  return hash === -1 ? id : id.slice(0, hash);
}

function pinFromSeed(seed: SeedPin, now: number, instance: number): Pin {
  const createdAt = now - seed.agoMin * MIN;
  return {
    id: instanceId(seed.id, instance),
    sellerId: seed.seller,
    category: 'shelf_stock',
    lat: seed.lat,
    lng: seed.lng,
    placeLabel: seed.place,
    headline: seed.headline,
    stockState: seed.stock,
    payloadText: seed.payload,
    quantityNote: seed.qty,
    photoUri: shelfPhoto(seed.place, seed.hue),
    price: seed.price,
    slotTotal: seed.slots,
    slotTaken: 0,
    createdAt,
    expiresAt: createdAt + seed.ttlMin * MIN,
    status: seed.voided ? 'voided' : 'active',
  };
}

function applyBuy(db: DB, pin: Pin, buy: SeedBuy, now: number): void {
  if (pin.slotTaken >= pin.slotTotal) return;
  // 何周もするので、買い手の残高が尽きたら黙って見送る
  if (balanceOf(db.wallet, buy.buyer).available < pin.price) return;

  const at = now - buy.agoMin * MIN;
  const fee = feeFor(pin.price);
  const settledAt = at + 4 * MIN;
  const purchase: Purchase = {
    id: newId('pu'),
    pinId: pin.id,
    buyerId: buy.buyer,
    price: pin.price,
    fee,
    createdAt: at,
    escrow: buy.outcome === 'held' ? 'held' : buy.outcome === 'miss' ? 'refunded' : 'released',
    verdict: buy.outcome === 'hit' ? 'hit' : buy.outcome === 'miss' ? 'miss' : null,
    verdictAt: buy.outcome === 'hit' || buy.outcome === 'miss' ? settledAt : null,
  };
  pin.slotTaken += 1;
  db.purchases.push(purchase);

  holdForPurchase(db.wallet, buy.buyer, pin.price, purchase.id, pin.headline, at);
  if (buy.outcome === 'hit' || buy.outcome === 'auto') {
    settlePurchase(
      db.wallet, buy.buyer, pin.sellerId, pin.price, fee, purchase.id, pin.headline, settledAt
    );
  } else if (buy.outcome === 'miss') {
    refundPurchase(db.wallet, buy.buyer, pin.price, purchase.id, pin.headline, settledAt);
  }
}

function bountyFromSeed(db: DB, seed: SeedBounty, now: number, instance: number): Bounty | null {
  const total = seed.reward * seed.acceptCount;
  if (balanceOf(db.wallet, seed.requester).available < total) return null;

  const at = now - seed.agoMin * MIN;
  const bounty: Bounty = {
    id: instanceId(seed.id, instance),
    requesterId: seed.requester,
    category: 'shelf_stock',
    lat: seed.lat,
    lng: seed.lng,
    radiusM: seed.radiusM,
    areaLabel: seed.areaLabel,
    targetText: seed.target,
    reward: seed.reward,
    acceptCount: seed.acceptCount,
    acceptedCount: 0,
    createdAt: at,
    expiresAt: at + seed.ttlMin * MIN,
    status: 'open',
  };
  holdForBounty(db.wallet, seed.requester, total, bounty.id, seed.target, at);
  return bounty;
}

function applyApplication(db: DB, bounty: Bounty, seed: SeedApplication, now: number): void {
  const at = now - seed.agoMin * MIN;
  db.applications.push({
    id: newId('ap'),
    bountyId: bounty.id,
    applicantId: seed.applicant,
    status: seed.status,
    createdAt: at,
    reportedAt: seed.report ? now - seed.report.reportedAgoMin * MIN : null,
    reportText: seed.report?.text ?? null,
    photoUri: seed.report ? shelfPhoto(seed.report.label, seed.report.hue) : null,
    decidedAt:
      seed.status === 'accepted' || seed.status === 'rejected'
        ? now - MIN
        : seed.status === 'lapsed'
          ? bounty.expiresAt
          : null,
  });

  if (seed.status === 'accepted' && bounty.acceptedCount < bounty.acceptCount) {
    bounty.acceptedCount += 1;
    payBounty(
      db.wallet,
      bounty.requesterId,
      seed.applicant,
      bounty.reward,
      feeFor(bounty.reward),
      bounty.id,
      bounty.targetText,
      now - MIN
    );
  }
}

/** 実装と同じ順序で締める。採用で枠が埋まれば成立、期限切れと取り下げは残った枠のぶんだけ返す */
function closeSeedBounty(db: DB, bounty: Bounty, close: SeedBounty['close']): void {
  if (bounty.acceptedCount >= bounty.acceptCount) {
    bounty.status = 'filled';
    return;
  }
  if (!close) return;
  const unused = bounty.acceptCount - bounty.acceptedCount;
  returnBounty(
    db.wallet,
    bounty.requesterId,
    unused * bounty.reward,
    bounty.id,
    bounty.targetText,
    bounty.expiresAt
  );
  bounty.status = close;
}

/** 「この値段なら動く」という票。自分が持ち主の側と、自分が要求する側の両方を作る */
function seedAsks(now: number): PriceAsk[] {
  return (
    [
      // 自分の出品に値下げ待ちが集まっている
      ['pin', 'p_yodobashi_acc', 'u_kana', 100, 4],
      ['pin', 'p_yodobashi_acc', 'u_gen', 150, 3],
      ['pin', 'p_yodobashi_acc', 'u_saki', 100, 2],
      // 自分の依頼に値上げ待ちが集まっている
      ['bounty', 'b_tokyo_bento', 'u_mei', 400, 2],
      ['bounty', 'b_tokyo_bento', 'u_hiro', 300, 1],
      // 他人のものへの票。買い手側の表示を確認できる
      ['pin', 'p_bic_gpu', 'u_nao', 350, 2],
      ['pin', 'p_bic_gpu', 'u_yuki', 250, 1],
      ['pin', 'p_suehiro_cards', 'u_tomo', 350, 1],
      ['bounty', 'b_akiba_junk', 'u_rin', 200, 6],
      ['bounty', 'b_ameyoko_fish', 'u_taku', 150, 2],
      ['bounty', 'b_coredo_popup', 'u_sho', 300, 5],
    ] as const
  ).map(([targetKind, targetId, userId, desired, agoMin]) => ({
    id: newId('ask'),
    targetKind,
    targetId,
    userId,
    desired,
    createdAt: now - agoMin * MIN,
  }));
}

// ---------------------------------------------------------------- テスト用のループ

const SEED_PIN_IDS = new Set(SEED_PINS.map((s) => s.id));
const SEED_BOUNTY_IDS = new Set(SEED_BOUNTIES.map((s) => s.id));
/** 締め切られた状態の見本。出し直さず、そのまま残す */
const STATIC_BOUNTY_IDS = new Set(SEED_BOUNTIES.filter((s) => s.close).map((s) => s.id));
/** 取り下げ済みや最初から期限切れの見本も、出し直す意味がない */
const STATIC_PIN_IDS = new Set(
  SEED_PINS.filter((s) => s.voided || s.agoMin >= s.ttlMin).map((s) => s.id)
);

/**
 * 期限が切れて画面から消えた種類だけ、同じ内容で出し直す。
 *
 * サンプルはすべて期限つきなので、放っておくと全部腐って何も残らない。
 * プロダクトとしては正しいが、テストのたびに入れ直すのは手間なので、
 * 消えたぶんを補充して回し続ける。買われた履歴を壊さないよう、
 * 古い方は書き換えず、新しい id で作る。
 */
export function recycleSamples(db: DB, now: number): boolean {
  const livePinKeys = new Set<string>();
  for (const pin of db.pins) if (isOnMap(pin, now)) livePinKeys.add(sampleKeyOf(pin.id));

  const liveBountyKeys = new Set<string>();
  for (const bounty of db.bounties) {
    if (isBountyOpen(bounty, now)) liveBountyKeys.add(sampleKeyOf(bounty.id));
  }

  const missingPins = SEED_PINS.filter(
    (s) => !STATIC_PIN_IDS.has(s.id) && !livePinKeys.has(s.id)
  );
  const missingBounties = SEED_BOUNTIES.filter(
    (s) => !STATIC_BOUNTY_IDS.has(s.id) && !liveBountyKeys.has(s.id)
  );
  if (!missingPins.length && !missingBounties.length) return false;

  db.loopCount += 1;
  const instance = db.loopCount;

  for (const seed of missingPins) {
    const pin = pinFromSeed(seed, now, instance);
    db.pins.push(pin);
    for (const buy of SEED_BUYS) {
      if (buy.pin === seed.id) applyBuy(db, pin, buy, now);
    }
  }

  for (const seed of missingBounties) {
    const bounty = bountyFromSeed(db, seed, now, instance);
    if (!bounty) continue;
    db.bounties.push(bounty);
    for (const app of SEED_APPLICATIONS) {
      // 採用は金と結果が絡むので、出し直しでは「向かっている」だけ作る
      if (app.bounty !== seed.id || app.status !== 'heading') continue;
      applyApplication(db, bounty, app, now);
    }
  }

  pruneDeadSamples(db, now);
  return true;
}

/** 出し直したぶんが際限なく積み上がらないよう、誰も触っていない死んだサンプルは捨てる */
function pruneDeadSamples(db: DB, now: number): void {
  const purchased = new Set(db.purchases.map((p) => p.pinId));
  db.pins = db.pins.filter((pin) => {
    const key = sampleKeyOf(pin.id);
    if (!SEED_PIN_IDS.has(key)) return true;
    if (STATIC_PIN_IDS.has(key)) return true;
    return isOnMap(pin, now) || purchased.has(pin.id);
  });

  const applied = new Set(db.applications.map((a) => a.bountyId));
  db.bounties = db.bounties.filter((bounty) => {
    const key = sampleKeyOf(bounty.id);
    if (!SEED_BOUNTY_IDS.has(key)) return true;
    if (STATIC_BOUNTY_IDS.has(key)) return true;
    return isBountyOpen(bounty, now) || applied.has(bounty.id);
  });
}

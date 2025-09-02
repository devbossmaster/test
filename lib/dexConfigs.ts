import type { Address } from 'viem';

export type V2Dex = {
  key: string;
  label: string;
  factory: Address;
  feeBps: number; // 30 = 0.30%
};

// Polygon V2-style factories (normalize keys; tune feeBps if non-30bps)
export const POLYGON_V2_DEXS: V2Dex[] = [
  { key:'quickswap_v2', label:'QuickSwap V2', factory:'0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32', feeBps:30 },
  { key:'sushiswap_v2', label:'Sushi V2',      factory:'0xc35dadb65012ec5796536bd9864ed8773abc74c4', feeBps:30 },
  { key:'apeswap_v2',   label:'ApeSwap V2',    factory:'0xcf083be4164828f00cae704ec15a36d711491284', feeBps:30 },
  { key:'dfyn_v2',      label:'DFyn V2',       factory:'0xe7fb3e833efe5f9c441105eb65ef8b261266423b', feeBps:30 },
  { key:'cometh_v2',    label:'Cometh V2',     factory:'0x800b052609c355ca8103e06f022aa30647ead60a', feeBps:30 },
  { key:'meshswap_v2',  label:'Meshswap V2',   factory:'0x9F3044f7F9FC8bC9eD615d54845b4577B833282d', feeBps:30 },
  { key:'polydex_v2',   label:'Polydex V2',    factory:'0xeaa98f7b5f7bfbcd1af14d0efaa9d9e68d82f640', feeBps:30 },
  { key:'polycat_v2',   label:'Polycat V2',    factory:'0x477ce834ae6b7ab003cce4bc4d8697763ff456fa', feeBps:30 },
  { key:'retro_v2',     label:'Retro V2',      factory:'0x0bb494c4574ff7f70f7d97bc0b89a282ba94bc83', feeBps:30 },
  { key:'dystopia_v2',  label:'Dystopia V2',   factory:'0x05faf42811eebc5b0f1b90def4a46f6a5e426d2a', feeBps:30 },
  { key:'honeyswap_v2', label:'HoneySwap V2',  factory:'0x03DAa61d8007443a6584e3d8f85105096543C19c', feeBps:30 },
  { key:'auraswap_v2',  label:'AuraSwap V2',   factory:'0x015DE3ec460869eb5ceAe4224Dc7112ac0a39303', feeBps:30 },
  { key:'lif3_v2',      label:'LIF3 V2',       factory:'0x3FB1E7D5d9C974141a5B6E5fa4edab0a7Aa15C6A', feeBps:30 },
  { key:'fraxswap_v2',  label:'FraxSwap V2',   factory:'0x54F454D747e037Da288dB568D4121117EAb34e79', feeBps:30 },
] as const;

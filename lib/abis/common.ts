// lib/abis/common.ts
export const V2_FACTORY_EVENT_ABI = [
  {
    type: 'event',
    name: 'PairCreated',
    inputs: [
      { indexed: true,  type: 'address', name: 'token0' },
      { indexed: true,  type: 'address', name: 'token1' },
      { indexed: false, type: 'address', name: 'pair'   },
      { indexed: false, type: 'uint256', name: 'index'  },
    ]
  }
] as const;

export const ERC20_ABI_MIN = [
  { type:'function', stateMutability:'view', name:'decimals', inputs:[], outputs:[{type:'uint8'}] },
  { type:'function', stateMutability:'view', name:'symbol',   inputs:[], outputs:[{type:'string'}] },
] as const;

import type { P5Token } from './p5-token-grid-types';
export function parsePageTsv(value: unknown): P5Token[];
export function parsePageBlocks(value: unknown): P5Token[];
export function extractPageTokens(data: unknown): { tokens: P5Token[]; tsvTokens: P5Token[]; blockTokens: P5Token[]; tokenSource: 'tsv' | 'blocks' | 'none'; representation: string };

/**
 * Server icon. Hosted deployments point clients at /icon.png and /icon.svg on their own
 * origin (public/); stdio has no origin, so it embeds this 64x64 PNG (same artwork, from
 * public/favicon.ico) as a data URI. Original artwork, not Garmin's logo.
 */
import type { Icon } from '@modelcontextprotocol/server';

const PNG_64_BASE64 =
  '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';

export function serverIcons(publicOrigin?: string): Icon[] {
  if (publicOrigin) {
    return [
      { src: `${publicOrigin}/icon.png`, mimeType: 'image/png', sizes: ['256x256'] },
      { src: `${publicOrigin}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] },
    ];
  }
  return [{ src: `data:image/png;base64,${PNG_64_BASE64}`, mimeType: 'image/png', sizes: ['64x64'] }];
}

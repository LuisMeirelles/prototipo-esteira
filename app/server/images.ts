import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { mediaPath } from './store.ts';

sharp.cache(false);
sharp.concurrency(2);

/** Formatos aceitos, identificados pelos magic bytes (nunca pelo Content-Type do cliente). */
function sniff(b: Buffer): boolean {
  if (b.length < 12) return false;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return true;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b.toString('latin1', 0, 3) === 'GIF') return true;
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return true;
  return false;
}

export class ImageError extends Error {}

/**
 * Decodifica e re-codifica a imagem como WebP: remove EXIF, metadados e qualquer
 * payload escondido. SVG e outros formatos são rejeitados.
 */
export async function processImage(input: Buffer, kind: 'image' | 'avatar') {
  if (!sniff(input)) throw new ImageError('formato não suportado');
  const id = randomBytes(18).toString('base64url');
  try {
    const base = sharp(input, { animated: kind === 'image', limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
    const pipeline =
      kind === 'avatar'
        ? base.resize(256, 256, { fit: 'cover' })
        : base.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
    const { data, info } = await pipeline.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    await writeFile(mediaPath(id), data, { mode: 0o600 });
    // para animações, info.height é a altura total dos quadros empilhados
    const h = info.pageHeight ?? info.height;
    return { id, width: info.width, height: h };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError('imagem inválida');
  }
}

const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v) {
    console.error(`Variável de ambiente obrigatória ausente: ${name}`);
    process.exit(1);
  }
  return v;
}

const inviteCode = required('INVITE_CODE');
if (inviteCode.length < 8) {
  console.error('INVITE_CODE precisa ter pelo menos 8 caracteres.');
  process.exit(1);
}

export const config = {
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT ?? 3000),
  dataDir: env.DATA_DIR ?? './data',
  webDir: env.WEB_DIR ?? './web',
  origin: required('PUBLIC_ORIGIN').replace(/\/+$/, ''),
  inviteCode,
  sessionTtlMs: 7 * 24 * 3600 * 1000,
  maxMessageLen: 4000,
  maxImageBytes: 6 * 1024 * 1024,
  maxImagesPerMessage: 4,
};

export const origin = new URL(config.origin);

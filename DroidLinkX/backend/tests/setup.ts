process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@127.0.0.1:5433/droidlinkx_test';
process.env.JWT_SECRET = 'test-only-jwt-secret-do-not-use-in-production-0123456789';
process.env.STORAGE_DIR = './storage-test';
process.env.TURN_SECRET = 'test-turn-secret';
process.env.TURN_URLS = 'turn:127.0.0.1:3478?transport=udp';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:8080';

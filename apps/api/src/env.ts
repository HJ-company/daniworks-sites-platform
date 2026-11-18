export interface Env {
  DB: D1Database;
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
  ADMIN_TOKEN: string;
}

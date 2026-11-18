export interface Env {
  DB: D1Database;
  SITES: R2Bucket;
  ROUTES: KVNamespace;
  BASE_DOMAIN: string;
  ADMIN_TOKEN: string;
  /** Image generation. Optional until image_generate ships. */
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
}

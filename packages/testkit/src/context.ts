export interface ParasDbContext {
  /** Admin connection string (can CREATE DATABASE). */
  adminUrl: string;
  /** Migrated template database every test database is cloned from. */
  template: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    parasDb: ParasDbContext;
  }
}

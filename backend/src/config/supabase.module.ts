import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseFetch } from './supabase-fetch';

export const SUPABASE_ADMIN = Symbol('SUPABASE_ADMIN');
export const SUPABASE_CLIENT = Symbol('SUPABASE_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: SUPABASE_ADMIN,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        const timeoutMs = config.get<number>(
          'SUPABASE_FETCH_TIMEOUT_MS',
          12000,
        );
        return createClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false,
            },
            global: {
              fetch: supabaseFetch(timeoutMs),
            },
          },
        );
      },
    },
    {
      provide: SUPABASE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SupabaseClient => {
        const timeoutMs = config.get<number>(
          'SUPABASE_FETCH_TIMEOUT_MS',
          12000,
        );
        return createClient(
          config.getOrThrow<string>('SUPABASE_URL'),
          config.getOrThrow<string>('SUPABASE_ANON_KEY'),
          {
            global: {
              fetch: supabaseFetch(timeoutMs),
            },
          },
        );
      },
    },
  ],
  exports: [SUPABASE_ADMIN, SUPABASE_CLIENT],
})
export class SupabaseModule {}

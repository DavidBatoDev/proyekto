import { SetMetadata } from '@nestjs/common';
import type { CachePolicyConfig } from '../cache/cache-policy';

export const CACHE_POLICY_METADATA_KEY = 'cache-policy';

export const SetCachePolicy = (policy: CachePolicyConfig) =>
  SetMetadata(CACHE_POLICY_METADATA_KEY, policy);

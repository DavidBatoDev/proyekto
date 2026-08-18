/* eslint-disable @typescript-eslint/no-unsafe-assignment -- The shared SupabaseClient is not generated from a Database schema, so embedded rows arrive as any at this boundary. */
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { TaxonomyRepository } from './taxonomy.repository.interface';
import type {
  MarketplaceCategory,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategory,
  MarketplaceSubcategoryWithCategory,
} from '../taxonomy.types';

const CATEGORY_COLUMNS = 'id, slug, name, description, icon, position';
const SUBCATEGORY_COLUMNS = 'id, slug, name, description, position';
const NAVIGATION_SELECT = `${CATEGORY_COLUMNS}, subcategories:marketplace_subcategories(${SUBCATEGORY_COLUMNS})`;

type Row = Record<string, any>;

function toSubcategory(row: Row): MarketplaceSubcategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    position: row.position ?? 0,
  };
}

function toCategory(row: Row): MarketplaceCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    icon: row.icon ?? null,
    position: row.position ?? 0,
  };
}

function toCategoryWithSubcategories(
  row: Row,
): MarketplaceCategoryWithSubcategories {
  return {
    ...toCategory(row),
    subcategories: ((row.subcategories as Row[]) ?? []).map(toSubcategory),
  };
}

@Injectable()
export class SupabaseTaxonomyRepository implements TaxonomyRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findNavigation(): Promise<MarketplaceCategoryWithSubcategories[]> {
    // One round trip via a PostgREST embed. The second `order` targets the
    // embedded table, which is what keeps sub-category ordering server-side
    // instead of re-sorting in the client on every render.
    const { data, error } = await this.db
      .from('marketplace_categories')
      .select(NAVIGATION_SELECT)
      .eq('is_active', true)
      .eq('subcategories.is_active', true)
      .order('position', { ascending: true })
      .order('position', {
        referencedTable: 'marketplace_subcategories',
        ascending: true,
      });

    if (error) throw error;
    return (data ?? []).map(toCategoryWithSubcategories);
  }

  async findCategoryBySlug(
    slug: string,
  ): Promise<MarketplaceCategoryWithSubcategories | null> {
    const { data, error } = await this.db
      .from('marketplace_categories')
      .select(NAVIGATION_SELECT)
      .eq('is_active', true)
      .eq('subcategories.is_active', true)
      .eq('slug', slug)
      .order('position', {
        referencedTable: 'marketplace_subcategories',
        ascending: true,
      })
      .maybeSingle();

    if (error) throw error;
    return data ? toCategoryWithSubcategories(data) : null;
  }

  async findSubcategoryBySlugs(
    categorySlug: string,
    subcategorySlug: string,
  ): Promise<MarketplaceSubcategoryWithCategory | null> {
    // Resolved through the parent so the (category, subcategory) pair is
    // validated together. Sub-category slugs are unique per category, not
    // globally, so looking one up on its own would be ambiguous.
    const category = await this.findCategoryBySlug(categorySlug);
    if (!category) return null;

    const match = category.subcategories.find(
      (item) => item.slug === subcategorySlug,
    );
    if (!match) return null;

    const { subcategories, ...categoryFields } = category;
    return {
      ...match,
      category: categoryFields,
      siblings: subcategories.filter((item) => item.id !== match.id),
    };
  }

  async findSubcategoryIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
  ): Promise<string[] | null> {
    if (!categorySlug) return null;

    const category = await this.findCategoryBySlug(categorySlug);
    if (!category) return null;

    if (!subcategorySlug) {
      return category.subcategories.map((item) => item.id);
    }

    const match = category.subcategories.find(
      (item) => item.slug === subcategorySlug,
    );
    return match ? [match.id] : null;
  }
}

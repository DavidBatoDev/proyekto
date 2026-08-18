/* eslint-disable @typescript-eslint/no-unsafe-assignment -- The shared SupabaseClient is not generated from a Database schema, so embedded rows arrive as any at this boundary. */
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { TaxonomyRepository } from './taxonomy.repository.interface';
import type {
  ConsultantPlacement,
  MarketplaceCategory,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategory,
  MarketplaceSubcategoryWithCategory,
} from '../taxonomy.types';

const CATEGORY_COLUMNS = 'id, slug, name, description, icon, position';
const SUBCATEGORY_COLUMNS = 'id, slug, name, description, position';
const NAVIGATION_SELECT = `${CATEGORY_COLUMNS}, subcategories:marketplace_subcategories(${SUBCATEGORY_COLUMNS})`;

type Row = Record<string, any>;

/**
 * A consultant's own placements. `!inner` on both levels so a placement in a
 * retired category or sub-category simply stops being returned rather than
 * arriving with a null parent the mapper would have to guess at.
 */
const PLACEMENT_SELECT =
  'is_primary, position, subcategory:marketplace_subcategories!inner(slug, name, category:marketplace_categories!inner(slug, name))';

function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}

function toPlacements(data: unknown): ConsultantPlacement[] {
  return ((data ?? []) as Row[])
    .map((row) => {
      const subcategory = firstOf(row.subcategory as Row | Row[] | null);
      const category = firstOf(subcategory?.category as Row | Row[] | null);
      if (!subcategory || !category) return null;
      return {
        categorySlug: category.slug as string,
        categoryName: category.name as string,
        subcategorySlug: subcategory.slug as string,
        subcategoryName: subcategory.name as string,
        isPrimary: row.is_primary === true,
      };
    })
    .filter((row): row is ConsultantPlacement => row !== null);
}

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

  async findConsultantSubcategories(
    userId: string,
  ): Promise<ConsultantPlacement[]> {
    const { data, error } = await this.db
      .from('consultant_subcategories')
      .select(PLACEMENT_SELECT)
      .eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw error;
    return toPlacements(data);
  }

  async replaceConsultantSubcategories(
    userId: string,
    subcategoryIds: string[],
  ): Promise<ConsultantPlacement[]> {
    // Delete-then-insert rather than a diff. The set is at most 5 and the
    // editor submits the whole intended set, so a diff would buy nothing --
    // and clearing first is what lets somebody swap all five at once without
    // transiently tripping the cap trigger, which counts existing rows.
    const { error: deleteError } = await this.db
      .from('consultant_subcategories')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw deleteError;

    if (subcategoryIds.length > 0) {
      const { error: insertError } = await this.db
        .from('consultant_subcategories')
        .insert(
          subcategoryIds.map((id, index) => ({
            user_id: userId,
            subcategory_id: id,
            position: index,
          })),
        );
      if (insertError) throw insertError;
    }

    return this.findConsultantSubcategories(userId);
  }
}

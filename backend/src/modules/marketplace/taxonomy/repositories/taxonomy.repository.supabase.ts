/* eslint-disable @typescript-eslint/no-unsafe-assignment -- The shared SupabaseClient is not generated from a Database schema, so embedded rows arrive as any at this boundary. */
import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { TaxonomyRepository } from './taxonomy.repository.interface';
import type {
  ConsultantPlacement,
  ConsultantTopicPlacement,
  MarketplaceCategory,
  MarketplaceCategoryDetail,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategory,
  MarketplaceSubcategoryWithCategory,
  MarketplaceSubcategoryWithTopics,
  MarketplaceTopic,
  MarketplaceTopicWithParents,
} from '../taxonomy.types';

const CATEGORY_COLUMNS = 'id, slug, name, description, icon, position';
const SUBCATEGORY_COLUMNS = 'id, slug, name, description, position';
const TOPIC_COLUMNS = 'id, slug, name, description, position';

/**
 * Two selects, deliberately.
 *
 * The mega-menu opens on hover and must never wait, so navigation stays two
 * levels: pulling ~300 topics to draw a panel that shows none of them would be
 * pure waste. The category page needs all three in one round trip, so it gets
 * its own select. `findSubcategoryBySlugs` derives from the detail one, which is
 * how the leaf page gets its topics without a query of its own.
 */
const NAVIGATION_SELECT = `${CATEGORY_COLUMNS}, subcategories:marketplace_subcategories(${SUBCATEGORY_COLUMNS})`;
const CATEGORY_DETAIL_SELECT = `${CATEGORY_COLUMNS}, subcategories:marketplace_subcategories(${SUBCATEGORY_COLUMNS}, topics:marketplace_topics(${TOPIC_COLUMNS}))`;

/**
 * A consultant's topic placements. `!inner` at all three levels for the same
 * reason PLACEMENT_SELECT uses it: a placement under a retired parent stops
 * being returned rather than arriving with a null the mapper must guess at.
 */
const TOPIC_PLACEMENT_SELECT =
  'topic:marketplace_topics!inner(slug, name, subcategory:marketplace_subcategories!inner(slug, name, category:marketplace_categories!inner(slug, name)))';

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

function toTopic(row: Row): MarketplaceTopic {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? null,
    position: row.position ?? 0,
  };
}

function toSubcategoryWithTopics(row: Row): MarketplaceSubcategoryWithTopics {
  return {
    ...toSubcategory(row),
    topics: ((row.topics as Row[]) ?? []).map(toTopic),
  };
}

function toCategoryDetail(row: Row): MarketplaceCategoryDetail {
  return {
    ...toCategory(row),
    subcategories: ((row.subcategories as Row[]) ?? []).map(
      toSubcategoryWithTopics,
    ),
  };
}

function toTopicPlacements(data: unknown): ConsultantTopicPlacement[] {
  return ((data ?? []) as Row[])
    .map((row) => {
      const topic = firstOf(row.topic as Row | Row[] | null);
      const subcategory = firstOf(topic?.subcategory as Row | Row[] | null);
      const category = firstOf(subcategory?.category as Row | Row[] | null);
      if (!topic || !subcategory || !category) return null;
      return {
        categorySlug: category.slug as string,
        categoryName: category.name as string,
        subcategorySlug: subcategory.slug as string,
        subcategoryName: subcategory.name as string,
        topicSlug: topic.slug as string,
        topicName: topic.name as string,
      };
    })
    .filter((entry): entry is ConsultantTopicPlacement => entry !== null);
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
  ): Promise<MarketplaceCategoryDetail | null> {
    const { data, error } = await this.db
      .from('marketplace_categories')
      .select(CATEGORY_DETAIL_SELECT)
      .eq('is_active', true)
      .eq('subcategories.is_active', true)
      .eq('subcategories.topics.is_active', true)
      .eq('slug', slug)
      .order('position', {
        referencedTable: 'marketplace_subcategories',
        ascending: true,
      })
      // The ALIAS PATH, not the table name. A one-level embed accepts either,
      // but a nested one only resolves by path -- `marketplace_topics` here
      // returns PGRST108, "not an embedded resource in this request".
      .order('position', {
        referencedTable: 'subcategories.topics',
        ascending: true,
      })
      .maybeSingle();

    if (error) throw error;
    return data ? toCategoryDetail(data) : null;
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
      // Siblings are named links, not sub-trees: dropping their topics keeps
      // the payload from carrying the whole category twice over.
      siblings: subcategories
        .filter((item) => item.id !== match.id)
        .map((sibling) => toSubcategory(sibling)),
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

  async findTopicBySlugs(
    categorySlug: string,
    subcategorySlug: string,
    topicSlug: string,
  ): Promise<MarketplaceTopicWithParents | null> {
    // Resolved down the whole chain, for the same reason a sub-category is:
    // topic slugs are unique per speciality, not globally, so `rag-systems` on
    // its own could belong to several parents.
    const subcategory = await this.findSubcategoryBySlugs(
      categorySlug,
      subcategorySlug,
    );
    if (!subcategory) return null;

    const match = subcategory.topics.find((item) => item.slug === topicSlug);
    if (!match) return null;

    // `siblings` is the speciality's peers; the topic's own siblings are its
    // peers under this speciality, so the incoming list is dropped rather than
    // forwarded under a name that would now mean something else.
    const { topics, category, siblings, ...subcategoryFields } = subcategory;
    void siblings;
    return {
      ...match,
      category,
      subcategory: subcategoryFields,
      siblings: topics.filter((item) => item.id !== match.id),
    };
  }

  async findTopicIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
    topicSlug: string | undefined,
  ): Promise<string[] | null> {
    // Same contract as findSubcategoryIds: null means "do not constrain",
    // an empty array means "nothing matched". They are not the same answer.
    if (!categorySlug || !topicSlug) return null;
    if (!subcategorySlug) return null;

    const topic = await this.findTopicBySlugs(
      categorySlug,
      subcategorySlug,
      topicSlug,
    );
    return topic ? [topic.id] : null;
  }

  async findConsultantTopics(
    userId: string,
  ): Promise<ConsultantTopicPlacement[]> {
    const { data, error } = await this.db
      .from('consultant_topics')
      .select(TOPIC_PLACEMENT_SELECT)
      .eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw error;
    return toTopicPlacements(data);
  }

  async replaceConsultantTopics(
    userId: string,
    topicIds: string[],
  ): Promise<ConsultantTopicPlacement[]> {
    // Delete-then-insert, matching replaceConsultantSubcategories: the editor
    // submits the whole intended set, and clearing first is what lets somebody
    // swap all fifteen at once without transiently tripping the cap trigger,
    // which counts existing rows.
    const { error: deleteError } = await this.db
      .from('consultant_topics')
      .delete()
      .eq('user_id', userId);
    if (deleteError) throw deleteError;

    if (topicIds.length > 0) {
      const { error: insertError } = await this.db
        .from('consultant_topics')
        .insert(
          topicIds.map((id, index) => ({
            user_id: userId,
            topic_id: id,
            position: index,
          })),
        );
      if (insertError) throw insertError;
    }

    return this.findConsultantTopics(userId);
  }

  async findCategoryIdsBySlugs(slugs: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (slugs.length === 0) return result;

    const { data, error } = await this.db
      .from('marketplace_categories')
      .select('id, slug')
      .eq('is_active', true)
      .in('slug', slugs);
    if (error) throw error;

    for (const row of (data ?? []) as Row[]) {
      result.set(row.slug as string, row.id as string);
    }
    return result;
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

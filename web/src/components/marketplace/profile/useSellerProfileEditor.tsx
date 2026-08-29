import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AboutModal } from "@/components/profile/AboutModal";
import { ExperienceModal } from "@/components/profile/ExperienceModal";
import { HeaderModal } from "@/components/profile/HeaderModal";
import { LanguageModal } from "@/components/profile/LanguageModal";
import { PortfolioModal } from "@/components/profile/PortfolioModal";
import { SpecializationModal } from "@/components/profile/SpecializationModal";
import { UploadModal } from "@/components/profile/UploadModal";
import { useToast } from "@/hooks/useToast";
import type {
	ConsultantPublicExperience,
	ConsultantPublicPortfolio,
	ConsultantPublicRates,
} from "@/queries/consultants";
import { consultantKeys } from "@/queries/consultants";
import { type TalentPublicSpecialization, talentKeys } from "@/queries/talent";
import {
	profileService,
	type SpecializationCategory,
	type UserExperience,
	type UserPortfolio,
} from "@/services/profile.service";
import { uploadService } from "@/services/upload.service";
import { RateModal, type RatePayload } from "./RateModal";
import {
	applySellerPatch,
	type EditableSellerProfile,
	replaceById,
	restoreSellerCaches,
	type SellerCacheSnapshot,
	tempId,
} from "./sellerProfileCache";

/**
 * The owner-side editing engine for the WYSIWYG marketplace profiles.
 *
 * Both public seller pages mount this when the viewer owns the profile. It
 * hosts the SAME modals the private profile editor uses — the page the client
 * sees is the page the owner edits — and it owns the mutations, so neither
 * route file grows the private page's 200-line mutation block.
 *
 * Every save invalidates three keys: the private full profile, the public
 * consultant detail and the public talent detail. Invalidating a key nobody
 * observes is a no-op, so this is unconditional rather than per-page. The
 * fetch layer's `noStore` option (owner requests send Cache-Control:
 * no-cache) plus the backend's Redis/edge purge is what makes the refetch
 * actually fresh.
 *
 * The authed full-profile query exists for what the public payload cannot
 * carry: skill row ids + proficiencies for the About modal, and the owner's
 * first/last name for the header modal.
 */
export function useSellerProfileEditor(profileId: string, enabled: boolean) {
	const qc = useQueryClient();
	const toast = useToast();

	const { data: fullProfile } = useQuery({
		queryKey: ["full-profile", profileId],
		queryFn: () => profileService.getProfile(profileId),
		enabled,
	});

	const { data: languagesMeta = [] } = useQuery({
		queryKey: ["profileMeta", "languages"],
		queryFn: () => profileService.getAllLanguages(),
		enabled,
		staleTime: 1000 * 60 * 60,
	});

	const invalidateAll = () => {
		void qc.invalidateQueries({ queryKey: ["full-profile", profileId] });
		void qc.invalidateQueries({ queryKey: consultantKeys.detail(profileId) });
		void qc.invalidateQueries({ queryKey: talentKeys.detail(profileId) });
	};
	const fail = () => toast.error("Could not save. Please try again.");

	/**
	 * Every edit writes into the rendered public caches first and rolls back if
	 * the server refuses — the owner is looking at the page they are editing, so
	 * a round trip of nothing-happened reads as a broken save.
	 */
	const optimistic = (
		patch: (previous: EditableSellerProfile) => EditableSellerProfile,
	) => applySellerPatch(qc, profileId, patch);

	const rollback = (snapshot: SellerCacheSnapshot | undefined) => {
		restoreSellerCaches(qc, snapshot);
		fail();
	};

	// ── Modal state ─────────────────────────────────────────────────────────
	const [headerOpen, setHeaderOpen] = useState(false);
	const [aboutOpen, setAboutOpen] = useState(false);
	const [avatarOpen, setAvatarOpen] = useState(false);
	const [ratesOpen, setRatesOpen] = useState(false);
	const [expOpen, setExpOpen] = useState(false);
	const [editingExp, setEditingExp] =
		useState<ConsultantPublicExperience | null>(null);
	const [portOpen, setPortOpen] = useState(false);
	const [editingPort, setEditingPort] =
		useState<ConsultantPublicPortfolio | null>(null);
	const [langOpen, setLangOpen] = useState(false);
	const [specOpen, setSpecOpen] = useState(false);
	const [editingSpec, setEditingSpec] =
		useState<TalentPublicSpecialization | null>(null);
	const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
	const [isSavingAbout, setIsSavingAbout] = useState(false);

	// ── Mutations ───────────────────────────────────────────────────────────
	const headline = useMutation({
		mutationFn: (payload: { headline: string }) =>
			profileService.updateProfile(payload),
		onMutate: async (payload) => {
			setHeaderOpen(false);
			return optimistic((previous) => ({
				...previous,
				headline: payload.headline,
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const saveRates = useMutation({
		mutationFn: (payload: RatePayload) =>
			profileService.updateRateSettings({
				hourly_rate: payload.hourly_rate,
				currency: payload.currency,
				availability: payload.availability as Parameters<
					typeof profileService.updateRateSettings
				>[0]["availability"],
			}),
		onMutate: async (payload) => {
			setRatesOpen(false);
			return optimistic((previous) => ({
				...previous,
				rates: {
					hourlyRate: payload.hourly_rate,
					currency: payload.currency,
					availability: payload.availability,
				},
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const addExp = useMutation({
		mutationFn: (payload: Parameters<typeof profileService.addExperience>[0]) =>
			profileService.addExperience(payload),
		onMutate: async (payload) => {
			setExpOpen(false);
			const id = tempId();
			const snapshot = await optimistic((previous) => ({
				...previous,
				experiences: [
					{
						id,
						company: payload.company ?? null,
						title: payload.title ?? null,
						location: payload.location ?? null,
						is_remote: payload.is_remote ?? null,
						description: payload.description ?? null,
						start_date: payload.start_date ?? null,
						end_date: payload.end_date ?? null,
						is_current: payload.is_current ?? null,
					},
					...previous.experiences,
				],
			}));
			return { snapshot, id };
		},
		// Swap the placeholder for the persisted row immediately, so a delete
		// fired before the refetch lands targets an id the server knows.
		onSuccess: (created, _payload, context) => {
			if (!context) return;
			void optimistic((previous) => ({
				...previous,
				experiences: replaceById(previous.experiences, context.id, {
					id: created.id,
					company: created.company ?? null,
					title: created.title ?? null,
					location: created.location ?? null,
					is_remote: created.is_remote ?? null,
					description: created.description ?? null,
					start_date: created.start_date ?? null,
					end_date: created.end_date ?? null,
					is_current: created.is_current ?? null,
				}),
			}));
		},
		onError: (_error, _payload, context) => rollback(context?.snapshot),
		onSettled: invalidateAll,
	});
	const updateExp = useMutation({
		mutationFn: ({
			id,
			payload,
		}: {
			id: string;
			payload: Parameters<typeof profileService.updateExperience>[1];
		}) => profileService.updateExperience(id, payload),
		onMutate: async ({ id, payload }) => {
			setExpOpen(false);
			setEditingExp(null);
			return optimistic((previous) => ({
				...previous,
				experiences: previous.experiences.map((entry) =>
					entry.id === id
						? {
								...entry,
								company: payload.company ?? entry.company,
								title: payload.title ?? entry.title,
								location: payload.location ?? entry.location,
								is_remote: payload.is_remote ?? entry.is_remote,
								description: payload.description ?? entry.description,
								start_date: payload.start_date ?? entry.start_date,
								// Deliberately not `??`: clearing an end date is how
								// "I still work here" is expressed.
								end_date:
									payload.end_date === undefined
										? entry.end_date
										: payload.end_date,
								is_current: payload.is_current ?? entry.is_current,
							}
						: entry,
				),
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});
	const removeExp = useMutation({
		mutationFn: (id: string) => profileService.deleteExperience(id),
		onMutate: async (id: string) =>
			optimistic((previous) => ({
				...previous,
				experiences: previous.experiences.filter((entry) => entry.id !== id),
			})),
		onError: (_error, _id, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const addPort = useMutation({
		mutationFn: (payload: Parameters<typeof profileService.addPortfolio>[0]) =>
			profileService.addPortfolio(payload),
		onMutate: async (payload) => {
			setPortOpen(false);
			const id = tempId();
			const snapshot = await optimistic((previous) => ({
				...previous,
				portfolios: [
					...previous.portfolios,
					{
						id,
						title: payload.title,
						description: payload.description ?? null,
						url: payload.url ?? null,
						image_url: payload.image_url ?? null,
						tags: payload.tags ?? null,
						position: payload.position ?? previous.portfolios.length,
					},
				],
			}));
			return { snapshot, id };
		},
		onSuccess: (created, _payload, context) => {
			if (!context) return;
			void optimistic((previous) => ({
				...previous,
				portfolios: replaceById(previous.portfolios, context.id, {
					id: created.id,
					title: created.title,
					description: created.description ?? null,
					url: created.url ?? null,
					image_url: created.image_url ?? null,
					tags: created.tags ?? null,
					position: created.position ?? null,
				}),
			}));
		},
		onError: (_error, _payload, context) => rollback(context?.snapshot),
		onSettled: invalidateAll,
	});
	const updatePort = useMutation({
		mutationFn: ({
			id,
			payload,
		}: {
			id: string;
			payload: Parameters<typeof profileService.updatePortfolio>[1];
		}) => profileService.updatePortfolio(id, payload),
		onMutate: async ({ id, payload }) => {
			setPortOpen(false);
			setEditingPort(null);
			return optimistic((previous) => ({
				...previous,
				portfolios: previous.portfolios.map((entry) =>
					entry.id === id
						? {
								...entry,
								title: payload.title ?? entry.title,
								description: payload.description ?? entry.description,
								url: payload.url ?? entry.url,
								image_url: payload.image_url ?? entry.image_url,
								tags: payload.tags ?? entry.tags,
							}
						: entry,
				),
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});
	const removePort = useMutation({
		mutationFn: (id: string) => profileService.deletePortfolio(id),
		onMutate: async (id: string) =>
			optimistic((previous) => ({
				...previous,
				portfolios: previous.portfolios.filter((entry) => entry.id !== id),
			})),
		onError: (_error, _id, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const addLang = useMutation({
		mutationFn: (payload: Parameters<typeof profileService.addLanguage>[0]) =>
			profileService.addLanguage(payload),
		onMutate: async (payload) => {
			setLangOpen(false);
			// The public row carries the language's code and NAME; the payload
			// only has the id, so resolve it from the meta list the modal uses.
			const meta = languagesMeta.find(
				(entry) => entry.id === payload.language_id,
			);
			return optimistic((previous) => ({
				...previous,
				languages: [
					...previous.languages,
					{
						code: meta?.code ?? "",
						name: meta?.name ?? "…",
						fluency: payload.fluency_level ?? null,
					},
				],
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const addSpec = useMutation({
		mutationFn: (
			payload: Parameters<typeof profileService.addSpecialization>[0],
		) => profileService.addSpecialization(payload),
		onMutate: async (payload) => {
			setSpecOpen(false);
			const id = tempId();
			const snapshot = await optimistic((previous) => ({
				...previous,
				specializations: [
					...(previous.specializations ?? []),
					{
						id,
						category: payload.category,
						subCategory: payload.sub_category ?? null,
						yearsOfExperience: payload.years_of_experience ?? null,
						description: payload.description ?? null,
					},
				],
			}));
			return { snapshot, id };
		},
		onSuccess: (created, _payload, context) => {
			if (!context) return;
			void optimistic((previous) => ({
				...previous,
				specializations: replaceById(
					previous.specializations ?? [],
					context.id,
					{
						id: created.id,
						category: created.category,
						subCategory: created.sub_category ?? null,
						yearsOfExperience: created.years_of_experience ?? null,
						description: created.description ?? null,
					},
				),
			}));
		},
		onError: (_error, _payload, context) => rollback(context?.snapshot),
		onSettled: invalidateAll,
	});
	const updateSpec = useMutation({
		mutationFn: ({
			id,
			payload,
		}: {
			id: string;
			payload: Parameters<typeof profileService.updateSpecialization>[1];
		}) => profileService.updateSpecialization(id, payload),
		onMutate: async ({ id, payload }) => {
			setSpecOpen(false);
			setEditingSpec(null);
			return optimistic((previous) => ({
				...previous,
				specializations: (previous.specializations ?? []).map((entry) =>
					entry.id === id
						? {
								...entry,
								category: payload.category ?? entry.category,
								subCategory: payload.sub_category ?? entry.subCategory,
								yearsOfExperience:
									payload.years_of_experience ?? entry.yearsOfExperience,
								description: payload.description ?? entry.description,
							}
						: entry,
				),
			}));
		},
		onError: (_error, _payload, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});
	const removeSpec = useMutation({
		mutationFn: (id: string) => profileService.deleteSpecialization(id),
		onMutate: async (id: string) =>
			optimistic((previous) => ({
				...previous,
				specializations: (previous.specializations ?? []).filter(
					(entry) => entry.id !== id,
				),
			})),
		onError: (_error, _id, snapshot) => rollback(snapshot),
		onSettled: invalidateAll,
	});

	const handleAboutSave = async (
		bio: string,
		skills: Array<{
			skill_id: string;
			proficiency_level: "beginner" | "intermediate" | "advanced" | "expert";
		}>,
	) => {
		setIsSavingAbout(true);
		// Bio shows on the page, so it moves immediately; the skill chips carry
		// names the modal does not have (it deals in ids), so those wait for the
		// refetch rather than being guessed at.
		const snapshot = await optimistic((previous) => ({ ...previous, bio }));
		setAboutOpen(false);
		try {
			await Promise.all([
				profileService.updateProfile({ bio }),
				profileService.updateSkills(
					skills.map(({ skill_id, proficiency_level }) => ({
						skill_id,
						proficiency_level,
					})),
				),
			]);
		} catch {
			rollback(snapshot);
			setAboutOpen(true);
		} finally {
			invalidateAll();
			setIsSavingAbout(false);
		}
	};

	const handleAvatarUpload = async (files: File[]) => {
		if (!files[0]) return;
		setIsUploadingAvatar(true);
		try {
			// The upload confirm invalidates the server-side caches; here only
			// invalidate — never setQueryData onto the marketplace keys, whose
			// payload shape differs from the private profile's.
			await uploadService.uploadAvatar(files[0]);
			invalidateAll();
			setAvatarOpen(false);
		} catch {
			fail();
		} finally {
			setIsUploadingAvatar(false);
		}
	};

	// ── Modal → payload adapters ────────────────────────────────────────────
	const expInitial = (
		entry: ConsultantPublicExperience,
	): Partial<UserExperience> => ({
		id: entry.id,
		company: entry.company ?? undefined,
		title: entry.title ?? undefined,
		location: entry.location,
		is_remote: entry.is_remote ?? false,
		description: entry.description,
		start_date: entry.start_date ?? undefined,
		end_date: entry.end_date,
		is_current: entry.is_current ?? false,
	});

	const portInitial = (
		item: ConsultantPublicPortfolio,
	): Partial<UserPortfolio> => ({
		id: item.id,
		title: item.title,
		description: item.description,
		url: item.url,
		image_url: item.image_url,
		tags: item.tags ?? [],
		position: item.position ?? 0,
	});

	const modals = enabled ? (
		<>
			<HeaderModal
				isOpen={headerOpen}
				onClose={() => setHeaderOpen(false)}
				onSave={(payload) => headline.mutate(payload)}
				isSaving={headline.isPending}
				firstName={fullProfile?.first_name ?? ""}
				lastName={fullProfile?.last_name ?? ""}
				headline={fullProfile?.headline ?? ""}
			/>
			<AboutModal
				isOpen={aboutOpen}
				onClose={() => setAboutOpen(false)}
				initialBio={fullProfile?.bio ?? ""}
				currentSkills={fullProfile?.skills ?? []}
				onSave={(bio, skills) => void handleAboutSave(bio, skills)}
				isSaving={isSavingAbout}
			/>
			<UploadModal
				isOpen={avatarOpen}
				onClose={() => setAvatarOpen(false)}
				title="Update profile photo"
				accept="image/jpeg,image/png,image/webp,image/gif"
				maxSizeMb={5}
				aspectHint="1:1 (square)"
				onUpload={(files) => void handleAvatarUpload(files)}
				isUploading={isUploadingAvatar}
			/>
			<RateModal
				isOpen={ratesOpen}
				onClose={() => setRatesOpen(false)}
				onSave={(payload) => saveRates.mutate(payload)}
				isSaving={saveRates.isPending}
				rates={publicRatesFromFull(fullProfile)}
			/>
			<ExperienceModal
				isOpen={expOpen}
				onClose={() => {
					setExpOpen(false);
					setEditingExp(null);
				}}
				onSave={(payload) =>
					editingExp
						? updateExp.mutate({ id: editingExp.id, payload })
						: addExp.mutate(payload)
				}
				isSaving={addExp.isPending || updateExp.isPending}
				initialData={editingExp ? expInitial(editingExp) : undefined}
			/>
			<PortfolioModal
				isOpen={portOpen}
				onClose={() => {
					setPortOpen(false);
					setEditingPort(null);
				}}
				onSave={(payload) =>
					editingPort
						? updatePort.mutate({ id: editingPort.id, payload })
						: addPort.mutate(payload)
				}
				isSaving={addPort.isPending || updatePort.isPending}
				nextPosition={fullProfile?.portfolios?.length ?? 0}
				initialData={editingPort ? portInitial(editingPort) : undefined}
			/>
			<LanguageModal
				isOpen={langOpen}
				onClose={() => setLangOpen(false)}
				onSave={(payload) => addLang.mutate(payload)}
				isSaving={addLang.isPending}
				languagesMeta={languagesMeta}
			/>
			<SpecializationModal
				isOpen={specOpen}
				onClose={() => {
					setSpecOpen(false);
					setEditingSpec(null);
				}}
				onSave={(payload) =>
					editingSpec
						? updateSpec.mutate({
								id: editingSpec.id,
								// The update DTO takes undefined for "unchanged", not null.
								payload: {
									category: payload.category,
									sub_category: payload.sub_category ?? undefined,
									years_of_experience: payload.years_of_experience ?? undefined,
									description: payload.description ?? undefined,
								},
							})
						: addSpec.mutate(payload)
				}
				isSaving={addSpec.isPending || updateSpec.isPending}
				initialData={
					editingSpec
						? {
								category: editingSpec.category as SpecializationCategory,
								sub_category: editingSpec.subCategory,
								years_of_experience: editingSpec.yearsOfExperience,
								description: editingSpec.description,
							}
						: undefined
				}
			/>
		</>
	) : null;

	return {
		modals,
		openHeader: () => setHeaderOpen(true),
		openAbout: () => setAboutOpen(true),
		openAvatar: () => setAvatarOpen(true),
		openRates: () => setRatesOpen(true),
		addExperience: () => {
			setEditingExp(null);
			setExpOpen(true);
		},
		editExperience: (entry: ConsultantPublicExperience) => {
			setEditingExp(entry);
			setExpOpen(true);
		},
		deleteExperience: (id: string) => removeExp.mutate(id),
		addPortfolio: () => {
			setEditingPort(null);
			setPortOpen(true);
		},
		editPortfolio: (item: ConsultantPublicPortfolio) => {
			setEditingPort(item);
			setPortOpen(true);
		},
		deletePortfolio: (id: string) => removePort.mutate(id),
		addLanguage: () => setLangOpen(true),
		addSpecialization: () => {
			setEditingSpec(null);
			setSpecOpen(true);
		},
		editSpecialization: (entry: TalentPublicSpecialization) => {
			setEditingSpec(entry);
			setSpecOpen(true);
		},
		deleteSpecialization: (id: string) => removeSpec.mutate(id),
	};
}

function publicRatesFromFull(
	fullProfile:
		| {
				rate_settings?: {
					hourly_rate?: number | null;
					currency?: string | null;
					availability?: string | null;
				} | null;
		  }
		| undefined,
): ConsultantPublicRates | null {
	const settings = fullProfile?.rate_settings;
	if (!settings) return null;
	return {
		hourlyRate:
			settings.hourly_rate === null || settings.hourly_rate === undefined
				? null
				: Number(settings.hourly_rate),
		currency: settings.currency ?? "USD",
		availability: settings.availability ?? null,
	};
}

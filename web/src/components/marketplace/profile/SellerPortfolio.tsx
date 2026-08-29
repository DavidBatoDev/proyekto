import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { ConsultantPublicPortfolio } from "@/queries/consultants";
import { EditableItem, ItemControlButton } from "./EditableSection";

/**
 * Portfolio grid on the public seller profiles. Talent go-live requires at
 * least one item, so on the talent page this is a load-bearing section; the
 * consultant endpoint returns the same rows.
 *
 * `onEditItem`/`onDeleteItem` are the WYSIWYG hooks — passed only for the
 * owner, in which case each card grows hover controls; a visitor's markup is
 * untouched.
 */
export function SellerPortfolio({
	portfolios,
	isOwner,
	name,
	onEditItem,
	onDeleteItem,
}: {
	portfolios: ConsultantPublicPortfolio[];
	isOwner: boolean;
	name: string;
	onEditItem?: (item: ConsultantPublicPortfolio) => void;
	onDeleteItem?: (item: ConsultantPublicPortfolio) => void;
}) {
	if (portfolios.length === 0) {
		return (
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				{isOwner
					? "You have not added portfolio work yet. Clients hire from proof."
					: `${name} has not added portfolio work yet.`}
			</p>
		);
	}

	return (
		<div className="mt-4 grid gap-4 sm:grid-cols-2">
			{portfolios.map((item) => {
				const card = (
					<div className="overflow-hidden rounded-xl border border-border">
						{item.image_url && (
							<img
								src={item.image_url}
								alt={item.title}
								className="aspect-[16/9] w-full object-cover"
							/>
						)}
						<div className="p-4">
							<h3 className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
								{item.title}
								{item.url && (
									<a
										href={item.url}
										target="_blank"
										rel="noreferrer"
										aria-label={`Open ${item.title}`}
										className="text-muted-foreground transition-colors hover:text-primary"
									>
										<ExternalLink className="h-3.5 w-3.5" />
									</a>
								)}
							</h3>
							{item.description && (
								<p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
									{item.description}
								</p>
							)}
							{(item.tags?.length ?? 0) > 0 && (
								<div className="mt-2 flex flex-wrap gap-1.5">
									{item.tags?.slice(0, 5).map((tag) => (
										<span
											key={tag}
											className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] text-muted-foreground"
										>
											{tag}
										</span>
									))}
								</div>
							)}
						</div>
					</div>
				);

				if (!onEditItem && !onDeleteItem) {
					return <div key={item.id}>{card}</div>;
				}
				return (
					<EditableItem
						key={item.id}
						controls={
							<div className="m-2 flex gap-1">
								{onEditItem && (
									<ItemControlButton
										label={`Edit ${item.title}`}
										onClick={() => onEditItem(item)}
										icon={<Pencil className="h-3.5 w-3.5" />}
									/>
								)}
								{onDeleteItem && (
									<ItemControlButton
										label={`Delete ${item.title}`}
										onClick={() => onDeleteItem(item)}
										icon={<Trash2 className="h-3.5 w-3.5" />}
									/>
								)}
							</div>
						}
					>
						{card}
					</EditableItem>
				);
			})}
		</div>
	);
}

/** The avatar both public seller profiles render — image or initial disc. */
export function SellerAvatar({
	name,
	initial,
	url,
	className,
}: {
	name: string;
	initial: string;
	url: string | null;
	className: string;
}) {
	return url ? (
		<img
			src={url}
			alt={name}
			className={`rounded-full object-cover ${className}`}
		/>
	) : (
		<div
			className={`flex items-center justify-center rounded-full bg-primary font-bold text-primary-foreground ${className}`}
		>
			{initial}
		</div>
	);
}

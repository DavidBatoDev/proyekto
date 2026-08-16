import { motion } from "framer-motion";
import {
	Check,
	LayoutDashboard,
	Lock,
	MousePointer2,
	Settings,
} from "lucide-react";
import { useEffect, useState } from "react";

export const HeroRoadmapAnimation = () => {
	const [animationStep, setAnimationStep] = useState(0);

	// Animation Sequence
	// 0: Initial render (cards visible, no cursor interaction)
	// 1: Cursor moves to second card
	// 2: Cursor clicks (card scales down slightly)
	// 3: Checklist items expand
	// 4: Reset
	useEffect(() => {
		const sequence = async () => {
			// Loop sequence
			while (true) {
				await new Promise((r) => setTimeout(r, 1500)); // Wait before start
				setAnimationStep(1); // Move
				await new Promise((r) => setTimeout(r, 800));
				setAnimationStep(2); // Click
				await new Promise((r) => setTimeout(r, 200));
				setAnimationStep(3); // Expand list
				await new Promise((r) => setTimeout(r, 2000)); // Hold state
				setAnimationStep(4); // Exit move left & fade
				await new Promise((r) => setTimeout(r, 1000));
				setAnimationStep(5); // Reset phase
				await new Promise((r) => setTimeout(r, 500));
				setAnimationStep(0); // Back to start
			}
		};
		sequence();
	}, []);

	return (
		<div className="relative w-full h-full min-h-[300px] lg:h-[300px] rounded-[30px] bg-[#f8fafc] overflow-hidden border border-gray-100 shadow-inner flex items-center justify-center p-4">
			{/* Background Grid Pattern */}
			<div
				className="absolute inset-0 z-0 opacity-[0.4]"
				style={{
					backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)",
					backgroundSize: "24px 24px",
				}}
			/>

			<div className="relative z-10 w-full max-w-[600px] pl-2 sm:pl-4">
				{/* Main Connector Line (Vertical) */}
				<div className="absolute left-[30px] sm:left-[32px] top-4 bottom-4 w-[2px] bg-gray-200 z-0" />

				<div className="flex flex-col space-y-2 w-full">
					<motion.div
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.5 }}
						className="flex items-start gap-4 relative"
					>
						{/* Connector node */}
						<div className="w-8 h-8 shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex items-center justify-center z-10 relative">
							<Settings className="w-4 h-4 text-gray-400" />
						</div>

						{/* Content Card */}
						<div className="flex-1 bg-white rounded-xl p-2.5 shadow-sm border border-gray-200">
							<div className="flex justify-between items-start mb-1">
								<h3 className="font-semibold text-gray-900 text-xs">
									Project Strategy & Scope
								</h3>
								<span className="px-1.5 py-0.5 bg-green-50 text-green-600 text-[8px] font-medium rounded-full uppercase tracking-wider">
									Completed
								</span>
							</div>
							<p className="text-[10px] text-gray-500 mb-1.5 leading-tight">
								Define platform access controls, authentication methods, and
								security protocols.
							</p>
							<div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden">
								<div className="bg-green-500 w-full h-full" />
							</div>
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.5, delay: 0.2 }}
						className="flex items-start gap-4 relative"
					>
						{/* Interactive Connector - This is what gets "clicked" */}
						<motion.div
							animate={animationStep === 2 ? { scale: 0.95 } : { scale: 1 }}
							className={`w-8 h-8 shrink-0 rounded-lg shadow-sm border flex items-center justify-center z-10 relative transition-colors duration-300 ${animationStep >= 3 ? "bg-primary/5 border-primary/20" : "bg-white border-gray-200"}`}
						>
							<Lock
								className={`w-4 h-4 ${animationStep >= 3 ? "text-primary" : "text-gray-400"}`}
							/>
						</motion.div>

						{/* Content Card container - Expands to show checklist */}
						<div className="flex-1">
							{/* Main Card */}
							<motion.div
								animate={animationStep === 2 ? { scale: 0.98 } : { scale: 1 }}
								className={`bg-white rounded-xl p-2.5 shadow-sm border transition-colors duration-300 relative z-20 ${animationStep >= 3 ? "border-primary ring-1 ring-primary/20" : "border-gray-200"}`}
							>
								<div className="flex justify-between items-start mb-1">
									<h3 className="font-semibold text-gray-900 text-xs">
										Authentication System
									</h3>
									<span className="px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[8px] font-medium rounded-full uppercase tracking-wider">
										In Progress
									</span>
								</div>
								<p className="text-[10px] text-gray-500 mb-1 leading-tight">
									Implement secure JWT login, role-based access to dashboards,
									and token rotation.
								</p>
								<div className="flex items-center justify-between text-[9px] text-gray-400">
									<span>3 tasks remaining</span>
									<span>40% done</span>
								</div>
								<div className="w-full bg-gray-100 h-1 rounded-full overflow-hidden mt-1">
									<div className="bg-amber-400 w-[40%] h-full" />
								</div>
							</motion.div>

							{/* Sub-checklist that appears on click */}
							<motion.div
								initial={{ height: 0, opacity: 0, marginTop: 0 }}
								animate={
									animationStep >= 3
										? { height: "auto", opacity: 1, marginTop: 4 }
										: { height: 0, opacity: 0, marginTop: 0 }
								}
								transition={{ duration: 0.3 }}
								className="overflow-hidden bg-white/60 backdrop-blur-sm rounded-lg border border-gray-100 pl-2"
							>
								<div className="p-1 flex flex-col gap-1">
									<div className="flex items-center gap-2 text-[9px] text-gray-600">
										<div className="w-2.5 h-2.5 rounded bg-green-500 flex items-center justify-center shrink-0">
											<Check className="w-2 h-2 text-white" />
										</div>
										<span className="line-through opacity-70">
											Design login UI layout
										</span>
									</div>
									<div className="flex items-center gap-2 text-[9px] text-gray-600">
										<div className="w-2.5 h-2.5 rounded bg-green-500 flex items-center justify-center shrink-0">
											<Check className="w-2 h-2 text-white" />
										</div>
										<span className="line-through opacity-70">
											Implement JWT logic
										</span>
									</div>
									<div className="flex items-center gap-2 text-[9px] font-medium text-gray-800">
										<div className="w-2.5 h-2.5 rounded border border-primary shrink-0" />
										<span>Connect roles to DB</span>
									</div>
								</div>
							</motion.div>
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, x: 20 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.5, delay: 0.4 }}
						className="flex items-start gap-4 relative"
					>
						{/* Connector node */}
						<div className="w-8 h-8 shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex items-center justify-center z-10 relative">
							<LayoutDashboard className="w-4 h-4 text-gray-400" />
						</div>

						{/* Content Card */}
						<div className="flex-1 bg-white rounded-xl p-2.5 shadow-sm border border-gray-200 opacity-60">
							<div className="flex justify-between items-start mb-1">
								<h3 className="font-semibold text-gray-900 text-xs">
									Admin Dashboard
								</h3>
								<span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[8px] font-medium rounded-full uppercase tracking-wider">
									Todo
								</span>
							</div>
							<p className="text-[10px] text-gray-500 leading-tight">
								Visual summary analytics formatting and active project routing
								limits.
							</p>
						</div>
					</motion.div>
				</div>

				{/* Animated Mouse Cursor */}
				<motion.div
					className="absolute top-0 left-0 z-100 pointer-events-none"
					initial={{ x: 150, y: 150, opacity: 0 }}
					animate={
						animationStep === 0 || animationStep === 5
							? { x: 150, y: 150, opacity: 0 }
							: animationStep === 1
								? { x: 35, y: 100, opacity: 1 } // Position over the middle lock icon
								: animationStep === 2 || animationStep === 3
									? { x: 35, y: 100, scale: 0.9, opacity: 1 } // Click effect
									: animationStep === 4
										? { x: -25, y: 100, opacity: 0 } // Move left & fade out
										: {}
					}
					transition={
						animationStep === 1
							? { duration: 0.8, ease: "easeInOut" }
							: animationStep === 4
								? { duration: 0.8, ease: "easeOut" } // Slow fade out
								: animationStep === 5 || animationStep === 0
									? { duration: 0 } // Instant snap back to hidden start
									: { duration: 0.1 }
					}
				>
					<MousePointer2
						className="w-8 h-8 text-gray-800 drop-shadow-lg"
						fill="white"
					/>
				</motion.div>
			</div>
		</div>
	);
};

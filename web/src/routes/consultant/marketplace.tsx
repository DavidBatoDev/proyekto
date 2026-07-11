import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Filter, SortDesc, Users } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "@/stores/authStore";
import {
  profileService,
  type AvailabilityStatus,
  type MarketplaceFreelancerCard,
} from "@/services/profile.service";
import { FreelancerCard } from "@/components/marketplace/FreelancerCard";
import { InviteModal } from "@/components/marketplace/InviteModal";

export const Route = createFileRoute("/consultant/marketplace")({
  beforeLoad: () => {
    const { isAuthenticated, profile } = useAuthStore.getState();
    if (!isAuthenticated) throw redirect({ to: "/auth/login" });
    if (profile && !profile.is_consultant_verified) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ConsultantMarketplacePage,
});

function ConsultantMarketplacePage() {
  const { profile } = useAuthStore();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [availability, setAvailability] = useState<AvailabilityStatus | "">("");
  const [specialization, setSpecialization] = useState("");
  const [sort, setSort] = useState<"rating_desc" | "rate_asc" | "rate_desc">("rating_desc");
  const [selectedFreelancer, setSelectedFreelancer] = useState<MarketplaceFreelancerCard | null>(null);

  const filters = useMemo(
    () => ({
      search: search || undefined,
      skill: skill || undefined,
      availability: availability || undefined,
      specialization: specialization || undefined,
      sort,
    }),
    [availability, search, skill, sort, specialization],
  );

  const freelancersQuery = useQuery({
    queryKey: ["marketplace", "freelancers", filters],
    queryFn: () => profileService.getMarketplaceFreelancers(filters),
    enabled: !!profile?.is_consultant_verified,
  });

  if (!profile?.is_consultant_verified) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4 bg-gray-50">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-md shadow-sm">
          <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
             <Users className="w-8 h-8 text-[#ff9933]" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Consultant Access Only</h1>
          <p className="text-sm text-gray-600 mt-2">
            This private freelancer marketplace is only available to verified consultants. Upgrade your account to gain access to top talent.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background pt-20 text-foreground">
      
      {/* Animated Background */}
      <div className="absolute inset-0 pointer-events-none">
        <motion.svg className="absolute top-0 left-0 w-full h-[500px] opacity-30" viewBox="0 0 1440 320" preserveAspectRatio="none"
          animate={{ y: [0, -20, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}>
          <motion.path
            d="M0,160L48,154.7C96,149,192,139,288,149.3C384,160,480,192,576,192C672,192,768,160,864,138.7C960,117,1056,107,1152,117.3C1248,128,1344,160,1392,176L1440,192L1440,0L1392,0C1344,0,1248,0,1152,0C1056,0,960,0,864,0C768,0,672,0,576,0C480,0,384,0,288,0C192,0,96,0,48,0L0,0Z"
            fill="url(#gradient-orange-pink)"
            fillOpacity="0.4"
          />
          <defs>
             <linearGradient id="gradient-orange-pink" x1="0%" y1="0%" x2="100%" y2="0%">
               <stop offset="0%" stopColor="#ff9933" />
               <stop offset="100%" stopColor="#e91e63" />
             </linearGradient>
          </defs>
        </motion.svg>
        <motion.div className="absolute top-0 right-10 w-[400px] h-[400px] bg-[#ff993333] rounded-full blur-3xl opacity-40 mix-blend-multiply"
          animate={{ scale: [1, 1.2, 1], x: [0, -30, 0], y: [0, 40, 0] }} transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }} />
         <motion.div className="absolute top-20 left-10 w-[350px] h-[350px] bg-pink-300 rounded-full blur-3xl opacity-20 mix-blend-multiply"
          animate={{ scale: [1, 1.3, 1], x: [0, 40, 0], y: [0, -30, 0] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut", delay: 1 }} />
      </div>

      <div className="max-w-[1440px] mx-auto px-6 py-12 relative z-10">
        
        {/* Header / Hero Section */}
        <div className="text-center max-w-3xl mx-auto mb-12">
            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="text-4xl md:text-5xl font-extrabold text-[#333438] mb-4 tracking-tight">
               Discover Top <span className="text-transparent bg-clip-text bg-linear-to-r from-[#ff9933] to-[#e91e63]">Talent</span>
            </motion.h1>
            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }} className="text-lg text-[#61636c]">
               Curated discovery engine for consultants. Build your dream development team from our private pool of vetted professionals.
            </motion.p>
        </div>

        {/* Floating Filter Bar */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.2 }} 
            className="bg-white/80 backdrop-blur-xl border border-white/60 shadow-xl rounded-2xl p-3 mb-10 sticky top-[90px] z-30">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Search Input */}
            <div className="md:col-span-4 relative group">
              <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 group-focus-within:text-[#ff9933] transition-colors" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, headline or keywords..."
                className="w-full pl-11 pr-4 py-3 bg-gray-50/50 rounded-xl border border-gray-200 text-sm text-[#333438] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50 focus:border-[#ff9933] transition-all placeholder:text-gray-400"
              />
            </div>

            {/* Filter Inputs Container */}
            <div className="md:col-span-6 grid grid-cols-3 gap-2">
                 <div className="relative group">
                     <Filter className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-[#e91e63] transition-colors hidden xl:block" />
                    <input
                        value={skill}
                        onChange={(e) => setSkill(e.target.value)}
                        placeholder="Skill (e.g. React)"
                        className="w-full xl:pl-9 px-4 py-3 bg-gray-50/50 rounded-xl border border-gray-200 text-sm text-[#333438] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#e91e63]/50 focus:border-[#e91e63] transition-all placeholder:text-gray-400"
                    />
                 </div>

                <select
                    value={availability}
                    onChange={(e) => setAvailability(e.target.value as AvailabilityStatus | "")}
                    className="w-full px-4 py-3 bg-gray-50/50 rounded-xl border border-gray-200 text-sm text-[#333438] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ff9933]/50 focus:border-[#ff9933] transition-all appearance-none cursor-pointer"
                >
                    <option value="">Any Availability</option>
                    <option value="available">Available Now</option>
                    <option value="partially_available">Part-time</option>
                    <option value="unavailable">Unavailable</option>
                </select>

                <input
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    placeholder="Specialization..."
                    className="w-full px-4 py-3 bg-gray-50/50 rounded-xl border border-gray-200 text-sm text-[#333438] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#e91e63]/50 focus:border-[#e91e63] transition-all placeholder:text-gray-400"
                />
            </div>

            {/* Sort Dropdown */}
            <div className="md:col-span-2 relative group">
                <SortDesc className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-indigo-500 transition-colors hidden xl:block" />
                <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as "rating_desc" | "rate_asc" | "rate_desc")}
                    className="w-full xl:pl-9 px-4 py-3 bg-gray-50/50 rounded-xl border border-gray-200 text-sm font-medium text-[#333438] focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all appearance-none cursor-pointer"
                >
                    <option value="rating_desc">Best Match</option>
                    <option value="rate_asc">Rate: Low to High</option>
                    <option value="rate_desc">Rate: High to Low</option>
                </select>
            </div>
            
          </div>
        </motion.div>

        {/* Results Section */}
        <div className="min-h-[400px]">
             {freelancersQuery.isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm animate-pulse">
                            <div className="flex items-start gap-4 mb-4">
                                <div className="w-14 h-14 bg-gray-200 rounded-full shrink-0" />
                                <div className="flex-1">
                                    <div className="h-5 bg-gray-200 rounded-md w-3/4 mb-2" />
                                    <div className="h-4 bg-gray-200 rounded-md w-1/2" />
                                </div>
                            </div>
                            <div className="space-y-2 mb-5">
                                <div className="h-4 bg-gray-200 rounded-md w-full" />
                                <div className="h-4 bg-gray-200 rounded-md w-2/3" />
                            </div>
                            <div className="flex gap-2 mb-5">
                                <div className="h-6 bg-gray-200 rounded-full w-16" />
                                <div className="h-6 bg-gray-200 rounded-full w-20" />
                                <div className="h-6 bg-gray-200 rounded-full w-14" />
                            </div>
                            <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                                <div className="h-5 bg-gray-200 rounded-md w-24" />
                                <div className="h-8 bg-gray-200 rounded-lg w-24" />
                            </div>
                        </div>
                    ))}
                </div>
             ) : freelancersQuery.data && freelancersQuery.data.length > 0 ? (
                <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.3 }}
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
                >
                    <AnimatePresence>
                        {freelancersQuery.data.map((freelancer, index) => (
                        <motion.div
                            key={freelancer.id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.3, delay: index * 0.05 }}
                        >
                            <FreelancerCard
                                freelancer={freelancer}
                                onInvite={(selected) => setSelectedFreelancer(selected)}
                            />
                        </motion.div>
                        ))}
                    </AnimatePresence>
                </motion.div>
            ) : (
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                    className="bg-white border border-gray-200 rounded-3xl p-16 text-center max-w-2xl mx-auto shadow-sm"
                >
                    <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Search className="w-10 h-10 text-gray-300" />
                    </div>
                    <h2 className="text-2xl font-bold text-[#333438] mb-2">No talent found</h2>
                    <p className="text-[#61636c] mb-6 max-w-sm mx-auto">
                        We couldn't find any freelancers matching your exact criteria. Try broadening your search terms or clearing some filters.
                    </p>
                    <button 
                        onClick={() => { setSearch(""); setSkill(""); setSpecialization(""); setAvailability(""); }}
                        className="px-6 py-2.5 bg-gray-100 text-[#333438] rounded-xl font-medium hover:bg-gray-200 transition-colors"
                    >
                        Clear all filters
                    </button>
                </motion.div>
            )}
        </div>
      </div>

      <InviteModal
        open={!!selectedFreelancer}
        onClose={() => setSelectedFreelancer(null)}
        inviteeId={selectedFreelancer?.id || ""}
        inviteeName={selectedFreelancer?.display_name || "Freelancer"}
      />
    </div>
  );
}
